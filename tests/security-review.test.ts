import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  subscription: { findUnique: vi.fn(), update: vi.fn() },
  paymentEvent: { findUnique: vi.fn(), create: vi.fn() },
  paymentTransaction: {
    findUnique: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
  },
  notification: { createMany: vi.fn(), create: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mocks }));
import { canRead, canViewProfile, hash, sign } from "@/lib/security";
import { processPaymentEvent, sandboxProvider } from "@/lib/payments";
import { readBoundedBody } from "@/lib/request";
const actor = { id: "fan", role: "SUBSCRIBER" } as User;
const sub = {
  id: "sub",
  subscriberId: "fan",
  creatorId: "creator",
  status: "PENDING",
  currentPeriodEnd: null,
  priceCents: 1000,
  currency: "USD",
};
const payment = {
  id: "payment",
  status: "PENDING",
  provider: "sandbox",
  amountCents: 1000,
  currency: "USD",
  subscription: sub,
  updatedAt: new Date(Date.now() - 10000),
};
function event(type = "payment.succeeded") {
  const raw = JSON.stringify({
    id: "event",
    transactionId: "payment",
    type,
    timestamp: Date.now(),
  });
  return [raw, sign(raw, "review-test-key")] as const;
}
beforeEach(() => {
  vi.clearAllMocks();
  process.env.PAYMENT_MODE = "sandbox";
  process.env.PAYMENT_WEBHOOK_SECRET = "review-test-key";
  mocks.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks) => Promise<unknown>) => callback(mocks),
  );
  mocks.paymentEvent.findUnique.mockResolvedValue(null);
  mocks.paymentTransaction.findUnique.mockResolvedValue(payment);
  mocks.paymentTransaction.findFirst.mockResolvedValue(null);
  mocks.user.findUnique.mockResolvedValue({
    id: "creator",
    role: "CREATOR",
    suspended: false,
    settings: { privateProfile: false },
  });
  mocks.subscription.findUnique.mockResolvedValue(null);
});
describe("private creator access", () => {
  it("hides a private profile and its public post from outsiders", async () => {
    mocks.user.findUnique.mockResolvedValue({
      role: "CREATOR",
      suspended: false,
      settings: { privateProfile: true },
    });
    expect(await canViewProfile("creator", null)).toBe(false);
    expect(await canViewProfile("creator", actor)).toBe(false);
    expect(await canRead("creator", "PUBLIC", actor)).toBe(false);
  });
  it("preserves private profile access for an entitled canceled subscriber until expiry", async () => {
    mocks.user.findUnique.mockResolvedValue({
      role: "CREATOR",
      suspended: false,
      settings: { privateProfile: true },
    });
    mocks.subscription.findUnique.mockResolvedValue({
      status: "CANCELED",
      currentPeriodEnd: new Date(Date.now() + 60000),
    });
    expect(await canRead("creator", "SUBSCRIBERS", actor)).toBe(true);
  });
  it("does not publish posts from suspended or demoted creators", async () => {
    mocks.user.findUnique.mockResolvedValue({
      role: "CREATOR",
      suspended: true,
      settings: { privateProfile: false },
    });
    expect(await canRead("creator", "PUBLIC", actor)).toBe(false);
    mocks.user.findUnique.mockResolvedValue({
      role: "SUBSCRIBER",
      suspended: false,
      settings: { privateProfile: false },
    });
    expect(await canRead("creator", "PUBLIC", actor)).toBe(false);
  });
});
describe("sandbox payment state transitions", () => {
  it("rejects expired signed payloads before any database work", () => {
    const raw = JSON.stringify({
      id: "old",
      transactionId: "payment",
      type: "payment.succeeded",
      timestamp: Date.now() - 600000,
    });
    expect(() =>
      sandboxProvider.verify(raw, sign(raw, "review-test-key")),
    ).toThrow("timestamp window");
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
  it("activates a period only after a verified event and matching transaction terms", async () => {
    await processPaymentEvent(...event());
    expect(mocks.paymentTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "SUCCEEDED", providerEventId: "event" },
      }),
    );
    expect(mocks.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "ACTIVE",
          currentPeriodEnd: expect.any(Date),
        }),
      }),
    );
  });
  it("treats a repeated event as idempotent and rejects conflicting payload reuse", async () => {
    const [raw, signature] = event();
    mocks.paymentEvent.findUnique.mockResolvedValue({ payloadHash: hash(raw) });
    expect(await processPaymentEvent(raw, signature)).toEqual({
      duplicate: true,
    });
    expect(mocks.paymentTransaction.update).not.toHaveBeenCalled();
    mocks.paymentEvent.findUnique.mockResolvedValue({
      payloadHash: "different",
    });
    await expect(processPaymentEvent(raw, signature)).rejects.toThrow(
      "conflicts",
    );
  });
  it("rejects mismatched amounts and a second overlapping period", async () => {
    mocks.paymentTransaction.findUnique.mockResolvedValue({
      ...payment,
      amountCents: 1,
    });
    await expect(processPaymentEvent(...event())).rejects.toThrow("terms");
    mocks.paymentTransaction.findUnique.mockResolvedValue({
      ...payment,
      subscription: {
        ...sub,
        status: "ACTIVE",
        currentPeriodEnd: new Date(Date.now() + 60000),
      },
    });
    await expect(processPaymentEvent(...event())).rejects.toThrow(
      "active paid period",
    );
    expect(mocks.subscription.update).not.toHaveBeenCalled();
  });
  it("preserves a later successful period when refunding historical billing", async () => {
    mocks.paymentTransaction.findUnique.mockResolvedValue({
      ...payment,
      status: "SUCCEEDED",
    });
    mocks.paymentTransaction.findFirst.mockResolvedValue({ id: "later" });
    await processPaymentEvent(...event("payment.refunded"));
    expect(mocks.subscription.update).not.toHaveBeenCalled();
  });
  it("revokes entitlement when the currently funded period is refunded", async () => {
    mocks.paymentTransaction.findUnique.mockResolvedValue({
      ...payment,
      status: "SUCCEEDED",
    });
    await processPaymentEvent(...event("payment.refunded"));
    expect(mocks.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "EXPIRED", renew: false }),
      }),
    );
  });
});
describe("streamed request limits", () => {
  it("bounds bodies without Content-Length", async () => {
    const req = new Request("http://localhost", {
      method: "POST",
      body: "123456",
    });
    await expect(readBoundedBody(req, 5)).rejects.toMatchObject({
      status: 413,
    });
  });
  it("preserves accepted UTF-8 bytes", async () => {
    const bytes = await readBoundedBody(
      new Request("http://localhost", { method: "POST", body: "héllo" }),
      20,
    );
    expect(new TextDecoder().decode(bytes)).toBe("héllo");
  });
});
