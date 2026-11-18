/* Authenticated profile assets bypass shared image optimization caches. */
/* eslint-disable @next/next/no-img-element */
import type { Identity } from "@/lib/types";
export function Avatar({
  user,
  large = false,
}: {
  user: Pick<Identity, "name" | "avatarId"> | null;
  large?: boolean;
}) {
  return (
    <span
      className={"avatar" + (large ? " large" : "")}
      aria-label={user?.name ?? "FollowersOnly"}
    >
      {user?.avatarId ? (
        <img alt="" src={"/api/media/" + user.avatarId} />
      ) : (
        (user?.name?.[0] ?? "F")
      )}
    </span>
  );
}
