import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { parseArgs } from "node:util";

// --- Config ---

const OBSIDIAN_BASE = process.env.OBSIDIAN_URL || "http://127.0.0.1:27123";
const OBSIDIAN_KEY = process.env.OBSIDIAN_API_KEY || "";
const STATE_FILE = join(import.meta.dir, "..", ".sisyphus", "backlinks-state.json");

// --- State ---

interface BacklinksState {
  processed: string[];
  linked: Array<{ child: string; parent: string }>;
  skipped: Array<{ sessionId: string; reason: string }>;
  lastRun: string;
}

async function loadState(): Promise<BacklinksState> {
  try {
    const text = await readFile(STATE_FILE, "utf-8");
    return JSON.parse(text);
  } catch {
    return { processed: [], linked: [], skipped: [], lastRun: "" };
  }
}

async function saveState(state: BacklinksState): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

// --- Obsidian REST API ---

async function obsidianSearch(query: string): Promise<Array<{ path: string; title: string }>> {
  const url = `${OBSIDIAN_BASE}/search/simple?query=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${OBSIDIAN_KEY}` },
    });
    if (res.status === 200) {
      const data = await res.json();
      return data.results || [];
    }
    return [];
  } catch (e) {
    console.error(`  [ERROR] Obsidian search: ${e}`);
    return [];
  }
}

async function listAllSummaryNotes(): Promise<string[]> {
  const sessionStoragePath = join(process.env.HOME || "/root", ".local/share/opencode/storage/session");
  const summaryNotes: string[] = [];

  try {
    const projects = await readdir(sessionStoragePath);
    for (const projectHash of projects) {
      const projectPath = join(sessionStoragePath, projectHash);
      const sessions = await readdir(projectPath);

      for (const sessionFile of sessions) {
        if (!sessionFile.endsWith(".json")) continue;

        const sessionId = sessionFile.replace(".json", "");
        const sessionContent = await readFile(join(projectPath, sessionFile), "utf-8");
        const session = JSON.parse(sessionContent);

        if (session.parentID) {
          summaryNotes.push(sessionId);
        }
      }
    }
  } catch (e) {
    console.error(`  [ERROR] Reading session storage: ${e}`);
  }

  return summaryNotes;
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

// --- Frontmatter Parsing ---

interface Frontmatter {
  [key: string]: unknown;
}

function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const fm: Frontmatter = {};
  const lines = match[1].split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const [key, ...valueParts] = line.split(":");
    const value = valueParts.join(":").trim();

    if (value.startsWith("[") && value.endsWith("]")) {
      try {
        fm[key.trim()] = JSON.parse(value);
      } catch {
        fm[key.trim()] = value;
      }
    } else if (value === "true") {
      fm[key.trim()] = true;
    } else if (value === "false") {
      fm[key.trim()] = false;
    } else if (!isNaN(Number(value))) {
      fm[key.trim()] = Number(value);
    } else {
      fm[key.trim()] = value;
    }
  }

  return { frontmatter: fm, body: match[2] };
}

function stringifyFrontmatter(frontmatter: Frontmatter, body: string): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else if (typeof value === "object" && value !== null) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  lines.push(body);
  return lines.join("\n");
}

// --- Session ID Extraction ---

function extractSessionId(content: string): string | null {
  const { frontmatter } = parseFrontmatter(content);
  return (frontmatter.session_id as string) || null;
}

function extractFilenameFromPath(path: string): string {
  return path.split("/").pop() || "";
}

// --- Main Logic ---

async function listVaultDir(vaultPath: string): Promise<string[]> {
  const url = `${OBSIDIAN_BASE}/vault/${encodeURIComponent(vaultPath)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${OBSIDIAN_KEY}` },
    });
    if (res.status !== 200) return [];
    const data = await res.json();
    return data.files || [];
  } catch {
    return [];
  }
}

function extractWikilinkName(filePath: string): string {
  const parts = filePath.split("/");
  const filename = parts.pop() || "";
  const folder = parts.pop() || "";
  return `${folder}/${filename.replace(/\.md$/, "")}`;
}

async function findSessionBySessionId(sessionId: string): Promise<string | null> {
  try {
    const projects = await listVaultDir("10-Projects/");
    const projectDirs = projects.filter((f: string) => f.endsWith("/"));

    for (const project of projectDirs) {
      const sessionsBase = `10-Projects/${project}sessions/`;
      const monthFolders = await listVaultDir(sessionsBase);
      const monthDirs = monthFolders.filter((f: string) => f.endsWith("/"));

      for (const month of monthDirs) {
        const monthBase = `${sessionsBase}${month}`;
        const sessionFolders = await listVaultDir(monthBase);
        const sessionDirs = sessionFolders.filter((f: string) => f.endsWith("/"));

        for (const sessionDir of sessionDirs) {
          const summaryPath = `${monthBase}${sessionDir}summary.md`;
          const content = await obsidianGet(summaryPath);
          if (!content) continue;

          const { frontmatter } = parseFrontmatter(content);
          if (frontmatter.session_id === sessionId) {
            return summaryPath;
          }
        }
      }
    }
  } catch (e) {
    console.error(`  [ERROR] Finding session: ${e}`);
  }

  return null;
}

async function linkSessions(): Promise<void> {
  console.log("Building session-to-session backlinks...\n");

  const state = await loadState();

  console.log("Scanning sessions with parent relationships...");
  const childSessionIds = await listAllSummaryNotes();
  console.log(`   Found ${childSessionIds.length} child sessions\n`);

  if (childSessionIds.length === 0) {
    console.log("No parent-child relationships found. Done.");
    return;
  }

  let linkedCount = 0;
  let skippedCount = 0;

  console.log(`Starting to process ${childSessionIds.length} sessions...`);
  for (const childSessionId of childSessionIds) {
    if (state.processed.includes(childSessionId)) {
      continue;
    }
    const childPath = await findSessionBySessionId(childSessionId);
    if (!childPath) {
      state.skipped.push({ sessionId: childSessionId, reason: "Child note not found" });
      state.processed.push(childSessionId);
      continue;
    }

    const childContent = await obsidianGet(childPath);
    if (!childContent) {
      state.skipped.push({ sessionId: childSessionId, reason: "Failed to read child" });
      state.processed.push(childSessionId);
      continue;
    }

    const { frontmatter: childFm, body: childBody } = parseFrontmatter(childContent);
    const parentSessionId = childFm.parent_session as string;

    if (!parentSessionId || typeof parentSessionId !== "string" || parentSessionId.startsWith("[[")) {
      state.processed.push(childSessionId);
      continue;
    }

    const childWikiName = extractWikilinkName(childPath);
    console.log(`\n Processing: ${childWikiName}`);
    console.log(`   Parent session ID: ${parentSessionId}`);

    const parentPath = await findSessionBySessionId(parentSessionId);
    if (!parentPath) {
      console.log(`   Parent session not found in Obsidian`);
      state.skipped.push({
        sessionId: childSessionId,
        reason: `Parent ${parentSessionId} not found`,
      });
      state.processed.push(childSessionId);
      continue;
    }

    const parentWikiName = extractWikilinkName(parentPath);
    console.log(`   Parent note: ${parentWikiName}`);

    const parentContent = await obsidianGet(parentPath);
    if (!parentContent) {
      console.log(`   ✗ Failed to read parent session`);
      state.skipped.push({ sessionId: childSessionId, reason: "Failed to read parent" });
      state.processed.push(childSessionId);
      continue;
    }

    const { frontmatter: parentFm, body: parentBody } = parseFrontmatter(parentContent);

    const parentWikilink = `[[${parentWikiName}]]`;
    childFm.parent_session = parentWikilink;

    const childWikilink = `[[${childWikiName}]]`;
    const childSessions = (parentFm.child_sessions as unknown[]) || [];
    if (!childSessions.includes(childWikilink)) {
      childSessions.push(childWikilink);
      parentFm.child_sessions = childSessions;
    }

    const updatedChildContent = stringifyFrontmatter(childFm, childBody);
    const childWriteOk = await obsidianPut(childPath, updatedChildContent);
    if (!childWriteOk) {
      console.log(`   ✗ Failed to write child session`);
      state.skipped.push({ sessionId: childSessionId, reason: "Failed to write child" });
      state.processed.push(childSessionId);
      continue;
    }

    const updatedParentContent = stringifyFrontmatter(parentFm, parentBody);
    const parentWriteOk = await obsidianPut(parentPath, updatedParentContent);
    if (!parentWriteOk) {
      console.log(`   ✗ Failed to write parent session`);
      state.skipped.push({ sessionId: childSessionId, reason: "Failed to write parent" });
      state.processed.push(childSessionId);
      continue;
    }

    console.log(`   Linked: ${childWikiName} -> ${parentWikiName}`);
    state.linked.push({ child: childPath, parent: parentPath });
    state.processed.push(childSessionId);
    linkedCount++;
  }

  state.lastRun = new Date().toISOString();
  await saveState(state);

  console.log(`\n✓ Backlinks complete:`);
  console.log(`  Linked: ${linkedCount}`);
  console.log(`  Skipped: ${skippedCount}`);
  console.log(`  Total processed: ${state.processed.length}`);
}

// --- CLI ---

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(`
Usage: bun run sync/backlinks.ts [options]

Options:
  --help, -h    Show this help message

Description:
  Creates bidirectional parent-child session backlinks in Obsidian.
  Reads parent_session from child notes and creates wikilinks.
  Updates parent notes with child_sessions array.
`);
    process.exit(0);
  }

  try {
    await linkSessions();
  } catch (e) {
    console.error(`\n✗ Fatal error: ${e}`);
    process.exit(1);
  }
}

main();
