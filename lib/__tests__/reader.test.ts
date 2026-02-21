import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSession, readMessages, readParts, readProject, resolveProjectName, listSessions } from "../reader";

let storagePath: string;

const SESSION: any = {
  id: "ses_test001",
  slug: "test-session",
  version: "1.0.0",
  projectID: "proj_abc123",
  directory: "/tmp/test-project",
  title: "Test Session Title",
  time: { created: 1700000000000, updated: 1700000001000 },
};

const MESSAGE_USER: any = {
  id: "msg_user001",
  sessionID: "ses_test001",
  role: "user",
  time: { created: 1700000000100 },
  agent: "build",
};

const MESSAGE_ASSISTANT: any = {
  id: "msg_asst001",
  sessionID: "ses_test001",
  role: "assistant",
  time: { created: 1700000000200, completed: 1700000000300 },
  modelID: "claude-opus-4-6",
  providerID: "anthropic",
  agent: "build",
  cost: 0.05,
};

const PART_TEXT: any = {
  id: "prt_text001",
  sessionID: "ses_test001",
  messageID: "msg_user001",
  type: "text",
  text: "Hello, can you help me?",
  time: { start: 1700000000100, end: 1700000000100 },
};

const PART_TOOL: any = {
  id: "prt_tool001",
  sessionID: "ses_test001",
  messageID: "msg_asst001",
  type: "tool",
  callID: "call_abc",
  tool: "bash",
  state: {
    status: "completed",
    input: { command: "ls -la" },
    output: "total 0\ndrwxr-xr-x  2 user  staff  64 Jan  1 00:00 .",
    time: { start: 1700000000250, end: 1700000000260 },
  },
};

const PART_TEXT_ASST: any = {
  id: "prt_text002",
  sessionID: "ses_test001",
  messageID: "msg_asst001",
  type: "text",
  text: "Here is the directory listing.",
  time: { start: 1700000000270, end: 1700000000270 },
};

const PROJECT: any = {
  id: "proj_abc123",
  worktree: "/Users/test/projects/my-cool-project",
  vcs: "git",
  time: { created: 1699999999000, updated: 1700000001000 },
};

beforeAll(async () => {
  storagePath = await mkdtemp(join(tmpdir(), "oos-test-"));

  await mkdir(join(storagePath, "session", "proj_abc123"), { recursive: true });
  await writeFile(
    join(storagePath, "session", "proj_abc123", "ses_test001.json"),
    JSON.stringify(SESSION),
  );

  await mkdir(join(storagePath, "message", "ses_test001"), { recursive: true });
  await writeFile(
    join(storagePath, "message", "ses_test001", "msg_user001.json"),
    JSON.stringify(MESSAGE_USER),
  );
  await writeFile(
    join(storagePath, "message", "ses_test001", "msg_asst001.json"),
    JSON.stringify(MESSAGE_ASSISTANT),
  );

  await mkdir(join(storagePath, "part", "msg_user001"), { recursive: true });
  await writeFile(
    join(storagePath, "part", "msg_user001", "prt_text001.json"),
    JSON.stringify(PART_TEXT),
  );

  await mkdir(join(storagePath, "part", "msg_asst001"), { recursive: true });
  await writeFile(
    join(storagePath, "part", "msg_asst001", "prt_tool001.json"),
    JSON.stringify(PART_TOOL),
  );
  await writeFile(
    join(storagePath, "part", "msg_asst001", "prt_text002.json"),
    JSON.stringify(PART_TEXT_ASST),
  );

  await mkdir(join(storagePath, "project"), { recursive: true });
  await writeFile(
    join(storagePath, "project", "proj_abc123.json"),
    JSON.stringify(PROJECT),
  );
});

afterAll(async () => {
  await rm(storagePath, { recursive: true, force: true });
});

describe("readSession", () => {
  test("reads a session file", async () => {
    const session = await readSession("ses_test001", "proj_abc123", { storagePath });
    expect(session).not.toBeNull();
    expect(session!.id).toBe("ses_test001");
    expect(session!.title).toBe("Test Session Title");
    expect(session!.projectID).toBe("proj_abc123");
    expect(session!.time.created).toBe(1700000000000);
  });

  test("returns null for non-existent session", async () => {
    const session = await readSession("ses_nonexistent", "proj_abc123", { storagePath });
    expect(session).toBeNull();
  });
});

describe("readMessages", () => {
  test("reads and sorts messages by time", async () => {
    const messages = await readMessages("ses_test001", { storagePath });
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe("msg_user001");
    expect(messages[1].id).toBe("msg_asst001");
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
  });

  test("returns empty array for non-existent session", async () => {
    const messages = await readMessages("ses_nonexistent", { storagePath });
    expect(messages).toHaveLength(0);
  });
});

describe("readParts", () => {
  test("reads text parts for user message", async () => {
    const parts = await readParts("msg_user001", { storagePath });
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("text");
    expect((parts[0] as any).text).toBe("Hello, can you help me?");
  });

  test("reads tool and text parts for assistant message", async () => {
    const parts = await readParts("msg_asst001", { storagePath });
    expect(parts).toHaveLength(2);
    const types = parts.map((p) => p.type).sort();
    expect(types).toEqual(["text", "tool"]);

    const toolPart = parts.find((p) => p.type === "tool") as any;
    expect(toolPart.tool).toBe("bash");
    expect(toolPart.state.output).toContain("drwxr-xr-x");
  });

  test("returns empty array for non-existent message", async () => {
    const parts = await readParts("msg_nonexistent", { storagePath });
    expect(parts).toHaveLength(0);
  });
});

describe("readProject", () => {
  test("reads project file", async () => {
    const project = await readProject("proj_abc123", { storagePath });
    expect(project).not.toBeNull();
    expect(project!.worktree).toBe("/Users/test/projects/my-cool-project");
  });
});

describe("resolveProjectName", () => {
  test("extracts basename from project worktree", async () => {
    const name = await resolveProjectName("proj_abc123", { storagePath });
    expect(name).toBe("my-cool-project");
  });

  test("returns projectId for non-existent project", async () => {
    const name = await resolveProjectName("proj_nonexistent", { storagePath });
    expect(name).toBe("proj_nonexistent");
  });
});

describe("listSessions", () => {
  test("lists all sessions", async () => {
    const sessions = await listSessions({ storagePath });
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions[0].id).toBe("ses_test001");
  });

  test("lists sessions filtered by project", async () => {
    const sessions = await listSessions({ storagePath }, "proj_abc123");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("ses_test001");
  });

  test("returns empty for non-existent project filter", async () => {
    const sessions = await listSessions({ storagePath }, "proj_nonexistent");
    expect(sessions).toHaveLength(0);
  });
});
