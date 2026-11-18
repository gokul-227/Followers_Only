import {
  test,
  expect,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const origin = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
const password = "FollowersOnly!2026";
async function checked(response: APIResponse, status = 200) {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}
async function post(
  ctx: APIRequestContext,
  route: string,
  data: unknown,
  status = 200,
) {
  return checked(
    await ctx.post("/api/" + route, { data, headers: { origin } }),
    status,
  );
}
async function localToken(userId: string, purpose: "verify" | "reset") {
  const dir = path.join(process.cwd(), ".local", "mail");
  let text = "";
  await expect
    .poll(async () => {
      const files = (await readdir(dir))
        .filter((f) => f.endsWith(`-${purpose}-${userId}.txt`))
        .sort();
      if (!files.length) return "";
      text = await readFile(path.join(dir, files.at(-1)!), "utf8");
      return text;
    })
    .toContain("?token=");
  const match = text.match(/\?token=([a-f0-9]{64})/);
  expect(match).not.toBeNull();
  return match![1];
}
async function signup(ctx: APIRequestContext, label: string, suffix: string) {
  const username = `qa_${label}_${suffix}`;
  const email = `${username}@example.test`;
  const user = await post(
    ctx,
    "auth/register",
    {
      email,
      username,
      name: `QA ${label}`,
      password,
      ageConfirmed: true,
      termsAccepted: true,
    },
    201,
  );
  const verifyToken = await localToken(user.id, "verify");
  await post(ctx, "auth/verify", { token: verifyToken });
  return { ...user, email, username };
}
test("real database creator/subscriber lifecycle and authorization boundaries", async ({
  playwright,
}) => {
  const creator = await playwright.request.newContext({ baseURL: origin });
  const fan = await playwright.request.newContext({ baseURL: origin });
  const stranger = await playwright.request.newContext({ baseURL: origin });
  const guest = await playwright.request.newContext({ baseURL: origin });
  const admin = await playwright.request.newContext({ baseURL: origin });
  let fixtureCreatorId: string | undefined;
  const suffix = Date.now().toString(36);
  try {
    for (const route of [
      "feed",
      "notifications",
      "conversations",
      "subscriptions",
      "dashboard",
      "admin",
    ])
      expect((await guest.get("/api/" + route)).status()).toBe(401);
    expect(
      (
        await guest.post("/api/auth/register", {
          data: {},
          headers: { origin: "https://attacker.example" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await guest.post("/api/auth/register", {
          data: { email: "invalid", password: "short", ageConfirmed: false },
          headers: { origin },
        })
      ).status(),
    ).toBe(400);
    const c = await signup(creator, "creator", suffix);
    fixtureCreatorId = c.id;
    const f = await signup(fan, "fan", suffix);
    const outsider = await signup(stranger, "outsider", suffix);
    const me = await checked(await creator.get("/api/me"));
    expect(me.emailVerified).toBe(true);
    expect(me.passwordHash).toBeUndefined();
    expect((await fan.get("/api/admin")).status()).toBe(403);
    expect((await fan.get("/api/dashboard")).status()).toBe(403);
    await post(creator, "creator/profile", {
      bio: "A clearly fictional QA creator.",
      category: "Art & design",
      location: "Test studio",
      website: "https://example.test",
      monthlyPriceCents: 1200,
      consent: true,
    });
    const profile = await checked(
      await guest.get("/api/profile/" + c.username),
    );
    expect(profile.creator.bio).toContain("fictional");
    expect(profile.creator.monthlyPriceCents).toBe(1200);
    const invalidUpload = await creator.post("/api/uploads", {
      headers: { origin },
      multipart: {
        purpose: "post",
        file: {
          name: "malicious.jpg",
          mimeType: "image/jpeg",
          buffer: Buffer.from("<script>alert(1)</script>"),
        },
      },
    });
    expect(invalidUpload.status()).toBe(400);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
    const media = await checked(
      await creator.post("/api/uploads", {
        headers: { origin },
        multipart: {
          purpose: "post",
          file: { name: "test.png", mimeType: "image/png", buffer: png },
        },
      }),
      201,
    );
    const body = `Exclusive QA content ${suffix}`;
    const locked = await post(
      creator,
      "posts",
      {
        body,
        preview: "Members-only QA preview",
        visibility: "SUBSCRIBERS",
        published: true,
        mediaIds: [media.id],
        consent: true,
      },
      201,
    );
    const publicPost = await post(
      creator,
      "posts",
      {
        body: "Public QA update",
        preview: "Public QA preview",
        visibility: "PUBLIC",
        published: true,
        mediaIds: [],
        consent: true,
      },
      201,
    );
    expect(
      (
        await fan.post("/api/posts", {
          headers: { origin },
          data: {
            body: "Cannot create",
            preview: "Cannot create",
            visibility: "PUBLIC",
            published: true,
            mediaIds: [],
            consent: true,
          },
        })
      ).status(),
    ).toBe(403);
    const lockedFeed = await checked(
      await fan.get("/api/feed?author=" + c.username),
    );
    const hidden = lockedFeed.items.find(
      (p: { id: string }) => p.id === locked.id,
    );
    expect(hidden.body).toBeNull();
    expect(hidden.media).toEqual([]);
    expect(hidden.locked).toBe(true);
    expect(JSON.stringify(lockedFeed)).not.toContain(body);
    expect((await fan.get("/api/media/" + media.id)).status()).toBe(403);
    expect((await guest.get("/api/media/" + media.id)).status()).toBe(403);
    expect((await fan.get("/api/comments/" + locked.id)).status()).toBe(403);
    expect(
      (
        await fan.post(`/api/posts/${locked.id}/like`, {
          headers: { origin },
          data: {},
        })
      ).status(),
    ).toBe(403);
    const checkoutKey = randomUUID();
    const checkout = await post(fan, "subscriptions/checkout", {
      creatorId: c.id,
      idempotencyKey: checkoutKey,
    });
    const duplicateCheckout = await post(fan, "subscriptions/checkout", {
      creatorId: c.id,
      idempotencyKey: checkoutKey,
    });
    expect(duplicateCheckout.transactionId).toBe(checkout.transactionId);
    expect(checkout.mode).toBe("sandbox");
    expect(
      (
        await stranger.post("/api/subscriptions/confirm", {
          headers: { origin },
          data: { transactionId: checkout.transactionId },
        })
      ).status(),
    ).toBe(404);
    expect((await fan.get("/api/media/" + media.id)).status()).toBe(403);
    await post(fan, "subscriptions/confirm", {
      transactionId: checkout.transactionId,
    });
    await post(fan, "subscriptions/confirm", {
      transactionId: checkout.transactionId,
    });
    const unlockedFeed = await checked(
      await fan.get("/api/feed?author=" + c.username),
    );
    const visible = unlockedFeed.items.find(
      (p: { id: string }) => p.id === locked.id,
    );
    expect(visible.body).toBe(body);
    expect(visible.media[0].id).toBe(media.id);
    expect(visible.locked).toBe(false);
    const mediaResponse = await fan.get("/api/media/" + media.id);
    expect(mediaResponse.status()).toBe(200);
    expect(mediaResponse.headers()["cache-control"]).toContain("no-store");
    expect(mediaResponse.headers()["content-type"]).toBe("image/png");
    expect((await stranger.get("/api/media/" + media.id)).status()).toBe(403);
    await post(creator, "settings", {
      name: "QA creator",
      username: c.username,
      emailNotifications: true,
      allowMessages: true,
      privateProfile: true,
    });
    expect((await stranger.get("/api/profile/" + c.username)).status()).toBe(
      404,
    );
    expect((await fan.get("/api/profile/" + c.username)).status()).toBe(200);
    const hiddenDirectory = await checked(await stranger.get("/api/creators"));
    expect(hiddenDirectory.some((x: { id: string }) => x.id === c.id)).toBe(
      false,
    );
    await post(creator, "settings", {
      name: "QA creator",
      username: c.username,
      emailNotifications: true,
      allowMessages: true,
      privateProfile: false,
    });
    expect((await post(fan, `posts/${locked.id}/like`, {})).active).toBe(true);
    expect((await post(fan, `posts/${locked.id}/bookmark`, {})).active).toBe(
      true,
    );
    await post(
      fan,
      `posts/${locked.id}/comments`,
      { body: "Thank you for the detailed tutorial." },
      201,
    );
    const comments = await checked(await fan.get("/api/comments/" + locked.id));
    expect(
      comments.some(
        (x: { body: string }) =>
          x.body === "Thank you for the detailed tutorial.",
      ),
    ).toBe(true);
    const bookmarks = await checked(await fan.get("/api/feed?bookmarks=true"));
    expect(
      bookmarks.items.some((p: { id: string }) => p.id === locked.id),
    ).toBe(true);
    const dash = await checked(await creator.get("/api/dashboard"));
    expect(dash.subscriberCount).toBe(1);
    expect(dash.revenueCents).toBe(1200);
    expect(
      dash.payments.filter((p: { status: string }) => p.status === "SUCCEEDED"),
    ).toHaveLength(1);
    const sub = (await checked(await fan.get("/api/subscriptions"))).find(
      (s: { creatorId: string }) => s.creatorId === c.id,
    );
    expect(sub.entitled).toBe(true);
    await post(fan, "subscriptions/cancel", { subscriptionId: sub.id });
    expect((await fan.get("/api/media/" + media.id)).status()).toBe(200);
    await post(fan, "subscriptions/renew", { subscriptionId: sub.id });
    expect((await post(fan, "follow", { creatorId: c.id })).following).toBe(
      true,
    );
    const conversation = await post(fan, "conversations", {
      recipientId: c.id,
    });
    await post(
      fan,
      `conversations/${conversation.id}/messages`,
      { body: "Private QA conversation" },
      201,
    );
    expect(
      (await stranger.get("/api/conversations/" + conversation.id)).status(),
    ).toBe(403);
    const thread = await checked(
      await creator.get("/api/conversations/" + conversation.id),
    );
    expect(
      thread.items.some(
        (m: { body: string }) => m.body === "Private QA conversation",
      ),
    ).toBe(true);
    const conversationList = await checked(
      await creator.get("/api/conversations"),
    );
    expect(
      conversationList.find((x: { id: string }) => x.id === conversation.id)
        .unread,
    ).toBe(1);
    await post(creator, `conversations/${conversation.id}/read`, {});
    const messageMedia = await checked(
      await fan.post("/api/uploads", {
        headers: { origin },
        multipart: {
          purpose: "message",
          file: { name: "message.png", mimeType: "image/png", buffer: png },
        },
      }),
      201,
    );
    await post(
      fan,
      `conversations/${conversation.id}/messages`,
      { body: "Attachment", mediaId: messageMedia.id },
      201,
    );
    expect((await creator.get("/api/media/" + messageMedia.id)).status()).toBe(
      200,
    );
    expect((await stranger.get("/api/media/" + messageMedia.id)).status()).toBe(
      403,
    );
    const notifications = await checked(
      await creator.get("/api/notifications"),
    );
    for (const kind of ["subscriber", "like", "comment", "follow", "message"])
      expect(notifications.some((n: { type: string }) => n.type === kind)).toBe(
        true,
      );
    await post(creator, "notifications/read", {});
    expect(
      (await checked(await creator.get("/api/notifications"))).every(
        (n: { readAt: string }) => n.readAt,
      ),
    ).toBe(true);
    expect(
      (
        await fan.post(`/api/posts/${publicPost.id}/delete`, {
          headers: { origin },
          data: {},
        })
      ).status(),
    ).toBe(403);
    const report = await post(
      fan,
      "reports",
      { postId: publicPost.id, reason: "QA report for moderation workflow." },
      201,
    );
    await post(fan, "subscriptions/refund", {
      transactionId: checkout.transactionId,
    });
    expect((await fan.get("/api/media/" + media.id)).status()).toBe(403);
    expect(
      (await checked(await creator.get("/api/dashboard"))).revenueCents,
    ).toBe(0);
    expect(
      (
        await guest.post("/api/webhooks/payments", {
          data: { transactionId: checkout.transactionId },
          headers: { "x-fo-signature": "f".repeat(64) },
        })
      ).status(),
    ).toBe(401);
    await post(creator, `posts/${publicPost.id}/delete`, {});
    const afterDelete = await checked(
      await fan.get("/api/feed?author=" + c.username),
    );
    expect(
      afterDelete.items.some((p: { id: string }) => p.id === publicPost.id),
    ).toBe(false);
    await post(fan, "auth/forgot", { email: f.email });
    const recoveryToken = await localToken(f.id, "reset");
    const newPassword = "NewFollowersOnly!2026";
    await post(guest, "auth/reset", {
      token: recoveryToken,
      password: newPassword,
    });
    expect(await checked(await fan.get("/api/me"))).toBeNull();
    expect(
      (
        await guest.post("/api/auth/reset", {
          headers: { origin },
          data: { token: recoveryToken, password: newPassword },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await fan.post("/api/auth/login", {
          headers: { origin },
          data: { email: f.email, password },
        })
      ).status(),
    ).toBe(401);
    await post(fan, "auth/login", { email: f.email, password: newPassword });
    await post(fan, "auth/logout", {});
    expect(await checked(await fan.get("/api/me"))).toBeNull();
    await post(admin, "auth/login", {
      email: "admin@followersonly.test",
      password,
    });
    await post(creator, "creator/verification", {});
    await post(admin, "admin/action", {
      action: "approve",
      targetId: c.id,
      note: "Fictional QA manual verification decision.",
    });
    expect(
      (await checked(await creator.get("/api/dashboard"))).profile.verification,
    ).toBe("APPROVED");
    await post(admin, "admin/action", {
      action: "resolve",
      targetId: report.id,
      note: "Reviewed fictional QA content report.",
    });
    await post(admin, "admin/action", {
      action: "remove",
      targetId: locked.id,
      note: "Fictional QA moderation removal.",
    });
    expect(
      (await checked(await creator.get("/api/feed?mine=true"))).items.some(
        (p: { id: string }) => p.id === locked.id,
      ),
    ).toBe(false);
    await post(admin, "admin/action", {
      action: "restore",
      targetId: locked.id,
      note: "Restore fictional QA moderation fixture.",
    });
    await post(admin, "admin/action", {
      action: "suspend",
      targetId: outsider.id,
      note: "Fictional QA suspension test.",
    });
    expect(await checked(await stranger.get("/api/me"))).toBeNull();
    await post(admin, "admin/action", {
      action: "unsuspend",
      targetId: outsider.id,
      note: "Restore fictional QA account.",
    });
    const administration = await checked(await admin.get("/api/admin"));
    expect(
      administration.reports.find((r: { id: string }) => r.id === report.id)
        .status,
    ).toBe("RESOLVED");
    expect(
      administration.audits.some(
        (a: { action: string; targetId: string }) =>
          a.action === "admin.suspend" && a.targetId === outsider.id,
      ),
    ).toBe(true);
    expect(
      (
        await admin.post("/api/admin/action", {
          headers: { origin },
          data: {
            action: "suspend",
            targetId: "user-admin",
            note: "Cannot suspend own admin account.",
          },
        })
      ).status(),
    ).toBe(400);
    expect(outsider.id).not.toBe(c.id);
  } finally {
    if (fixtureCreatorId) {
      const current = await admin.get("/api/me");
      if (!(await current.json()))
        await admin.post("/api/auth/login", {
          data: { email: "admin@followersonly.test", password },
          headers: { origin },
        });
      await admin.post("/api/admin/action", {
        data: {
          action: "suspend",
          targetId: fixtureCreatorId,
          note: "Hide exact fictional QA creator fixture after automated test; retain financial audit.",
        },
        headers: { origin },
      });
    }
    await Promise.all([
      creator.dispose(),
      fan.dispose(),
      stranger.dispose(),
      guest.dispose(),
      admin.dispose(),
    ]);
  }
});
