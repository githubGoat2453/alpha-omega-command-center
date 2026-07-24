import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const raw = (await cookies()).get("owner_session")?.value;
  if (!raw) return NextResponse.json({ authenticated: false });
  const [payload, signature] = raw.split(".");
  const secret = process.env.AUTH_COOKIE_SECRET;
  if (!secret) return NextResponse.json({ authenticated: false });
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (!payload || signature !== expected) return NextResponse.json({ authenticated: false });
  try {
    const user = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (user.exp < Date.now() || user.id !== (process.env.OWNER_ID ?? "1501897844624461904")) return NextResponse.json({ authenticated: false });
    return NextResponse.json({ authenticated: true, user });
  } catch {
    return NextResponse.json({ authenticated: false });
  }
}
