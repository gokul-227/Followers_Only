import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import {
  assert,
  activeSubscription,
  hash,
  sign,
  verifySignature,
} from "./security";
const eventSchema = z.object({
  id: z.string().min(1).max(200),
  transactionId: z.string(),
  type: z.enum(["payment.succeeded", "payment.failed", "payment.refunded"]),
  timestamp: z.number().int(),
});
export interface PaymentProvider {
  name: string;
  verify(raw: string, signature: string | null): z.infer<typeof eventSchema>;
}
export const sandboxProvider: PaymentProvider = {
  name: "sandbox",
  verify(raw, signature) {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    assert(secret, 503, "Payment signing key is not configured.");
    assert(
      verifySignature(raw, signature, secret),
      401,
      "Invalid webhook signature.",
    );
    const event = eventSchema.parse(JSON.parse(raw));
    assert(
      Math.abs(Date.now() - event.timestamp) < 300000,
      400,
      "Payment event is outside the accepted timestamp window.",
    );
    return event;
  },
};
export function paymentProvider() {
  assert(
    process.env.PAYMENT_MODE === "sandbox",
    503,
    "Production billing is not enabled.",
  );
  return sandboxProvider;
}
export async function processPaymentEvent(
  raw: string,
  signature: string | null,
) {
  const provider = paymentProvider();
  const event = provider.verify(raw, signature);
  return db.$transaction(
    async (tx) => {
      const old = await tx.paymentEvent.findUnique({ where: { id: event.id } });
      if (old) {
        assert(
          old.payloadHash === hash(raw),
          409,
          "Payment event conflicts with an earlier event.",
        );
        return { duplicate: true };
      }
      const payment = await tx.paymentTransaction.findUnique({
        where: { id: event.transactionId },
        include: { subscription: true },
      });
      assert(
        payment && payment.provider === provider.name,
        404,
        "Transaction not found.",
      );
      await tx.paymentEvent.create({
        data: { id: event.id, payloadHash: hash(raw) },
      });
      const sub = payment.subscription;
      if (event.type === "payment.succeeded") {
        if (process.env.NODE_ENV === "production") {
          assert(
            process.env.PRODUCTION_SAFETY_APPROVED === "true",
            503,
            "Production creator operations are not approved.",
          );
          const creator = await tx.creatorProfile.findUnique({
            where: { userId: sub.creatorId },
            include: { user: { select: { suspended: true, role: true } } },
          });
          assert(
            creator?.verification === "APPROVED" &&
              !creator.user.suspended &&
              ["CREATOR", "ADMIN"].includes(creator.user.role),
            403,
            "Creator is unavailable for subscription activation.",
          );
        }
        assert(
          payment.status === "PENDING",
          409,
          "Transaction cannot be completed in its current state.",
        );
        assert(
          !activeSubscription(sub),
          409,
          "This subscription already has an active paid period.",
        );
        assert(
          payment.amountCents === sub.priceCents &&
            payment.currency === sub.currency,
          409,
          "Transaction terms do not match the subscription.",
        );
        await tx.paymentTransaction.update({
          where: { id: payment.id },
          data: { status: "SUCCEEDED", providerEventId: event.id },
        });
        const start = Date.now();
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            status: "ACTIVE",
            currentPeriodEnd: new Date(start + 30 * 86400000),
          },
        });
        await tx.notification.createMany({
          data: [
            {
              userId: sub.creatorId,
              type: "subscriber",
              text: "A subscriber joined your circle (sandbox).",
              href: "/creator/subscribers",
            },
            {
              userId: sub.subscriberId,
              type: "subscription",
              text: "Your sandbox subscription is active.",
              href: "/subscriptions",
            },
          ],
        });
      } else if (event.type === "payment.refunded") {
        assert(
          payment.status === "SUCCEEDED",
          409,
          "Only completed sandbox transactions can be refunded.",
        );
        await tx.paymentTransaction.update({
          where: { id: payment.id },
          data: { status: "REFUNDED" },
        });
        const laterPayment = await tx.paymentTransaction.findFirst({
          where: {
            subscriptionId: sub.id,
            status: "SUCCEEDED",
            id: { not: payment.id },
            updatedAt: { gte: payment.updatedAt },
          },
          orderBy: { updatedAt: "desc" },
        });
        if (!laterPayment)
          await tx.subscription.update({
            where: { id: sub.id },
            data: {
              status: "EXPIRED",
              renew: false,
              currentPeriodEnd: new Date(),
            },
          });
        await tx.notification.create({
          data: {
            userId: sub.subscriberId,
            type: "subscription",
            text: "Your sandbox refund was recorded.",
            href: "/subscriptions",
          },
        });
      } else {
        assert(
          payment.status === "PENDING",
          409,
          "Transaction is already finalized.",
        );
        await tx.paymentTransaction.update({
          where: { id: payment.id },
          data: { status: "FAILED" },
        });
      }
      await tx.auditLog.create({
        data: {
          action: event.type,
          targetId: payment.id,
          detail: "Verified sandbox provider event",
        },
      });
      return { duplicate: false };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
export async function sandboxEvent(
  transactionId: string,
  type: z.infer<typeof eventSchema>["type"],
) {
  paymentProvider();
  const raw = JSON.stringify({
    id: crypto.randomUUID(),
    transactionId,
    type,
    timestamp: Date.now(),
  });
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  assert(secret, 503, "Payment signing key is not configured.");
  return processPaymentEvent(raw, sign(raw, secret));
}
