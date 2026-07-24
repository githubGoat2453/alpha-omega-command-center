import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const ownerId = process.env.OWNER_ID ?? "1501897844624461904";
const commandNames = ["ping", "uptime", "guilds", "cmdcount", "serverinfo", "membercount"];

export async function GET() {
  const raw = (await cookies()).get("owner_session")?.value;
  const secret = process.env.AUTH_COOKIE_SECRET;
  if (!raw || !secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [payload, signature] = raw.split(".");
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (!payload || signature !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (session.exp < Date.now() || session.id !== ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.DISCORD_TOKEN;
  let bot = { connected: false, username: "The End Of All Fate", guilds: 0 };
  if (token) {
    const headers = { Authorization: `Bot ${token}` };
    const [userResponse, guildResponse] = await Promise.all([
      fetch("https://discord.com/api/v10/users/@me", { headers, cache: "no-store" }),
      fetch("https://discord.com/api/v10/users/@me/guilds?limit=200", { headers, cache: "no-store" }),
    ]);
    if (userResponse.ok) {
      const user = await userResponse.json();
      const guilds = guildResponse.ok ? await guildResponse.json() : [];
      bot = { connected: true, username: user.global_name ?? user.username, guilds: Array.isArray(guilds) ? guilds.length : 0 };
    }
  }
  return NextResponse.json({ bot, commands: commandNames.map((name) => ({ name: `!${name}`, status: bot.connected ? "ready" : "waiting" })), checkedAt: new Date().toISOString() });
}
