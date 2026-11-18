import { assert, HttpError } from "./security";
/** Bound streamed request bodies even when Content-Length is absent or dishonest. */
export async function readBoundedBody(req: Request, maxBytes: number) {
  const declared = Number(req.headers.get("content-length") ?? 0);
  assert(
    Number.isFinite(declared) && declared >= 0 && declared <= maxBytes,
    413,
    "Request is too large.",
  );
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "Request is too large.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
