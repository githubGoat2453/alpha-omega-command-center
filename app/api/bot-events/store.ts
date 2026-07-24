export type BotEvent = {
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

export type BotMetrics = {
  connected: boolean;
  uptimeSeconds: number;
  latencyMs: number;
  guilds: number;
  members: number;
  channels: number;
  commands: number;
  heartbeatAt: string;
};

export type ControlAction = {
  id: string;
  action: string;
  params: Record<string, unknown>;
  queuedAt: string;
  status: "pending" | "dispatched" | "done" | "failed";
  result?: string;
  ok?: boolean;
  completedAt?: string;
};

type Store = {
  events: BotEvent[];
  metrics?: BotMetrics;
  pending: ControlAction[];
  history: ControlAction[];
};

const g = globalThis as typeof globalThis & { _aoStore?: Store };
export const store: Store =
  g._aoStore ?? (g._aoStore = { events: [], pending: [], history: [] });

// Shim kept for existing route imports
export const eventStore = {
  get events() {
    return store.events;
  },
  get metrics() {
    return store.metrics;
  },
};

export function addEvent(
  event: Omit<BotEvent, "id" | "timestamp"> & { timestamp?: string },
) {
  store.events.unshift({
    ...event,
    id: crypto.randomUUID(),
    timestamp: event.timestamp ?? new Date().toISOString(),
  });
  store.events = store.events.slice(0, 250);
}

export function setMetrics(metrics: BotMetrics) {
  store.metrics = metrics;
}

// Action queue
export function enqueueAction(
  action: string,
  params: Record<string, unknown>,
): string {
  const id = crypto.randomUUID();
  store.pending.push({
    id,
    action,
    params,
    queuedAt: new Date().toISOString(),
    status: "pending",
  });
  return id;
}

export function drainPending(): ControlAction[] {
  const actions = store.pending.filter((a) => a.status === "pending");
  for (const a of actions) a.status = "dispatched";
  return actions;
}

export function recordResult(id: string, result: string, ok: boolean) {
  const idx = store.pending.findIndex((a) => a.id === id);
  if (idx !== -1) {
    const action = store.pending.splice(idx, 1)[0];
    action.status = ok ? "done" : "failed";
    action.result = result;
    action.ok = ok;
    action.completedAt = new Date().toISOString();
    store.history.unshift(action);
    store.history = store.history.slice(0, 200);
  }
}

export function getHistory(limit = 100): ControlAction[] {
  return store.history.slice(0, limit);
}
