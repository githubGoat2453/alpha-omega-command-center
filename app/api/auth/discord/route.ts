import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.DISCORD_OAUTH_CLIENT_ID ?? process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "Discord OAuth is not configured." }, { status: 503 });
  }
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify");
  return NextResponse.redirect(url);
}
