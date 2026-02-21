import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { reconstructConversation } from "../reconstruction";

let storagePath: string;

beforeAll(async () => {
  storagePath = await mkdtemp(join(tmpdir(), "oos-recon-"));

  await mkdir(join(storagePath, "session", "proj_abc"), { recursive: true });
  await writeFile(
    join(storagePath, "session", "proj_abc", "ses_r001.json"),
    JSON.stringify({
      id: "ses_r001",
      slug: "recon-test",
      projectID: "proj_abc",
      title: "Reconstruction Test",
      time: { created: 1700000000000, updated: 1700000001000 },
    }),
  );

  await mkdir(join(storagePath, "project"), { recursive: true });
  await writeFile(
    join(storagePath, "project", "proj_abc.json"),
    JSON.stringify({
      id: "proj_abc",
      worktree: "/home/dev/my-app",
      vcs: "git",
      time: { created: 1699999999000 },
    }),
  );

  await mkdir(join(storagePath, "message", "ses_r001"), { recursive: true });
  await writeFile(
    join(storagePath, "message", "ses_r001", "msg_u1.json"),
    JSON.stringify({
      id: "msg_u1",
      sessionID: "ses_r001",
      role: "user",
      time: { created: 1700000000100 },
    }),
  );
  await writeFile(
    join(storagePath, "message", "ses_r001", "msg_a1.json"),
    JSON.stringify({
      id: "msg_a1",
      sessionID: "ses_r001",
      role: "assistant",
      time: { created: 1700000000200, completed: 1700000000400 },
      modelID: "claude-opus-4-6",
      agent: "build",
      cost: 0.03,
    }),
  );

  await mkdir(join(storagePath, "part", "msg_u1"), { recursive: true });
  await writeFile(
    join(storagePath, "part", "msg_u1", "prt_u1t.json"),
    JSON.stringify({
      id: "prt_u1t",
      sessionID: "ses_r001",
      messageID: "msg_u1",
      type: "text",
      text: "Fix the login bug",
    }),
  );

  await mkdir(join(storagePath, "part", "msg_a1"), { recursive: true });
  await writeFile(
    join(storagePath, "part", "msg_a1", "prt_a1tool.json"),
    JSON.stringify({
      id: "prt_a1tool",
      sessionID: "ses_r001",
      messageID: "msg_a1",
      type: "tool",
      tool: "edit",
      state: {
        status: "completed",
        input: { filePath: "/src/login.ts", oldString: "bug", newString: "fix" },
        output: "File edited successfully",
      },
    }),
  );
  await writeFile(
    join(storagePath, "part", "msg_a1", "prt_a1text.json"),
    JSON.stringify({
      id: "prt_a1text",
      sessionID: "ses_r001",
      messageID: "msg_a1",
      type: "text",
      text: "I fixed the login bug by editing login.ts.",
    }),
  );
});

afterAll(async () => {
  await rm(storagePath, { recursive: true, force: true });
});

describe("reconstructConversation", () => {
  test("reconstructs full conversation with metadata", async () => {
    const conv = await reconstructConversation("ses_r001", "proj_abc", { storagePath });
    expect(conv).not.toBeNull();
    expect(conv!.session.id).toBe("ses_r001");
    expect(conv!.projectName).toBe("my-app");
    expect(conv!.projectPath).toBe("/home/dev/my-app");
    expect(conv!.entries).toHaveLength(2);
  });

  test("entries are sorted by timestamp", async () => {
    const conv = await reconstructConversation("ses_r001", "proj_abc", { storagePath });
    expect(conv!.entries[0].role).toBe("user");
    expect(conv!.entries[1].role).toBe("assistant");
    expect(conv!.entries[0].timestamp).toBeLessThan(conv!.entries[1].timestamp);
  });

  test("user entry has text content", async () => {
    const conv = await reconstructConversation("ses_r001", "proj_abc", { storagePath });
    const userEntry = conv!.entries[0];
    expect(userEntry.textContent).toBe("Fix the login bug");
    expect(userEntry.toolCalls).toHaveLength(0);
  });

  test("assistant entry has text and tool calls", async () => {
    const conv = await reconstructConversation("ses_r001", "proj_abc", { storagePath });
    const asstEntry = conv!.entries[1];
    expect(asstEntry.textContent).toContain("I fixed the login bug");
    expect(asstEntry.toolCalls).toHaveLength(1);
    expect(asstEntry.toolCalls[0].tool).toBe("edit");
    expect(asstEntry.toolCalls[0].output).toBe("File edited successfully");
    expect(asstEntry.model).toBe("claude-opus-4-6");
    expect(asstEntry.cost).toBe(0.03);
  });

  test("returns null for non-existent session", async () => {
    const conv = await reconstructConversation("ses_nope", "proj_abc", { storagePath });
    expect(conv).toBeNull();
  });
});
