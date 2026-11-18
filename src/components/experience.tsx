"use client";
/* Private media uses authenticated no-store API URLs; avoid Next image optimization caching. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Avatar } from "./avatar";
import { MediaAttachment } from "./media-attachment";
import { api as request } from "@/lib/client";
import {
  Messages,
  Composer,
  SettingsForm,
  CreatorSettings,
  AdminPanel,
} from "./workspace-forms";
import { useRouter } from "next/navigation";
import {
  Home,
  Compass,
  Bell,
  MessageCircle,
  Bookmark,
  Users,
  Settings,
  Plus,
  Heart,
  Lock,
  Sparkles,
  ArrowUpRight,
  Search,
} from "lucide-react";
import type {
  Account,
  Creator,
  Post,
  Comment,
  Page,
  DashboardDTO,
  AdminDTO,
  NotificationDTO,
  SubscriptionDTO,
  Conversation,
  ActResult,
} from "@/lib/types";
type ProfileData = { creator: Creator; posts: Page<Post> };
type RouteData = {
  feed?: Page<Post>;
  profile?: ProfileData;
  dashboard?: DashboardDTO;
  admin?: AdminDTO;
  notifications?: NotificationDTO[];
  subscriptions?: SubscriptionDTO[];
  conversations?: Conversation[];
};
const api = <T = ActResult,>(path: string, data?: unknown) =>
  request<T>(path, data);
const nav = [
  ["Home", "/home", Home],
  ["Explore", "/explore", Compass],
  ["Notifications", "/notifications", Bell],
  ["Messages", "/messages", MessageCircle],
  ["Subscriptions", "/subscriptions", Users],
  ["Bookmarks", "/bookmarks", Bookmark],
  ["Settings", "/settings", Settings],
] as const;
export default function Experience({ route }: { route: string }) {
  const router = useRouter();
  const [me, setMe] = useState<Account | null>(null),
    [data, setData] = useState<RouteData>({}),
    [creators, setCreators] = useState<Creator[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [q, setQ] = useState(""),
    [menu, setMenu] = useState(false),
    [notice, setNotice] = useState(""),
    [editing, setEditing] = useState<Post | null>(null),
    [comments, setComments] = useState<Record<string, Comment[]>>({});
  const title =
    route === "/"
      ? "Your people. Your space."
      : (route.split("/").filter(Boolean).at(-1)?.replaceAll("-", " ") ??
        "Home");
  const modalRef = useRef<HTMLDialogElement>(null);
  const [dialog, setDialog] = useState<{
    label: string;
    resolve: (v: string | null) => void;
    confirmOnly?: boolean;
  } | null>(null);
  function ask(label: string, confirmOnly = false) {
    return new Promise<string | null>((resolve) =>
      setDialog({ label, resolve, confirmOnly }),
    );
  }
  useEffect(() => {
    if (dialog && !modalRef.current?.open) modalRef.current?.showModal();
  }, [dialog]);
  const auth = [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
  ].includes(route);
  async function load() {
    setBusy(true);
    setError("");
    setData({});
    try {
      const u = await api<Account | null>("me");
      setMe(u);
      setCreators(await api<Creator[]>("creators"));
      if (route === "/creator/settings" && u?.role === "SUBSCRIBER") return;
      if (route.startsWith("/creator/posts"))
        setData({ feed: await api<Page<Post>>("feed?mine=true") });
      else if (route === "/messages" || route === "/creator/messages")
        setData({ conversations: await api<Conversation[]>("conversations") });
      else if (route.startsWith("/creator/"))
        setData({ dashboard: await api<DashboardDTO>("dashboard") });
      else if (route.startsWith("/admin"))
        setData({ admin: await api<AdminDTO>("admin") });
      else if (["/home", "/feed", "/bookmarks"].includes(route))
        setData({
          feed: await api<Page<Post>>(
            "feed" + (route === "/bookmarks" ? "?bookmarks=true" : ""),
          ),
        });
      else if (route === "/notifications")
        setData({
          notifications: await api<NotificationDTO[]>("notifications"),
        });
      else if (route === "/subscriptions")
        setData({
          subscriptions: await api<SubscriptionDTO[]>("subscriptions"),
        });
      else if (
        !auth &&
        ![
          "/",
          "/about",
          "/terms",
          "/privacy",
          "/creators",
          "/explore",
          "/search",
          "/settings",
        ].includes(route)
      )
        setData({
          profile: await api<ProfileData>(
            "profile/" +
              route.split("/")[1] +
              (route.endsWith("/media") ? "?media=true" : ""),
          ),
        });
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load();
  }, [route]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!["/messages", "/creator/messages", "/notifications"].includes(route))
      return;
    let live = true;
    const timer = setInterval(async () => {
      try {
        if (route === "/notifications") {
          const rows = await api<NotificationDTO[]>("notifications");
          if (live) setData((d) => ({ ...d, notifications: rows }));
        } else {
          const rows = await api<Conversation[]>("conversations");
          if (live) setData((d) => ({ ...d, conversations: rows }));
        }
      } catch {
        /* A transient poll failure leaves the last successful state visible. */
      }
    }, 7000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [route]);
  async function act(path: string, d: unknown) {
    setBusy(true);
    try {
      const r = await api(path, d);
      setNotice(
        path.startsWith("subscriptions/")
          ? "Sandbox subscription update recorded. No real money was moved."
          : "Saved successfully.",
      );
      await load();
      return r;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function form(
    fields: string[],
    submit: (
      v: Record<string, FormDataEntryValue | boolean>,
    ) => Promise<unknown>,
    defaults: Record<string, string> = {},
  ) {
    return (
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const v = Object.fromEntries(new FormData(e.currentTarget));
          try {
            await submit({
              ...v,
              ageConfirmed: v.ageConfirmed === "on",
              termsAccepted: v.termsAccepted === "on",
            });
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {fields.map((f) => (
          <label key={f}>
            {f.replaceAll("_", " ")}
            <input
              required
              name={f}
              defaultValue={defaults[f] ?? ""}
              type={
                f.toLowerCase().includes("password")
                  ? "password"
                  : f === "email"
                    ? "email"
                    : "text"
              }
              minLength={f.toLowerCase().includes("password") ? 12 : undefined}
            />
          </label>
        ))}
        {route === "/register" && (
          <>
            <label>
              <input type="checkbox" name="ageConfirmed" required /> I am 18 or
              older
            </label>
            <label>
              <input type="checkbox" name="termsAccepted" required /> I accept
              the <Link href="/terms">Terms</Link> and{" "}
              <Link href="/privacy">Privacy Policy</Link>
            </label>
          </>
        )}
        <button className="primary">
          {route === "/login"
            ? "Sign in"
            : route === "/register"
              ? "Create account"
              : "Save & continue"}
        </button>
      </form>
    );
  }
  const creator = data.profile?.creator;
  const dashboard = data.dashboard;
  const postsPage = data.feed ?? data.profile?.posts;
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span>✳</span> FollowersOnly
        </Link>
        <small>YOUR CREATIVE CIRCLE</small>
        <nav>
          {nav.map(([name, url, Icon]) => (
            <Link
              className={route === url ? "active" : ""}
              href={url}
              key={url}
            >
              <Icon size={21} />
              {name}
            </Link>
          ))}
        </nav>
        <Link className="primary" href="/creator/posts/new">
          <Plus size={18} /> Create a post
        </Link>
        <Link href="/creator/dashboard">
          Creator studio <ArrowUpRight size={16} />
        </Link>
        {me?.role === "ADMIN" && <Link href="/admin">Administration</Link>}
        <div className="sidebar-bottom">
          <Avatar user={me} />
          <div>
            <b>{me?.name ?? "Your next chapter"}</b>
            <small>
              {me ? "@" + me.username : "Join your creative circle"}
            </small>
          </div>
          {me ? (
            <button
              onClick={() =>
                act("auth/logout", {}).then(() => {
                  router.push("/login");
                  router.refresh();
                })
              }
            >
              Log out
            </button>
          ) : (
            <Link href="/login">Sign in</Link>
          )}
        </div>
      </aside>
      <main>
        {dialog && (
          <div className="modal-backdrop">
            <dialog
              ref={modalRef}
              aria-modal="true"
              aria-labelledby="dialog-title"
              onCancel={() => {
                dialog.resolve(null);
                setDialog(null);
              }}
            >
              <h2 id="dialog-title">{dialog.label}</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  dialog.resolve(
                    dialog.confirmOnly
                      ? "yes"
                      : String(new FormData(e.currentTarget).get("answer")),
                  );
                  setDialog(null);
                }}
              >
                {!dialog.confirmOnly && (
                  <label>
                    Response
                    <input autoFocus required name="answer" />
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => {
                    dialog.resolve(null);
                    setDialog(null);
                  }}
                >
                  Cancel
                </button>{" "}
                <button className="primary">Confirm</button>
              </form>
            </dialog>
          </div>
        )}
        <header>
          <div>
            <small>MAKE ROOM FOR INSPIRATION</small>
            <h1>{title}</h1>
          </div>
          <Link className="icon" href="/notifications">
            <Bell size={22} />
          </Link>
        </header>
        {me && !me.emailVerified && !auth && (
          <p className="notice">
            Verify your email to publish, subscribe, or send messages.{" "}
            <Link href="/settings">Email settings</Link>
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {error && (
          <div role="alert" className="error">
            {error} <button onClick={load}>Retry</button>
            {!me && <Link href="/login"> Sign in</Link>}
          </div>
        )}
        {auth ? (
          <section className="panel auth">
            <span className="eyebrow">WELCOME TO YOUR CIRCLE</span>
            <h2>{title}</h2>
            {route === "/login" ? (
              form(["email", "password"], async (v) => {
                await api("auth/login", v);
                router.push("/home");
                router.refresh();
              })
            ) : route === "/register" ? (
              form(["name", "username", "email", "password"], async (v) => {
                await api("auth/register", v);
                router.push("/home");
                router.refresh();
              })
            ) : route === "/forgot-password" ? (
              form(["email"], (v) => act("auth/forgot", v))
            ) : route === "/reset-password" ? (
              form(["password"], (v) =>
                act("auth/reset", {
                  ...v,
                  token: new URLSearchParams(location.search).get("token"),
                }),
              )
            ) : (
              <button
                className="primary"
                onClick={() =>
                  act("auth/verify", {
                    token: new URLSearchParams(location.search).get("token"),
                  })
                }
              >
                Verify email
              </button>
            )}
            <p>
              <Link href="/register">Create account</Link> ·{" "}
              <Link href="/login">Sign in</Link> ·{" "}
              <Link href="/forgot-password">Forgot password?</Link>
            </p>
          </section>
        ) : null}
        {route === "/" && (
          <section className="hero">
            <span className="eyebrow">MORE THAN A FOLLOW</span>
            <h2>
              A little closer.
              <br />A lot more you.
            </h2>
            <p>
              Step inside the creative process. Discover exclusive stories,
              meaningful conversations, and the people who inspire you.
            </p>
            <Link className="primary" href="/explore">
              Find your circle <ArrowUpRight size={19} />
            </Link>
            <div className="hero-art">
              ✳
              <span>
                Ideas worth sharing.
                <br />
                Connections worth keeping.
              </span>
            </div>
          </section>
        )}
        {["/", "/explore", "/creators", "/search"].includes(route) && (
          <>
            <div className="section-title">
              <h2>Discover your next favorite</h2>
              <span>INDEPENDENT MINDS. EXTRAORDINARY WORK.</span>
            </div>
            <label className="search">
              <Search size={19} />
              <input
                placeholder="Search creators"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <div className="chips">
              {[
                "All creators",
                "Art & design",
                "Photography",
                "Music",
                "Wellness",
                "Food",
              ].map((c) => (
                <button
                  key={c}
                  onClick={() => setQ(c === "All creators" ? "" : c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="creator-grid">
              {creators
                .filter((c) =>
                  (c.name + " " + c.category)
                    .toLowerCase()
                    .includes(q.toLowerCase()),
                )
                .map((c, i) => (
                  <Link
                    className={"creator-card color" + (i % 4)}
                    href={"/" + c.username}
                    key={c.id}
                  >
                    <div className="cover">
                      <span>✳</span>
                      <b>{c.category}</b>
                    </div>
                    <div className="creator-info">
                      <Avatar user={c} />
                      <h3>
                        {c.name}{" "}
                        {c.verification === "APPROVED" && (
                          <span
                            className="verified"
                            aria-label="Verified creator"
                          >
                            ✦
                          </span>
                        )}
                      </h3>
                      <small>@{c.username}</small>
                      <p>{c.bio}</p>
                      <footer>
                        <span>
                          {c.monthlyPriceCents
                            ? "From $" +
                              (c.monthlyPriceCents / 100).toFixed(2) +
                              "/month"
                            : "Free to follow"}
                        </span>
                        <ArrowUpRight size={18} />
                      </footer>
                    </div>
                  </Link>
                ))}
            </div>
          </>
        )}
        {busy && <div className="skeleton">Loading your circle…</div>}
        {creator && (
          <section className="panel">
            <div className="profile-cover">
              {creator.coverId ? (
                <img
                  alt="Creator cover"
                  src={"/api/media/" + creator.coverId}
                />
              ) : (
                "✳"
              )}
            </div>
            <Avatar user={creator} large />
            <h2>{creator.name}</h2>
            <small>@{creator.username}</small>
            <p>{creator.bio}</p>
            <p>
              {creator.followerCount} followers · {creator.postCount} posts
            </p>
            <button onClick={() => act("follow", { creatorId: creator.id })}>
              {creator.following ? "Following" : "Follow"}
            </button>{" "}
            <button
              className="primary"
              disabled={busy || creator.subscribed || creator.id === me?.id}
              onClick={async () => {
                if (
                  !(await ask(
                    "Start a sandbox subscription? No real money will be charged.",
                    true,
                  ))
                )
                  return;
                const t = await act("subscriptions/checkout", {
                  creatorId: creator.id,
                  idempotencyKey: crypto.randomUUID(),
                });
                if (t)
                  await act("subscriptions/confirm", {
                    transactionId: t.transactionId,
                  });
              }}
            >
              {creator.subscribed
                ? "Subscribed"
                : `Subscribe · $${(creator.monthlyPriceCents / 100).toFixed(2)}/mo`}
            </button>{" "}
            {creator.subscribed && (
              <Link href="/subscriptions">Manage subscription</Link>
            )}
            <button
              onClick={async () => {
                const c = await act("conversations", {
                  recipientId: creator.id,
                });
                if (c?.id) router.push("/messages?conversation=" + c.id);
              }}
            >
              Message
            </button>
            <div className="chips">
              <Link href={route.split("/").slice(0, 2).join("/") + "/posts"}>
                Posts
              </Link>
              <Link href={route.split("/").slice(0, 2).join("/") + "/media"}>
                Media
              </Link>
            </div>
          </section>
        )}
        {(postsPage?.items ?? []).map((p) => (
          <article className="post panel" key={p.id}>
            <div className="post-author">
              <Avatar user={p.author} />
              <div>
                <Link href={"/" + p.author.username}>
                  <b>{p.author.name}</b>
                </Link>
                <small>
                  @{p.author.username} ·{" "}
                  {new Date(p.createdAt).toLocaleDateString()}
                </small>
              </div>
              <Sparkles size={18} />
            </div>
            <p>{p.body ?? p.preview}</p>
            {p.locked ? (
              <div className="locked">
                <Lock />
                <b>A little something for the inner circle</b>
                <Link href={"/" + p.author.username}>Subscribe to unlock</Link>
              </div>
            ) : (
              p.media.map((m) => <MediaAttachment key={m.id} media={m} />)
            )}
            <footer>
              <button onClick={() => act("posts/" + p.id + "/like", {})}>
                <Heart size={18} /> {p.likeCount}
              </button>
              <button
                onClick={async () => {
                  setComments((c) => ({ ...c, [p.id]: [] }));
                  try {
                    setComments((c) => ({ ...c, [p.id]: [] }));
                    const rows = await api<Comment[]>("comments/" + p.id);
                    setComments((c) => ({ ...c, [p.id]: rows }));
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <MessageCircle size={18} /> {p.commentCount}
              </button>
              <button onClick={() => act("posts/" + p.id + "/bookmark", {})}>
                <Bookmark size={18} />
                {p.bookmarked ? "Saved" : "Save"}
              </button>
              <button
                onClick={async () => {
                  const reason = await ask(
                    "Describe the concern (at least 10 characters)",
                  );
                  if (reason) act("reports", { postId: p.id, reason });
                }}
              >
                Report
              </button>
            </footer>
            {comments[p.id] && (
              <section>
                <h3>Comments</h3>
                {comments[p.id].map((c) => (
                  <p key={c.id}>
                    <b>{c.author.name}</b> {c.body}
                  </p>
                ))}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const body = String(
                      new FormData(e.currentTarget).get("comment"),
                    );
                    await act("posts/" + p.id + "/comments", { body });
                    setComments((c) => ({ ...c, [p.id]: [] }));
                    const rows = await api<Comment[]>("comments/" + p.id);
                    setComments((c) => ({ ...c, [p.id]: rows }));
                  }}
                >
                  <label>
                    Your comment
                    <input name="comment" required maxLength={1000} />
                  </label>
                  <button>Post comment</button>
                </form>
              </section>
            )}
            {me?.id === p.author.id && (
              <button onClick={() => setEditing(p)}>Edit post</button>
            )}
            {me?.id === p.author.id && (
              <button
                onClick={async () => {
                  if (await ask("Delete this post?", true))
                    await act("posts/" + p.id + "/delete", {});
                }}
              >
                Delete post
              </button>
            )}
          </article>
        ))}
        {postsPage?.nextCursor && (
          <button
            disabled={busy}
            onClick={async () => {
              try {
                const query =
                  "cursor=" + encodeURIComponent(postsPage.nextCursor!);
                if (data.profile) {
                  const next = await api<ProfileData>(
                    "profile/" +
                      data.profile.creator.username +
                      "?" +
                      query +
                      (route.endsWith("/media") ? "&media=true" : ""),
                  );
                  setData({
                    ...data,
                    profile: {
                      ...data.profile,
                      posts: {
                        ...next.posts,
                        items: [...postsPage.items, ...next.posts.items],
                      },
                    },
                  });
                } else {
                  const next = await api<Page<Post>>(
                    "feed?" +
                      query +
                      (route === "/bookmarks"
                        ? "&bookmarks=true"
                        : route.startsWith("/creator/")
                          ? "&mine=true"
                          : ""),
                  );
                  setData({
                    ...data,
                    feed: {
                      ...next,
                      items: [...postsPage.items, ...next.items],
                    },
                  });
                }
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Load more posts
          </button>
        )}
        {route === "/creator/posts/new" && <Composer act={act} />}{" "}
        {editing && (
          <section className="panel">
            <button onClick={() => setEditing(null)}>Close editor</button>
            <Composer key={editing.id} act={act} initial={editing} />
          </section>
        )}
        {route === "/settings" && me && (
          <section className="panel">
            <h2>Your profile</h2>
            <SettingsForm me={me} act={act} />
            <h3>Change password</h3>
            {form(["currentPassword", "newPassword"], (v) =>
              act("auth/password", v),
            )}
            <button onClick={() => act("auth/resend", {})}>
              Resend verification email
            </button>
            <Link href="/creator/settings">Become a creator</Link>
          </section>
        )}
        {route === "/creator/settings" && (
          <section className="panel">
            <h2>Your creator space</h2>
            <CreatorSettings profile={dashboard?.profile ?? {}} act={act} />
            <button onClick={() => act("creator/verification", {})}>
              Request verification
            </button>
          </section>
        )}
        {(route === "/creator" || route.startsWith("/creator/")) &&
          dashboard && (
            <>
              <div className="chips">
                {[
                  "dashboard",
                  "posts",
                  "posts/new",
                  "subscribers",
                  "earnings",
                  "analytics",
                  "messages",
                  "settings",
                ].map((n) => (
                  <Link key={n} href={"/creator/" + n}>
                    {n}
                  </Link>
                ))}
              </div>
              <div className="stats">
                {[
                  ["Sandbox earnings", "$" + dashboard.revenueCents / 100],
                  ["Subscribers", dashboard.subscriberCount],
                  ["Posts", dashboard.postCount],
                ].map(([a, b]) => (
                  <section className="panel" key={a}>
                    <small>{a}</small>
                    <h2>{b}</h2>
                  </section>
                ))}
              </div>
              {route === "/creator/analytics" && (
                <section className="panel">
                  <h2>Audience overview</h2>
                  <p>
                    {dashboard.subscriberCount} active subscribers across{" "}
                    {dashboard.postCount} published and draft posts.
                  </p>
                  <p>
                    Current subscription value: $
                    {(dashboard.monthly / 100).toFixed(2)} per period. All
                    figures reflect sandbox database records.
                  </p>
                </section>
              )}
              {dashboard.subscriptions.map((s) => (
                <div className="panel" key={s.id}>
                  {s.subscriber.name} · {s.status}
                </div>
              ))}
              {dashboard.payments.map((p) => (
                <div className="panel" key={p.id}>
                  ${p.amountCents / 100} · {p.status} · Sandbox
                </div>
              ))}
            </>
          )}
        {route === "/subscriptions" &&
          data.subscriptions &&
          data.subscriptions.map((s) => (
            <section className="panel" key={s.id}>
              <h3>{s.creator.name}</h3>
              <p>
                {s.status} · ${(s.priceCents / 100).toFixed(2)} ·{" "}
                {s.currentPeriodEnd &&
                  new Date(s.currentPeriodEnd).toLocaleDateString()}
              </p>
              <button
                onClick={() =>
                  act("subscriptions/cancel", { subscriptionId: s.id })
                }
              >
                Cancel renewal
              </button>
              <button
                onClick={() =>
                  act("subscriptions/renew", { subscriptionId: s.id })
                }
              >
                Enable renewal
              </button>
              {s.transactions.map((p) => (
                <p key={p.id}>
                  Sandbox ${p.amountCents / 100} · {p.status}{" "}
                  <button
                    onClick={() =>
                      act("subscriptions/refund", { transactionId: p.id })
                    }
                  >
                    Refund
                  </button>
                </p>
              ))}
            </section>
          ))}
        {route === "/notifications" && data.notifications && (
          <>
            <button onClick={() => act("notifications/read", {})}>
              Mark all read
            </button>
            {data.notifications.map((n) => (
              <Link
                className="panel notification"
                href={n.href}
                key={n.id}
                onClick={() => act("notifications/read", { id: n.id })}
              >
                <Bell size={20} />
                {n.text}
                {!n.readAt && <span className="dot" />}
              </Link>
            ))}
          </>
        )}
        {(route === "/messages" || route === "/creator/messages") && (
          <Messages rows={data.conversations ?? []} act={act} />
        )}
        {route.startsWith("/admin") && data.admin && (
          <AdminPanel route={route} data={data.admin} act={act} />
        )}
        {["/about", "/privacy", "/terms"].includes(route) && (
          <section className="panel">
            <h2>{title}</h2>
            <p>
              FollowersOnly connects independent creators with their
              communities. This local development platform uses sandbox payments
              only. All accounts must be 18 or older. Creators must own the
              rights and consent for everything they publish.
            </p>
            <p>
              Your private content is protected by account and subscription
              authorization. You can report content through each post. Contact
              the platform operator for privacy, moderation and account
              requests. Production legal policies require operator review before
              launch.
            </p>
          </section>
        )}
        {!busy &&
          !auth &&
          (
            data.notifications ??
            data.subscriptions ??
            data.conversations ??
            postsPage?.items
          )?.length === 0 && (
            <section className="empty">
              <Sparkles />
              <h2>A fresh start</h2>
              <p>Your circle is waiting to grow.</p>
              <Link href="/explore">Discover creators</Link>
            </section>
          )}
        <footer className="legal">
          <Link href="/about">About</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <span>© FollowersOnly · Sandbox environment</span>
        </footer>
      </main>
      <aside className="rail">
        <label className="search">
          <Search size={18} />
          <input
            placeholder="Find your inspiration"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <section className="rail-note">
          <Sparkles />
          <h3>Your people are here.</h3>
          <p>Go beyond the feed. Get closer to what inspires you.</p>
          <Link href="/explore">
            Explore creators <ArrowUpRight size={16} />
          </Link>
        </section>
        <h3>Worth getting to know</h3>
        {creators.slice(0, 4).map((c) => (
          <Link className="recommendation" href={"/" + c.username} key={c.id}>
            <Avatar user={c} />
            <div>
              <b>{c.name}</b>
              <small>{c.category}</small>
            </div>
            <Plus size={17} />
          </Link>
        ))}
        <p className="rail-caption">
          A space for creativity.
          <br />A community that feels like you.
        </p>
      </aside>
      {menu && (
        <section className="mobile-menu panel">
          <button onClick={() => setMenu(false)}>Close navigation</button>
          {nav.map(([n, u]) => (
            <Link href={u} key={u}>
              {n}
            </Link>
          ))}
          <Link href="/creator/dashboard">Creator studio</Link>
          <Link href="/creator/posts/new">Create post</Link>
          {me?.role === "ADMIN" && <Link href="/admin">Administration</Link>}
          <Link href="/login">Sign in</Link>
        </section>
      )}
      <nav className="mobile-nav">
        {nav.slice(0, 4).map(([n, u, I]) => (
          <Link href={u} key={u} aria-label={n}>
            <I size={22} />
          </Link>
        ))}
        <button aria-label="More navigation" onClick={() => setMenu(!menu)}>
          More
        </button>
      </nav>
    </div>
  );
}
