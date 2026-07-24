import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { addEvent, eventStore, setMetrics } from "./store";

const ownerId = process.env.OWNER_ID ?? "1501897844624461904";

function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function isOwner() {
  const raw = (await cookies()).get("owner_session")?.value;
  const secret = process.env.AUTH_COOKIE_SECRET;
  if (!raw || !secret) return false;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (!secureEqual(signature, expected)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString());
    return session.exp >= Date.now() && session.id === ownerId;
  } catch {
    return false;
  }
}

export async function GET() {
  if (!(await isOwner())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    events: eventStore.events,
    metrics: eventStore.metrics ?? null,
    connected: eventStore.events.some(
      (event) => event.type === "bot.ready" && Date.now() - new Date(event.timestamp).getTime() < 86_400_000,
    ),
    checkedAt: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.BOT_LOG_SECRET;
  const suppliedSecret = request.headers.get("x-bot-log-secret") ?? "";
  if (!configuredSecret || !secureEqual(suppliedSecret, configuredSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const level = body.level === "error" || body.level === "warn" ? body.level : "info";
  if (body.type === "bot.heartbeat" && body.metrics && typeof body.metrics === "object") {
    const metrics = body.metrics as Record<string, unknown>;
    setMetrics({
      connected: true,
      uptimeSeconds: Number(metrics.uptimeSeconds) || 0,
      latencyMs: Number(metrics.latencyMs) || 0,
      guilds: Number(metrics.guilds) || 0,
      members: Number(metrics.members) || 0,
      channels: Number(metrics.channels) || 0,
      commands: Number(metrics.commands) || 0,
      heartbeatAt: new Date().toISOString(),
    });
    return NextResponse.json({ accepted: true });
  }
  const message = typeof body.message === "string" ? body.message.slice(0, 300) : "Bot event";
  addEvent({
    level,
    type: typeof body.type === "string" ? body.type.slice(0, 80) : "bot.event",
    message,
    timestamp: typeof body.timestamp === "string" ? body.timestamp : undefined,
    command: typeof body.command === "string" ? body.command.slice(0, 100) : undefined,
    user: typeof body.user === "string" ? body.user.slice(0, 100) : undefined,
    guild: typeof body.guild === "string" ? body.guild.slice(0, 120) : undefined,
    channel: typeof body.channel === "string" ? body.channel.slice(0, 120) : undefined,
  });
  return NextResponse.json({ accepted: true });
}
