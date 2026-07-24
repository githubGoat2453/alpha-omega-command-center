import { NextResponse } from "next/server";

const botId = process.env.DISCORD_CLIENT_ID ?? "1503928394411147304";

export async function GET() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    return NextResponse.json({ connected: false, botId, username: "The End Of All Fate", updatedAt: new Date().toISOString() });
  }
  try {
    const response = await fetch(`https://discord.com/api/v10/users/${botId}`, {
      headers: { Authorization: `Bot ${token}` },
      cache: "no-store",
    });
    if (!response.ok) return NextResponse.json({ connected: false, botId, error: "Discord bot unavailable", updatedAt: new Date().toISOString() });
    const user = await response.json();
    return NextResponse.json({
      connected: true,
      botId,
      username: user.global_name ?? user.username,
      avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${botId}/${user.avatar}.webp?size=128` : null,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ connected: false, botId, error: "Status check failed", updatedAt: new Date().toISOString() });
  }
}
