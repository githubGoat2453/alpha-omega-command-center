import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { drainPending, recordResult } from "../bot-events/store";

function secureEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function isBotAuth(req: NextRequest) {
  const secret = process.env.BOT_LOG_SECRET;
  const supplied = req.headers.get("x-bot-log-secret") ?? "";
  return !!secret && secureEqual(supplied, secret);
}

async function isOwner() {
  const raw = (await cookies()).get("owner_session")?.value;
  const secret = process.env.AUTH_COOKIE_SECRET;
  if (!raw || !secret) return false;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (!secureEqual(sig, expected)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString());
    const ownerId = process.env.OWNER_ID ?? "1501897844624461904";
    return session.exp >= Date.now() && session.id === ownerId;
  } catch {
    return false;
  }
}

// GET: bot polls for pending actions
export async function GET(req: NextRequest) {
  if (!isBotAuth(req))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actions = drainPending();
  return NextResponse.json({ actions });
}

// POST: bot submits result after executing an action
export async function POST(req: NextRequest) {
  // Only bots post here
  if (!isBotAuth(req)) {
    // Also allow owner to force-drain / debug
    if (!(await isOwner()))
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const result = typeof body.result === "string" ? body.result : "";
  const ok = body.ok === true;
  if (id) recordResult(id, result, ok);
  return NextResponse.json({ accepted: true });
}
