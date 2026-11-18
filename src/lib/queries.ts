import { Prisma, type User } from "@prisma/client";
import { db } from "./db";
import {
  activeSubscription,
  assert,
  publicUser,
  canRead,
  canViewProfile,
} from "./security";
const authorSelect = {
  id: true,
  name: true,
  username: true,
  avatarId: true,
  creator: { select: { category: true, verification: true } },
} as const;
function visibleAuthorWhere(user: User | null): Prisma.UserWhereInput {
  if (user?.role === "ADMIN") return { suspended: false };
  const entitlement: Prisma.UserWhereInput = user
    ? {
        audience: {
          some: {
            subscriberId: user.id,
            status: { in: ["ACTIVE", "CANCELED"] },
            currentPeriodEnd: { gt: new Date() },
          },
        },
      }
    : { id: "__no_anonymous_entitlement__" };
  return {
    suspended: false,
    AND: [
      {
        OR: [
          { settings: { is: null } },
          { settings: { is: { privateProfile: false } } },
          ...(user ? [{ id: user.id }, entitlement] : []),
        ],
      },
      {
        OR: [
          { role: { in: ["CREATOR", "ADMIN"] } },
          ...(user ? [{ id: user.id }, entitlement] : []),
        ],
      },
    ],
  };
}
export async function creatorCards(
  user: User | null,
  q = "",
  category = "",
  free = false,
  exactUsername?: string,
) {
  const candidates = await db.creatorProfile.findMany({
    where: {
      user: {
        ...visibleAuthorWhere(user),
        ...(exactUsername
          ? { username: exactUsername }
          : {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { username: { contains: q, mode: "insensitive" } },
              ],
            }),
      },
      ...(category ? { category } : {}),
      ...(free ? { monthlyPriceCents: 0 } : {}),
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          avatarId: true,
          _count: {
            select: {
              posts: { where: { published: true, removed: false } },
              followers: true,
            },
          },
        },
      },
    },
    take: exactUsername ? 1 : 100,
    orderBy: { createdAt: "asc" },
  });
  const subs = user
    ? await db.subscription.findMany({ where: { subscriberId: user.id } })
    : [];
  const follows = user
    ? await db.follow.findMany({ where: { followerId: user.id } })
    : [];
  const visible = await Promise.all(
    candidates.map(async (c) =>
      (await canViewProfile(c.userId, user)) ? c : null,
    ),
  );
  return visible
    .filter((c) => c !== null)
    .slice(0, 48)
    .map((c) => ({
      id: c.user.id,
      profileId: c.id,
      name: c.user.name,
      username: c.user.username,
      avatarId: c.user.avatarId,
      bio: c.bio,
      category: c.category,
      location: c.location,
      website: c.website,
      coverId: c.coverId,
      monthlyPriceCents: c.monthlyPriceCents,
      verification: c.verification,
      createdAt: c.createdAt,
      postCount: c.user._count.posts,
      followerCount: c.user._count.followers,
      subscribed: activeSubscription(
        subs.find((s) => s.creatorId === c.user.id) ?? null,
      ),
      following: follows.some((f) => f.followedId === c.user.id),
    }));
}
export async function feed(
  user: User | null,
  options: {
    author?: string;
    bookmarks?: boolean;
    mine?: boolean;
    cursor?: string;
    media?: boolean;
  } = {},
) {
  const authorWhere = visibleAuthorWhere(user);
  const where: Prisma.PostWhereInput = {
    removed: false,
    author: authorWhere,
    ...(options.mine ? { authorId: user?.id } : { published: true }),
    ...(options.author
      ? { author: { ...authorWhere, username: options.author } }
      : {}),
    ...(options.bookmarks
      ? { bookmarks: { some: { userId: user?.id ?? "none" } } }
      : {}),
    ...(options.media ? { media: { some: {} } } : {}),
  };
  if (options.cursor) {
    const cursorPost = await db.post.findUnique({
      where: { id: options.cursor },
    });
    assert(cursorPost, 400, "Invalid page cursor.");
    where.OR = [
      { createdAt: { lt: cursorPost.createdAt } },
      { createdAt: cursorPost.createdAt, id: { lt: cursorPost.id } },
    ];
  }
  const posts = await db.post.findMany({
    where,
    include: {
      author: { select: authorSelect },
      media: {
        include: {
          media: { select: { id: true, mime: true, processingStatus: true } },
        },
        orderBy: { position: "asc" },
      },
      _count: { select: { likes: true, comments: true } },
      likes: { where: { userId: user?.id ?? "none" }, select: { id: true } },
      bookmarks: {
        where: { userId: user?.id ?? "none" },
        select: { id: true },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 11,
  });
  const more = posts.length > 10;
  const shown = posts.slice(0, 10);
  const items = await Promise.all(
    shown.map(async (p) => {
      const unlocked = await canRead(p.authorId, p.visibility, user);
      return {
        id: p.id,
        author: p.author,
        body: unlocked ? p.body : null,
        preview: p.preview,
        visibility: p.visibility,
        published: p.published,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        locked: !unlocked,
        media: unlocked ? p.media.map((m) => m.media) : [],
        likeCount: p._count.likes,
        commentCount: p._count.comments,
        liked: p.likes.length > 0,
        bookmarked: p.bookmarks.length > 0,
      };
    }),
  );
  return { items, nextCursor: more ? shown.at(-1)?.id : null };
}
export async function dashboard(user: User) {
  const [profile, posts, subscriptions, payments, payouts] = await Promise.all([
    db.creatorProfile.findUnique({ where: { userId: user.id } }),
    db.post.count({ where: { authorId: user.id, removed: false } }),
    db.subscription.findMany({
      where: { creatorId: user.id },
      include: { subscriber: { select: authorSelect } },
      orderBy: { createdAt: "desc" },
    }),
    db.paymentTransaction.findMany({
      where: { subscription: { creatorId: user.id } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.payout.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const aggregate = await db.paymentTransaction.aggregate({
    where: { subscription: { creatorId: user.id }, status: "SUCCEEDED" },
    _sum: { amountCents: true },
  });
  const revenue = aggregate._sum.amountCents ?? 0;
  return {
    profile,
    postCount: posts,
    subscriberCount: subscriptions.filter(activeSubscription).length,
    subscriptions: subscriptions.map((s) => ({
      ...s,
      subscriber: { ...s.subscriber, creator: undefined },
    })),
    payments,
    payouts,
    revenueCents: revenue,
    monthly: subscriptions
      .filter(activeSubscription)
      .reduce((sum, s) => sum + s.priceCents, 0),
    mode: "sandbox",
  };
}
export async function adminData() {
  const [users, reports, content, transactions, audits] = await Promise.all([
    db.user.findMany({
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        suspended: true,
        createdAt: true,
        creator: true,
      },
      take: 100,
      orderBy: { createdAt: "desc" },
    }),
    db.report.findMany({
      include: {
        reporter: { select: { username: true } },
        post: { select: { id: true, preview: true } },
      },
      take: 100,
      orderBy: { createdAt: "desc" },
    }),
    db.post.findMany({
      select: {
        id: true,
        body: true,
        preview: true,
        visibility: true,
        published: true,
        removed: true,
        media: { select: { media: { select: { id: true, mime: true } } } },
        author: { select: { username: true } },
        createdAt: true,
      },
      take: 100,
      orderBy: { createdAt: "desc" },
    }),
    db.paymentTransaction.findMany({
      take: 100,
      orderBy: { createdAt: "desc" },
    }),
    db.auditLog.findMany({ take: 50, orderBy: { createdAt: "desc" } }),
  ]);
  return { users, reports, content, transactions, audits };
}
export async function conversations(user: User) {
  const rows = await db.conversation.findMany({
    where: { participants: { some: { userId: user.id } } },
    include: {
      participants: { include: { user: { select: authorSelect } } },
      messages: { take: 1, orderBy: { createdAt: "desc" } },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return Promise.all(
    rows.map(async (c) => {
      const participant = c.participants.find((p) => p.userId === user.id)!;
      const unread = await db.message.count({
        where: {
          conversationId: c.id,
          senderId: { not: user.id },
          createdAt: { gt: participant.lastReadAt },
        },
      });
      return {
        id: c.id,
        other: c.participants.find((p) => p.userId !== user.id)?.user,
        lastMessage: c.messages[0]?.body ?? "",
        updatedAt: c.updatedAt,
        unread,
      };
    }),
  );
}
export async function thread(user: User, id: string, cursor?: string) {
  assert(
    await db.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: user.id } },
    }),
    403,
    "Conversation access denied.",
  );
  if (cursor)
    assert(
      await db.message.findFirst({ where: { id: cursor, conversationId: id } }),
      400,
      "Invalid conversation cursor.",
    );
  const items = await db.message.findMany({
    where: { conversationId: id },
    include: {
      sender: { select: authorSelect },
      media: { select: { id: true, mime: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  return {
    items: items.reverse(),
    nextCursor: items.length === 50 ? items[0]?.id : null,
  };
}
export async function ownData(user: User) {
  const full = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { creator: true, settings: true },
  });
  return {
    ...publicUser(full),
    email: full.email,
    creator: full.creator,
    settings: full.settings,
  };
}
