/** Serialized public DTOs. Secret/session/payment-provider credentials are never included. */
export interface Identity {
  id: string;
  name: string;
  username: string;
  avatarId: string | null;
}
export interface Creator extends Identity {
  coverId?: string | null;
  location?: string;
  website?: string;
  bio: string;
  category: string;
  monthlyPriceCents: number;
  followerCount: number;
  postCount: number;
  subscribed: boolean;
  following: boolean;
  verification: string;
}
export interface Attachment {
  id: string;
  mime: string;
  processingStatus?: string;
}
export interface Post {
  id: string;
  author: Identity;
  body: string | null;
  preview: string;
  visibility: "PUBLIC" | "SUBSCRIBERS";
  published: boolean;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
  media: Attachment[];
  likeCount: number;
  commentCount: number;
  liked: boolean;
  bookmarked: boolean;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export interface Message {
  id: string;
  sender: Identity;
  body: string;
  media: Attachment | null;
  createdAt: string;
}
export interface Conversation {
  id: string;
  other: Identity;
  lastMessage: string;
  updatedAt: string;
  unread: number;
}
export interface Comment {
  id: string;
  author: Identity;
  body: string;
  createdAt: string;
}
export interface Preferences {
  emailNotifications: boolean;
  allowMessages: boolean;
  privateProfile: boolean;
}
export interface Account extends Identity {
  role: "SUBSCRIBER" | "CREATOR" | "ADMIN";
  email: string;
  emailVerified: boolean;
  settings: Preferences | null;
}
export type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;
export type Dashboard = Serialized<
  Awaited<ReturnType<typeof import("./queries").dashboard>>
>;
export type Administration = Serialized<
  Awaited<ReturnType<typeof import("./queries").adminData>>
>;
export type CreatorProfile = NonNullable<Dashboard["profile"]>;
export interface ActionResult {
  id?: string;
  transactionId?: string;
  ok?: boolean;
  mode?: string;
  status?: string;
  amountCents?: number;
  active?: boolean;
  following?: boolean;
  message?: string;
}
export type Act = (
  path: string,
  data: unknown,
) => Promise<ActionResult | undefined>;
export type CreatorProfileDTO = CreatorProfile;
export type DashboardDTO = Dashboard;
export type AdminDTO = Administration;
export type ActResult = ActionResult;
export type NotificationDTO = Serialized<import("@prisma/client").Notification>;
export type PaymentDTO = Serialized<
  import("@prisma/client").PaymentTransaction
>;
export type SubscriptionDTO = Serialized<
  import("@prisma/client").Subscription
> & { creator: Identity; transactions: PaymentDTO[]; entitled: boolean };
