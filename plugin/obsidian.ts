import { readQueue, dequeue, updateRetries, shouldDiscard, type QueueItem } from "./queue";

const OBSIDIAN_URL = process.env.OBSIDIAN_URL || "http://127.0.0.1:27123";
const OBSIDIAN_KEY = process.env.OBSIDIAN_API_KEY || "";
const PROCESS_INTERVAL_MS = 7_000;

let available = false;
let processorTimer: ReturnType<typeof setInterval> | null = null;

export function isAvailable(): boolean {
  return available;
}

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${OBSIDIAN_URL}/`, {
      signal: AbortSignal.timeout(3000),
    });
    available = res.ok;
  } catch {
    available = false;
  }
  return available;
}

async function obsidianPut(path: string, content: string): Promise<boolean> {
  const url = `${OBSIDIAN_URL}/vault/${encodeURIComponent(path)}`;
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${OBSIDIAN_KEY}`,
        "Content-Type": "text/markdown",
      },
      body: content,
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function obsidianGet(path: string): Promise<string | null> {
  const url = `${OBSIDIAN_URL}/vault/${encodeURIComponent(path)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${OBSIDIAN_KEY}`,
        Accept: "text/markdown",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function obsidianDelete(path: string): Promise<boolean> {
  const url = `${OBSIDIAN_URL}/vault/${encodeURIComponent(path)}`;
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${OBSIDIAN_KEY}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

async function processItem(item: QueueItem): Promise<boolean> {
  if (item.type === "delete") {
    return obsidianDelete(item.path);
  }
  return obsidianPut(item.path, item.content);
}

async function processQueue(): Promise<void> {
  if (!available) {
    const ok = await healthCheck();
    if (!ok) return;
  }

  const items = await readQueue();
  if (items.length === 0) return;

  for (const item of items) {
    if (shouldDiscard(item)) {
      await dequeue(item.id);
      // Silently discard after max retries to avoid TUI overlap
      continue;
    }

    const ok = await processItem(item);
    if (ok) {
      await dequeue(item.id);
    } else {
      available = false;
      await updateRetries(item);
      return;
    }
  }
}

export function startProcessor(): void {
  if (processorTimer) return;
  processorTimer = setInterval(() => {
    processQueue().catch(() => {});
  }, PROCESS_INTERVAL_MS);
}

export function stopProcessor(): void {
  if (processorTimer) {
    clearInterval(processorTimer);
    processorTimer = null;
  }
}
