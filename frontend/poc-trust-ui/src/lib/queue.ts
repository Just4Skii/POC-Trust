/**
 * Pending-assessment queue (prototype offline boundary).
 *
 * IMPLEMENTED: queue survives reload; entries are removed only after the backend accepted them.
 * FUTURE: a real sync engine. This is storage/transport metadata, it is NOT a clinical
 * reliability rule and does not evaluate reliability locally.
 *
 * Removal is identity-based (`_queueId`) rather than index-based, so an entry queued while a sync
 * is in flight is never discarded by a stale write-back.
 */

export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const QUEUE_KEY = "poctrust-pending";

export interface QueuedEvent extends Record<string, unknown> {
  _queueId: string;
  _queuedAt: string;
}

function newQueueId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `q-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalise(entry: Record<string, unknown>): QueuedEvent {
  const { _queueId, _queuedAt, ...rest } = entry;
  return {
    ...rest,
    _queueId: typeof _queueId === "string" && _queueId ? _queueId : newQueueId(),
    _queuedAt: typeof _queuedAt === "string" && _queuedAt ? _queuedAt : new Date().toISOString(),
  };
}

export function writeQueue(storage: QueueStorage, items: QueuedEvent[]): QueuedEvent[] {
  storage.setItem(QUEUE_KEY, JSON.stringify(items));
  return items;
}

/**
 * Reads the queue and gives legacy entries (written before `_queueId` existed) a stable identity,
 * persisting the migration so later syncs can match them.
 */
export function readQueue(storage: QueueStorage): QueuedEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(QUEUE_KEY) ?? "[]");
  } catch {
    return writeQueue(storage, []);
  }
  if (!Array.isArray(parsed)) return writeQueue(storage, []);

  const entries = parsed.filter(isRecord);
  const items = entries.map(normalise);
  const migrated = items.some((item, i) => item._queueId !== entries[i]._queueId);
  return migrated ? writeQueue(storage, items) : items;
}

/** Appends an entry to the current queue without clobbering concurrent additions. */
export function enqueueEvent(storage: QueueStorage, body: Record<string, unknown>): QueuedEvent[] {
  return writeQueue(storage, [...readQueue(storage), normalise({ ...body })]);
}

/**
 * Removes only the entries a completed sync accepted. Re-reads storage first, so anything queued
 * while the sync was running is preserved, and failed/unsynced entries stay queued.
 */
export function completeSync(storage: QueueStorage, syncedIds: readonly string[]): QueuedEvent[] {
  const synced = new Set(syncedIds);
  return writeQueue(storage, readQueue(storage).filter((item) => !synced.has(item._queueId)));
}
