import { parseArgs } from "node:util";
import { listSessions, type Session } from "../lib";

const OBSIDIAN_BASE = process.env.OBSIDIAN_URL || "http://127.0.0.1:27123";
const OBSIDIAN_KEY = process.env.OBSIDIAN_API_KEY || "";

interface DailyData {
  date: string;
  sessions: Array<{
    id: string;
    title: string;
    slug: string;
    project: string;
    cost: number;
    duration: string;
  }>;
  totalCost: number;
  projects: Set<string>;
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

function formatDate(ts: number): string {
  return new Date(ts).toISOString().split("T")[0];
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

function sanitizeFolderName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "-").replace(/\s+/g, " ").trim() || "unknown";
}

const STOP_WORDS = new Set([
  "a","an","the","and","or","for","in","on","at","to","of","with","is","it",
  "by","as","from","that","this",
]);

function sessionSlug(s: Session): string {
  const raw = s.title || s.slug || s.id.slice(0, 12);
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

async function generateDailyNotes(): Promise<void> {
  console.log("Loading sessions...");
  const sessions = await listSessions();
  console.log(`Found ${sessions.length} sessions total.`);

  const dailyMap = new Map<string, DailyData>();

  for (const session of sessions) {
    const date = formatDate(session.time.created);
    
    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        date,
        sessions: [],
        totalCost: 0,
        projects: new Set(),
      });
    }

    const daily = dailyMap.get(date)!;
    
    const projectName = session.projectID;
    const title = session.title || session.slug || session.id;
    const duration = computeDuration(session);
    
    daily.sessions.push({
      id: session.id,
      title,
      slug: sessionSlug(session),
      project: projectName,
      cost: 0,
      duration,
    });
    
    daily.projects.add(projectName);
  }

  console.log(`\nFound ${dailyMap.size} unique dates with sessions.`);
  console.log("Generating daily notes...\n");

  let created = 0;
  let skipped = 0;

  const sortedDates = Array.from(dailyMap.keys()).sort();

  for (const date of sortedDates) {
    const daily = dailyMap.get(date)!;
    const notePath = `00-Dashboard/Daily Notes/${date}.md`;

    const exists = await obsidianExists(notePath);
    if (exists) {
      skipped++;
      console.log(`  [SKIP] ${date} (already exists)`);
      continue;
    }

    const content = buildDailyNote(daily);
    const ok = await obsidianPut(notePath, content);
    
    if (ok) {
      created++;
      console.log(`  [OK] ${date} (${daily.sessions.length} sessions)`);
    } else {
      console.error(`  [FAIL] ${date}`);
    }
  }

  console.log(`\nDaily notes generation complete.`);
  console.log(`Created: ${created}, Skipped: ${skipped}`);
}

function buildDailyNote(daily: DailyData): string {
  const lines: string[] = [];
  
  lines.push("---");
  lines.push(`tags: [type/daily-note]`);
  lines.push(`date: ${daily.date}`);
  lines.push(`session_count: ${daily.sessions.length}`);
  lines.push(`projects: [${Array.from(daily.projects).map(p => escapeYaml(p)).join(", ")}]`);
  lines.push(`total_cost: ${daily.totalCost.toFixed(4)}`);
  lines.push("---");
  lines.push("");
  lines.push(`# Daily Note: ${daily.date}`);
  lines.push("");
  lines.push(`**Sessions:** ${daily.sessions.length}`);
  lines.push(`**Projects:** ${Array.from(daily.projects).join(", ")}`);
  lines.push(`**Total Cost:** $${daily.totalCost.toFixed(4)}`);
  lines.push("");
  lines.push("## Sessions");
  lines.push("");

  const sessionsByProject = new Map<string, typeof daily.sessions>();
  for (const session of daily.sessions) {
    if (!sessionsByProject.has(session.project)) {
      sessionsByProject.set(session.project, []);
    }
    sessionsByProject.get(session.project)!.push(session);
  }

  for (const [project, sessions] of sessionsByProject) {
    lines.push(`### ${project}`);
    lines.push("");
    for (const session of sessions) {
      const day = daily.date.slice(8, 10);
      const summaryLink = `[[${day}-${session.slug}/summary|${session.title}]]`;
      lines.push(`- ${summaryLink} (${session.duration})`);
    }
    lines.push("");
  }

  lines.push("## Activity");
  lines.push("");
  lines.push("```dataview");
  lines.push("TABLE session_id AS \"Session\", project AS \"Project\", duration AS \"Duration\", total_cost AS \"Cost\"");
  lines.push("FROM #type/summary");
  lines.push(`WHERE created = "${daily.date}"`);
  lines.push("SORT created DESC");
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "generate-dailies": { type: "boolean", default: false },
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

  if (values["generate-dailies"]) {
    await generateDailyNotes();
  } else {
    console.log("Usage:");
    console.log("  bun run daily-notes.ts --generate-dailies   Generate all historical daily notes");
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
