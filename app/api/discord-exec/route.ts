import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const API = "https://discord.com/api/v10";
const ownerId = process.env.OWNER_ID ?? "1501897844624461904";

function secEq(a: string, b: string) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

async function isOwner() {
  const raw = (await cookies()).get("owner_session")?.value;
  const secret = process.env.AUTH_COOKIE_SECRET;
  if (!raw || !secret) return false;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (!secEq(sig, expected)) return false;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString());
    return s.exp >= Date.now() && s.id === ownerId;
  } catch { return false; }
}

type DiscordResult = { ok: boolean; status: number; data: unknown };

async function dc(method: string, path: string, body?: unknown): Promise<DiscordResult> {
  const token = process.env.DISCORD_TOKEN;
  if (!token) return { ok: false, status: 503, data: { message: "No bot token configured on server" } };
  const opts: RequestInit = {
    method,
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(`${API}${path}`, opts);
    let data: unknown;
    try { data = await r.json(); } catch { data = {}; }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 500, data: { message: String(e) } };
  }
}

function fmt(label: string, r: DiscordResult, extra?: string): { ok: boolean; result: string } {
  if (!r.ok) {
    const msg = (r.data as Record<string,unknown>)?.message ?? r.status;
    return { ok: false, result: `${label} failed: ${msg}` };
  }
  return { ok: true, result: extra ?? `${label} succeeded` };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type P = Record<string, any>;

async function exec(action: string, p: P): Promise<{ ok: boolean; result: string }> {
  switch (action) {

    /* ── Bot / Status ─────────────────────────────────── */
    case "ping_bot": {
      const r = await dc("GET", "/gateway");
      if (!r.ok) return { ok: false, result: "Discord API unreachable" };
      return { ok: true, result: `Discord gateway OK — ${(r.data as P).url}` };
    }

    case "bot_info": {
      const r = await dc("GET", "/users/@me");
      if (!r.ok) return fmt("bot_info", r);
      const u = r.data as P;
      return { ok: true, result: `${u.username}#${u.discriminator} (ID: ${u.id}) — bot: ${u.bot}` };
    }

    /* ── Guilds ───────────────────────────────────────── */
    case "get_guilds": {
      const r = await dc("GET", "/users/@me/guilds?limit=200");
      if (!r.ok) return fmt("get_guilds", r);
      const guilds = r.data as P[];
      if (!guilds.length) return { ok: true, result: "Bot is not in any guilds." };
      return { ok: true, result: guilds.map((g) => `${g.name} (${g.id})`).join("\n") };
    }

    case "get_guild_info": {
      const r = await dc("GET", `/guilds/${p.guild_id}?with_counts=true`);
      if (!r.ok) return fmt("get_guild_info", r);
      const g = r.data as P;
      return { ok: true, result: `${g.name} | Owner: ${g.owner_id} | Members: ${g.approximate_member_count ?? "?"} | Channels: ${g.channels?.length ?? "?"} | Roles: ${g.roles?.length ?? "?"} | Boosts: ${g.premium_subscription_count ?? 0}` };
    }

    case "leave_guild": {
      const r = await dc("DELETE", `/users/@me/guilds/${p.guild_id}`);
      return fmt("Leave guild", r, `Left guild ${p.guild_id}`);
    }

    case "guild_audit": {
      const limit = Math.min(Number(p.limit) || 25, 100);
      const r = await dc("GET", `/guilds/${p.guild_id}/audit-logs?limit=${limit}`);
      if (!r.ok) return fmt("guild_audit", r);
      const log = r.data as P;
      const entries = (log.audit_log_entries as P[]) ?? [];
      if (!entries.length) return { ok: true, result: "No audit log entries found." };
      return { ok: true, result: entries.map((e) => `[${e.action_type}] ${e.user_id} → ${e.target_id ?? "—"} ${e.reason ? `(${e.reason})` : ""}`).join("\n") };
    }

    case "list_invites": {
      const r = await dc("GET", `/guilds/${p.guild_id}/invites`);
      if (!r.ok) return fmt("list_invites", r);
      const inv = r.data as P[];
      if (!inv.length) return { ok: true, result: "No invites found." };
      return { ok: true, result: inv.map((i) => `${i.code} — ${i.inviter?.username ?? "?"} — ${i.uses}/${i.max_uses || "∞"} uses`).join("\n") };
    }

    case "del_all_invites": {
      const r = await dc("GET", `/guilds/${p.guild_id}/invites`);
      if (!r.ok) return fmt("del_all_invites", r);
      const inv = r.data as P[];
      await Promise.all(inv.map((i) => dc("DELETE", `/invites/${i.code}`)));
      return { ok: true, result: `Deleted ${inv.length} invites.` };
    }

    /* ── Channels ─────────────────────────────────────── */
    case "get_channels": {
      const r = await dc("GET", `/guilds/${p.guild_id}/channels`);
      if (!r.ok) return fmt("get_channels", r);
      const chs = (r.data as P[]).sort((a, b) => a.position - b.position);
      const typeLabel = (t: number) => t === 0 ? "text" : t === 2 ? "voice" : t === 4 ? "cat" : t === 5 ? "news" : t === 13 ? "stage" : t === 15 ? "forum" : `${t}`;
      return { ok: true, result: chs.map((c) => `[${typeLabel(c.type)}] ${c.name} (${c.id})`).join("\n") };
    }

    case "create_channel": {
      const body: P = { name: p.name, type: Number(p.type) || 0 };
      if (p.category_id) body.parent_id = p.category_id;
      if (p.topic) body.topic = p.topic;
      const r = await dc("POST", `/guilds/${p.guild_id}/channels`, body);
      if (!r.ok) return fmt("create_channel", r);
      const ch = r.data as P;
      return { ok: true, result: `Created #${ch.name} (${ch.id})` };
    }

    case "delete_channel": {
      const r = await dc("DELETE", `/channels/${p.channel_id}`);
      return fmt("Delete channel", r, `Deleted channel ${p.channel_id}`);
    }

    case "rename_channel": {
      const r = await dc("PATCH", `/channels/${p.channel_id}`, { name: p.name });
      if (!r.ok) return fmt("rename_channel", r);
      return { ok: true, result: `Channel renamed to ${p.name}` };
    }

    case "lock_channel": {
      // deny SEND_MESSAGES (2048) + SEND_MESSAGES_IN_THREADS (4096) for @everyone
      const r = await dc("PUT", `/channels/${p.channel_id}/permission-overwrites/${p.guild_id}`, {
        id: p.guild_id, type: 0, allow: "0", deny: "6144",
      });
      return fmt("Lock channel", r, `Channel ${p.channel_id} locked`);
    }

    case "unlock_channel": {
      const r = await dc("DELETE", `/channels/${p.channel_id}/permission-overwrites/${p.guild_id}`);
      return fmt("Unlock channel", r, `Channel ${p.channel_id} unlocked`);
    }

    case "hide_channel": {
      const r = await dc("PUT", `/channels/${p.channel_id}/permission-overwrites/${p.guild_id}`, {
        id: p.guild_id, type: 0, allow: "0", deny: "1024",
      });
      return fmt("Hide channel", r, `Channel ${p.channel_id} hidden`);
    }

    case "show_channel": {
      const r = await dc("PUT", `/channels/${p.channel_id}/permission-overwrites/${p.guild_id}`, {
        id: p.guild_id, type: 0, allow: "1024", deny: "0",
      });
      return fmt("Show channel", r, `Channel ${p.channel_id} made visible`);
    }

    case "slow_channel": {
      const secs = Math.max(0, Math.min(21600, Number(p.seconds) || 0));
      const r = await dc("PATCH", `/channels/${p.channel_id}`, { rate_limit_per_user: secs });
      return fmt("Slowmode", r, `Slowmode set to ${secs}s on ${p.channel_id}`);
    }

    case "topic_channel": {
      const r = await dc("PATCH", `/channels/${p.channel_id}`, { topic: p.topic });
      return fmt("Set topic", r, `Topic updated`);
    }

    case "purge_channel": {
      const count = Math.min(Number(p.count) || 10, 100);
      const msgs = await dc("GET", `/channels/${p.channel_id}/messages?limit=${count}`);
      if (!msgs.ok) return fmt("purge_channel", msgs);
      const ids = (msgs.data as P[]).map((m) => m.id);
      if (!ids.length) return { ok: true, result: "No messages to purge." };
      if (ids.length === 1) {
        await dc("DELETE", `/channels/${p.channel_id}/messages/${ids[0]}`);
        return { ok: true, result: "Deleted 1 message." };
      }
      const r = await dc("POST", `/channels/${p.channel_id}/messages/bulk-delete`, { messages: ids });
      return fmt("Purge", r, `Deleted ${ids.length} messages.`);
    }

    case "pin_message": {
      const r = await dc("PUT", `/channels/${p.channel_id}/pins/${p.message_id}`);
      return fmt("Pin message", r, `Message ${p.message_id} pinned`);
    }

    case "get_webhooks": {
      const r = await dc("GET", `/guilds/${p.guild_id}/webhooks`);
      if (!r.ok) return fmt("get_webhooks", r);
      const wh = r.data as P[];
      if (!wh.length) return { ok: true, result: "No webhooks found." };
      return { ok: true, result: wh.map((w) => `${w.name} — #${w.channel_id} (${w.id})`).join("\n") };
    }

    /* ── Roles ────────────────────────────────────────── */
    case "get_roles": {
      const r = await dc("GET", `/guilds/${p.guild_id}/roles`);
      if (!r.ok) return fmt("get_roles", r);
      const roles = (r.data as P[]).sort((a, b) => b.position - a.position);
      return { ok: true, result: roles.map((r) => `${r.name} (${r.id}) — pos ${r.position}`).join("\n") };
    }

    case "create_role": {
      const body: P = { name: p.name };
      if (p.color) body.color = parseInt(p.color.replace("#", ""), 16);
      if (p.hoist) body.hoist = true;
      const r = await dc("POST", `/guilds/${p.guild_id}/roles`, body);
      if (!r.ok) return fmt("create_role", r);
      const role = r.data as P;
      return { ok: true, result: `Created role ${role.name} (${role.id})` };
    }

    case "delete_role": {
      const r = await dc("DELETE", `/guilds/${p.guild_id}/roles/${p.role_id}`);
      return fmt("Delete role", r, `Deleted role ${p.role_id}`);
    }

    case "rename_role": {
      const r = await dc("PATCH", `/guilds/${p.guild_id}/roles/${p.role_id}`, { name: p.name });
      return fmt("Rename role", r, `Role renamed to ${p.name}`);
    }

    case "color_role": {
      const color = parseInt((p.color ?? "000000").replace("#", ""), 16);
      const r = await dc("PATCH", `/guilds/${p.guild_id}/roles/${p.role_id}`, { color });
      return fmt("Color role", r, `Role color set to #${p.color}`);
    }

    case "add_role_user": {
      const r = await dc("PUT", `/guilds/${p.guild_id}/members/${p.user_id}/roles/${p.role_id}`);
      return fmt("Add role", r, `Role ${p.role_id} added to ${p.user_id}`);
    }

    case "remove_role_user": {
      const r = await dc("DELETE", `/guilds/${p.guild_id}/members/${p.user_id}/roles/${p.role_id}`);
      return fmt("Remove role", r, `Role ${p.role_id} removed from ${p.user_id}`);
    }

    /* ── Members ──────────────────────────────────────── */
    case "get_members": {
      const limit = Math.min(Number(p.limit) || 50, 100);
      const r = await dc("GET", `/guilds/${p.guild_id}/members?limit=${limit}`);
      if (!r.ok) return fmt("get_members", r);
      const members = r.data as P[];
      return { ok: true, result: members.map((m) => `${m.user?.username ?? "?"}#${m.user?.discriminator ?? "0"} (${m.user?.id}) — joined ${m.joined_at?.slice(0,10)}`).join("\n") };
    }

    case "ban_user": {
      const body: P = {};
      if (p.reason) body.reason = p.reason;
      const r = await dc("PUT", `/guilds/${p.guild_id}/bans/${p.user_id}`, body);
      return fmt("Ban", r, `User ${p.user_id} banned${p.reason ? `: ${p.reason}` : ""}`);
    }

    case "kick_user": {
      const opts: RequestInit = { method: "DELETE", headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, "Content-Type": "application/json" }, cache: "no-store" };
      if (p.reason) opts.headers = { ...opts.headers as Record<string,string>, "X-Audit-Log-Reason": p.reason };
      const res = await fetch(`${API}/guilds/${p.guild_id}/members/${p.user_id}`, opts);
      return res.ok ? { ok: true, result: `User ${p.user_id} kicked` } : { ok: false, result: `Kick failed: ${res.status}` };
    }

    case "unban_user": {
      const r = await dc("DELETE", `/guilds/${p.guild_id}/bans/${p.user_id}`);
      return fmt("Unban", r, `User ${p.user_id} unbanned`);
    }

    case "timeout_user": {
      const until = new Date(Date.now() + (Number(p.minutes) || 10) * 60000).toISOString();
      const r = await dc("PATCH", `/guilds/${p.guild_id}/members/${p.user_id}`, {
        communication_disabled_until: until,
      });
      return fmt("Timeout", r, `User ${p.user_id} timed out for ${p.minutes}m`);
    }

    case "untimeout_user": {
      const r = await dc("PATCH", `/guilds/${p.guild_id}/members/${p.user_id}`, {
        communication_disabled_until: null,
      });
      return fmt("Remove timeout", r, `Timeout removed from ${p.user_id}`);
    }

    case "nick_user": {
      const r = await dc("PATCH", `/guilds/${p.guild_id}/members/${p.user_id}`, { nick: p.nick });
      return fmt("Nickname", r, `Nickname set to ${p.nick}`);
    }

    case "list_bans": {
      const r = await dc("GET", `/guilds/${p.guild_id}/bans?limit=100`);
      if (!r.ok) return fmt("list_bans", r);
      const bans = r.data as P[];
      if (!bans.length) return { ok: true, result: "No bans found." };
      return { ok: true, result: `${bans.length} bans:\n` + bans.slice(0, 30).map((b) => `${b.user?.username} (${b.user?.id})${b.reason ? ` — ${b.reason}` : ""}`).join("\n") + (bans.length > 30 ? `\n…+${bans.length - 30} more` : "") };
    }

    case "get_user_info": {
      const r = await dc("GET", `/users/${p.user_id}`);
      if (!r.ok) return fmt("get_user_info", r);
      const u = r.data as P;
      return { ok: true, result: `${u.username}#${u.discriminator} (${u.id}) — bot: ${u.bot ?? false} — flags: ${u.public_flags ?? 0}` };
    }

    /* ── Messaging ────────────────────────────────────── */
    case "send_message": {
      const r = await dc("POST", `/channels/${p.channel_id}/messages`, { content: p.message });
      if (!r.ok) return fmt("send_message", r);
      const m = r.data as P;
      return { ok: true, result: `Message sent (ID: ${m.id})` };
    }

    case "send_embed": {
      const embed: P = {
        title: p.title,
        description: p.description ?? undefined,
        color: p.color ? parseInt((p.color as string).replace("#", ""), 16) : 0x7c3aed,
      };
      if (p.footer) embed.footer = { text: p.footer };
      if (p.image) embed.image = { url: p.image };
      const r = await dc("POST", `/channels/${p.channel_id}/messages`, { embeds: [embed] });
      if (!r.ok) return fmt("send_embed", r);
      return { ok: true, result: `Embed sent: "${p.title}"` };
    }

    case "send_dm": {
      const dm = await dc("POST", `/users/${p.user_id}/channels`, { recipient_id: p.user_id });
      if (!dm.ok) return fmt("open_dm", dm);
      const ch = dm.data as P;
      const r = await dc("POST", `/channels/${ch.id}/messages`, { content: p.message });
      return fmt("Send DM", r, `DM sent to ${p.user_id}`);
    }

    /* ── Server settings ──────────────────────────────── */
    case "rename_server": {
      const r = await dc("PATCH", `/guilds/${p.guild_id}`, { name: p.name });
      return fmt("Rename server", r, `Server renamed to ${p.name}`);
    }

    case "set_verification": {
      const r = await dc("PATCH", `/guilds/${p.guild_id}`, { verification_level: Number(p.level) });
      return fmt("Set verification", r, `Verification level set to ${p.level}`);
    }

    case "set_content_filter": {
      const r = await dc("PATCH", `/guilds/${p.guild_id}`, { explicit_content_filter: Number(p.level) });
      return fmt("Content filter", r, `Content filter set to ${p.level}`);
    }

    case "set_notif": {
      const r = await dc("PATCH", `/guilds/${p.guild_id}`, { default_message_notifications: Number(p.level) });
      return fmt("Notifications", r, `Notification level set to ${p.level}`);
    }

    case "set_icon": {
      // URL → base64 data URI
      const imgRes = await fetch(p.url);
      if (!imgRes.ok) return { ok: false, result: `Could not fetch image from URL` };
      const buf = await imgRes.arrayBuffer();
      const mime = imgRes.headers.get("content-type") ?? "image/png";
      const b64 = Buffer.from(buf).toString("base64");
      const r = await dc("PATCH", `/guilds/${p.guild_id}`, { icon: `data:${mime};base64,${b64}` });
      return fmt("Set icon", r, `Server icon updated`);
    }

    case "set_banner": {
      const imgRes = await fetch(p.url);
      if (!imgRes.ok) return { ok: false, result: `Could not fetch banner image` };
      const buf = await imgRes.arrayBuffer();
      const mime = imgRes.headers.get("content-type") ?? "image/png";
      const b64 = Buffer.from(buf).toString("base64");
      const r = await dc("PATCH", `/guilds/${p.guild_id}`, { banner: `data:${mime};base64,${b64}` });
      return fmt("Set banner", r, `Server banner updated`);
    }

    case "del_webhooks": {
      const r = await dc("GET", `/guilds/${p.guild_id}/webhooks`);
      if (!r.ok) return fmt("del_webhooks", r);
      const wh = r.data as P[];
      await Promise.all(wh.map((w) => dc("DELETE", `/webhooks/${w.id}`)));
      return { ok: true, result: `Deleted ${wh.length} webhooks.` };
    }

    case "del_emojis": {
      const r = await dc("GET", `/guilds/${p.guild_id}/emojis`);
      if (!r.ok) return fmt("del_emojis", r);
      const emojis = r.data as P[];
      await Promise.all(emojis.map((e) => dc("DELETE", `/guilds/${p.guild_id}/emojis/${e.id}`)));
      return { ok: true, result: `Deleted ${emojis.length} emojis.` };
    }

    default:
      return { ok: false, result: `Unknown direct action: ${action}` };
  }
}

export async function POST(req: NextRequest) {
  if (!(await isOwner()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: P;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const action = typeof body.action === "string" ? body.action : "";
  const params = typeof body.params === "object" && body.params ? body.params as P : {};
  if (!action) return NextResponse.json({ error: "Missing action" }, { status: 400 });

  const { ok, result } = await exec(action, params);
  return NextResponse.json({ ok, result });
}
