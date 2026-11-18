import Link from "next/link";
export default function NotFound() {
  return (
    <main className="standalone-state">
      <span className="state-orbit" aria-hidden="true">
        ✳
      </span>
      <p className="eyebrow">A LITTLE OFF THE PATH</p>
      <h1>This space doesn’t exist.</h1>
      <p>The page may have moved, or this creator is no longer available.</p>
      <Link className="primary" href="/explore">
        Find your next favorite
      </Link>
    </main>
  );
}
