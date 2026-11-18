"use client";
/* Authenticated no-store media must bypass image optimization caches. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import type {
  Message,
  Conversation,
  Page,
  Post,
  Account,
  Attachment,
  CreatorProfile,
  Administration,
  ActionResult,
  Act,
} from "@/lib/types";
import { api as request } from "@/lib/client";
const api = <T = ActionResult,>(path: string, data?: unknown) =>
  request<T>(path, data);
export function Messages({ rows, act }: { rows: Conversation[]; act: Act }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const id = params.get("conversation") ?? "";
  const [messages, setMessages] = useState<Message[]>([]),
    [body, setBody] = useState(""),
    [attachment, setAttachment] = useState<string | undefined>(),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [cursor, setCursor] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    const update = () =>
      api<Page<Message>>("conversations/" + id)
        .then((v) => {
          if (live) {
            setMessages(v.items);
            setCursor(v.nextCursor);
            api("conversations/" + id + "/read", {}).catch(() => {});
          }
        })
        .catch((e) => setError(e.message));
    update();
    const t = setInterval(update, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [id]);
  return (
    <section className="panel">
      <label>
        Search conversations
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="chips">
        {rows
          .filter((c) =>
            c.other?.name.toLowerCase().includes(query.toLowerCase()),
          )
          .map((c) => (
            <button
              key={c.id}
              onClick={() => {
                router.replace(
                  pathname + "?conversation=" + encodeURIComponent(c.id),
                );
                act("conversations/" + c.id + "/read", {});
              }}
            >
              {c.other?.name} {c.unread > 0 ? "●" : ""}
            </button>
          ))}
      </div>
      {cursor && (
        <button
          onClick={async () => {
            const older = await api<Page<Message>>(
              "conversations/" + id + "?cursor=" + cursor,
            );
            setMessages((m) => [...older.items, ...m]);
            setCursor(older.nextCursor);
          }}
        >
          Earlier messages
        </button>
      )}
      {messages.map((m) => (
        <div className="bubble" key={m.id}>
          <b>{m.sender.name}</b>
          <p>{m.body}</p>
          {m.media &&
            (m.media.mime.startsWith("video") ? (
              <video controls src={"/api/media/" + m.media.id} />
            ) : (
              <img alt="Message attachment" src={"/api/media/" + m.media.id} />
            ))}
          <small>{new Date(m.createdAt).toLocaleString()}</small>
        </div>
      ))}
      {id && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            try {
              await api("conversations/" + id + "/messages", {
                body,
                mediaId: attachment,
              });
              setBody("");
              setAttachment(undefined);
              setMessages(
                (await api<Page<Message>>("conversations/" + id)).items,
              );
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setPending(false);
            }
          }}
        >
          <label>
            Message
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={4000}
            />
          </label>
          <label>
            Attach media
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
              onChange={async (e) => {
                try {
                  if (e.target.files?.[0])
                    setAttachment(await upload(e.target.files[0], "message"));
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            />
          </label>
          {attachment && (
            <p>
              Attachment ready{" "}
              <button type="button" onClick={() => setAttachment(undefined)}>
                Remove
              </button>
            </p>
          )}
          <button
            className="primary"
            disabled={pending || (!body.trim() && !attachment)}
          >
            {pending ? "Sending…" : "Send message"}
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {!id && <p>Select a conversation to start connecting.</p>}
    </section>
  );
}
export function Composer({ act, initial }: { act: Act; initial?: Post }) {
  const [media, setMedia] = useState<string[]>(
      initial?.media?.map((m: Attachment) => m.id) ?? [],
    ),
    [error, setError] = useState("");
  return (
    <section className="panel">
      <h2>Share something special</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          await act("posts", {
            id: initial?.id,
            body: f.get("body"),
            preview: f.get("preview"),
            visibility: f.get("visibility"),
            published: f.get("published") === "on",
            mediaIds: media,
            consent: f.get("consent") === "on",
          });
        }}
      >
        <label>
          Post
          <textarea
            name="body"
            required
            maxLength={10000}
            defaultValue={initial?.body ?? ""}
          />
        </label>
        <label>
          Public preview
          <input
            name="preview"
            required
            maxLength={280}
            defaultValue={initial?.preview ?? ""}
          />
        </label>
        <label>
          Visibility
          <select
            name="visibility"
            defaultValue={initial?.visibility ?? "PUBLIC"}
          >
            <option value="PUBLIC">Public</option>
            <option value="SUBSCRIBERS">Subscribers only</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            name="published"
            defaultChecked={initial?.published ?? true}
          />{" "}
          Publish immediately (uncheck to save draft)
        </label>
        <label>
          Attachments
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
            onChange={async (e) => {
              try {
                for (const file of Array.from(e.target.files ?? [])) {
                  const f = new FormData();
                  f.set("file", file);
                  f.set("purpose", "post");
                  const r = await fetch("/api/uploads", {
                    method: "POST",
                    body: f,
                  });
                  const data = await r.json();
                  if (!r.ok) throw Error(data.error);
                  setMedia((m) => [...m, data.id]);
                }
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          />
        </label>
        <p>{media.length} attachments uploaded</p>
        {media.map((m) => (
          <button
            type="button"
            key={m}
            onClick={() => setMedia((v) => v.filter((id) => id !== m))}
          >
            Remove attachment {media.indexOf(m) + 1}
          </button>
        ))}
        {error && <p role="alert">{error}</p>}
        <label>
          <input type="checkbox" name="consent" required /> I own this content
          and have consent from everyone depicted.
        </label>
        <button className="primary">Save post</button>
      </form>
    </section>
  );
}

async function upload(file: File, purpose: string) {
  const f = new FormData();
  f.set("file", file);
  f.set("purpose", purpose);
  const r = await fetch("/api/uploads", { method: "POST", body: f });
  const data = await r.json();
  if (!r.ok) throw Error(data.error);
  return data.id as string;
}
export function SettingsForm({ me, act }: { me: Account; act: Act }) {
  const [avatar, setAvatar] = useState<string | null>(me.avatarId),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await act("settings", {
          name: f.get("name"),
          username: f.get("username"),
          avatarId: avatar,
          emailNotifications: f.get("emailNotifications") === "on",
          allowMessages: f.get("allowMessages") === "on",
          privateProfile: f.get("privateProfile") === "on",
        });
      }}
    >
      <label>
        Display name
        <input name="name" defaultValue={me.name} required />
      </label>
      <label>
        Username
        <input name="username" defaultValue={me.username} required />
      </label>
      <label>
        Avatar
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={async (e) => {
            try {
              if (e.target.files?.[0])
                setAvatar(await upload(e.target.files[0], "avatar"));
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        />
      </label>
      {avatar && (
        <img
          className="avatar"
          alt="Avatar preview"
          src={"/api/media/" + avatar}
        />
      )}
      <button type="button" onClick={() => setAvatar(null)}>
        Remove avatar
      </button>
      {["emailNotifications", "allowMessages", "privateProfile"].map((n) => (
        <label key={n}>
          <input
            type="checkbox"
            name={n}
            defaultChecked={
              me.settings?.[n as keyof NonNullable<Account["settings"]>] ??
              n !== "privateProfile"
            }
          />
          {n === "emailNotifications"
            ? "Email notifications"
            : n === "allowMessages"
              ? "Allow direct messages"
              : "Private profile"}
        </label>
      ))}
      {error && <p role="alert">{error}</p>}
      <button className="primary">Save settings</button>
    </form>
  );
}

export function CreatorSettings({
  profile,
  act,
}: {
  profile: Partial<CreatorProfile>;
  act: Act;
}) {
  const [cover, setCover] = useState<string | null>(profile.coverId ?? null),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await act("creator/profile", {
          bio: f.get("bio"),
          category: f.get("category"),
          location: f.get("location"),
          website: f.get("website"),
          monthlyPriceCents: Number(f.get("price")),
          coverId: cover,
          consent: f.get("consent") === "on",
        });
      }}
    >
      <label>
        Biography
        <textarea
          name="bio"
          defaultValue={profile.bio ?? ""}
          maxLength={1500}
        />
      </label>
      <label>
        Category
        <select name="category" defaultValue={profile.category}>
          {[
            "Art & design",
            "Photography",
            "Music",
            "Wellness",
            "Food",
            "Lifestyle",
          ].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <label>
        Location
        <input name="location" defaultValue={profile.location ?? ""} />
      </label>
      <label>
        Website
        <input name="website" type="url" defaultValue={profile.website ?? ""} />
      </label>
      <label>
        Monthly price in USD cents
        <input
          name="price"
          type="number"
          min="0"
          max="100000"
          defaultValue={profile.monthlyPriceCents ?? 1000}
          required
        />
      </label>
      <label>
        Cover image
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={async (e) => {
            try {
              if (e.target.files?.[0])
                setCover(await upload(e.target.files[0], "cover"));
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        />
      </label>
      {cover && <img alt="Cover preview" src={"/api/media/" + cover} />}
      <label>
        <input name="consent" type="checkbox" required /> I confirm I am an
        adult and have rights and consent to publish my content.
      </label>
      <p>
        Verification status: {profile.verification ?? "NOT_SUBMITTED"}.
        Production publishing requires operator verification.
      </p>
      {error && <p role="alert">{error}</p>}
      <button className="primary">Save creator profile</button>
    </form>
  );
}

export function AdminPanel({
  route,
  data,
  act,
}: {
  route: string;
  data: Administration;
  act: Act;
}) {
  const kind = route.split("/")[2] ?? "users";
  type AdminRow = {
    id: string;
    name?: string;
    preview?: string;
    reason?: string;
    username?: string;
    status?: string;
    role?: string;
    suspended?: boolean;
    body?: string;
    amountCents?: number;
    media?: { media: Attachment }[];
  };
  const rows: AdminRow[] =
    kind === "reports"
      ? data.reports
      : kind === "content"
        ? data.content
        : kind === "transactions"
          ? data.transactions
          : kind === "creators"
            ? data.users.filter((u) => u.creator)
            : data.users;
  return (
    <section className="panel">
      <h2>Platform {kind}</h2>
      <div className="chips">
        {["users", "creators", "reports", "content", "transactions"].map(
          (n) => (
            <Link href={"/admin/" + n} key={n}>
              {n}
            </Link>
          ),
        )}
      </div>
      {rows.map((r) => (
        <article className="panel" key={r.id}>
          <h3>{r.name ?? r.preview ?? r.reason ?? r.id}</h3>
          <p>
            {r.username && "@" + r.username} {r.status ?? r.role ?? ""}{" "}
            {r.suspended ? "Suspended" : ""}
          </p>
          {kind === "content" && (
            <>
              <p>{r.body}</p>
              {r.media?.map((m: { media: Attachment }) =>
                m.media.mime.startsWith("video") ? (
                  <video
                    key={m.media.id}
                    controls
                    src={"/api/media/" + m.media.id}
                  />
                ) : (
                  <img
                    key={m.media.id}
                    alt="Moderation attachment"
                    src={"/api/media/" + m.media.id}
                  />
                ),
              )}
            </>
          )}
          {kind === "transactions" ? (
            <p>
              Sandbox ${((r.amountCents ?? 0) / 100).toFixed(2)} · {r.status}
            </p>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await act("admin/action", {
                  action: f.get("action"),
                  targetId: r.id,
                  role: f.get("role"),
                  note: f.get("note"),
                });
              }}
            >
              <label>
                Action
                <select name="action">
                  {(kind === "content"
                    ? ["remove", "restore"]
                    : kind === "reports"
                      ? ["resolve", "dismiss"]
                      : kind === "creators"
                        ? ["approve", "reject", "suspend", "unsuspend", "role"]
                        : ["suspend", "unsuspend", "role"]
                  ).map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              {["users", "creators"].includes(kind) && (
                <label>
                  Role (for role change)
                  <select name="role" defaultValue={r.role}>
                    {["SUBSCRIBER", "CREATOR", "ADMIN"].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Reason for audit log
                <textarea name="note" minLength={5} maxLength={1000} required />
              </label>
              <button className="primary">Apply moderation action</button>
            </form>
          )}
        </article>
      ))}
      <h3>Recent audit trail</h3>
      {data.audits.map((a) => (
        <p key={a.id}>
          {a.action} · {a.detail} · {new Date(a.createdAt).toLocaleString()}
        </p>
      ))}
    </section>
  );
}
