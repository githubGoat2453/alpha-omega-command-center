import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { enqueueAction, getHistory } from "../bot-events/store";

function secureEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
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

// GET: owner polls action history + pending
export async function GET() {
  if (!(await isOwner()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ history: getHistory(100) });
}

// POST: owner queues a new control action
export async function POST(req: NextRequest) {
  if (!(await isOwner()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action.trim() : "";
  const params =
    typeof body.params === "object" && body.params !== null
      ? (body.params as Record<string, unknown>)
      : {};
  if (!action)
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  const id = enqueueAction(action, params);
  return NextResponse.json({ id, queued: true });
}
