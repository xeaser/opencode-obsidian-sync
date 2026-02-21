import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { parseArgs } from "node:util";
import {
  listSessions,
  reconstructConversation,
  formatForObsidian,
  splitIfNeeded,
  resolveProjectName,
  readMessages,
  extractTags,
  type Session,
  type ReconstructedConversation,
  type SplitResult,
} from "../lib";

// --- Config ---

const OBSIDIAN_BASE = process.env.OBSIDIAN_URL || "http://127.0.0.1:27123";
const OBSIDIAN_KEY = process.env.OBSIDIAN_API_KEY || "";
const STATE_FILE = join(import.meta.dir, "..", ".sisyphus", "sync-state.json");
const CONCURRENCY = 3;

// --- State ---

interface SyncState {
  completed: string[];
  failed: Array<{ id: string; error: string }>;
  lastRun: string;
}

async function loadState(): Promise<SyncState> {
  try {
    const text = await readFile(STATE_FILE, "utf-8");
    return JSON.parse(text);
  } catch {
    return { completed: [], failed: [], lastRun: "" };
  }
}

async function saveState(state: SyncState): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

// --- Obsidian REST API ---

async function obsidianPut(path: string, content: string): Promise<boolean> {
  const url = `${OBSIDIAN_BASE}/vault/${encodeURIComponent(path)}`;
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${OBSIDIAN_KEY}`,
        "Content-Type": "text/markdown",
      },
      body: content,
    });
    return res.ok;
  } catch (e) {
    console.error(`  [ERROR] Obsidian PUT ${path}: ${e}`);
    return false;
  }
}

async function obsidianExists(path: string): Promise<boolean> {
  const url = `${OBSIDIAN_BASE}/vault/${encodeURIComponent(path)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${OBSIDIAN_KEY}` },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function obsidianGet(path: string): Promise<string | null> {
  const url = `${OBSIDIAN_BASE}/vault/${encodeURIComponent(path)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${OBSIDIAN_KEY}`,
        Accept: "text/markdown",
      },
    });
    if (res.status === 200) return await res.text();
    return null;
  } catch {
    return null;
  }
}

async function obsidianAppend(path: string, content: string): Promise<boolean> {
  const url = `${OBSIDIAN_BASE}/vault/${encodeURIComponent(path)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OBSIDIAN_KEY}`,
        "Content-Type": "text/markdown",
      },
      body: content,
    });
    return res.ok;
  } catch (e) {
    console.error(`  [ERROR] Obsidian APPEND ${path}: ${e}`);
    return false;
  }
}

// --- Formatting ---

function formatDate(ts: number): string {
  return new Date(ts).toISOString().split("T")[0];
}

function formatDateTime(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function escapeYaml(value: string): string {
  if (
    value.includes('"') ||
    value.includes(":") ||
    value.includes("#") ||
    value.includes("\n") ||
    value.includes("[") ||
    value.includes("]")
  ) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function computeDuration(session: Session): string {
  const start = session.time.created;
  const end = session.time.completed || session.time.updated || start;
  const ms = end - start;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.round((ms % 3_600_000) / 60_000);
  return `${hours}h ${mins}m`;
}

function collectAgents(conv: ReconstructedConversation): string[] {
  const agents = new Set<string>();
  for (const e of conv.entries) {
    if (e.agent) agents.add(e.agent);
  }
  return [...agents];
}

function collectModels(conv: ReconstructedConversation): string[] {
  const models = new Set<string>();
  for (const e of conv.entries) {
    if (e.model) models.add(e.model);
  }
  return [...models];
}

function totalCost(conv: ReconstructedConversation): number {
  return conv.entries.reduce((sum, e) => sum + (e.cost || 0), 0);
}

function computeStatus(session: Session): string {
  if (session.time.completed) return "completed";
  const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
  const lastActivity = session.time.updated || session.time.created;
  if (lastActivity > thirtyMinAgo) return "active";
  return "idle";
}

async function computeTotalTokens(sessionId: string): Promise<number> {
  const messages = await readMessages(sessionId);
  let total = 0;
  for (const msg of messages) {
    if (msg.tokens) {
      total += (msg.tokens.input || 0) + (msg.tokens.output || 0);
    }
  }
  return total;
}

async function buildSummaryNote(conv: ReconstructedConversation): Promise<string> {
  const s = conv.session;
  const created = formatDate(s.time.created);
  const title = s.title || s.slug || s.id;
  const agents = collectAgents(conv);
  const models = collectModels(conv);
  const cost = totalCost(conv);
  const duration = computeDuration(s);

  const smartTags = extractTags(conv);
  const allTags = ["type/session-log", "type/summary", ...smartTags];

  const lines: string[] = [];
  lines.push("---");
  lines.push(`aliases: []`);
  lines.push(`tags: [${allTags.join(", ")}]`);
  lines.push(`created: ${created}`);
  lines.push(`session_id: ${s.id}`);
  lines.push(`project: ${escapeYaml(conv.projectName)}`);
  lines.push(`directory: ${escapeYaml(conv.projectPath)}`);
  lines.push(`branch: ""`);
  const status = computeStatus(s);
  lines.push(`status: ${status}`);
  lines.push(`agents: [${agents.map((a) => escapeYaml(a)).join(", ")}]`);
  lines.push(`models: [${models.map((m) => escapeYaml(m)).join(", ")}]`);
  lines.push(`message_count: ${conv.entries.length}`);
  lines.push(`total_cost: ${cost.toFixed(4)}`);
  const totalTokens = await computeTotalTokens(s.id);
  lines.push(`total_tokens: ${totalTokens}`);
  lines.push(`duration: ${escapeYaml(duration)}`);
  lines.push(`files_changed: 0`);
  if (s.parentID) {
    lines.push(`parent_session: ${s.parentID}`);
  } else {
    lines.push(`parent_session: ""`);
  }
  lines.push("---");
  lines.push("");
  lines.push(`# Session: ${title}`);
  lines.push("");
  lines.push(`**Project:** [[${conv.projectName}]] (\`${conv.projectPath}\`)`);
  lines.push(`**Date:** ${created}`);
  lines.push(`**Messages:** ${conv.entries.length}`);
  lines.push(`**Duration:** ${duration}`);
  lines.push(`**Cost:** $${cost.toFixed(4)}`);
  lines.push(`**Agents:** ${agents.join(", ") || "none"}`);
  lines.push(`**Models:** ${models.join(", ") || "none"}`);
  lines.push("");
  lines.push("## Links");
  if (s.parentID) {
    lines.push(`- **Parent Session**: ${s.parentID}`);
  }
  lines.push(`- **Raw Log**: See raw-log note(s) in this folder`);
  lines.push("");

  return lines.join("\n");
}

function buildRawLogNote(
  conv: ReconstructedConversation,
  partNumber: number,
  totalParts: number,
): string {
  const fullMarkdown = formatForObsidian(conv);
  const splits = splitIfNeeded(fullMarkdown, 300);

  if (totalParts <= 1) {
    const rawBody = extractRawBody(fullMarkdown);
    return buildRawLogWrapper(conv, rawBody, 1, 1);
  }

  const split = splits[partNumber - 1];
  if (!split) return "";

  const rawBody = extractRawBody(split.markdown);
  return buildRawLogWrapper(conv, rawBody, partNumber, totalParts);
}

function extractRawBody(markdown: string): string {
  const fmEnd = markdown.indexOf("---", 4);
  if (fmEnd === -1) return markdown;
  return markdown.slice(fmEnd + 3).trim();
}

function buildRawLogWrapper(
  conv: ReconstructedConversation,
  body: string,
  part: number,
  totalParts: number,
): string {
  const s = conv.session;
  const created = formatDate(s.time.created);
  const slug = sessionSlug(s);

  const smartTags = extractTags(conv);
  const allTags = ["type/session-log", "type/raw-log", ...smartTags];

  const lines: string[] = [];
  lines.push("---");
  lines.push(`tags: [${allTags.join(", ")}]`);
  lines.push(`session_id: ${s.id}`);
  lines.push(`project: ${escapeYaml(conv.projectName)}`);
  lines.push(`created: ${created}`);
  lines.push(`part: ${part}`);
  lines.push(`total_parts: ${totalParts}`);
  lines.push("---");
  lines.push("");
  lines.push(
    `# Raw Log: ${s.id} (Part ${part}/${totalParts})`,
  );
  lines.push("");
  lines.push(
    `> [!info] This is the raw conversation log for session \`${s.id}\`.`,
  );
  lines.push(
    `> For the summary, see [[${created.slice(8, 10)}-${slug}/summary]].`,
  );
  lines.push("");
  if (totalParts > 1) {
    if (part > 1) {
      lines.push(
        `> Previous part: [[${created.slice(8, 10)}-${slug}/raw-log-part-${part - 1}]]`,
      );
    }
    if (part < totalParts) {
      lines.push(
        `> Next part: [[${created.slice(8, 10)}-${slug}/raw-log-part-${part + 1}]]`,
      );
    }
    lines.push("");
  }
  lines.push(body);
  lines.push("");

  return lines.join("\n");
}

const STOP_WORDS = new Set([
  "a","an","the","and","or","but","for","in","on","at","to","of","with","is","it",
  "this","that","be","as","by","from","was","were","been","are","do","does","did",
  "has","have","had","not","no","so","if","then","than","when","where","how","what",
  "which","who","whom","its","my","our","your","their","we","you","they","i","me",
  "he","she","him","her","us","them","can","could","will","would","shall","should",
  "may","might","must","let","lets","just","also","very","really","about","into",
]);

function sessionSlug(s: Session): string {
  const raw = s.title || s.slug || s.id.slice(0, 12);
  const words = raw
    .toLowerCase()
    .replace(/[<>:"/\\|?*#^[\]]/g, "")
    .split(/[\s_-]+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
  const joined = words
    .join("-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (joined.length <= 40) return joined;
  const truncated = joined.slice(0, 40);
  const lastDash = truncated.lastIndexOf("-");
  return lastDash > 10 ? truncated.slice(0, lastDash) : truncated;
}

function sessionBasePath(conv: ReconstructedConversation): string {
  const s = conv.session;
  const date = formatDate(s.time.created);
  const slug = sessionSlug(s);
  const yearMonth = date.slice(0, 7);
  const day = date.slice(8, 10);
  return `10-Projects/${sanitizeFolderName(conv.projectName)}/sessions/${yearMonth}/${day}-${slug}`;
}

function sanitizeFolderName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "-").replace(/\s+/g, " ").trim() || "unknown";
}

// --- MOC Management ---

async function ensureProjectMOC(
  projectName: string,
  projectPath: string,
): Promise<void> {
  const safeName = sanitizeFolderName(projectName);
  const mocPath = `10-Projects/${safeName}/_MOC.md`;

  const exists = await obsidianExists(mocPath);
  if (exists) return;

  const content = `---
aliases: []
tags: [type/project-moc]
project: ${escapeYaml(projectName)}
directory: ${escapeYaml(projectPath)}
created: ${formatDate(Date.now())}
---

# ${projectName}

> **Directory**: \`${projectPath}\`

## Recent Sessions

\`\`\`dataview
TABLE session_id AS "Session", created AS "Date", duration AS "Duration", status AS "Status", total_cost AS "Cost"
FROM #type/summary
WHERE project = this.project
SORT created DESC
LIMIT 20
\`\`\`

## Session Timeline

\`\`\`dataview
LIST WITHOUT ID "**" + session_id + "** (" + status + ") - " + duration
FROM #type/summary
WHERE project = this.project
SORT created DESC
\`\`\`

## Statistics

\`\`\`dataview
TABLE
  length(rows) AS "Sessions",
  sum(rows.total_cost) AS "Total Cost"
FROM #type/summary
WHERE project = this.project
GROUP BY project
\`\`\`
`;

  await obsidianPut(mocPath, content);
  console.log(`  Created MOC: ${mocPath}`);
}

// --- Import Logic ---

async function importSession(
  session: Session,
): Promise<{ success: boolean; error?: string }> {
  const sessionId = session.id;
  const projectId = session.projectID;

  try {
    const projectName = await resolveProjectName(projectId);
    const conv = await reconstructConversation(sessionId, projectId);
    if (!conv) {
      return { success: false, error: "Failed to reconstruct conversation" };
    }

    if (conv.entries.length === 0) {
      return { success: false, error: "Session has 0 messages" };
    }

    const basePath = sessionBasePath(conv);
    const summaryPath = `${basePath}/summary.md`;

    const summaryExists = await obsidianExists(summaryPath);
    if (summaryExists) {
      return { success: true }; // Already imported
    }

    await ensureProjectMOC(conv.projectName, conv.projectPath);

    const summaryNote = await buildSummaryNote(conv);
    const putOk = await obsidianPut(summaryPath, summaryNote);
    if (!putOk) {
      return { success: false, error: `Failed to write summary: ${summaryPath}` };
    }

    if (conv.entries.length === 0) {
      return { success: true };
    }

    const fullMarkdown = formatForObsidian(conv);
    const splits = splitIfNeeded(fullMarkdown, 300);

    if (splits.length <= 1) {
      const rawLogPath = `${basePath}/raw-log.md`;
      const rawContent = buildRawLogWrapper(conv, extractRawBody(fullMarkdown), 1, 1);
      const rawOk = await obsidianPut(rawLogPath, rawContent);
      if (!rawOk) {
        return { success: false, error: `Failed to write raw log: ${rawLogPath}` };
      }
    } else {
      for (const split of splits) {
        const rawLogPath = `${basePath}/raw-log-part-${split.partNumber}.md`;
        const rawBody = extractRawBody(split.markdown);
        const rawContent = buildRawLogWrapper(conv, rawBody, split.partNumber, split.totalParts);
        const rawOk = await obsidianPut(rawLogPath, rawContent);
        if (!rawOk) {
          return { success: false, error: `Failed to write raw log part ${split.partNumber}: ${rawLogPath}` };
        }
      }
    }

    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

async function importAll(resume: boolean = false): Promise<void> {
  console.log("Loading sessions...");
  const sessions = await listSessions();
  console.log(`Found ${sessions.length} sessions total.`);

  const state = resume ? await loadState() : { completed: [], failed: [], lastRun: "" };
  const completedSet = new Set(state.completed);

  const toImport: Session[] = [];
  let skippedEmpty = 0;
  let skippedCompleted = 0;

  for (const session of sessions) {
    if (completedSet.has(session.id)) {
      skippedCompleted++;
      continue;
    }

    const messages = await readMessages(session.id);
    if (messages.length === 0) {
      skippedEmpty++;
      continue;
    }

    toImport.push(session);
  }

  console.log(`Sessions to import: ${toImport.length}`);
  console.log(`Skipped (already done): ${skippedCompleted}`);
  console.log(`Skipped (0 messages): ${skippedEmpty}`);
  console.log("");

  if (toImport.length === 0) {
    console.log("All sessions already synced.");
    return;
  }

  let imported = 0;
  let failed = 0;

  for (let i = 0; i < toImport.length; i += CONCURRENCY) {
    const batch = toImport.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (session) => {
        const result = await importSession(session);
        return { session, result };
      }),
    );

    for (const { session, result } of results) {
      if (result.success) {
        imported++;
        state.completed.push(session.id);
        const title = session.title || session.slug || session.id;
        console.log(
          `  [${imported + failed}/${toImport.length}] OK: ${title.slice(0, 60)}`,
        );
      } else {
        if (result.error === "Session has 0 messages") {
          console.log(
            `  [${imported + failed}/${toImport.length}] SKIP (empty): ${session.id}`,
          );
        } else {
          failed++;
          state.failed.push({ id: session.id, error: result.error || "unknown" });
          console.error(
            `  [${imported + failed}/${toImport.length}] FAIL: ${session.id} - ${result.error}`,
          );
        }
      }
    }

    state.lastRun = new Date().toISOString();
    await saveState(state);
  }

  console.log("");
  console.log(`Import complete. Imported: ${imported}, Failed: ${failed}`);
  console.log(`State saved to ${STATE_FILE}`);
}

async function importSingle(sessionId: string): Promise<void> {
  console.log(`Importing session: ${sessionId}`);

  const sessions = await listSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  const result = await importSession(session);
  if (result.success) {
    console.log("Import successful.");
  } else {
    console.error(`Import failed: ${result.error}`);
    process.exit(1);
  }
}

// --- CLI ---

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      all: { type: "boolean", default: false },
      session: { type: "string" },
      resume: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (!OBSIDIAN_KEY) {
    console.error("Error: OBSIDIAN_API_KEY env var is required.");
    console.error("Set it to your Obsidian Local REST API key.");
    process.exit(1);
  }

  try {
    const res = await fetch(`${OBSIDIAN_BASE}/`, {
      headers: { Authorization: `Bearer ${OBSIDIAN_KEY}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log("Obsidian API connected.");
  } catch (e) {
    console.error(`Cannot connect to Obsidian at ${OBSIDIAN_BASE}: ${e}`);
    process.exit(1);
  }

  if (values.session) {
    await importSingle(values.session);
  } else if (values.all) {
    await importAll(values.resume ?? false);
  } else {
    console.log("Usage:");
    console.log("  bun run import.ts --all           Import all historical sessions");
    console.log("  bun run import.ts --all --resume   Continue from last state");
    console.log("  bun run import.ts --session <id>   Import specific session");
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
