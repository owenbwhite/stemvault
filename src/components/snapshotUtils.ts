export type Snapshot = Record<string, string>;

export function encodeSnapshot(s: Snapshot): string {
  return JSON.stringify(s);
}

export function decodeSnapshot(raw: unknown): Snapshot {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Snapshot; } catch { return {}; }
  }
  return raw as Snapshot;
}
