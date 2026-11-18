export default function Loading() {
  return (
    <main className="standalone-state" aria-busy="true" role="status">
      <span className="state-orbit" aria-hidden="true">
        ✳
      </span>
      <h1>Opening your circle…</h1>
      <p>Getting your space ready.</p>
    </main>
  );
}
