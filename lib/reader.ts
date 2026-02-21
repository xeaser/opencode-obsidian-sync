import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { Config, Session, Message, Part, Project } from "./types";

function cfg(config?: Partial<Config>): Config {
  return {
    storagePath: config?.storagePath ?? `${process.env.HOME}/.local/share/opencode/storage`,
  };
}

async function readJson<T>(path: string): Promise<T> {
  const text = await readFile(path, "utf-8");
  return JSON.parse(text) as T;
}

async function readJsonSafe<T>(path: string): Promise<T | null> {
  try {
    return await readJson<T>(path);
  } catch {
    return null;
  }
}

async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((e) => e.endsWith(".json")).map((e) => join(dir, e));
  } catch {
    return [];
  }
}

export async function readSession(
  sessionId: string,
  projectId: string,
  config?: Partial<Config>,
): Promise<Session | null> {
  const c = cfg(config);
  const path = join(c.storagePath, "session", projectId, `${sessionId}.json`);
  return readJsonSafe<Session>(path);
}

export async function readMessages(
  sessionId: string,
  config?: Partial<Config>,
): Promise<Message[]> {
  const c = cfg(config);
  const dir = join(c.storagePath, "message", sessionId);
  const files = await listJsonFiles(dir);
  const messages = await Promise.all(files.map((f) => readJson<Message>(f)));
  return messages.sort((a, b) => a.time.created - b.time.created);
}

export async function readParts(
  messageId: string,
  config?: Partial<Config>,
): Promise<Part[]> {
  const c = cfg(config);
  const dir = join(c.storagePath, "part", messageId);
  const files = await listJsonFiles(dir);
  const parts = await Promise.all(files.map((f) => readJson<Part>(f)));
  return parts.sort((a, b) => a.id.localeCompare(b.id));
}

export async function readProject(
  projectId: string,
  config?: Partial<Config>,
): Promise<Project | null> {
  const c = cfg(config);
  const path = join(c.storagePath, "project", `${projectId}.json`);
  return readJsonSafe<Project>(path);
}

export async function resolveProjectName(
  projectId: string,
  config?: Partial<Config>,
): Promise<string> {
  const project = await readProject(projectId, config);
  if (!project) return projectId;
  return basename(project.worktree) || projectId;
}

export async function listSessions(
  config?: Partial<Config>,
  projectId?: string,
): Promise<Session[]> {
  const c = cfg(config);
  const sessionRoot = join(c.storagePath, "session");

  let projectDirs: string[];
  if (projectId) {
    projectDirs = [projectId];
  } else {
    try {
      projectDirs = await readdir(sessionRoot);
    } catch {
      return [];
    }
  }

  const sessions: Session[] = [];
  for (const projDir of projectDirs) {
    const dir = join(sessionRoot, projDir);
    const files = await listJsonFiles(dir);
    for (const file of files) {
      const session = await readJsonSafe<Session>(file);
      if (session) sessions.push(session);
    }
  }

  return sessions.sort((a, b) => b.time.created - a.time.created);
}
