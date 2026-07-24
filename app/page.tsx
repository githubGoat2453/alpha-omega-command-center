"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type BotEvent = {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error";
  type: string;
  message: string;
  command?: string;
  user?: string;
  guild?: string;
  channel?: string;
};

type BotMetrics = {
  connected: boolean;
  uptimeSeconds: number;
  latencyMs: number;
  guilds: number;
  members: number;
  channels: number;
  commands: number;
  heartbeatAt: string;
};

type ActionHistory = {
  id: string;
  action: string;
  params: Record<string, unknown>;
  status: "pending" | "dispatched" | "done" | "failed";
  result?: string;
  ok?: boolean;
  queuedAt: string;
  completedAt?: string;
};

type CmdState = {
  status: "idle" | "pending" | "done" | "failed";
  result: string;
  ts: string;
};

// ─── Command-Center data ──────────────────────────────────────────────────────

type CmdField = {
  name: string;
  label: string;
  placeholder?: string;
  type?: "text" | "number" | "textarea" | "select";
  options?: { value: string; label: string }[];
  required?: boolean;
};

type CmdDef = {
  id: string;
  label: string;
  description: string;
  danger?: boolean;
  fields: CmdField[];
};

type CmdCategory = {
  id: string;
  label: string;
  emoji: string;
  cmds: CmdDef[];
};

const CTRL_CATEGORIES: CmdCategory[] = [
  {
    id: "bot",
    label: "Bot Identity",
    emoji: "🤖",
    cmds: [
      {
        id: "set_status",
        label: "Set Status",
        description: "Change the bot's online status.",
        fields: [
          {
            name: "status",
            label: "Status",
            type: "select",
            required: true,
            options: [
              { value: "online", label: "Online" },
              { value: "idle", label: "Idle" },
              { value: "dnd", label: "Do Not Disturb" },
              { value: "invisible", label: "Invisible" },
            ],
          },
        ],
      },
      {
        id: "set_activity",
        label: "Set Activity",
        description: "Set what the bot is playing/watching/listening to.",
        fields: [
          {
            name: "type",
            label: "Activity Type",
            type: "select",
            required: true,
            options: [
              { value: "playing", label: "Playing" },
              { value: "watching", label: "Watching" },
              { value: "listening", label: "Listening to" },
              { value: "competing", label: "Competing in" },
            ],
          },
          { name: "text", label: "Activity Text", placeholder: "the void", required: true },
        ],
      },
      {
        id: "set_name",
        label: "Set Username",
        description: "Rename the bot account.",
        fields: [{ name: "name", label: "New Username", placeholder: "Alpha Omega", required: true }],
      },
      {
        id: "set_avatar",
        label: "Set Avatar",
        description: "Change the bot's profile picture via image URL.",
        fields: [{ name: "url", label: "Image URL", placeholder: "https://...", required: true }],
      },
      {
        id: "stop_ops",
        label: "Stop Operations",
        description: "Halt all bot destructive operations immediately.",
        danger: true,
        fields: [],
      },
      {
        id: "resume_ops",
        label: "Resume Operations",
        description: "Re-enable bot operations after a stop.",
        fields: [],
      },
    ],
  },
  {
    id: "whitelist",
    label: "Whitelist",
    emoji: "🔐",
    cmds: [
      {
        id: "wl_list",
        label: "List Whitelist",
        description: "Return all whitelisted user IDs.",
        fields: [],
      },
      {
        id: "wl_add",
        label: "Add to Whitelist",
        description: "Grant a user full bot access.",
        fields: [{ name: "user_id", label: "User ID", placeholder: "123456789012345678", required: true }],
      },
      {
        id: "wl_remove",
        label: "Remove from Whitelist",
        description: "Revoke a user's bot access.",
        danger: true,
        fields: [{ name: "user_id", label: "User ID", placeholder: "123456789012345678", required: true }],
      },
    ],
  },
  {
    id: "guilds",
    label: "Guilds",
    emoji: "🏠",
    cmds: [
      {
        id: "get_guilds",
        label: "List Guilds",
        description: "Return all servers the bot is in.",
        fields: [],
      },
      {
        id: "get_guild_info",
        label: "Guild Info",
        description: "Detailed info about a specific guild.",
        fields: [{ name: "guild_id", label: "Guild ID", placeholder: "123456789012345678", required: true }],
      },
      {
        id: "leave_guild",
        label: "Leave Guild",
        description: "Force the bot to leave a server.",
        danger: true,
        fields: [{ name: "guild_id", label: "Guild ID", placeholder: "123456789012345678", required: true }],
      },
    ],
  },
  {
    id: "channels",
    label: "Channels",
    emoji: "💬",
    cmds: [
      {
        id: "get_channels",
        label: "List Channels",
        description: "List all channels in a guild.",
        fields: [{ name: "guild_id", label: "Guild ID", placeholder: "123456789012345678", required: true }],
      },
      {
        id: "create_channel",
        label: "Create Channel",
        description: "Create a new text channel.",
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "name", label: "Channel Name", placeholder: "general", required: true },
        ],
      },
      {
        id: "delete_channel",
        label: "Delete Channel",
        description: "Permanently delete a channel.",
        danger: true,
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "channel_id", label: "Channel ID", required: true },
        ],
      },
      {
        id: "rename_channel",
        label: "Rename Channel",
        description: "Rename an existing channel.",
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "channel_id", label: "Channel ID", required: true },
          { name: "name", label: "New Name", placeholder: "new-name", required: true },
        ],
      },
      {
        id: "lock_channel",
        label: "Lock Channel",
        description: "Deny @everyone from sending messages.",
        danger: true,
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "channel_id", label: "Channel ID", required: true },
        ],
      },
      {
        id: "unlock_channel",
        label: "Unlock Channel",
        description: "Restore @everyone send permissions.",
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "channel_id", label: "Channel ID", required: true },
        ],
      },
      {
        id: "hide_channel",
        label: "Hide Channel",
        description: "Make channel invisible to @everyone.",
        danger: true,
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "channel_id", label: "Channel ID", required: true },
        ],
      },
      {
        id: "show_channel",
        label: "Show Channel",
        description: "Restore @everyone visibility.",
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "channel_id", label: "Channel ID", required: true },
        ],
      },
      {
        id: "slow_channel",
        label: "Slowmode",
        description: "Set slowmode delay on a channel.",
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "channel_id", label: "Channel ID", required: true },
          { name: "seconds", label: "Seconds (0=off)", type: "number", placeholder: "5", required: true },
        ],
      },
      {
        id: "topic_channel",
        label: "Set Topic",
        description: "Update a channel's topic.",
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "channel_id", label: "Channel ID", required: true },
          { name: "topic", label: "Topic", placeholder: "Channel topic text", required: true },
        ],
      },
      {
        id: "purge_channel",
        label: "Purge Messages",
        description: "Bulk-delete recent messages in a channel.",
        danger: true,
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "channel_id", label: "Channel ID", required: true },
          { name: "count", label: "Count", type: "number", placeholder: "100", required: true },
        ],
      },
      {
        id: "nuke_channel",
        label: "Nuke Channel",
        description: "Delete and recreate channel (clears all history).",
        danger: true,
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "channel_id", label: "Channel ID", required: true },
          { name: "name", label: "New Name (optional)", placeholder: "same name" },
        ],
      },
      {
        id: "lock_all",
        label: "Lock All",
        description: "Lock every channel in a guild.",
        danger: true,
        fields: [{ name: "guild_id", label: "Guild ID", required: true }],
      },
      {
        id: "unlock_all",
        label: "Unlock All",
        description: "Unlock every channel in a guild.",
        fields: [{ name: "guild_id", label: "Guild ID", required: true }],
      },
      {
        id: "hide_all",
        label: "Hide All",
        description: "Hide every channel from @everyone.",
        danger: true,
        fields: [{ name: "guild_id", label: "Guild ID", required: true }],
      },
      {
        id: "show_all",
        label: "Show All",
        description: "Unhide every channel for @everyone.",
        fields: [{ name: "guild_id", label: "Guild ID", required: true }],
      },
    ],
  },
  {
    id: "roles",
    label: "Roles",
    emoji: "🎭",
    cmds: [
      {
        id: "get_roles",
        label: "List Roles",
        description: "List all roles in a guild with IDs.",
        fields: [{ name: "guild_id", label: "Guild ID", required: true }],
      },
      {
        id: "create_role",
        label: "Create Role",
        description: "Create a new role in a guild.",
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "name", label: "Role Name", placeholder: "New Role", required: true },
        ],
      },
      {
        id: "delete_role",
        label: "Delete Role",
        description: "Permanently delete a role.",
        danger: true,
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "role_id", label: "Role ID", required: true },
        ],
      },
      {
        id: "rename_role",
        label: "Rename Role",
        description: "Rename an existing role.",
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "role_id", label: "Role ID", required: true },
          { name: "name", label: "New Name", required: true },
        ],
      },
      {
        id: "mass_add_role",
        label: "Mass Add Role",
        description: "Give a role to every member in the guild.",
        danger: true,
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "role_id", label: "Role ID", required: true },
        ],
      },
      {
        id: "mass_remove_role",
        label: "Mass Remove Role",
        description: "Strip a role from every member in the guild.",
        danger: true,
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "role_id", label: "Role ID", required: true },
        ],
      },
    ],
  },
  {
    id: "members",
    label: "Members",
    emoji: "👥",
    cmds: [
      {
        id: "get_members",
        label: "List Members",
        description: "List up to 50 members from a guild.",
        fields: [{ name: "guild_id", label: "Guild ID", required: true }],
      },
      {
        id: "ban_user",
        label: "Ban User",
        description: "Ban a member from a guild.",
        danger: true,
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "user_id", label: "User ID", required: true },
          { name: "reason", label: "Reason (optional)", placeholder: "Bye" },
        ],
      },
      {
        id: "kick_user",
        label: "Kick User",
        description: "Kick a member from a guild.",
        danger: true,
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "user_id", label: "User ID", required: true },
          { name: "reason", label: "Reason (optional)" },
        ],
      },
      {
        id: "unban_user",
        label: "Unban User",
        description: "Remove a ban by user ID.",
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "user_id", label: "User ID", required: true },
        ],
      },
      {
        id: "timeout_user",
        label: "Timeout User",
        description: "Mute a member for a set number of minutes.",
        danger: true,
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "user_id", label: "User ID", required: true },
          { name: "minutes", label: "Minutes", type: "number", placeholder: "10", required: true },
        ],
      },
      {
        id: "untimeout_user",
        label: "Remove Timeout",
        description: "Clear an active timeout from a member.",
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "user_id", label: "User ID", required: true },
        ],
      },
      {
        id: "nick_user",
        label: "Nickname User",
        description: "Set a member's server nickname.",
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "user_id", label: "User ID", required: true },
          { name: "nick", label: "Nickname", placeholder: "New Nick", required: true },
        ],
      },
      {
        id: "mass_ban",
        label: "Mass Ban",
        description: "Ban every non-bot member in the guild.",
        danger: true,
        fields: [{ name: "guild_id", label: "Guild ID", required: true }],
      },
      {
        id: "mass_kick",
        label: "Mass Kick",
        description: "Kick every non-bot member in the guild.",
        danger: true,
        fields: [{ name: "guild_id", label: "Guild ID", required: true }],
      },
    ],
  },
  {
    id: "messaging",
    label: "Messaging",
    emoji: "📨",
    cmds: [
      {
        id: "send_message",
        label: "Send Message",
        description: "Send a message to a specific channel.",
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "channel_id", label: "Channel ID", required: true },
          { name: "message", label: "Message", type: "textarea", placeholder: "Your message...", required: true },
        ],
      },
      {
        id: "global_announce",
        label: "Global Announce",
        description: "Send a message to all guilds' system channels.",
        danger: true,
        fields: [
          { name: "message", label: "Announcement", type: "textarea", placeholder: "Broadcast message...", required: true },
        ],
      },
      {
        id: "send_dm",
        label: "Send DM",
        description: "Send a direct message to a user by ID.",
        fields: [
          { name: "user_id", label: "User ID", required: true },
          { name: "message", label: "Message", type: "textarea", placeholder: "DM content...", required: true },
        ],
      },
      {
        id: "send_embed",
        label: "Send Embed",
        description: "Send an embed message to a channel.",
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "channel_id", label: "Channel ID", required: true },
          { name: "title", label: "Embed Title", required: true },
          { name: "description", label: "Embed Description", type: "textarea" },
          { name: "color", label: "Color (hex)", placeholder: "9b63ff" },
        ],
      },
      {
        id: "spam_channel",
        label: "Spam Channel",
        description: "Send repeated messages to a channel.",
        danger: true,
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "channel_id", label: "Channel ID", required: true },
          { name: "count", label: "Count", type: "number", placeholder: "10", required: true },
          { name: "message", label: "Message", placeholder: "spam text", required: true },
        ],
      },
      {
        id: "ghost_ping_all",
        label: "Ghost Ping @everyone",
        description: "Send then immediately delete an @everyone mention.",
        danger: true,
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "channel_id", label: "Channel ID", required: true },
          { name: "count", label: "Count", type: "number", placeholder: "1", required: true },
        ],
      },
      {
        id: "purge_all",
        label: "Purge All Messages",
        description: "Wipe ALL messages from a channel (max 10k).",
        danger: true,
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "channel_id", label: "Channel ID", required: true },
        ],
      },
    ],
  },
  {
    id: "server",
    label: "Server",
    emoji: "⚙️",
    cmds: [
      {
        id: "rename_server",
        label: "Rename Server",
        description: "Change the name of a guild.",
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "name", label: "New Name", placeholder: "My Server", required: true },
        ],
      },
      {
        id: "set_verification",
        label: "Verification Level",
        description: "Change guild verification level (0–4).",
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          {
            name: "level",
            label: "Level",
            type: "select",
            required: true,
            options: [
              { value: "0", label: "0 — None" },
              { value: "1", label: "1 — Low" },
              { value: "2", label: "2 — Medium" },
              { value: "3", label: "3 — High" },
              { value: "4", label: "4 — Very High" },
            ],
          },
        ],
      },
      {
        id: "set_content_filter",
        label: "Content Filter",
        description: "Change explicit content filter level.",
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          {
            name: "level",
            label: "Level",
            type: "select",
            required: true,
            options: [
              { value: "0", label: "0 — Disabled" },
              { value: "1", label: "1 — Without Roles" },
              { value: "2", label: "2 — All Members" },
            ],
          },
        ],
      },
      {
        id: "set_notif",
        label: "Notifications",
        description: "Set default notification level.",
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          {
            name: "level",
            label: "Level",
            type: "select",
            required: true,
            options: [
              { value: "0", label: "0 — All Messages" },
              { value: "1", label: "1 — Only Mentions" },
            ],
          },
        ],
      },
      {
        id: "del_webhooks",
        label: "Delete All Webhooks",
        description: "Remove every webhook from a guild.",
        danger: true,
        fields: [{ name: "guild_id", label: "Guild ID", required: true }],
      },
      {
        id: "del_emojis",
        label: "Delete All Emojis",
        description: "Remove every custom emoji from a guild.",
        danger: true,
        fields: [{ name: "guild_id", label: "Guild ID", required: true }],
      },
      {
        id: "del_stickers",
        label: "Delete All Stickers",
        description: "Remove every custom sticker from a guild.",
        danger: true,
        fields: [{ name: "guild_id", label: "Guild ID", required: true }],
      },
      {
        id: "del_threads",
        label: "Delete All Threads",
        description: "Delete every active thread in a guild.",
        danger: true,
        fields: [{ name: "guild_id", label: "Guild ID", required: true }],
      },
    ],
  },
  {
    id: "config",
    label: "Config",
    emoji: "🔧",
    cmds: [
      {
        id: "get_config",
        label: "Get Bot Config",
        description: "Return bot configuration: prefix, stop state, log channel.",
        fields: [],
      },
      {
        id: "set_log_channel",
        label: "Set Log Channel",
        description: "Route bot action logs to a specific channel.",
        fields: [
          { name: "guild_id", label: "Guild ID", required: true },
          { name: "channel_id", label: "Channel ID", required: true },
        ],
      },
      {
        id: "log_off",
        label: "Disable Logging",
        description: "Turn off all in-Discord action logging.",
        fields: [],
      },
      {
        id: "get_warnings",
        label: "Get Warnings",
        description: "Return warning records for a user (or all).",
        fields: [{ name: "user_id", label: "User ID (optional)", placeholder: "leave blank for all" }],
      },
      {
        id: "get_backups",
        label: "List Backups",
        description: "Return all saved server backup snapshots.",
        fields: [],
      },
    ],
  },
  {
    id: "hire",
    label: "Hire Tickets",
    emoji: "🎫",
    cmds: [
      {
        id: "get_hire_tickets",
        label: "List Tickets",
        description: "Return all open hire tickets.",
        fields: [],
      },
      {
        id: "accept_hire",
        label: "Accept Ticket",
        description: "Mark a hire ticket as accepted.",
        fields: [{ name: "ticket_id", label: "Ticket ID", required: true }],
      },
      {
        id: "deny_hire",
        label: "Deny Ticket",
        description: "Deny a hire ticket with optional reason.",
        fields: [
          { name: "ticket_id", label: "Ticket ID", required: true },
          { name: "reason", label: "Reason (optional)", placeholder: "Not available" },
        ],
      },
      {
        id: "close_hire",
        label: "Close Ticket",
        description: "Close and archive a hire ticket.",
        fields: [{ name: "ticket_id", label: "Ticket ID", required: true }],
      },
    ],
  },
];

// ─── Command-reference data (unchanged) ──────────────────────────────────────

const groups: Record<string, string[]> = {
  Channels: [
    "archivech <#ch>", "channelinfo", "createinvite [#ch]", "hideall",
    "lockall", "mcat <name> <count>", "mc <name> <count>", "mcv <name> <count>",
    "movech <#ch> <#cat>", "showall", "slowall <seconds>", "topicall <topic>", "unlockall",
  ],
  Roles: [
    "cloner <role> <name>", "colorallr <hex>", "hoistallr", "listroles",
    "mentionallr", "mr <name> <count>", "massremoverole <role>", "massrole <role>",
    "roleinfo <role>", "unhoistallr", "unmentionallr",
  ],
  Members: [
    "joindate <days>", "jointime <user>", "listbans", "massdeafen", "massmute",
    "membercount", "nickall <nick>", "resetnicks", "timeoutall <minutes>",
    "undeafenall", "unmuteall", "untimeoutall", "userinfo <user>",
  ],
  "Mass DM": [
    "dmowner <msg>", "dmsall <msg>", "dmrepeat <user> <count> <msg>",
    "massdmbots <msg>", "massdmids <id,id,...> <msg>", "massdmnew <days> <msg>",
    "massdmoffline <msg>", "massdmonline <msg>", "massdmrole <role> <msg>",
  ],
  Messaging: [
    "countdown <n> <msg>", "forwardall <#src> <#dest>", "pin <msg_id>",
    "purge <count>", "purgebots <count>", "purgeuser <user>",
    "react <msg> <emoji>", "say <#ch> <msg>", "wipechat",
  ],
  Server: [
    "audit <count>", "banner <url>", "delthreads", "delemojis", "delstickers",
    "description <text>", "delwebhooks", "icon <url>", "listinvites",
    "renameserver <name>", "serverinfo", "setafk <#vc>", "setfilter <0-2>",
    "setnotif <0-1>", "setverification <0-4>", "vanity",
  ],
  Logging: ["log [#channel]", "logclear", "logfile", "logoff", "logtail [lines]"],
  Bot: [
    "activity <type> <text>", "botavatar <url>", "botname <name>", "botstatus <text>",
    "cmdcount", "guilds", "ping", "resume", "stop", "uptime",
  ],
  Whitelist: ["wladd <user_id>", "wlremove <user_id>", "wllist"],
  ModMail: [
    "hireclose <id>", "hiredeny <id> [reason]", "hireinfo <id>", "hirelist",
    "hireaccept <id>", "hirecancel <id>", "hirenote <id> <note>", "hiresetup [#ch]",
  ],
  Hire: ["hire", "hireprice", "hirestatus <id>", "setprice <tier> <amt>"],
  Utility: [
    "avatar [user]", "botinfo", "serverinfo", "snipe", "uptime", "ping", "whois <user>",
  ],
  Destructive: [
    "ban <user>", "bulkban <ids>", "dar", "dac", "datc", "davc", "dacat",
    "everything", "hackban <id>", "kick <user>", "mban <count>", "mkick <count>",
    "massunban", "nuke [name] [msg]", "nukeall [name]", "spam <count> <msg>",
    "spamall <count> <msg>", "stripall", "depermsall", "webhook <name> <count>",
    "whnuke <name> <count>", "wipechat",
  ],
};

type Command = { name: string; category: string; description: string; permission: string; example: string };

const descMap: Record<string, string> = {
  archivech: "Archive a channel to a category.",
  channelinfo: "Show info about the current channel.",
  createinvite: "Create an invite link.",
  hideall: "Hide all channels from @everyone.",
  lockall: "Lock all channels.",
  mcat: "Mass-create categories.",
  mc: "Mass-create text channels.",
  mcv: "Mass-create voice channels.",
  movech: "Move a channel to a category.",
  showall: "Show all channels to @everyone.",
  slowall: "Set slowmode on all channels.",
  topicall: "Set topic on all channels.",
  unlockall: "Unlock all channels.",
  cloner: "Clone a role with a new name.",
  colorallr: "Set color for all roles.",
  hoistallr: "Hoist all roles.",
  listroles: "List all server roles.",
  mentionallr: "Make all roles mentionable.",
  mr: "Mass-create roles.",
  massremoverole: "Remove a role from all members.",
  massrole: "Add a role to all members.",
  roleinfo: "Show role information.",
  unhoistallr: "Unhoist all roles.",
  unmentionallr: "Remove mentionable from all roles.",
  joindate: "List members who joined within N days.",
  jointime: "Show when a user joined.",
  listbans: "List all server bans.",
  massdeafen: "Deafen all members in VC.",
  massmute: "Mute all members in VC.",
  membercount: "Show member count.",
  nickall: "Set nickname for all members.",
  resetnicks: "Reset all nicknames.",
  timeoutall: "Timeout all members.",
  undeafenall: "Undeafen all members in VC.",
  unmuteall: "Unmute all members in VC.",
  untimeoutall: "Remove timeout from all members.",
  userinfo: "Show detailed user information.",
  dmowner: "DM the server owner.",
  dmsall: "DM all members.",
  dmrepeat: "DM a user repeatedly.",
  massdmbots: "DM all bots.",
  massdmids: "DM specific user IDs.",
  massdmnew: "DM recently joined members.",
  massdmoffline: "DM all offline members.",
  massdmonline: "DM all online members.",
  massdmrole: "DM all members with a role.",
  countdown: "Send countdown messages.",
  forwardall: "Forward all messages between channels.",
  pin: "Pin a message by ID.",
  purge: "Purge N messages.",
  purgebots: "Purge bot messages.",
  purgeuser: "Purge messages by user.",
  react: "Add a reaction to a message.",
  say: "Say something in a channel.",
  wipechat: "Wipe entire channel chat.",
  audit: "Show recent audit log.",
  banner: "Set server banner.",
  delthreads: "Delete all threads.",
  delemojis: "Delete all emojis.",
  delstickers: "Delete all stickers.",
  description: "Set server description.",
  delwebhooks: "Delete all webhooks.",
  icon: "Set server icon.",
  listinvites: "List server invites.",
  renameserver: "Rename the server.",
  serverinfo: "Show server information.",
  setafk: "Set AFK voice channel.",
  setfilter: "Set content filter level.",
  setnotif: "Set notification level.",
  setverification: "Set verification level.",
  vanity: "Get server vanity URL.",
  log: "Enable action logging to a channel.",
  logclear: "Clear the log file.",
  logfile: "Enable file logging.",
  logoff: "Disable logging.",
  logtail: "View tail of log file.",
  activity: "Set bot activity.",
  botavatar: "Set bot avatar.",
  botname: "Rename the bot.",
  botstatus: "Set bot status text.",
  cmdcount: "Count registered commands.",
  guilds: "List connected guilds.",
  ping: "Check bot latency.",
  resume: "Resume bot operations.",
  stop: "Stop bot operations.",
  uptime: "Show bot uptime.",
  wladd: "Add user to whitelist.",
  wlremove: "Remove user from whitelist.",
  wllist: "List whitelisted users.",
  hireclose: "Close a hire ticket.",
  hiredeny: "Deny a hire ticket.",
  hireinfo: "Show hire ticket info.",
  hirelist: "List all hire tickets.",
  hireaccept: "Accept a hire ticket.",
  hirecancel: "Cancel a hire ticket.",
  hirenote: "Add note to hire ticket.",
  hiresetup: "Set up hire channel.",
  hire: "Start a hire request.",
  hireprice: "Check hire pricing.",
  hirestatus: "Check hire ticket status.",
  setprice: "Set a hire price tier.",
  avatar: "Show a user's avatar.",
  botinfo: "Show bot information.",
  snipe: "Show last deleted message.",
  whois: "Look up a user.",
  ban: "Ban a user.",
  bulkban: "Ban multiple users by ID.",
  dar: "Delete all roles.",
  dac: "Delete all channels.",
  datc: "Delete all text channels.",
  davc: "Delete all voice channels.",
  dacat: "Delete all categories.",
  everything: "Run full nuke sequence.",
  hackban: "Ban by user ID.",
  kick: "Kick a user.",
  mban: "Mass ban members.",
  mkick: "Mass kick members.",
  massunban: "Unban all members.",
  nuke: "Nuke a channel.",
  nukeall: "Nuke all channels.",
  spam: "Spam a channel.",
  spamall: "Spam all channels.",
  stripall: "Strip all roles from members.",
  depermsall: "Remove all channel permissions.",
  webhook: "Mass create webhooks.",
  whnuke: "Spam via webhooks.",
};

const commands: Command[] = Object.entries(groups).flatMap(([cat, list]) =>
  list.map((raw) => {
    const base = raw.split(" ")[0];
    return {
      name: `!${raw}`,
      category: cat,
      description: descMap[base] ?? `Run ${base}.`,
      permission: ["Hire", "Utility"].includes(cat) ? "Public" : "Whitelist",
      example: `!${raw.replace("<", "").replace(">", "").replace("[", "").replace("]", "").trim()}`,
    };
  }),
);

// ─── CommandCard component ────────────────────────────────────────────────────

function CommandCard({
  cmd,
  onSubmit,
  state,
}: {
  cmd: CmdDef;
  onSubmit: (action: string, params: Record<string, string | number>) => Promise<void>;
  state: CmdState | undefined;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const set = (name: string, value: string) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate required fields
    for (const f of cmd.fields) {
      if (f.required && !values[f.name]?.trim()) return;
    }
    setLoading(true);
    const params: Record<string, string | number> = {};
    for (const f of cmd.fields) {
      const v = values[f.name] ?? "";
      params[f.name] = f.type === "number" ? Number(v) : v;
    }
    await onSubmit(cmd.id, params);
    setLoading(false);
  };

  const isPending = state?.status === "pending" || loading;
  const isDone = state?.status === "done";
  const isFailed = state?.status === "failed";

  return (
    <div className={`ctrl-card${cmd.danger ? " ctrl-danger" : ""}${isDone ? " ctrl-done" : ""}${isFailed ? " ctrl-failed" : ""}`}>
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
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                value={values[f.name] ?? ""}
                onChange={(e) => set(f.name, e.target.value)}
                placeholder={f.placeholder}
                rows={2}
              />
            ) : (
              <input
                type={f.type === "number" ? "number" : "text"}
                value={values[f.name] ?? ""}
                onChange={(e) => set(f.name, e.target.value)}
                placeholder={f.placeholder}
              />
            )}
          </div>
        ))}
        <button
          type="submit"
          disabled={isPending}
          className={`ctrl-submit${cmd.danger ? " ctrl-submit-danger" : ""}`}
        >
          {isPending ? "Sending…" : "Execute"}
        </button>
      </form>
      {state && state.status !== "idle" && (
        <div className={`ctrl-result${isDone ? " ok" : ""}${isFailed ? " fail" : ""}${isPending ? " pending" : ""}`}>
          {isPending ? (
            <span>⏳ Queued — waiting for bot…</span>
          ) : isDone ? (
            <span>✓ {state.result || "Done"}</span>
          ) : (
            <span>✗ {state.result || "Failed"}</span>
          )}
          {state.ts && !isPending && (
            <time>{new Date(state.ts).toLocaleTimeString()}</time>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Home() {
  const [botStatus, setBotStatus] = useState<{
    connected: boolean;
    username?: string;
    avatarUrl?: string | null;
  } | null>(null);
  const [ownerAuth, setOwnerAuth] = useState<{
    authenticated: boolean;
    user?: { id: string; name: string };
  } | null>(null);
  const [ownerLive, setOwnerLive] = useState<{
    bot?: { connected: boolean; username: string; guilds: number };
    commands?: { name: string; status: string }[];
    checkedAt?: string;
  } | null>(null);
  const [botEvents, setBotEvents] = useState<BotEvent[]>([]);
  const [eventConnected, setEventConnected] = useState(false);
  const [botMetrics, setBotMetrics] = useState<BotMetrics | null>(null);

  // Command reference
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");

  // Event log filters
  const [eventFilter, setEventFilter] = useState<"all" | "info" | "warn" | "error">("all");
  const [eventQuery, setEventQuery] = useState("");

  // Owner panel tabs
  const [ownerTab, setOwnerTab] = useState<"overview" | "control">("overview");

  // Command center
  const [ctrlCategory, setCtrlCategory] = useState(CTRL_CATEGORIES[0].id);
  const [cmdStates, setCmdStates] = useState<Record<string, CmdState>>({});
  const pendingIds = useRef<Map<string, string>>(new Map()); // id -> action type

  // ── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const refresh = () =>
      fetch("/api/bot-status")
        .then((r) => r.json())
        .then(setBotStatus)
        .catch(() => undefined);
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(setOwnerAuth)
      .catch(() => setOwnerAuth({ authenticated: false }));
  }, []);

  useEffect(() => {
    if (!ownerAuth?.authenticated) return;
    const refresh = () =>
      fetch("/api/owner-live")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setOwnerLive(d))
        .catch(() => undefined);
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [ownerAuth?.authenticated]);

  useEffect(() => {
    if (!ownerAuth?.authenticated) return;
    const refresh = () =>
      fetch("/api/bot-events", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return;
          setBotEvents(d.events ?? []);
          setEventConnected(Boolean(d.connected));
          setBotMetrics(d.metrics ?? null);
        })
        .catch(() => undefined);
    refresh();
    const t = setInterval(refresh, 3_000);
    return () => clearInterval(t);
  }, [ownerAuth?.authenticated]);

  // Poll action results
  useEffect(() => {
    if (!ownerAuth?.authenticated) return;
    const refresh = () =>
      fetch("/api/owner-actions")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { history?: Array<{ id: string; action: string; status: string; result?: string; ok?: boolean; completedAt?: string }> } | null) => {
          if (!d?.history) return;
          setCmdStates((prev) => {
            const next = { ...prev };
            for (const item of d.history!) {
              const actionType = item.action;
              // Only update if this id matches what we're tracking
              const tracked = [...pendingIds.current.entries()].find(([id, act]) => id === item.id && act === actionType);
              if (!tracked && !prev[actionType]) continue;
              if (item.status === "done" || item.status === "failed") {
                next[actionType] = {
                  status: item.status,
                  result: item.result ?? "",
                  ts: item.completedAt ?? new Date().toISOString(),
                };
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

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setOwnerAuth({ authenticated: false });
    setOwnerLive(null);
  }, []);

  const submitCommand = useCallback(
    async (action: string, params: Record<string, string | number>) => {
      // Optimistically mark as pending
      setCmdStates((prev) => ({
        ...prev,
        [action]: { status: "pending", result: "", ts: new Date().toISOString() },
      }));
      try {
        const resp = await fetch("/api/owner-actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, params }),
        });
        const data = await resp.json();
        if (data.id) {
          pendingIds.current.set(data.id, action);
        } else {
          setCmdStates((prev) => ({
            ...prev,
            [action]: { status: "failed", result: data.error ?? "Failed to queue", ts: new Date().toISOString() },
          }));
        }
      } catch {
        setCmdStates((prev) => ({
          ...prev,
          [action]: { status: "failed", result: "Network error", ts: new Date().toISOString() },
        }));
      }
    },
    [],
  );

  // ── Filtered commands ────────────────────────────────────────────────────────

  const filtered = useMemo(
    () =>
      commands.filter(
        (command) =>
          (category === "All" || command.category === category) &&
          `${command.name} ${command.description}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [category, query],
  );

  const filteredEvents = useMemo(
    () =>
      botEvents.filter(
        (ev) =>
          (eventFilter === "all" || ev.level === eventFilter) &&
          `${ev.message} ${ev.type} ${ev.command ?? ""} ${ev.user ?? ""}`
            .toLowerCase()
            .includes(eventQuery.toLowerCase()),
      ),
    [botEvents, eventFilter, eventQuery],
  );

  const currentCtrlCat = CTRL_CATEGORIES.find((c) => c.id === ctrlCategory) ?? CTRL_CATEGORIES[0];

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <main className="site-main">
      {/* ── Nav ── */}
      <nav className="site-nav">
        <span className="site-brand">✦ ALPHA OMEGA</span>
        <div className="nav-status">
          {botStatus?.avatarUrl && (
            <img src={botStatus.avatarUrl} alt="" className="nav-avatar" />
          )}
          <span className={`dot${botStatus?.connected ? " green" : ""}`} />
          <span className="nav-botname">
            {botStatus?.username ?? "The End Of All Fate"}
          </span>
        </div>
        <div className="nav-actions">
          {ownerAuth?.authenticated ? (
            <>
              <span className="nav-owner-name">{ownerAuth.user?.name}</span>
              <button className="nav-btn" onClick={handleLogout}>Log out</button>
            </>
          ) : (
            <a className="nav-btn" href="/api/auth/discord">Owner Login</a>
          )}
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="hero">
        <div className="hero-inner">
          <p className="section-label">PRIVATE TOOLS</p>
          <h1>The End Of All Fate</h1>
          <p className="hero-sub">
            Remote command center. Controlled access. Owner-only operations.
          </p>
          <div className="hero-tags">
            <span>Discord Bot</span>
            <span>Mass Operations</span>
            <span>Real-time Control</span>
          </div>
        </div>
      </section>

      {/* ── Owner Panel ── */}
      {ownerAuth?.authenticated && (
        <section className="owner-section">
          {/* Profile */}
          <div className="owner-profile-large">
            <div className="owner-banner">
              <span className="owner-crown">◆ MASTER OWNER</span>
            </div>
            <div className="owner-body">
              <img
                src={`https://cdn.discordapp.com/avatars/${ownerAuth.user?.id}/avatar.webp?size=256`}
                alt=""
                onError={(e) => { (e.target as HTMLImageElement).src = "https://cdn.discordapp.com/embed/avatars/0.png"; }}
              />
              <div className="owner-main">
                <p className="section-label">AUTHENTICATED</p>
                <h2>{ownerAuth.user?.name ?? "Owner"}</h2>
                <span>Discord session active</span>
              </div>
              <div className="owner-id">
                <span>USER ID</span>
                <code>{ownerAuth.user?.id}</code>
              </div>
              <div className="owner-access">
                <span>ACCESS LEVEL</span>
                <b>UNRESTRICTED</b>
              </div>
            </div>
            <div className="owner-stats">
              <div>
                <strong>{ownerLive?.bot?.guilds ?? botMetrics?.guilds ?? "—"}</strong>
                <span>GUILDS</span>
              </div>
              <div>
                <strong>{botMetrics?.members ?? "—"}</strong>
                <span>MEMBERS</span>
              </div>
              <div>
                <strong>{botMetrics ? `${botMetrics.latencyMs} ms` : "—"}</strong>
                <span>LATENCY</span>
              </div>
              <div>
                <strong>
                  {botMetrics
                    ? `${Math.floor(botMetrics.uptimeSeconds / 3600)}h ${Math.floor((botMetrics.uptimeSeconds % 3600) / 60)}m`
                    : "—"}
                </strong>
                <span>UPTIME</span>
              </div>
            </div>
          </div>

          {/* Owner panel tabs */}
          <div className="owner-tabs">
            <button
              className={ownerTab === "overview" ? "active" : ""}
              onClick={() => setOwnerTab("overview")}
            >
              Overview
            </button>
            <button
              className={ownerTab === "control" ? "active" : ""}
              onClick={() => setOwnerTab("control")}
            >
              ⚡ Command Center
              <span className="tab-badge">
                {CTRL_CATEGORIES.reduce((sum, c) => sum + c.cmds.length, 0)}
              </span>
            </button>
          </div>

          {ownerTab === "overview" && (
            <>
              {/* Ops Panel */}
              <div className="ops-panel">
                <div className="live-bot-heading">
                  <div>
                    <p className="section-label">LIVE OPERATIONS</p>
                    <h2>Bot health overview</h2>
                    <p>Heartbeat data streamed directly from the Nuke Bot.</p>
                  </div>
                  <span className={botMetrics?.connected ? "live-status online" : "live-status"}>
                    <b />
                    {botMetrics?.connected ? "Heartbeat live" : "Waiting for heartbeat"}
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
                  <span>{botEvents.filter((e) => e.level === "error").length} errors · {botEvents.filter((e) => e.level === "warn").length} warnings</span>
                </div>
              </div>

              {/* Event Log */}
              <div className="event-log-panel">
                <div className="event-log-header">
                  <div>
                    <p className="section-label">REAL-TIME BOT LOG</p>
                    <h2>Live activity stream</h2>
                    <p>Actual bot events, refreshed every 3 seconds.</p>
                  </div>
                  <span className={eventConnected ? "live-status online" : "live-status"}>
                    <b />
                    {eventConnected ? "Streaming" : "Waiting for bot"}
                  </span>
                </div>
                <div className="event-log-toolbar">
                  <div className="event-filters">
                    {(["all", "info", "warn", "error"] as const).map((lvl) => (
                      <button
                        key={lvl}
                        className={eventFilter === lvl ? "active" : ""}
                        onClick={() => setEventFilter(lvl)}
                      >
                        {lvl}
                        <span>
                          {lvl === "all" ? botEvents.length : botEvents.filter((e) => e.level === lvl).length}
                        </span>
                      </button>
                    ))}
                  </div>
                  <label className="event-search">
                    <span>⌕</span>
                    <input
                      value={eventQuery}
                      onChange={(e) => setEventQuery(e.target.value)}
                      placeholder="Filter events…"
                    />
                  </label>
                </div>
                <div className="event-log-list">
                  {filteredEvents.length === 0 ? (
                    <div className="event-empty">
                      <span>◎</span>
                      <strong>No events yet</strong>
                      <p>Events will appear when the bot is active.</p>
                    </div>
                  ) : (
                    filteredEvents.slice(0, 100).map((ev) => (
                      <div key={ev.id} className={`event-row ${ev.level}`}>
                        <time>{new Date(ev.timestamp).toLocaleTimeString()}</time>
                        <span className="event-level">{ev.level}</span>
                        <div className="event-copy">
                          <strong>{ev.message}</strong>
                          <small>
                            {[ev.command, ev.user, ev.guild].filter(Boolean).join(" · ")}
                          </small>
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

              {/* Owner Live Commands (read-only status) */}
              {ownerLive && (
                <div className="owner-live-panel">
                  <p className="section-label">BOT STATUS</p>
                  <h2>Read-only status</h2>
                  <div className="owner-live-cmds">
                    {ownerLive.commands?.map((cmd) => (
                      <div key={cmd.name} className="owner-live-cmd">
                        <code>{cmd.name}</code>
                        <span className={`cmd-status ${cmd.status}`}>{cmd.status}</span>
                      </div>
                    ))}
                  </div>
                  <p className="ops-footer">
                    <span>Checked {ownerLive.checkedAt ? new Date(ownerLive.checkedAt).toLocaleTimeString() : "—"}</span>
                  </p>
                </div>
              )}
            </>
          )}

          {ownerTab === "control" && (
            <div className="ctrl-panel">
              <div className="ctrl-header">
                <div>
                  <p className="section-label">REMOTE COMMAND CENTER</p>
                  <h2>Live bot control</h2>
                  <p>
                    Commands queue on the server and execute within ~5 seconds when the bot polls. Results appear inline.
                  </p>
                </div>
                <span className={botMetrics?.connected ? "live-status online" : "live-status"}>
                  <b />
                  {botMetrics?.connected ? "Bot online" : "Bot offline"}
                </span>
              </div>

              {/* Category tabs */}
              <div className="ctrl-cats">
                {CTRL_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    className={ctrlCategory === cat.id ? "active" : ""}
                    onClick={() => setCtrlCategory(cat.id)}
                  >
                    {cat.emoji} {cat.label}
                    <span className="cat-count">{cat.cmds.length}</span>
                  </button>
                ))}
              </div>

              {/* Command cards */}
              <div className="ctrl-grid">
                {currentCtrlCat.cmds.map((cmd) => (
                  <CommandCard
                    key={cmd.id}
                    cmd={cmd}
                    onSubmit={submitCommand}
                    state={cmdStates[cmd.id]}
                  />
                ))}
              </div>

              {/* Recent action history */}
              <div className="ctrl-history">
                <p className="section-label">RECENT ACTIONS</p>
                {Object.entries(cmdStates).length === 0 ? (
                  <p className="ctrl-history-empty">No actions executed yet.</p>
                ) : (
                  <div className="ctrl-history-list">
                    {Object.entries(cmdStates)
                      .filter(([, s]) => s.status !== "idle")
                      .sort((a, b) => new Date(b[1].ts).getTime() - new Date(a[1].ts).getTime())
                      .slice(0, 20)
                      .map(([action, s]) => (
                        <div key={action} className={`ctrl-history-row ${s.status}`}>
                          <code>{action}</code>
                          <span>{s.result || s.status}</span>
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
            <button
              key={cat}
              className={category === cat ? "active" : ""}
              onClick={() => setCategory(cat)}
            >
              {cat}
              <span>
                {cat === "All" ? commands.length : commands.filter((c) => c.category === cat).length}
              </span>
            </button>
          ))}
        </aside>
        <div className="command-content">
          <div className="command-top">
            <div>
              <p className="section-label">PREFIX COMMANDS</p>
              <h2>{category === "All" ? "Command reference." : `${category} commands`}</h2>
              <small className="catalog-note">
                Use the <code>!</code> prefix. Destructive operations are restricted to authorized users.
              </small>
            </div>
            <label className="search">
              <span>⌕</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search commands…"
              />
            </label>
          </div>
          <div className="command-grid">
            {filtered.map((command) => (
              <article className="command-card" key={command.name}>
                <div className="command-title">
                  <code>{command.name}</code>
                </div>
                <p>{command.description}</p>
                <footer>
                  <span className="pill">{command.category}</span>
                  <span>{command.permission}</span>
                </footer>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <span>✦ THE END OF ALL FATE</span>
        <span>Private tools. Controlled access.</span>
        <span>© 2026</span>
      </footer>
    </main>
  );
}
