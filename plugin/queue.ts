import { readdir, readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface QueueItem {
  id: string;
  type: "create" | "update" | "delete";
  path: string;
  content: string;
  retries: number;
  createdAt: number;
}

const QUEUE_DIR = join(
  process.env.HOME || "/tmp",
  ".cache",
  "opencode-obsidian-sync",
  "queue",
);

let initialized = false;

async function ensureDir(): Promise<void> {
  if (initialized) return;
  await mkdir(QUEUE_DIR, { recursive: true });
  initialized = true;
}

export async function enqueue(
  type: QueueItem["type"],
  path: string,
  content: string,
): Promise<void> {
  await ensureDir();
  const item: QueueItem = {
    id: randomUUID(),
    type,
    path,
    content,
    retries: 0,
    createdAt: Date.now(),
  };
  const filePath = join(QUEUE_DIR, `${item.id}.json`);
  await writeFile(filePath, JSON.stringify(item));
}

export async function readQueue(): Promise<QueueItem[]> {
  await ensureDir();
  try {
    const files = await readdir(QUEUE_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    const items: QueueItem[] = [];
    for (const file of jsonFiles) {
      try {
        const text = await readFile(join(QUEUE_DIR, file), "utf-8");
        items.push(JSON.parse(text) as QueueItem);
      } catch {}
    }
    return items.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function dequeue(id: string): Promise<void> {
  try {
    await unlink(join(QUEUE_DIR, `${id}.json`));
  } catch {}
}

export async function updateRetries(item: QueueItem): Promise<void> {
  const filePath = join(QUEUE_DIR, `${item.id}.json`);
  item.retries += 1;
  await writeFile(filePath, JSON.stringify(item));
}

const MAX_RETRIES = 50;

export function shouldDiscard(item: QueueItem): boolean {
  return item.retries >= MAX_RETRIES;
}
