import { test, expect } from "@playwright/test";
const origin = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
const credentials = {
  email: "alex@followersonly.test",
  password: "FollowersOnly!2026",
};
test("subscriber signs in through UI, reads feed and updates profile", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("email", { exact: true }).fill(credentials.email);
  await page.getByLabel("password", { exact: true }).fill(credentials.password);
  await page
    .getByRole("button", { name: /save & continue|sign in|log in/i })
    .click();
  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByRole("heading", { name: /home/i })).toBeVisible();
  await expect(page.locator(".post").first()).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByLabel(/^(display name|name)$/i)).toHaveValue(
    "Alex Harper",
  );
  await page.getByLabel(/^(display name|name)$/i).fill("Alex Harper");
  await page
    .getByRole("button", {
      name: /save & continue|save changes|save profile|save settings/i,
    })
    .first()
    .click();
  await expect(page.getByRole("status")).toBeVisible();
});
test("public creator discovery and intentional responsive shell at all requested widths", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  for (const width of [1440, 1280, 1024, 768, 390, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/creators");
    await expect(
      page.getByRole("heading", { name: /discover your next favorite/i }),
    ).toBeVisible();
    await expect(page.locator(".creator-card").first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBe(false);
    if (width <= 760) await expect(page.locator(".mobile-nav")).toBeVisible();
    await page.screenshot({
      path: `.local/qa-screenshots/creators-${width}.png`,
      fullPage: true,
    });
  }
  expect(failures).toEqual([]);
});
test("protected application and admin routes do not disclose privileged content", async ({
  page,
}) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByText("Platform administration", { exact: true }),
  ).toHaveCount(0);
  const login = await page.request.post("/api/auth/login", {
    data: credentials,
    headers: { origin },
  });
  expect(login.status()).toBe(200);
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/home/);
  await expect(page.locator(".admin-row")).toHaveCount(0);
});

test("all specified routes load without runtime or API error states for their authorized role", async ({
  page,
}) => {
  test.setTimeout(180000);
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  const assertReady = async (route: string) => {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expect(page.locator(".shell main > header h1")).toBeVisible();
    await expect(page.locator(".skeleton")).toHaveCount(0);
    expect(
      await page.locator('.error[role="alert"]').allTextContents(),
      route,
    ).toEqual([]);
    await expect(page.locator(".shell main")).not.toBeEmpty();
  };
  for (const route of [
    "/",
    "/about",
    "/creators",
    "/terms",
    "/privacy",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/maya",
    "/maya/posts",
    "/maya/media",
  ])
    await assertReady(route);
  for (const [email, routes] of [
    [
      "alex@followersonly.test",
      [
        "/home",
        "/feed",
        "/explore",
        "/search",
        "/notifications",
        "/messages",
        "/subscriptions",
        "/bookmarks",
        "/settings",
        "/creator/settings",
      ],
    ],
    [
      "maya@followersonly.test",
      [
        "/creator/dashboard",
        "/creator/posts",
        "/creator/posts/new",
        "/creator/subscribers",
        "/creator/earnings",
        "/creator/analytics",
        "/creator/messages",
        "/creator/settings",
      ],
    ],
    [
      "admin@followersonly.test",
      [
        "/admin",
        "/admin/users",
        "/admin/creators",
        "/admin/reports",
        "/admin/content",
        "/admin/transactions",
      ],
    ],
  ] as const) {
    const login = await page.request.post("/api/auth/login", {
      data: { email, password: credentials.password },
      headers: { origin },
    });
    expect(login.status()).toBe(200);
    for (const route of routes) await assertReady(route);
  }
  expect(failures).toEqual([]);
});

test("creator publishes private media and a subscriber unlocks and messages through the UI", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const creatorContext = await browser.newContext();
  const fanContext = await browser.newContext();
  const creator = await creatorContext.newPage();
  const fan = await fanContext.newPage();
  creator.setDefaultTimeout(10000);
  fan.setDefaultTimeout(10000);
  const suffix = Date.now().toString(36);
  const name = `UI Fan ${suffix}`;
  const username = `ui_fan_${suffix}`;
  const email = username + "@example.test";
  let postId: string | undefined;
  let transactionId: string | undefined;
  try {
    const login = await creator.request.post("/api/auth/login", {
      data: {
        email: "maya@followersonly.test",
        password: credentials.password,
      },
      headers: { origin },
    });
    expect(login.status()).toBe(200);
    const registration = await fan.request.post("/api/auth/register", {
      data: {
        email,
        username,
        name,
        password: credentials.password,
        ageConfirmed: true,
        termsAccepted: true,
      },
      headers: { origin },
    });
    expect(registration.status()).toBe(201);
    const user = await registration.json();
    const { readdir, readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = path.join(process.cwd(), ".local", "mail");
    const files = (await readdir(dir))
      .filter((f) => f.endsWith(`-verify-${user.id}.txt`))
      .sort();
    const message = await readFile(path.join(dir, files.at(-1)!), "utf8");
    const verifyToken = message.match(/\?token=([a-f0-9]{64})/)![1];
    expect(
      (
        await fan.request.post("/api/auth/verify", {
          data: { token: verifyToken },
          headers: { origin },
        })
      ).status(),
    ).toBe(200);
    await creator.goto("/creator/posts/new");
    const body = `A private studio lesson ${suffix}`;
    const preview = `Members-only browser QA ${suffix}`;
    await creator.getByLabel("Post", { exact: true }).fill(body);
    await creator.getByLabel("Public preview", { exact: true }).fill(preview);
    await creator
      .getByRole("combobox", { name: /Visibility/ })
      .selectOption("SUBSCRIBERS");
    await creator.getByLabel("Attachments", { exact: true }).setInputFiles({
      name: "studio.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(
      creator.getByText("1 attachments uploaded", { exact: true }),
    ).toBeVisible();
    await creator.getByRole("checkbox", { name: /I own this content/ }).check();
    const saveResponse = creator.waitForResponse(
      (r) => r.url().endsWith("/api/posts") && r.request().method() === "POST",
    );
    await creator
      .getByRole("button", { name: "Save post", exact: true })
      .click();
    const saved = await saveResponse;
    expect(saved.status(), await saved.text()).toBe(201);
    postId = (await saved.json()).id;
    await fan.goto("/maya");
    const lockedPost = fan.locator(".post").filter({ hasText: preview });
    await expect(lockedPost.locator(".locked")).toBeVisible();
    await expect(fan.getByText(body, { exact: true })).toHaveCount(0);
    await fan.getByRole("button", { name: /^Subscribe ·/ }).click();
    await expect(fan.getByRole("dialog")).toBeVisible();
    await fan
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(fan.getByText(body, { exact: true })).toBeVisible();
    await expect(
      fan.locator(".post").filter({ hasText: body }).locator("img"),
    ).toBeVisible();
    const subscriptions = await (
      await fan.request.get("/api/subscriptions")
    ).json();
    transactionId = subscriptions
      .find((s: { creatorId: string }) => s.creatorId === "user-maya")
      .transactions.find(
        (t: { status: string }) => t.status === "SUCCEEDED",
      ).id;
    await fan.getByRole("button", { name: "Message", exact: true }).click();
    await expect(fan).toHaveURL(/\/messages\?conversation=/);
    const text = `UI conversation ${suffix}`;
    await fan.getByLabel("Message", { exact: true }).fill(text);
    await fan
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      fan.locator(".bubble").filter({ hasText: text }),
    ).toBeVisible();
    await creator.goto("/creator/messages");
    await creator.getByRole("button", { name: new RegExp(name) }).click();
    await expect(
      creator.locator(".bubble").filter({ hasText: text }),
    ).toBeVisible();
  } finally {
    if (transactionId)
      await fan.request.post("/api/subscriptions/refund", {
        data: { transactionId },
        headers: { origin },
      });
    if (postId)
      await creator.request.post(`/api/posts/${postId}/delete`, {
        data: {},
        headers: { origin },
      });
    await creatorContext.close().catch(() => {});
    await fanContext.close().catch(() => {});
  }
});
