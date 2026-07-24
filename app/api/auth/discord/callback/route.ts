import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const ownerId = process.env.OWNER_ID ?? "1501897844624461904";
const sign = (value: string, secret: string) => createHmac("sha256", secret).update(value).digest("hex");

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const clientId = process.env.DISCORD_OAUTH_CLIENT_ID ?? process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_OAUTH_REDIRECT_URI;
  const cookieSecret = process.env.AUTH_COOKIE_SECRET;
  if (!code || !clientId || !clientSecret || !redirectUri || !cookieSecret) return NextResponse.redirect(new URL("/?auth=failed", request.url));
  const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  if (!tokenResponse.ok) return NextResponse.redirect(new URL("/?auth=failed", request.url));
  const token = await tokenResponse.json();
  const userResponse = await fetch("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (!userResponse.ok) return NextResponse.redirect(new URL("/?auth=failed", request.url));
  const user = await userResponse.json();
  if (user.id !== ownerId) return NextResponse.redirect(new URL("/?auth=denied", request.url));
  const payload = Buffer.from(JSON.stringify({ id: user.id, name: user.global_name ?? user.username, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString("base64url");
  const response = NextResponse.redirect(new URL("/?auth=success", request.url));
  response.cookies.set("owner_session", `${payload}.${sign(payload, cookieSecret)}`, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 8 * 60 * 60, path: "/" });
  return response;
}
