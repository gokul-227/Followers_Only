"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="standalone-state">
      <p className="eyebrow">LET’S TRY THAT AGAIN</p>
      <h1>We couldn’t load this space.</h1>
      <p>Your changes haven’t been submitted. Try again in a moment.</p>
      <button className="primary" onClick={reset}>
        Try again
      </button>{" "}
      <Link href="/home">Back to home</Link>
    </main>
  );
}
