import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  assert,
  HttpError,
  viewer,
  requireUser,
  requireCreator,
  requireAdmin,
  verifiedUser,
  publicUser,
  createSession,
  logout,
  checkOrigin,
  rateLimit,
  hash,
  audit,
  activeSubscription,
  canRead,
  canViewProfile,
  requireProductionCreatorApproval,
} from "@/lib/security";
import {
  creatorCards,
  feed,
  dashboard,
  adminData,
  conversations,
  thread,
  ownData,
} from "@/lib/queries";
import { sendAccountMail } from "@/lib/mail";
import { storeMedia } from "@/lib/storage";
import { sandboxEvent } from "@/lib/payments";
import { readBoundedBody } from "@/lib/request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const username = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-z][a-z0-9_]+$/, "Use lowercase letters, digits and underscores.")
  .refine(
    (v) =>
      ![
        "home",
        "feed",
        "explore",
        "search",
        "notifications",
        "messages",
        "subscriptions",
        "bookmarks",
        "settings",
        "creator",
        "admin",
        "api",
        "about",
        "creators",
        "terms",
        "privacy",
        "login",
        "register",
        "forgot-password",
        "reset-password",
        "verify-email",
      ].includes(v),
    "That username is reserved.",
  );
const password = z
  .string()
  .min(12)
  .max(72)
  .refine(
    (v) => Buffer.byteLength(v, "utf8") <= 72,
    "Password must be at most 72 UTF-8 bytes.",
  );
const id = z.string().min(1).max(100);
async function json(req: Request) {
  const body = new TextDecoder().decode(await readBoundedBody(req, 65536));
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}
async function notification(
  userId: string,
  type: string,
  text: string,
  href: string,
) {
  await db.notification.create({ data: { userId, type, text, href } });
}
async function handler(
  req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await context.params;
    const route = path.join("/");
    const url = new URL(req.url);
    const mutating = req.method !== "GET";
    if (mutating) {
      checkOrigin(req);
      await rateLimit("mutation-global", 600);
    }
    if (req.method === "GET") {
      const user = await viewer();
      if (route === "me")
        return NextResponse.json(user ? await ownData(user) : null);
      if (route === "creators")
        return NextResponse.json(
          await creatorCards(
            user,
            url.searchParams.get("q")?.slice(0, 100),
            url.searchParams.get("category")?.slice(0, 100),
            url.searchParams.get("free") === "true",
          ),
        );
      if (route === "feed") {
        await requireUser();
        return NextResponse.json(
          await feed(user, {
            bookmarks: url.searchParams.get("bookmarks") === "true",
            author: url.searchParams.get("author") ?? undefined,
            mine: url.searchParams.get("mine") === "true",
            media: url.searchParams.get("media") === "true",
            cursor: url.searchParams.get("cursor") ?? undefined,
          }),
        );
      }
      if (path[0] === "profile" && path[1]) {
        const creators = await creatorCards(user, "", "", false, path[1]);
        const creator = creators[0];
        assert(creator, 404, "Creator not found.");
        return NextResponse.json({
          creator,
          posts: await feed(user, {
            author: creator.username,
            media: url.searchParams.get("media") === "true",
            cursor: url.searchParams.get("cursor") ?? undefined,
          }),
        });
      }
      if (route === "dashboard")
        return NextResponse.json(await dashboard(await requireCreator()));
      if (route === "admin") {
        await requireAdmin();
        return NextResponse.json(await adminData());
      }
      if (route === "notifications") {
        const u = await requireUser();
        return NextResponse.json(
          await db.notification.findMany({
            where: { userId: u.id },
            orderBy: { createdAt: "desc" },
            take: 100,
          }),
        );
      }
      if (route === "subscriptions") {
        const u = await requireUser();
        const rows = await db.subscription.findMany({
          where: { subscriberId: u.id },
          include: {
            creator: {
              select: { id: true, name: true, username: true, avatarId: true },
            },
            transactions: { orderBy: { createdAt: "desc" } },
          },
          orderBy: { createdAt: "desc" },
        });
        return NextResponse.json(
          rows.map((s) => ({
            ...s,
            status:
              s.currentPeriodEnd && s.currentPeriodEnd < new Date()
                ? "EXPIRED"
                : s.status,
            entitled: activeSubscription(s),
          })),
        );
      }
      if (route === "conversations")
        return NextResponse.json(await conversations(await requireUser()));
      if (path[0] === "conversations" && path[1])
        return NextResponse.json(
          await thread(
            await requireUser(),
            path[1],
            url.searchParams.get("cursor") ?? undefined,
          ),
        );
      if (path[0] === "comments" && path[1]) {
        const p = await db.post.findUnique({
          where: { id: path[1] },
          include: { author: { select: { suspended: true } } },
        });
        assert(
          p && !p.removed && p.published && !p.author.suspended,
          404,
          "Post not found.",
        );
        assert(
          await canRead(p.authorId, p.visibility, user),
          403,
          "Subscribe to read comments.",
        );
        return NextResponse.json(
          await db.comment.findMany({
            where: { postId: p.id },
            include: {
              author: {
                select: {
                  id: true,
                  name: true,
                  username: true,
                  avatarId: true,
                },
              },
            },
            take: 100,
            orderBy: { createdAt: "asc" },
          }),
        );
      }
    }
    if (req.method === "POST") {
      if (route === "auth/register") {
        const data = z
          .object({
            email: z
              .email()
              .max(254)
              .transform((v) => v.toLowerCase()),
            username,
            name: z.string().min(2).max(70),
            password,
            ageConfirmed: z.literal(true),
            termsAccepted: z.literal(true),
          })
          .parse(await json(req));
        await rateLimit("register", 20, 3600);
        await rateLimit("register:" + hash(data.email), 3, 3600);
        const user = await db.user.create({
          data: {
            email: data.email,
            username: data.username,
            name: data.name,
            passwordHash: await bcrypt.hash(data.password, 12),
            ageConfirmedAt: new Date(),
            subscriber: { create: {} },
            settings: { create: {} },
          },
        });
        await createSession(user.id);
        let emailDelivery: "sent" | "pending" = "sent";
        try {
          await sendAccountMail(user.id, user.email, "verify");
        } catch {
          emailDelivery = "pending";
        }
        await audit(user.id, "account.register", user.id);
        return NextResponse.json(
          { ...publicUser(user), emailDelivery },
          { status: 201 },
        );
      }
      if (route === "auth/login") {
        const data = z
          .object({
            email: z.email().transform((v) => v.toLowerCase()),
            password: z
              .string()
              .max(72)
              .refine((v) => Buffer.byteLength(v, "utf8") <= 72),
          })
          .parse(await json(req));
        await rateLimit("login", 200, 900);
        await rateLimit("login:" + hash(data.email), 12, 900);
        const user = await db.user.findUnique({ where: { email: data.email } });
        const valid = await bcrypt.compare(
          data.password,
          user?.passwordHash ??
            "$2b$12$f5vRLv4J7hncZ7tWe5M7Ze7TYfTltyj15KoK5XvPnj2Zg3ri.ZdKq",
        );
        assert(
          valid && user && !user.suspended,
          401,
          "Invalid email or password.",
        );
        await createSession(user.id);
        await audit(user.id, "account.login", user.id);
        return NextResponse.json(publicUser(user));
      }
      if (route === "auth/logout") {
        await logout();
        return NextResponse.json({ ok: true });
      }
      if (route === "auth/forgot") {
        const { email } = z
          .object({ email: z.email().transform((v) => v.toLowerCase()) })
          .parse(await json(req));
        await rateLimit("recovery", 30, 3600);
        await rateLimit("recovery:" + hash(email), 3, 3600);
        const user = await db.user.findUnique({ where: { email } });
        if (user) await sendAccountMail(user.id, user.email, "reset");
        return NextResponse.json({
          message:
            "If the account exists, recovery instructions have been sent.",
        });
      }
      if (route === "auth/resend") {
        const user = await requireUser();
        await rateLimit("verify:" + user.id, 3, 3600);
        if (!user.emailVerifiedAt)
          await sendAccountMail(user.id, user.email, "verify");
        return NextResponse.json({ ok: true });
      }
      if (route === "auth/reset" || route === "auth/verify") {
        await rateLimit("account-token", 30, 60);
        const data = z
          .object({
            token: z.string().length(64),
            password: password.optional(),
          })
          .parse(await json(req));
        const purpose = route.endsWith("reset") ? "reset" : "verify";
        if (purpose === "reset")
          assert(data.password, 400, "A new password is required.");
        const passwordHash =
          purpose === "reset" && data.password
            ? await bcrypt.hash(data.password, 12)
            : undefined;
        await db.$transaction(async (tx) => {
          const t = await tx.accountToken.findUnique({
            where: { tokenHash: hash(data.token) },
          });
          assert(
            t && t.purpose === purpose && !t.usedAt && t.expiresAt > new Date(),
            400,
            "This link is invalid or expired.",
          );
          const used = await tx.accountToken.updateMany({
            where: { id: t.id, usedAt: null },
            data: { usedAt: new Date() },
          });
          assert(used.count === 1, 400, "This link has already been used.");
          await tx.user.update({
            where: { id: t.userId },
            data:
              purpose === "reset"
                ? { passwordHash }
                : { emailVerifiedAt: new Date() },
          });
          if (purpose === "reset") {
            await tx.session.deleteMany({ where: { userId: t.userId } });
            await tx.accountToken.updateMany({
              where: { userId: t.userId, purpose: "reset", usedAt: null },
              data: { usedAt: new Date() },
            });
          }
          await tx.auditLog.create({
            data: {
              actorId: t.userId,
              action: "account." + purpose,
              targetId: t.userId,
            },
          });
        });
        return NextResponse.json({ ok: true });
      }
      const user = await requireUser();
      await rateLimit("user:" + user.id, 100);
      if (route === "auth/password") {
        await verifiedUser();
        await rateLimit("password-change:" + user.id, 10, 3600);
        const data = z
          .object({
            currentPassword: z
              .string()
              .max(72)
              .refine((v) => Buffer.byteLength(v, "utf8") <= 72),
            newPassword: password,
          })
          .parse(await json(req));
        assert(
          await bcrypt.compare(data.currentPassword, user.passwordHash),
          401,
          "Your current password is incorrect.",
        );
        const passwordHash = await bcrypt.hash(data.newPassword, 12);
        await db.$transaction([
          db.user.update({ where: { id: user.id }, data: { passwordHash } }),
          db.session.deleteMany({ where: { userId: user.id } }),
          db.accountToken.updateMany({
            where: { userId: user.id, purpose: "reset", usedAt: null },
            data: { usedAt: new Date() },
          }),
          db.auditLog.create({
            data: {
              actorId: user.id,
              action: "account.password.change",
              targetId: user.id,
            },
          }),
        ]);
        await createSession(user.id);
        return NextResponse.json({
          ok: true,
          message: "Password updated. Other sessions have been signed out.",
        });
      }
      if (route === "settings") {
        const data = z
          .object({
            name: z.string().min(2).max(70),
            username,
            emailNotifications: z.boolean(),
            allowMessages: z.boolean(),
            privateProfile: z.boolean(),
            avatarId: id.nullable().optional(),
          })
          .parse(await json(req));
        if (data.avatarId)
          assert(
            await db.media.findFirst({
              where: { id: data.avatarId, ownerId: user.id, purpose: "avatar" },
            }),
            400,
            "Invalid avatar.",
          );
        await db.user.update({
          where: { id: user.id },
          data: {
            name: data.name,
            username: data.username,
            ...(data.avatarId !== undefined ? { avatarId: data.avatarId } : {}),
            settings: {
              upsert: {
                create: {
                  emailNotifications: data.emailNotifications,
                  allowMessages: data.allowMessages,
                  privateProfile: data.privateProfile,
                },
                update: {
                  emailNotifications: data.emailNotifications,
                  allowMessages: data.allowMessages,
                  privateProfile: data.privateProfile,
                },
              },
            },
          },
        });
        await audit(user.id, "account.settings", user.id);
        return NextResponse.json({ ok: true });
      }
      if (route === "creator/profile") {
        await verifiedUser();
        const data = z
          .object({
            bio: z.string().max(1500),
            category: z.enum([
              "Art & design",
              "Photography",
              "Music",
              "Wellness",
              "Food",
              "Lifestyle",
            ]),
            location: z.string().max(100),
            website: z.union([
              z.literal(""),
              z
                .url()
                .refine(
                  (v) => /^https?:\/\//.test(v),
                  "Use an HTTP or HTTPS URL.",
                ),
            ]),
            monthlyPriceCents: z.number().int().min(0).max(100000),
            consent: z.literal(true),
            coverId: id.nullable().optional(),
          })
          .parse(await json(req));
        if (data.coverId)
          assert(
            await db.media.findFirst({
              where: { id: data.coverId, ownerId: user.id, purpose: "cover" },
            }),
            400,
            "Invalid cover.",
          );
        const fields = {
          bio: data.bio,
          category: data.category,
          location: data.location,
          website: data.website,
          monthlyPriceCents: data.monthlyPriceCents,
          ...(data.coverId !== undefined ? { coverId: data.coverId } : {}),
        };
        await db.$transaction([
          db.creatorProfile.upsert({
            where: { userId: user.id },
            create: {
              userId: user.id,
              ...fields,
              consentAcceptedAt: new Date(),
            },
            update: fields,
          }),
          db.user.update({
            where: { id: user.id },
            data: { role: user.role === "ADMIN" ? "ADMIN" : "CREATOR" },
          }),
        ]);
        await audit(user.id, "creator.profile", user.id);
        return NextResponse.json({ ok: true });
      }
      if (route === "creator/verification") {
        await requireCreator();
        const profile = await db.creatorProfile.findUnique({
          where: { userId: user.id },
        });
        assert(profile, 400, "Create your creator profile first.");
        assert(
          profile.verification !== "APPROVED",
          409,
          "Your creator verification is already approved.",
        );
        await db.creatorProfile.update({
          where: { userId: user.id },
          data: {
            verification: "PENDING",
            verificationNote: "Creator requested manual verification.",
          },
        });
        await audit(user.id, "creator.verification.request", user.id);
        return NextResponse.json({ ok: true });
      }
      if (route === "uploads") {
        await verifiedUser();
        const bytes = await readBoundedBody(req, 11 * 1024 * 1024);
        const form = await new Response(bytes, {
          headers: { "content-type": req.headers.get("content-type") ?? "" },
        }).formData();
        const file = form.get("file");
        assert(file instanceof File, 400, "Choose a file.");
        const purpose = String(form.get("purpose") ?? "post");
        if (purpose === "post" || purpose === "cover") await requireCreator();
        const media = await storeMedia(user, file, purpose);
        return NextResponse.json(
          { id: media.id, mime: media.mime },
          { status: 201 },
        );
      }
      if (route === "posts") {
        await requireCreator();
        await verifiedUser();
        assert(
          await db.creatorProfile.findUnique({ where: { userId: user.id } }),
          400,
          "Create your creator profile before publishing.",
        );
        await requireProductionCreatorApproval(user.id);
        const data = z
          .object({
            id: id.optional(),
            body: z.string().min(1).max(10000),
            preview: z.string().min(1).max(280),
            visibility: z.enum(["PUBLIC", "SUBSCRIBERS"]),
            published: z.boolean(),
            mediaIds: z.array(id).max(8),
            consent: z.literal(true),
          })
          .parse(await json(req));
        if (data.id)
          assert(
            await db.post.findFirst({
              where: { id: data.id, authorId: user.id, removed: false },
            }),
            403,
            "You cannot edit this post.",
          );
        const media = await db.media.findMany({
          where: {
            id: { in: data.mediaIds },
            ownerId: user.id,
            purpose: "post",
            processingStatus: "READY",
          },
        });
        assert(
          data.mediaIds.length === new Set(data.mediaIds).size &&
            media.length === data.mediaIds.length,
          400,
          "Invalid or duplicate post attachment.",
        );
        for (const m of media) {
          const attached = await db.postMedia.findFirst({
            where: {
              mediaId: m.id,
              ...(data.id ? { postId: { not: data.id } } : {}),
            },
          });
          assert(!attached, 400, "Upload a new attachment for each post.");
        }
        const fields = {
          body: data.body,
          preview: data.preview,
          visibility: data.visibility,
          published: data.published,
          consentConfirmed: true,
        };
        const post = await db.$transaction(
          async (tx) => {
            for (const mediaId of data.mediaIds)
              assert(
                !(await tx.postMedia.findFirst({
                  where: {
                    mediaId,
                    ...(data.id ? { postId: { not: data.id } } : {}),
                  },
                })),
                409,
                "Attachment already belongs to another post.",
              );
            if (data.id) {
              await tx.postMedia.deleteMany({ where: { postId: data.id } });
              return tx.post.update({
                where: { id: data.id },
                data: {
                  ...fields,
                  media: {
                    create: data.mediaIds.map((mediaId, position) => ({
                      mediaId,
                      position,
                    })),
                  },
                },
              });
            }
            return tx.post.create({
              data: {
                authorId: user.id,
                ...fields,
                media: {
                  create: data.mediaIds.map((mediaId, position) => ({
                    mediaId,
                    position,
                  })),
                },
              },
            });
          },
          { isolationLevel: "Serializable" },
        );
        await audit(user.id, "post.save", post.id);
        return NextResponse.json({ id: post.id }, { status: 201 });
      }
      if (path[0] === "posts" && path[1]) {
        const post = await db.post.findUnique({
          where: { id: path[1] },
          include: { author: { select: { suspended: true } } },
        });
        assert(
          post && !post.removed && !post.author.suspended,
          404,
          "Post not found.",
        );
        if (path[2] === "delete") {
          assert(
            post.authorId === user.id,
            403,
            "You cannot delete this post.",
          );
          await db.post.update({
            where: { id: post.id },
            data: { removed: true },
          });
          await audit(user.id, "post.delete", post.id);
          return NextResponse.json({ ok: true });
        }
        assert(
          post.published || post.authorId === user.id,
          404,
          "Post not found.",
        );
        assert(
          await canRead(post.authorId, post.visibility, user),
          403,
          "Subscribe to interact with this content.",
        );
        if (path[2] === "like" || path[2] === "bookmark") {
          await verifiedUser();
          const where = { postId_userId: { postId: post.id, userId: user.id } };
          const existing =
            path[2] === "like"
              ? await db.like.findUnique({ where })
              : await db.bookmark.findUnique({ where });
          if (existing) {
            if (path[2] === "like") await db.like.delete({ where });
            else await db.bookmark.delete({ where });
          } else {
            const data = { postId: post.id, userId: user.id };
            if (path[2] === "like") await db.like.create({ data });
            else await db.bookmark.create({ data });
            if (path[2] === "like" && post.authorId !== user.id)
              await notification(
                post.authorId,
                "like",
                `${user.name} liked your post.`,
                "/home",
              );
          }
          return NextResponse.json({ active: !existing });
        }
        if (path[2] === "comments") {
          await verifiedUser();
          const { body } = z
            .object({ body: z.string().min(1).max(1000) })
            .parse(await json(req));
          const comment = await db.comment.create({
            data: { postId: post.id, authorId: user.id, body },
          });
          if (post.authorId !== user.id)
            await notification(
              post.authorId,
              "comment",
              `${user.name} commented on your post.`,
              "/creator/posts",
            );
          return NextResponse.json({ id: comment.id }, { status: 201 });
        }
      }
      if (route === "follow") {
        await verifiedUser();
        const { creatorId } = z
          .object({ creatorId: id })
          .parse(await json(req));
        assert(
          creatorId !== user.id &&
            (await db.creatorProfile.findFirst({
              where: {
                userId: creatorId,
                user: { suspended: false, role: { in: ["CREATOR", "ADMIN"] } },
              },
            })) &&
            (await canViewProfile(creatorId, user)),
          400,
          "Invalid creator.",
        );
        const where = {
          followerId_followedId: { followerId: user.id, followedId: creatorId },
        };
        const old = await db.follow.findUnique({ where });
        if (old) await db.follow.delete({ where });
        else {
          await db.follow.create({
            data: { followerId: user.id, followedId: creatorId },
          });
          await notification(
            creatorId,
            "follow",
            `${user.name} followed you.`,
            "/creator/subscribers",
          );
        }
        return NextResponse.json({ following: !old });
      }
      if (route === "subscriptions/checkout") {
        await verifiedUser();
        const data = z
          .object({ creatorId: id, idempotencyKey: z.string().uuid() })
          .parse(await json(req));
        assert(
          data.creatorId !== user.id,
          400,
          "You cannot subscribe to yourself.",
        );
        const creator = await db.creatorProfile.findFirst({
          where: {
            userId: data.creatorId,
            user: { suspended: false, role: { in: ["CREATOR", "ADMIN"] } },
          },
        });
        assert(
          creator && (await canViewProfile(data.creatorId, user)),
          404,
          "Creator not found.",
        );
        await requireProductionCreatorApproval(data.creatorId);
        const result = await db.$transaction(
          async (tx) => {
            const old = await tx.paymentTransaction.findUnique({
              where: { idempotencyKey: data.idempotencyKey },
            });
            if (old) {
              assert(
                old.userId === user.id &&
                  old.subscriptionId ===
                    (
                      await tx.subscription.findUnique({
                        where: {
                          subscriberId_creatorId: {
                            subscriberId: user.id,
                            creatorId: data.creatorId,
                          },
                        },
                      })
                    )?.id,
                409,
                "Checkout key already used.",
              );
              return old;
            }
            const s = await tx.subscription.findUnique({
              where: {
                subscriberId_creatorId: {
                  subscriberId: user.id,
                  creatorId: data.creatorId,
                },
              },
            });
            assert(
              !activeSubscription(s ?? null),
              409,
              "This subscription is already active.",
            );
            if (s) {
              const pending = await tx.paymentTransaction.findFirst({
                where: { subscriptionId: s.id, status: "PENDING" },
              });
              if (pending) return pending;
            }
            const sub = await tx.subscription.upsert({
              where: {
                subscriberId_creatorId: {
                  subscriberId: user.id,
                  creatorId: data.creatorId,
                },
              },
              create: {
                subscriberId: user.id,
                creatorId: data.creatorId,
                priceCents: creator.monthlyPriceCents,
              },
              update: {
                status: "PENDING",
                priceCents: creator.monthlyPriceCents,
              },
            });
            return tx.paymentTransaction.create({
              data: {
                userId: user.id,
                subscriptionId: sub.id,
                amountCents: creator.monthlyPriceCents,
                idempotencyKey: data.idempotencyKey,
              },
            });
          },
          { isolationLevel: "Serializable" },
        );
        return NextResponse.json({
          transactionId: result.id,
          amountCents: result.amountCents,
          status: result.status,
          mode: "sandbox",
        });
      }
      if (route === "subscriptions/confirm") {
        await verifiedUser();
        const { transactionId } = z
          .object({ transactionId: id })
          .parse(await json(req));
        const payment = await db.paymentTransaction.findFirst({
          where: { id: transactionId, userId: user.id },
        });
        assert(payment, 404, "Transaction not found.");
        if (payment.status === "SUCCEEDED")
          return NextResponse.json({ ok: true, mode: "sandbox" });
        await sandboxEvent(payment.id, "payment.succeeded");
        return NextResponse.json({ ok: true, mode: "sandbox" });
      }
      if (route === "subscriptions/cancel" || route === "subscriptions/renew") {
        const { subscriptionId } = z
          .object({ subscriptionId: id })
          .parse(await json(req));
        const s = await db.subscription.findFirst({
          where: { id: subscriptionId, subscriberId: user.id },
        });
        assert(
          s && activeSubscription(s),
          400,
          "Active subscription not found.",
        );
        const renew = route.endsWith("renew");
        await db.subscription.update({
          where: { id: s.id },
          data: { renew, status: renew ? "ACTIVE" : "CANCELED" },
        });
        await notification(
          user.id,
          "subscription",
          renew
            ? "Renewal preference enabled. Sandbox renewals require explicit confirmation."
            : "Renewal canceled. Access continues until the period ends.",
          "/subscriptions",
        );
        await audit(
          user.id,
          "subscription." + (renew ? "renew" : "cancel"),
          s.id,
        );
        return NextResponse.json({ ok: true });
      }
      if (route === "subscriptions/refund") {
        await verifiedUser();
        const { transactionId } = z
          .object({ transactionId: id })
          .parse(await json(req));
        const p = await db.paymentTransaction.findFirst({
          where: { id: transactionId, userId: user.id },
        });
        assert(p, 404, "Transaction not found.");
        await sandboxEvent(p.id, "payment.refunded");
        return NextResponse.json({ ok: true, mode: "sandbox" });
      }
      if (route === "conversations") {
        await verifiedUser();
        const { recipientId } = z
          .object({ recipientId: id })
          .parse(await json(req));
        assert(recipientId !== user.id, 400, "Choose another person.");
        const recipient = await db.user.findFirst({
          where: { id: recipientId, suspended: false },
          include: { settings: true },
        });
        assert(
          recipient &&
            recipient.settings?.allowMessages !== false &&
            (await canViewProfile(recipient.id, user)),
          403,
          "This account is not accepting messages.",
        );
        const pairKey = [user.id, recipientId].sort().join(":");
        const c = await db.conversation.upsert({
          where: { pairKey },
          create: {
            pairKey,
            participants: {
              create: [{ userId: user.id }, { userId: recipientId }],
            },
          },
          update: {},
        });
        return NextResponse.json({ id: c.id });
      }
      if (path[0] === "conversations" && path[1]) {
        const c = await db.conversation.findFirst({
          where: { id: path[1], participants: { some: { userId: user.id } } },
          include: {
            participants: {
              include: { user: { include: { settings: true } } },
            },
          },
        });
        assert(c, 403, "Conversation access denied.");
        if (path[2] === "read") {
          await db.conversationParticipant.update({
            where: {
              conversationId_userId: { conversationId: c.id, userId: user.id },
            },
            data: { lastReadAt: new Date() },
          });
          return NextResponse.json({ ok: true });
        }
        if (path[2] === "messages") {
          await verifiedUser();
          const data = z
            .object({ body: z.string().max(4000), mediaId: id.optional() })
            .parse(await json(req));
          assert(
            data.body.trim() || data.mediaId,
            400,
            "Write a message or attach media.",
          );
          const recipient = c.participants.find((p) => p.userId !== user.id);
          assert(
            recipient &&
              !recipient.user.suspended &&
              recipient.user.settings?.allowMessages !== false,
            403,
            "This account is not accepting messages.",
          );
          if (data.mediaId)
            assert(
              await db.media.findFirst({
                where: {
                  id: data.mediaId,
                  ownerId: user.id,
                  purpose: "message",
                  messages: { none: {} },
                },
              }),
              400,
              "Invalid attachment.",
            );
          const m = await db.$transaction(async (tx) => {
            const message = await tx.message.create({
              data: { conversationId: c.id, senderId: user.id, ...data },
            });
            await tx.conversation.update({
              where: { id: c.id },
              data: { updatedAt: new Date() },
            });
            await tx.notification.create({
              data: {
                userId: recipient.userId,
                type: "message",
                text: `New message from ${user.name}.`,
                href: "/messages?conversation=" + c.id,
              },
            });
            return message;
          });
          return NextResponse.json({ id: m.id }, { status: 201 });
        }
      }
      if (route === "notifications/read") {
        const { id: notificationId } = z
          .object({ id: id.optional() })
          .parse(await json(req));
        await db.notification.updateMany({
          where: {
            userId: user.id,
            ...(notificationId ? { id: notificationId } : {}),
          },
          data: { readAt: new Date() },
        });
        return NextResponse.json({ ok: true });
      }
      if (route === "reports") {
        const data = z
          .object({
            postId: id.optional(),
            reason: z.string().min(10).max(2000),
          })
          .parse(await json(req));
        if (data.postId)
          assert(
            await db.post.findUnique({ where: { id: data.postId } }),
            404,
            "Post not found.",
          );
        const report = await db.report.create({
          data: { reporterId: user.id, ...data },
        });
        await audit(user.id, "report.create", report.id);
        return NextResponse.json({ id: report.id }, { status: 201 });
      }
      if (route === "admin/action") {
        await requireAdmin();
        const data = z
          .object({
            action: z.enum([
              "suspend",
              "unsuspend",
              "approve",
              "reject",
              "role",
              "remove",
              "restore",
              "resolve",
              "dismiss",
            ]),
            targetId: id,
            role: z.enum(["SUBSCRIBER", "CREATOR", "ADMIN"]).optional(),
            note: z.string().min(5).max(1000),
          })
          .parse(await json(req));
        assert(
          data.targetId !== user.id ||
            !["suspend", "role"].includes(data.action),
          400,
          "You cannot suspend or change your own admin access.",
        );
        await db.$transaction(async (tx) => {
          if (["suspend", "unsuspend", "role"].includes(data.action)) {
            if (data.action === "role")
              assert(data.role, 400, "Choose a role.");
            await tx.user.update({
              where: { id: data.targetId },
              data:
                data.action === "role"
                  ? { role: data.role }
                  : { suspended: data.action === "suspend" },
            });
            if (data.action === "suspend")
              await tx.session.deleteMany({ where: { userId: data.targetId } });
            if (data.action === "role" && data.role === "SUBSCRIBER")
              await tx.subscription.updateMany({
                where: {
                  creatorId: data.targetId,
                  status: { in: ["ACTIVE", "CANCELED"] },
                },
                data: { renew: false, status: "CANCELED" },
              });
          }
          if (["approve", "reject"].includes(data.action))
            await tx.creatorProfile.update({
              where: { userId: data.targetId },
              data: {
                verification:
                  data.action === "approve" ? "APPROVED" : "REJECTED",
                verificationNote: data.note,
              },
            });
          if (["remove", "restore"].includes(data.action))
            await tx.post.update({
              where: { id: data.targetId },
              data: { removed: data.action === "remove" },
            });
          if (["resolve", "dismiss"].includes(data.action))
            await tx.report.update({
              where: { id: data.targetId },
              data: {
                status: data.action === "resolve" ? "RESOLVED" : "DISMISSED",
                resolution: data.note,
              },
            });
          await tx.auditLog.create({
            data: {
              actorId: user.id,
              action: "admin." + data.action,
              targetId: data.targetId,
              detail: data.note,
            },
          });
        });
        return NextResponse.json({ ok: true });
      }
    }
    throw new HttpError(404, "Endpoint not found.");
  } catch (error) {
    if (error instanceof HttpError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    if (error instanceof z.ZodError)
      return NextResponse.json(
        {
          error: error.issues
            .map((e) => `${e.path.join(".")}: ${e.message}`)
            .join("; "),
        },
        { status: 400 },
      );
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002")
        return NextResponse.json(
          { error: "This value already exists. Refresh and try again." },
          { status: 409 },
        );
      if (error.code === "P2034")
        return NextResponse.json(
          { error: "A concurrent update occurred. Please try again." },
          { status: 409 },
        );
      if (error.code === "P2025")
        return NextResponse.json(
          { error: "Record not found." },
          { status: 404 },
        );
    }
    console.error(
      "API failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
async function privateHandler(
  req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const response = await handler(req, context);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}
export const GET = privateHandler;
export const POST = privateHandler;
