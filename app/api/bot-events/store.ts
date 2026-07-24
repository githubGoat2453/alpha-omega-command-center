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

type EventStore = { events: BotEvent[]; metrics?: BotMetrics };

const globalStore = globalThis as typeof globalThis & {
  alphaOmegaEventStore?: EventStore;
};

export const eventStore =
  globalStore.alphaOmegaEventStore ??
  (globalStore.alphaOmegaEventStore = { events: [] });

export function addEvent(event: Omit<BotEvent, "id" | "timestamp"> & { timestamp?: string }) {
  eventStore.events.unshift({
    ...event,
    id: crypto.randomUUID(),
    timestamp: event.timestamp ?? new Date().toISOString(),
  });
  eventStore.events = eventStore.events.slice(0, 250);
}

export function setMetrics(metrics: BotMetrics) {
  eventStore.metrics = metrics;
}
