export async function api<T = unknown>(
  path: string,
  data?: unknown,
): Promise<T> {
  const r = await fetch(
    "/api/" + path,
    data
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      : {},
  );
  const v = await r.json();
  if (!r.ok) throw Error(v.error);
  return v as T;
}
