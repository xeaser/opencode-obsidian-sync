/**
 * TDD tests for plugin/hooks.ts bug fixes.
 *
 * Expected test results BEFORE fixes:
 *   - pollForDeletions tests       → FAIL (currently trashes on first null)
 *   - console output tests         → FAIL (console.log/warn/error present)
 *   - onSessionCreated tests       → PASS (existing behavior is correct)
 *   - rename handling tests        → PASS (existing behavior is correct)
 *
 * After fixes, ALL tests should PASS.
 */
import { describe, test, expect, beforeEach, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Mocks — must be set up BEFORE importing hooks
// ---------------------------------------------------------------------------

const mockEnqueue = mock(() => Promise.resolve());
const mockObsidianGet = mock(() => Promise.resolve(null as string | null));
const mockReadSession = mock(() => Promise.resolve(null as any));
const mockReadMessages = mock(() => Promise.resolve([] as any[]));
const mockReconstructConversation = mock(() => Promise.resolve(null as any));
const mockResolveProjectName = mock(() => Promise.resolve("test-project"));
const mockFormatForObsidian = mock(() => "# Formatted\nContent here");
const mockSplitIfNeeded = mock(() => [{ markdown: "# Part\nContent" }]);
const mockExtractTags = mock(() => [] as string[]);

mock.module("../queue", () => ({
  enqueue: mockEnqueue,
}));

mock.module("../obsidian", () => ({
  obsidianGet: mockObsidianGet,
}));

mock.module("../../lib", () => ({
  reconstructConversation: mockReconstructConversation,
  formatForObsidian: mockFormatForObsidian,
  resolveProjectName: mockResolveProjectName,
  readMessages: mockReadMessages,
  readSession: mockReadSession,
  splitIfNeeded: mockSplitIfNeeded,
  extractTags: mockExtractTags,
}));

// Import hooks AFTER mocks are wired
import {
  pollForDeletions,
  onSessionCreated,
  onSessionUpdated,
  onSessionIdle,
  handleEvent,
  _resetForTesting,
} from "../hooks";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSessionInfo(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? "ses_default",
    projectID: overrides.projectID ?? "proj_abc",
    title: overrides.title ?? "Test Session Title",
    directory: overrides.directory ?? "/tmp/test-project",
    time: overrides.time ?? { created: Date.now() },
  };
}

function resetAllMocks() {
  mockEnqueue.mockClear();
  mockObsidianGet.mockClear();
  mockReadSession.mockClear();
  mockReadMessages.mockClear();
  mockReconstructConversation.mockClear();
  mockResolveProjectName.mockClear();
  mockFormatForObsidian.mockClear();
  mockSplitIfNeeded.mockClear();
  mockExtractTags.mockClear();

  mockResolveProjectName.mockImplementation(() => Promise.resolve("test-project"));
  mockReadSession.mockImplementation(() => Promise.resolve(null));
  mockReadMessages.mockImplementation(() => Promise.resolve([]));
  mockEnqueue.mockImplementation(() => Promise.resolve());
  mockObsidianGet.mockImplementation(() => Promise.resolve(null));
  mockReconstructConversation.mockImplementation(() => Promise.resolve(null));
}

/** Count enqueue calls matching a specific operation and optional path substring. */
function countEnqueueCalls(op: "create" | "update" | "delete", pathSubstring?: string): number {
  return mockEnqueue.mock.calls.filter((call: any[]) => {
    if (call[0] !== op) return false;
    if (pathSubstring && !String(call[1]).includes(pathSubstring)) return false;
    return true;
  }).length;
}

/** Get all enqueue calls as [op, path, content] tuples. */
function getEnqueueCalls(): Array<[string, string, string]> {
  return mockEnqueue.mock.calls.map((c: any[]) => [c[0], c[1], c[2]]);
}

// ===========================================================================
// pollForDeletions — consecutive failure counting
// ===========================================================================

describe("pollForDeletions", () => {
  beforeEach(() => {
    _resetForTesting();
    resetAllMocks();
  });

  test("should NOT trash a session on first readSession failure", async () => {
    await onSessionCreated(makeSessionInfo({ id: "ses_poll_1" }));
    resetAllMocks();

    mockReadSession.mockImplementation(() => Promise.resolve(null));
    await pollForDeletions();

    // obsidianGet is ONLY called from moveToTrash — zero calls means no trashing
    expect(mockObsidianGet.mock.calls.length).toBe(0);
  });

  test("should NOT trash a session after 2 consecutive failures", async () => {
    await onSessionCreated(makeSessionInfo({ id: "ses_poll_2" }));
    resetAllMocks();

    mockReadSession.mockImplementation(() => Promise.resolve(null));
    await pollForDeletions();
    await pollForDeletions();

    expect(mockObsidianGet.mock.calls.length).toBe(0);
  });

  test("should trash a session after 3 consecutive failures", async () => {
    await onSessionCreated(makeSessionInfo({ id: "ses_poll_3" }));
    resetAllMocks();

    mockReadSession.mockImplementation(() => Promise.resolve(null));
    mockObsidianGet.mockImplementation(() => Promise.resolve("---\nsummary content\n---"));

    await pollForDeletions();
    await pollForDeletions();
    await pollForDeletions();

    expect(countEnqueueCalls("create", "/trash/")).toBeGreaterThan(0);
  });

  test("should reset failure counter when readSession succeeds", async () => {
    const validSession = { id: "ses_poll_4", title: "Test", time: { created: Date.now() } };
    await onSessionCreated(makeSessionInfo({ id: "ses_poll_4" }));
    resetAllMocks();

    // 2 failures
    mockReadSession.mockImplementation(() => Promise.resolve(null));
    await pollForDeletions();
    await pollForDeletions();

    // 1 success → resets counter
    mockReadSession.mockImplementation(() => Promise.resolve(validSession));
    await pollForDeletions();

    // 2 more failures (consecutive count = 2, not 4)
    mockReadSession.mockImplementation(() => Promise.resolve(null));
    await pollForDeletions();
    await pollForDeletions();

    expect(mockObsidianGet.mock.calls.length).toBe(0);
  });

  test("should still track session after transient failure (not remove from internal map)", async () => {
    await onSessionCreated(makeSessionInfo({ id: "ses_poll_5" }));
    resetAllMocks();

    // One failed poll
    mockReadSession.mockImplementation(() => Promise.resolve(null));
    await pollForDeletions();

    // Session should still be tracked: onSessionUpdated should process it
    mockReconstructConversation.mockImplementation(() =>
      Promise.resolve({
        session: { id: "ses_poll_5", title: "Test", time: { created: Date.now() } },
        projectName: "test-project",
        projectPath: "/tmp/test",
        entries: [],
      }),
    );

    await onSessionUpdated({
      id: "ses_poll_5",
      projectID: "proj_abc",
      title: "Test",
      time: { created: Date.now(), updated: Date.now() },
    });

    // reconstructConversation being called proves the session is still tracked
    expect(mockReconstructConversation.mock.calls.length).toBeGreaterThan(0);
  });

  test("should handle empty sessions map gracefully", async () => {
    _resetForTesting();
    await pollForDeletions();
    expect(mockReadSession.mock.calls.length).toBe(0);
  });
});

// ===========================================================================
// Console output — TUI overlap prevention
// ===========================================================================

describe("console output (TUI overlap prevention)", () => {
  test("hooks.ts should not contain console.log calls", async () => {
    const content = await Bun.file(import.meta.dir + "/../hooks.ts").text();
    const matches = content.match(/console\.log\(/g);
    expect(matches).toBeNull();
  });

  test("hooks.ts should not contain console.warn calls", async () => {
    const content = await Bun.file(import.meta.dir + "/../hooks.ts").text();
    const matches = content.match(/console\.warn\(/g);
    expect(matches).toBeNull();
  });

  test("hooks.ts should not contain console.error calls", async () => {
    const content = await Bun.file(import.meta.dir + "/../hooks.ts").text();
    const matches = content.match(/console\.error\(/g);
    expect(matches).toBeNull();
  });

  test("index.ts should not contain console.log calls", async () => {
    const content = await Bun.file(import.meta.dir + "/../index.ts").text();
    const matches = content.match(/console\.log\(/g);
    expect(matches).toBeNull();
  });

  test("index.ts should not contain console.warn calls", async () => {
    const content = await Bun.file(import.meta.dir + "/../index.ts").text();
    const matches = content.match(/console\.warn\(/g);
    expect(matches).toBeNull();
  });

  test("obsidian.ts should not contain console.error calls", async () => {
    const content = await Bun.file(import.meta.dir + "/../obsidian.ts").text();
    const matches = content.match(/console\.error\(/g);
    expect(matches).toBeNull();
  });

  test("queue.ts should not contain console calls", async () => {
    const content = await Bun.file(import.meta.dir + "/../queue.ts").text();
    const matches = content.match(/console\.(log|warn|error)\(/g);
    expect(matches).toBeNull();
  });
});

// ===========================================================================
// onSessionCreated — skeleton creation and slug naming
// ===========================================================================

describe("onSessionCreated", () => {
  beforeEach(() => {
    _resetForTesting();
    resetAllMocks();
  });

  test("should enqueue a skeleton summary note", async () => {
    await onSessionCreated(makeSessionInfo({ id: "ses_create_1", title: "My Test Session" }));

    expect(countEnqueueCalls("create")).toBe(1);

    const calls = getEnqueueCalls().filter(([op]) => op === "create");
    const [, path, content] = calls[0];
    expect(path).toContain("/sessions/");
    expect(path).toContain("summary.md");
    expect(content).toContain("session_id: ses_create_1");
    expect(content).toContain("message_count: 0");
    expect(content).toContain("status: active");
  });

  test("should use title-derived slug in note path (not session ID)", async () => {
    await onSessionCreated(
      makeSessionInfo({
        id: "ses_create_2",
        title: "Fix authentication bug in login flow",
      }),
    );

    const calls = getEnqueueCalls().filter(([op]) => op === "create");
    const [, path] = calls[0];
    expect(path).not.toContain("ses_create_2");
    expect(path).toContain("fix-authentication-bug-login-flow");
  });

  test("should fall back to session ID prefix when title is empty", async () => {
    await onSessionCreated(makeSessionInfo({ id: "ses_create_3_abcdef", title: "" }));

    const calls = getEnqueueCalls().filter(([op]) => op === "create");
    const [, path] = calls[0];
    // sessionSlug splits on underscores: "ses_create_3" → "ses-create-3"
    expect(path).toContain("ses-create-3");
  });

  test("should include project name in path", async () => {
    mockResolveProjectName.mockImplementation(() => Promise.resolve("my-cool-project"));

    await onSessionCreated(makeSessionInfo({ id: "ses_create_4", title: "Some Session" }));

    const calls = getEnqueueCalls().filter(([op]) => op === "create");
    const [, path] = calls[0];
    expect(path).toContain("10-Projects/my-cool-project/sessions/");
  });

  test("should include date-based directory in path", async () => {
    const created = new Date("2026-02-15T10:00:00Z").getTime();
    await onSessionCreated(
      makeSessionInfo({
        id: "ses_create_5",
        title: "Date Test",
        time: { created },
      }),
    );

    const calls = getEnqueueCalls().filter(([op]) => op === "create");
    const [, path] = calls[0];
    expect(path).toContain("2026-02/15-");
  });
});

// ===========================================================================
// Session rename handling (via onSessionUpdated)
// ===========================================================================

describe("session rename handling (via onSessionUpdated)", () => {
  beforeEach(() => {
    _resetForTesting();
    resetAllMocks();
  });

  test("should delete old notes and create new summary when slug changes", async () => {
    await onSessionCreated(makeSessionInfo({ id: "ses_rename_1", title: "Initial Title" }));
    resetAllMocks();

    mockReconstructConversation.mockImplementation(() =>
      Promise.resolve({
        session: {
          id: "ses_rename_1",
          title: "Completely Different Title",
          time: { created: Date.now() },
        },
        projectName: "test-project",
        projectPath: "/tmp/test",
        entries: [],
      }),
    );

    await onSessionUpdated({
      id: "ses_rename_1",
      projectID: "proj_abc",
      title: "Completely Different Title",
      time: { created: Date.now(), updated: Date.now() },
    });

    const deleteCalls = getEnqueueCalls().filter(([op]) => op === "delete");
    expect(deleteCalls.length).toBeGreaterThan(0);

    const updateCalls = getEnqueueCalls().filter(([op]) => op === "update");
    expect(updateCalls.length).toBeGreaterThan(0);

    const newSummaryPath = updateCalls[updateCalls.length - 1][1];
    expect(newSummaryPath).toContain("completely-different-title");
  });

  test("should NOT delete when title change produces identical slug", async () => {
    await onSessionCreated(makeSessionInfo({ id: "ses_rename_2", title: "cool title" }));
    resetAllMocks();

    mockReconstructConversation.mockImplementation(() =>
      Promise.resolve({
        session: {
          id: "ses_rename_2",
          title: "Cool Title",
          time: { created: Date.now() },
        },
        projectName: "test-project",
        projectPath: "/tmp/test",
        entries: [],
      }),
    );

    await onSessionUpdated({
      id: "ses_rename_2",
      projectID: "proj_abc",
      title: "Cool Title",
      time: { created: Date.now(), updated: Date.now() },
    });

    expect(countEnqueueCalls("delete")).toBe(0);
  });

  test("should handle title with special characters in slug", async () => {
    await onSessionCreated(
      makeSessionInfo({
        id: "ses_rename_3",
        title: 'Fix: "auth" [bug] in #login',
      }),
    );

    const calls = getEnqueueCalls().filter(([op]) => op === "create");
    const [, path] = calls[0];
    // Extract the slug portion from the path (e.g., "21-fix-auth-bug-login" from full path)
    const slugMatch = path.match(/\d{2}-([^/]+)\/summary\.md$/);
    expect(slugMatch).not.toBeNull();
    const slug = slugMatch![1];
    expect(slug).not.toMatch(/[<>:"/\\|?*#^\[\]]/);
    expect(slug).toContain("fix-auth-bug-login");
  });
});

// ===========================================================================
// onSessionUpdated — full summary update
// ===========================================================================

describe("onSessionUpdated", () => {
  beforeEach(() => {
    _resetForTesting();
    resetAllMocks();
  });

  test("should update summary with conversation data", async () => {
    const created = Date.now();
    await onSessionCreated(makeSessionInfo({ id: "ses_update_1", title: "Test", time: { created } }));
    resetAllMocks();

    mockReconstructConversation.mockImplementation(() =>
      Promise.resolve({
        session: {
          id: "ses_update_1",
          title: "Test",
          time: { created, updated: created + 60_000 },
        },
        projectName: "test-project",
        projectPath: "/tmp/test",
        entries: [
          { role: "user", content: "Hello", agent: "user", model: null },
          { role: "assistant", content: "Hi!", agent: "atlas", model: "claude-opus", cost: 0.05 },
        ],
      }),
    );
    mockReadMessages.mockImplementation(() =>
      Promise.resolve([
        { tokens: { input: 100, output: 200 } },
        { tokens: { input: 150, output: 300 } },
      ]),
    );

    await onSessionUpdated({
      id: "ses_update_1",
      projectID: "proj_abc",
      title: "Test",
      time: { created, updated: created + 60_000 },
    });

    const updateCalls = getEnqueueCalls().filter(([op]) => op === "update");
    expect(updateCalls.length).toBeGreaterThan(0);

    const [, , content] = updateCalls[updateCalls.length - 1];
    expect(content).toContain("message_count: 2");
    expect(content).toContain("total_tokens: 750");
  });

  test("should not process unknown session", async () => {
    await onSessionUpdated({
      id: "ses_unknown",
      projectID: "proj_abc",
      title: "Unknown",
      time: { created: Date.now(), updated: Date.now() },
    });

    expect(mockReconstructConversation.mock.calls.length).toBe(0);
  });
});

// ===========================================================================
// onSessionIdle — raw log sync
// ===========================================================================

describe("onSessionIdle", () => {
  beforeEach(() => {
    _resetForTesting();
    resetAllMocks();
  });

  test("should sync raw log on idle when conversation has entries", async () => {
    const created = Date.now();
    await onSessionCreated(makeSessionInfo({ id: "ses_idle_1", title: "Idle Test", time: { created } }));
    resetAllMocks();

    mockReconstructConversation.mockImplementation(() =>
      Promise.resolve({
        session: {
          id: "ses_idle_1",
          title: "Idle Test",
          time: { created },
        },
        projectName: "test-project",
        projectPath: "/tmp/test",
        entries: [{ role: "user", content: "test message" }],
      }),
    );
    mockFormatForObsidian.mockImplementation(() => "---\ntags: []\n---\n# Log\nUser: test");
    mockSplitIfNeeded.mockImplementation(() => [{ markdown: "---\ntags: []\n---\n# Log\nUser: test" }]);

    // Also mock readSession for the rename check inside onSessionIdle
    mockReadSession.mockImplementation(() =>
      Promise.resolve({ id: "ses_idle_1", title: "Idle Test", time: { created } }),
    );

    await onSessionIdle("ses_idle_1");

    const updateCalls = getEnqueueCalls().filter(([op]) => op === "update");
    const rawLogCalls = updateCalls.filter(([, path]) => path.includes("raw-log"));
    expect(rawLogCalls.length).toBeGreaterThan(0);
  });

  test("should not sync for unknown session", async () => {
    await onSessionIdle("ses_nonexistent");
    expect(mockReconstructConversation.mock.calls.length).toBe(0);
  });
});
