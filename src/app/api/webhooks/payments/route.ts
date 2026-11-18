import { NextResponse } from "next/server";
import { processPaymentEvent } from "@/lib/payments";
import { HttpError, rateLimit } from "@/lib/security";
import { readBoundedBody } from "@/lib/request";
export async function POST(req: Request) {
  try {
    await rateLimit("webhook", 200);
    const raw = new TextDecoder().decode(await readBoundedBody(req, 16384));
    return NextResponse.json(
      await processPaymentEvent(raw, req.headers.get("x-fo-signature")),
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof HttpError ? e.message : "Invalid payment event." },
      { status: e instanceof HttpError ? e.status : 400 },
    );
  }
}
