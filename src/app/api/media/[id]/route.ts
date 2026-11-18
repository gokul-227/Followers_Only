import { NextResponse } from "next/server";
import { viewer, HttpError } from "@/lib/security";
import { readMedia } from "@/lib/storage";
export const dynamic = "force-dynamic";
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const { buffer, mime } = await readMedia(id, await viewer());
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
        "Content-Length": String(buffer.length),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof HttpError ? e.message : "Media unavailable." },
      { status: e instanceof HttpError ? e.status : 500 },
    );
  }
}
