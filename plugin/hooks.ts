import type { Event } from "@opencode-ai/sdk";
import { enqueue } from "./queue";
import { obsidianGet } from "./obsidian";
import {
  reconstructConversation,
  formatForObsidian,
  resolveProjectName,
  readMessages,
  readSession,
  splitIfNeeded,
  extractTags,
  type ReconstructedConversation,
} from "../lib";

const MESSAGE_DEBOUNCE_MS = 30_000;

interface SessionTracker {
  projectId: string;
  projectName: string;
  slug: string;
  summaryPath: string;
  messageCount: number;
  lastMessageSync: number;
  foundInStorage: boolean;
}

const sessions = new Map<string, SessionTracker>();
const deletionFailures = new Map<string, number>();
const DELETION_THRESHOLD = 3;

function formatDate(ts: number): string {
  return new Date(ts).toISOString().split("T")[0];
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

const STOP_WORDS = new Set([
  "a","an","the","and","or","but","for","in","on","at","to","of","with","is","was",
  "are","were","be","been","being","have","has","had","do","does","did","will","would",
  "could","should","may","might","shall","can","this","that","these","those","it","its",
  "my","your","our","their","his","her","from","by","about","into","through","during",
  "before","after","above","below","between","under","again","further","then","once",
  "here","there","when","where","why","how","all","each","every","both","few","more",
  "most","other","some","such","no","nor","not","only","own","same","so","than","too",
  "very","just","because","as","until","while","also","i","me","we","you","he","she",
  "they","them","what","which","who","whom","let","lets","using","use","need","needs",
]);

function sessionSlug(session: { title?: string; slug?: string; id: string }): string {
  const raw = session.title || session.slug || session.id.slice(0, 12);
  const words = raw
    .toLowerCase()
    .replace(/[<>:"/\\|?*#^[\]]/g, "")
    .split(/[\s_-]+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
  const joined = words.join("-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (joined.length <= 40) return joined;
  const truncated = joined.slice(0, 40);
  const lastDash = truncated.lastIndexOf("-");
  return lastDash > 10 ? truncated.slice(0, lastDash) : truncated;
}

function notePath(projectName: string, date: string, slug: string, suffix: string): string {
  const yearMonth = date.slice(0, 7);
  const day = date.slice(8, 10);
  return `10-Projects/${projectName}/sessions/${yearMonth}/${day}-${slug}/${suffix}.md`;
}

function buildSkeletonSummary(
  sessionId: string,
  projectName: string,
  projectPath: string,
  created: string,
  title: string,
  slug: string,
): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("aliases: []");
  lines.push("tags: [type/session-log, type/summary]");
  lines.push(`created: ${created}`);
  lines.push(`session_id: ${sessionId}`);
  lines.push(`project: ${escapeYaml(projectName)}`);
  lines.push(`directory: ${escapeYaml(projectPath)}`);
  lines.push('branch: ""');
  lines.push("status: active");
  lines.push("agents: []");
  lines.push("models: []");
  lines.push("message_count: 0");
  lines.push("total_cost: 0.0000");
  lines.push("total_tokens: 0");
  lines.push('duration: "0s"');
  lines.push("files_changed: 0");
  lines.push('parent_session: ""');
  lines.push("---");
  lines.push("");
  lines.push(`# Session: ${title}`);
  lines.push("");
  lines.push(`**Project:** [[${projectName}]] (\`${projectPath}\`)`);
  lines.push(`**Date:** ${created}`);
  lines.push("**Messages:** 0");
  lines.push('**Duration:** 0s');
  lines.push("**Cost:** $0.0000");
  lines.push("");
  lines.push("## Links");
  lines.push("- **Raw Log**: See raw-log note(s) in this folder");
  lines.push("");
  return lines.join("\n");
}

function computeStatus(session: { time: { created: number; updated?: number; completed?: number } }): string {
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

function buildUpdatedSummary(
  conv: ReconstructedConversation,
  totalTokens: number,
): string {
  const s = conv.session;
  const created = formatDate(s.time.created);
  const title = s.title || s.slug || s.id;
  const agents = [...new Set(conv.entries.filter((e) => e.agent).map((e) => e.agent!))];
  const models = [...new Set(conv.entries.filter((e) => e.model).map((e) => e.model!))];
  const cost = conv.entries.reduce((sum, e) => sum + (e.cost || 0), 0);

  const start = s.time.created;
  const end = s.time.updated || start;
  const ms = end - start;
  let duration: string;
  if (ms < 60_000) duration = `${Math.round(ms / 1000)}s`;
  else if (ms < 3_600_000) duration = `${Math.round(ms / 60_000)}m`;
  else {
    const hours = Math.floor(ms / 3_600_000);
    const mins = Math.round((ms % 3_600_000) / 60_000);
    duration = `${hours}h ${mins}m`;
  }

  const smartTags = extractTags(conv);
  const allTags = ["type/session-log", "type/summary", ...smartTags];
  const status = computeStatus(s);

  const lines: string[] = [];
  lines.push("---");
  lines.push("aliases: []");
  lines.push(`tags: [${allTags.join(", ")}]`);
  lines.push(`created: ${created}`);
  lines.push(`session_id: ${s.id}`);
  lines.push(`project: ${escapeYaml(conv.projectName)}`);
  lines.push(`directory: ${escapeYaml(conv.projectPath)}`);
  lines.push('branch: ""');
  lines.push(`status: ${status}`);
  lines.push(`agents: [${agents.map((a) => escapeYaml(a)).join(", ")}]`);
  lines.push(`models: [${models.map((m) => escapeYaml(m)).join(", ")}]`);
  lines.push(`message_count: ${conv.entries.length}`);
  lines.push(`total_cost: ${cost.toFixed(4)}`);
  lines.push(`total_tokens: ${totalTokens}`);
  lines.push(`duration: ${escapeYaml(duration)}`);
  lines.push("files_changed: 0");
  lines.push(`parent_session: ${s.parentID ? s.parentID : '""'}`);
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
  lines.push("- **Raw Log**: See raw-log note(s) in this folder");
  lines.push("");
  return lines.join("\n");
}

function buildRawLogNote(
  conv: ReconstructedConversation,
  partNumber: number,
  totalParts: number,
): string {
  if (conv.entries.length === 0) return "";

  const s = conv.session;
  const created = formatDate(s.time.created);
  const slug = sessionSlug(s);
  const fullMarkdown = formatForObsidian(conv);
  const splits = splitIfNeeded(fullMarkdown, 300);

  const splitContent = totalParts <= 1
    ? fullMarkdown
    : (splits[partNumber - 1]?.markdown ?? "");

  const fmEnd = splitContent.indexOf("---", 4);
  const body = fmEnd === -1 ? splitContent : splitContent.slice(fmEnd + 3).trim();

  const smartTags = extractTags(conv);
  const allTags = ["type/session-log", "type/raw-log", ...smartTags];

  const lines: string[] = [];
  lines.push("---");
  lines.push(`tags: [${allTags.join(", ")}]`);
  lines.push(`session_id: ${s.id}`);
  lines.push(`project: ${escapeYaml(conv.projectName)}`);
  lines.push(`created: ${created}`);
  lines.push(`part: ${partNumber}`);
  lines.push(`total_parts: ${totalParts}`);
  lines.push("---");
  lines.push("");
  lines.push(`# Raw Log: ${s.id} (Part ${partNumber}/${totalParts})`);
  lines.push("");
  lines.push(`> [!info] This is the raw conversation log for session \`${s.id}\`.`);
  const day = created.slice(8, 10);
  lines.push(`> For the summary, see [[${day}-${slug}/summary]].`);
  lines.push("");
  if (totalParts > 1) {
    if (partNumber > 1) {
      lines.push(`> Previous part: [[${day}-${slug}/raw-log-part-${partNumber - 1}]]`);
    }
    if (partNumber < totalParts) {
      lines.push(`> Next part: [[${day}-${slug}/raw-log-part-${partNumber + 1}]]`);
    }
    lines.push("");
  }
  lines.push(body);
  lines.push("");
  return lines.join("\n");
}

function syncRawLog(
  conv: ReconstructedConversation,
  projectName: string,
  created: string,
  slug: string,
): void {
  if (conv.entries.length === 0) return;

  const fullMarkdown = formatForObsidian(conv);
  const splits = splitIfNeeded(fullMarkdown, 300);
  const totalParts = Math.max(splits.length, 1);

  if (totalParts <= 1) {
    const path = notePath(projectName, created, slug, "raw-log");
    const content = buildRawLogNote(conv, 1, 1);
    enqueue("update", path, content).catch(() => {});
  } else {
    for (let i = 1; i <= totalParts; i++) {
      const suffix = `raw-log-part-${i}`;
      const path = notePath(projectName, created, slug, suffix);
      const content = buildRawLogNote(conv, i, totalParts);
      enqueue("update", path, content).catch(() => {});
    }
  }
}

function handleRenameIfNeeded(
  tracker: SessionTracker,
  newTitle: string,
  created: string,
): boolean {
  const newSlug = sessionSlug({ title: newTitle, id: "" });
  if (newSlug === tracker.slug) return false;

  const oldSlug = tracker.slug;
  const projectName = tracker.projectName;

  enqueue("delete", tracker.summaryPath, "").catch(() => {});

  const oldRawLogPath = notePath(projectName, created, oldSlug, "raw-log");
  enqueue("delete", oldRawLogPath, "").catch(() => {});
  for (let i = 1; i <= 20; i++) {
    const oldPartPath = notePath(projectName, created, oldSlug, `raw-log-part-${i}`);
    enqueue("delete", oldPartPath, "").catch(() => {});
  }

  tracker.slug = newSlug;
  tracker.summaryPath = notePath(projectName, created, newSlug, "summary");

  return true;
}

async function moveToTrash(sessionId: string, tracker: SessionTracker): Promise<void> {
  const summaryPath = tracker.summaryPath;
  const trashSummaryPath = summaryPath.replace("/sessions/", "/trash/");

  const summaryContent = await obsidianGet(summaryPath);
  if (summaryContent !== null) {
    enqueue("create", trashSummaryPath, summaryContent).catch(() => {});
    enqueue("delete", summaryPath, "").catch(() => {});
  }

  const rawLogPath = summaryPath.replace("/summary.md", "/raw-log.md");
  const trashRawLogPath = rawLogPath.replace("/sessions/", "/trash/");
  const rawLogContent = await obsidianGet(rawLogPath);
  if (rawLogContent !== null) {
    enqueue("create", trashRawLogPath, rawLogContent).catch(() => {});
    enqueue("delete", rawLogPath, "").catch(() => {});
  }

  for (let i = 1; i <= 20; i++) {
    const partPath = summaryPath.replace("/summary.md", `/raw-log-part-${i}.md`);
    const partContent = await obsidianGet(partPath);
    if (partContent === null) break;
    const trashPartPath = partPath.replace("/sessions/", "/trash/");
    enqueue("create", trashPartPath, partContent).catch(() => {});
    enqueue("delete", partPath, "").catch(() => {});
  }


}

export async function pollForDeletions(): Promise<void> {
  for (const [sessionId, tracker] of sessions.entries()) {
    try {
      const session = await readSession(sessionId, tracker.projectId);
      if (session !== null) {
        tracker.foundInStorage = true;
        deletionFailures.delete(sessionId);
      } else if (tracker.foundInStorage) {
        const failures = (deletionFailures.get(sessionId) || 0) + 1;
        deletionFailures.set(sessionId, failures);
        if (failures >= DELETION_THRESHOLD) {
          await moveToTrash(sessionId, tracker);
          sessions.delete(sessionId);
          deletionFailures.delete(sessionId);
        }
      }
    } catch {}
  }
}


export async function onSessionCreated(
  sessionInfo: { id: string; projectID: string; title: string; directory: string; time: { created: number } },
): Promise<void> {
  try {
    const projectName = await resolveProjectName(sessionInfo.projectID);
    const created = formatDate(sessionInfo.time.created);
    const slug = sessionSlug(sessionInfo);
    const title = sessionInfo.title || sessionInfo.id.slice(0, 12);
    const summaryPath = notePath(projectName, created, slug, "summary");

    sessions.set(sessionInfo.id, {
      projectId: sessionInfo.projectID,
      projectName,
      slug,
      summaryPath,
      messageCount: 0,
      lastMessageSync: 0,
      foundInStorage: false,
    });

    const content = buildSkeletonSummary(
      sessionInfo.id,
      projectName,
      sessionInfo.directory,
      created,
      title,
      slug,
    );

    enqueue("create", summaryPath, content).catch(() => {});
  } catch (e) {

  }
}

export async function onSessionUpdated(
  sessionInfo: { id: string; projectID: string; title: string; time: { created: number; updated: number } },
): Promise<void> {
  try {
    const tracker = sessions.get(sessionInfo.id);
    if (!tracker) return;

    const created = formatDate(sessionInfo.time.created);
    if (sessionInfo.title) {
      handleRenameIfNeeded(tracker, sessionInfo.title, created);
    }

    const conv = await reconstructConversation(sessionInfo.id, tracker.projectId);
    if (!conv) return;

    const totalTokens = await computeTotalTokens(sessionInfo.id);
    const content = buildUpdatedSummary(conv, totalTokens);
    tracker.messageCount = conv.entries.length;

    enqueue("update", tracker.summaryPath, content).catch(() => {});
  } catch (e) {

  }
}

export async function onSessionIdle(sessionId: string): Promise<void> {
  try {
    const tracker = sessions.get(sessionId);
    if (!tracker) return;

    const freshSession = await readSession(sessionId, tracker.projectId);
    if (freshSession) {
      tracker.foundInStorage = true;
      const created = formatDate(freshSession.time.created);
      const currentTitle = freshSession.title || freshSession.slug || freshSession.id;
      handleRenameIfNeeded(tracker, currentTitle, created);
    }

    const conv = await reconstructConversation(sessionId, tracker.projectId);
    if (!conv) return;

    const totalTokens = await computeTotalTokens(sessionId);
    const content = buildUpdatedSummary(conv, totalTokens);
    tracker.messageCount = conv.entries.length;

    enqueue("update", tracker.summaryPath, content).catch(() => {});

    const created = formatDate(conv.session.time.created);
    if (conv.entries.length > 0) {
      syncRawLog(conv, tracker.projectName, created, tracker.slug);
    }
  } catch (e) {

  }
}

export async function onCompacting(sessionId: string): Promise<void> {
  try {
    const tracker = sessions.get(sessionId);
    let projectId: string;

    if (tracker) {
      projectId = tracker.projectId;
    } else {
      return;
    }

    const conv = await reconstructConversation(sessionId, projectId);
    if (!conv) return;

    const projectName = conv.projectName;
    const created = formatDate(conv.session.time.created);
    const slug = tracker.slug;

    if (conv.entries.length > 0) {
      syncRawLog(conv, projectName, created, slug);
    }

    const summaryContent = buildUpdatedSummary(conv, await computeTotalTokens(sessionId));
    enqueue("update", tracker.summaryPath, summaryContent).catch(() => {});

    tracker.messageCount = conv.entries.length;
  } catch (e) {

  }
}

export async function onMessageUpdated(
  messageInfo: { sessionID: string },
): Promise<void> {
  try {
    const tracker = sessions.get(messageInfo.sessionID);
    if (!tracker) return;

    const now = Date.now();
    if (now - tracker.lastMessageSync < MESSAGE_DEBOUNCE_MS) return;
    tracker.lastMessageSync = now;

    const messages = await readMessages(messageInfo.sessionID);
    tracker.messageCount = messages.length;
  } catch {}
}

export function _resetForTesting(): void {
  sessions.clear();
  deletionFailures.clear();
}

export function handleEvent(event: Event): void {
  switch (event.type) {
    case "session.created":
      onSessionCreated(event.properties.info).catch(() => {});
      break;
    case "session.updated":
      onSessionUpdated(event.properties.info).catch(() => {});
      break;
    case "session.idle":
      onSessionIdle(event.properties.sessionID).catch(() => {});
      break;
    case "message.updated":
      onMessageUpdated(event.properties.info).catch(() => {});
      break;
  }
}
