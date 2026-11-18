import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import {
  activeSubscription,
  hash,
  token,
  sign,
  verifySignature,
  checkOrigin,
  assert,
  HttpError,
  publicUser,
} from "@/lib/security";
import type { User } from "@prisma/client";
describe("subscription authorization", () => {
  it("grants active paid periods and preserves canceled access until expiry", () => {
    for (const status of ["ACTIVE", "CANCELED"])
      expect(
        activeSubscription({
          status,
          currentPeriodEnd: new Date(Date.now() + 60000),
        }),
      ).toBe(true);
  });
  it("denies expired, pending, missing and incomplete subscription records", () => {
    expect(activeSubscription(null)).toBe(false);
    for (const status of ["ACTIVE", "CANCELED", "PENDING", "EXPIRED"])
      expect(
        activeSubscription({
          status,
          currentPeriodEnd: new Date(Date.now() - 60000),
        }),
      ).toBe(false);
    expect(
      activeSubscription({
        status: "PENDING",
        currentPeriodEnd: new Date(Date.now() + 60000),
      }),
    ).toBe(false);
    expect(
      activeSubscription({ status: "ACTIVE", currentPeriodEnd: null }),
    ).toBe(false);
  });
});
describe("signed payment boundaries", () => {
  it("accepts only the original payload signed with the configured key", () => {
    const raw = JSON.stringify({ transaction: "a", amount: 1000 });
    const signature = sign(raw, "test-secret");
    expect(verifySignature(raw, signature, "test-secret")).toBe(true);
    expect(verifySignature(raw + " ", signature, "test-secret")).toBe(false);
    expect(verifySignature(raw, signature, "wrong-secret")).toBe(false);
    for (const invalid of [null, "", "x".repeat(64), "00", "f".repeat(64)])
      expect(verifySignature(raw, invalid, "test-secret")).toBe(false);
  });
  it("generates high entropy opaque session values and one-way digests", () => {
    const a = token(),
      b = token();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(hash(a)).toHaveLength(64);
    expect(hash(a)).not.toBe(a);
    expect(hash(a)).toBe(hash(a));
  });
});
describe("request privacy and CSRF", () => {
  it("rejects cross-origin state mutations", () => {
    process.env.APP_URL = "http://127.0.0.1:3100";
    expect(() =>
      checkOrigin(
        new Request("http://127.0.0.1:3100/api/posts", {
          headers: { origin: "https://attacker.example" },
        }),
      ),
    ).toThrow(HttpError);
    expect(() =>
      checkOrigin(new Request("http://127.0.0.1:3100/api/posts")),
    ).toThrow(HttpError);
    expect(() =>
      checkOrigin(
        new Request("http://127.0.0.1:3100/api/posts", {
          headers: {
            origin: "http://127.0.0.1:3100",
            "sec-fetch-site": "cross-site",
          },
        }),
      ),
    ).toThrow(HttpError);
    expect(() =>
      checkOrigin(
        new Request("http://127.0.0.1:3100/api/posts", {
          headers: {
            origin: "http://127.0.0.1:3100",
            "sec-fetch-site": "same-origin",
          },
        }),
      ),
    ).not.toThrow();
  });
  it("serializes identity without password or account secrets", () => {
    const user = {
      id: "a",
      name: "Fictional",
      username: "fiction",
      role: "SUBSCRIBER",
      avatarId: null,
      emailVerifiedAt: new Date(),
      passwordHash: "secret",
      email: "private@example.test",
    } as unknown as User;
    const safe = publicUser(user);
    expect(safe).toEqual({
      id: "a",
      name: "Fictional",
      username: "fiction",
      role: "SUBSCRIBER",
      avatarId: null,
      emailVerified: true,
    });
    expect(JSON.stringify(safe)).not.toContain("secret");
    expect(JSON.stringify(safe)).not.toContain("private@example");
  });
  it("preserves meaningful HTTP failures", () => {
    expect(() => assert(false, 403, "Denied")).toThrow("Denied");
    try {
      assert(false, 403, "Denied");
    } catch (e) {
      expect((e as HttpError).status).toBe(403);
    }
  });
});
