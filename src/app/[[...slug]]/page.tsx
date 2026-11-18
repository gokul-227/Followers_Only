import Experience from "@/components/experience";
import { viewer } from "@/lib/security";
import { db } from "@/lib/db";
import { redirect, notFound } from "next/navigation";
export const dynamic = "force-dynamic";
const publicRoutes = new Set([
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
]);
const subscriberRoutes = new Set([
  "/home",
  "/feed",
  "/explore",
  "/search",
  "/notifications",
  "/messages",
  "/subscriptions",
  "/bookmarks",
  "/settings",
]);
const creatorRoutes = new Set([
  "/creator/dashboard",
  "/creator/posts",
  "/creator/posts/new",
  "/creator/subscribers",
  "/creator/earnings",
  "/creator/analytics",
  "/creator/messages",
  "/creator/settings",
]);
const adminRoutes = new Set([
  "/admin",
  "/admin/users",
  "/admin/creators",
  "/admin/reports",
  "/admin/content",
  "/admin/transactions",
]);
export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const segments = (await params).slug ?? [];
  const route = "/" + segments.join("/");
  const isProtected =
    subscriberRoutes.has(route) ||
    creatorRoutes.has(route) ||
    adminRoutes.has(route);
  if (isProtected) {
    const user = await viewer();
    if (!user) redirect("/login");
    if (adminRoutes.has(route) && user.role !== "ADMIN") redirect("/home");
    if (
      creatorRoutes.has(route) &&
      route !== "/creator/settings" &&
      user.role !== "CREATOR" &&
      user.role !== "ADMIN"
    )
      redirect("/creator/settings");
  } else if (!publicRoutes.has(route)) {
    if (
      segments.length < 1 ||
      segments.length > 2 ||
      (segments.length === 2 && !["posts", "media"].includes(segments[1]))
    )
      notFound();
    const creator = await db.creatorProfile.findFirst({
      where: {
        user: {
          username: segments[0],
          suspended: false,
          role: { in: ["CREATOR", "ADMIN"] },
        },
      },
      select: { id: true },
    });
    if (!creator) notFound();
  }
  return <Experience route={route} />;
}
