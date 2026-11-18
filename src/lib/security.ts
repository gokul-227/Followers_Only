import {
  createHash,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import type { User } from "@prisma/client";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  value: unknown,
  status: number,
  message: string,
): asserts value {
  if (!value) throw new HttpError(status, message);
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("hex");
export const publicUser = (u: User) => ({
  id: u.id,
  name: u.name,
  username: u.username,
  role: u.role,
  avatarId: u.avatarId,
  emailVerified: !!u.emailVerifiedAt,
});
export async function viewer() {
  const value = (await cookies()).get("fo_session")?.value;
  if (!value) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hash(value) },
    include: { user: true },
  });
  return session && session.expiresAt > new Date() && !session.user.suspended
    ? session.user
    : null;
}
export async function requireUser() {
  const user = await viewer();
  assert(user, 401, "Please sign in to continue.");
  return user;
}
export async function requireCreator() {
  const user = await requireUser();
  assert(
    user.role === "CREATOR" || user.role === "ADMIN",
    403,
    "Creator access required.",
  );
  return user;
}
export async function requireAdmin() {
  const user = await requireUser();
  assert(user.role === "ADMIN", 403, "Administrator access required.");
  return user;
}
export async function verifiedUser() {
  const user = await requireUser();
  assert(user.emailVerifiedAt, 403, "Verify your email address first.");
  return user;
}
export async function createSession(userId: string) {
  const previous = (await cookies()).get("fo_session")?.value;
  if (previous)
    await db.session.deleteMany({ where: { tokenHash: hash(previous) } });
  const value = token();
  const expires = new Date(Date.now() + 7 * 86400000);
  await db.session.create({
    data: { tokenHash: hash(value), userId, expiresAt: expires },
  });
  (await cookies()).set("fo_session", value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}
export async function logout() {
  const jar = await cookies();
  const value = jar.get("fo_session")?.value;
  if (value) await db.session.deleteMany({ where: { tokenHash: hash(value) } });
  jar.delete("fo_session");
}
export function checkOrigin(req: Request) {
  assert(
    process.env.NODE_ENV !== "production" || process.env.APP_URL,
    503,
    "Configure the canonical application URL before production.",
  );
  const expected = new URL(process.env.APP_URL ?? req.url).origin;
  assert(
    req.headers.get("origin") === expected,
    403,
    "Invalid request origin.",
  );
  assert(
    !req.headers.get("sec-fetch-site") ||
      req.headers.get("sec-fetch-site") !== "cross-site",
    403,
    "Cross-site request denied.",
  );
}
export async function rateLimit(key: string, max = 60, windowSeconds = 60) {
  const now = new Date();
  const rows = await db.$queryRaw<
    Array<{ count: number }>
  >`INSERT INTO "RateLimit" ("key","count","expiresAt","updatedAt") VALUES (${key},1,${new Date(now.getTime() + windowSeconds * 1000)},${now}) ON CONFLICT ("key") DO UPDATE SET "count" = CASE WHEN "RateLimit"."expiresAt" < ${now} THEN 1 ELSE "RateLimit"."count" + 1 END, "expiresAt" = CASE WHEN "RateLimit"."expiresAt" < ${now} THEN ${new Date(now.getTime() + windowSeconds * 1000)} ELSE "RateLimit"."expiresAt" END, "updatedAt"=${now} RETURNING "count"`;
  assert(rows[0].count <= max, 429, "Too many requests. Try again later.");
}
export async function audit(
  actorId: string | null,
  action: string,
  targetId: string,
  detail = "",
) {
  await db.auditLog.create({ data: { actorId, action, targetId, detail } });
}
export function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}
export function verifySignature(
  payload: string,
  signature: string | null,
  secret: string,
) {
  if (!signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(
    Buffer.from(sign(payload, secret), "hex"),
    Buffer.from(signature, "hex"),
  );
}
export function activeSubscription(
  s: { status: string; currentPeriodEnd: Date | null } | null,
) {
  return (
    !!s &&
    ["ACTIVE", "CANCELED"].includes(s.status) &&
    !!s.currentPeriodEnd &&
    s.currentPeriodEnd > new Date()
  );
}
export async function canViewProfile(authorId: string, user: User | null) {
  if (user?.id === authorId || user?.role === "ADMIN") return true;
  const author = await db.user.findUnique({
    where: { id: authorId },
    include: { settings: true },
  });
  if (!author || author.suspended) return false;
  if (!author.settings?.privateProfile) return true;
  if (!user) return false;
  return activeSubscription(
    await db.subscription.findUnique({
      where: {
        subscriberId_creatorId: { subscriberId: user.id, creatorId: authorId },
      },
    }),
  );
}
export async function canRead(
  authorId: string,
  visibility: string,
  user: User | null,
) {
  if (!(await canViewProfile(authorId, user))) return false;
  if (user?.id !== authorId && user?.role !== "ADMIN") {
    const author = await db.user.findUnique({
      where: { id: authorId },
      select: { role: true },
    });
    if (!author) return false;
    if (
      !["CREATOR", "ADMIN"].includes(author.role) &&
      (!user ||
        !activeSubscription(
          await db.subscription.findUnique({
            where: {
              subscriberId_creatorId: {
                subscriberId: user.id,
                creatorId: authorId,
              },
            },
          }),
        ))
    )
      return false;
  }
  if (
    user?.id === authorId ||
    user?.role === "ADMIN" ||
    visibility === "PUBLIC"
  )
    return true;
  if (!user) return false;
  return activeSubscription(
    await db.subscription.findUnique({
      where: {
        subscriberId_creatorId: { subscriberId: user.id, creatorId: authorId },
      },
    }),
  );
}
export async function requireProductionCreatorApproval(userId: string) {
  if (process.env.NODE_ENV !== "production") return;
  assert(
    process.env.PRODUCTION_SAFETY_APPROVED === "true",
    503,
    "Production publishing is disabled until age assurance, creator identity, consent and moderation operations are approved.",
  );
  const creator = await db.creatorProfile.findUnique({ where: { userId } });
  assert(
    creator?.verification === "APPROVED",
    403,
    "Creator verification must be approved before publishing or monetizing in production.",
  );
}
