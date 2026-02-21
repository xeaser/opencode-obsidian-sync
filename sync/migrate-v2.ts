import { rmSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const VAULT_PATH = "/Volumes/Work/Obsidian/Work";
const PROJECT_ROOT = join(import.meta.dir, "..");
const STATE_DIR = join(PROJECT_ROOT, ".sisyphus");
const BUN = join(process.env.HOME || "~", ".bun/bin/bun");

const PROJECTS = ["aifr-core", "bifrost", "global"];

const PROTECTED_FILES = new Set([
  "00-Dashboard/Session Dashboard.md",
  "00-Dashboard/Daily Notes/_placeholder.md",
  "00-Dashboard/Daily Notes/.gitkeep.md",
]);

function log(msg: string) {
  console.log(`[migrate-v2] ${msg}`);
}

function err(msg: string) {
  console.error(`[migrate-v2] ERROR: ${msg}`);
}

// --- Phase 0: Preflight checks ---

async function checkObsidian(): Promise<boolean> {
  const base = process.env.OBSIDIAN_URL || "http://127.0.0.1:27123";
  const key = process.env.OBSIDIAN_API_KEY || "";

  if (!key) {
    err("OBSIDIAN_API_KEY env var is required.");
    return false;
  }

  try {
    const res = await fetch(`${base}/`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (e) {
    err(`Cannot connect to Obsidian at ${base}: ${e}`);
    return false;
  }
}

// --- Phase 1: Cleanup ---

function deleteFilesInDir(dir: string, label: string): number {
  if (!existsSync(dir)) {
    log(`  ${label}: directory not found, skipping`);
    return 0;
  }

  let count = 0;

  function walkAndDelete(current: string) {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      const relativePath = fullPath.replace(VAULT_PATH + "/", "");

      if (PROTECTED_FILES.has(relativePath)) {
        log(`  PROTECTED: ${relativePath}`);
        continue;
      }

      if (entry.isDirectory()) {
        walkAndDelete(fullPath);
        try {
          const remaining = readdirSync(fullPath);
          if (remaining.length === 0) {
            rmSync(fullPath, { recursive: true });
          }
        } catch {}
      } else if (entry.name.endsWith(".md")) {
        unlinkSync(fullPath);
        count++;
      }
    }
  }

  walkAndDelete(dir);
  log(`  ${label}: deleted ${count} files`);
  return count;
}

function cleanupVault(): number {
  log("Phase 1: Cleaning up vault...");
  let total = 0;

  for (const project of PROJECTS) {
    const sessionsDir = join(VAULT_PATH, "10-Projects", project, "sessions");
    total += deleteFilesInDir(sessionsDir, `${project}/sessions`);
  }

  for (const project of PROJECTS) {
    const mocPath = join(VAULT_PATH, "10-Projects", project, "_MOC.md");
    if (existsSync(mocPath)) {
      unlinkSync(mocPath);
      total++;
      log(`  Deleted MOC: ${project}/_MOC.md`);
    }
  }

  const dailyDir = join(VAULT_PATH, "00-Dashboard", "Daily Notes");
  total += deleteFilesInDir(dailyDir, "Daily Notes");

  const vaultRoot = readdirSync(VAULT_PATH, { withFileTypes: true });
  for (const entry of vaultRoot) {
    if (
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      !["Welcome.md"].includes(entry.name) &&
      (entry.name.match(/^\d{4}-\d{2}-\d{2}/) || entry.name.includes("-raw-log") || entry.name.includes("-summary"))
    ) {
      const fullPath = join(VAULT_PATH, entry.name);
      unlinkSync(fullPath);
      total++;
      log(`  Deleted stray: ${entry.name}`);
    }
  }

  log(`Phase 1 complete: ${total} files deleted.`);
  return total;
}

// --- Phase 2: Reset state ---

function resetState(): void {
  log("Phase 2: Resetting sync state...");

  const stateFiles = ["sync-state.json", "backlinks-state.json"];
  for (const file of stateFiles) {
    const path = join(STATE_DIR, file);
    if (existsSync(path)) {
      unlinkSync(path);
      log(`  Deleted: .sisyphus/${file}`);
    }
  }

  log("Phase 2 complete.");
}

// --- Phase 3: Re-import ---

function runScript(script: string, args: string[], label: string): boolean {
  const cmd = `${BUN} run ${join(PROJECT_ROOT, "sync", script)} ${args.join(" ")}`;
  log(`Phase 3: Running ${label}...`);
  log(`  $ ${cmd}`);

  try {
    execSync(cmd, {
      stdio: "inherit",
      env: { ...process.env },
      cwd: PROJECT_ROOT,
      timeout: 600_000,
    });
    log(`  ${label} completed.`);
    return true;
  } catch (e) {
    err(`${label} failed: ${e}`);
    return false;
  }
}

// --- Main ---

async function main() {
  log("=== Migration v2: Full re-import with new path structure ===");
  log("");

  const obsidianOk = await checkObsidian();
  if (!obsidianOk) {
    err("Obsidian is not available. Ensure Obsidian is running with the Local REST API plugin enabled.");
    process.exit(1);
  }
  log("Obsidian API connected.");
  log("");

  const deleted = cleanupVault();
  log("");

  resetState();
  log("");

  const importOk = runScript("import.ts", ["--all"], "Session import");
  if (!importOk) {
    err("Import failed. Fix errors and re-run.");
    process.exit(1);
  }
  log("");

  const backlinksOk = runScript("backlinks.ts", [], "Backlinks");
  if (!backlinksOk) {
    err("Backlinks failed (non-fatal, can re-run separately).");
  }
  log("");

  const dailiesOk = runScript("daily-notes.ts", ["--generate-dailies"], "Daily notes");
  if (!dailiesOk) {
    err("Daily notes failed (non-fatal, can re-run separately).");
  }
  log("");

  log("=== Migration v2 Summary ===");
  log(`  Files deleted: ${deleted}`);
  log(`  Import:    ${importOk ? "OK" : "FAILED"}`);
  log(`  Backlinks: ${backlinksOk ? "OK" : "FAILED"}`);
  log(`  Dailies:   ${dailiesOk ? "OK" : "FAILED"}`);
  log("=== Done ===");

  if (!importOk) process.exit(1);
}

main().catch((e) => {
  err(`Fatal: ${e}`);
  process.exit(1);
});
