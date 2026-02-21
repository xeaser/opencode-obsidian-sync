import { describe, test, expect } from "bun:test";
import { formatForObsidian } from "../formatter";
import { splitIfNeeded } from "../splitter";
import type { ReconstructedConversation } from "../types";

function makeConversation(entryCount: number = 2): ReconstructedConversation {
  const entries = [];
  for (let i = 0; i < entryCount; i++) {
    entries.push({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      messageId: `msg_${i}`,
      timestamp: 1700000000000 + i * 1000,
      textContent: `Message number ${i}`,
      toolCalls:
        i % 2 === 1
          ? [
              {
                tool: "bash",
                input: { command: "echo hello" },
                output: "hello",
                status: "completed",
              },
            ]
          : [],
      model: i % 2 === 1 ? "claude-opus-4-6" : undefined,
      agent: i % 2 === 1 ? "build" : undefined,
      cost: i % 2 === 1 ? 0.01 : undefined,
    });
  }

  return {
    session: {
      id: "ses_fmt001",
      slug: "format-test",
      projectID: "proj_fmt",
      title: "Format Test Session",
      time: { created: 1700000000000, updated: 1700000010000 },
    },
    projectName: "test-project",
    projectPath: "/home/dev/test-project",
    entries,
  };
}

describe("formatForObsidian", () => {
  test("produces valid frontmatter", () => {
    const md = formatForObsidian(makeConversation());
    expect(md).toStartWith("---\n");
    expect(md).toContain("title: Format Test Session");
    expect(md).toContain("session_id: ses_fmt001");
    expect(md).toContain("project: test-project");
    expect(md).toContain("date: 2023-11-14");
    expect(md).toContain("messages: 2");
    expect(md).toContain("tags:");
    expect(md).toContain("  - opencode-session");
    expect(md).toContain("  - project/test-project");
  });

  test("includes header section", () => {
    const md = formatForObsidian(makeConversation());
    expect(md).toContain("# Format Test Session");
    expect(md).toContain("**Project:** test-project");
    expect(md).toContain("**Messages:** 2");
  });

  test("formats user entries", () => {
    const md = formatForObsidian(makeConversation());
    expect(md).toContain("### User (");
    expect(md).toContain("Message number 0");
  });

  test("formats assistant entries with tool calls", () => {
    const md = formatForObsidian(makeConversation());
    expect(md).toContain("### Assistant (");
    expect(md).toContain("claude-opus-4-6");
    expect(md).toContain("**Tool: bash**");
    expect(md).toContain("hello");
    expect(md).toContain("$0.0100");
  });

  test("escapes frontmatter values with special chars", () => {
    const conv = makeConversation();
    conv.session.title = 'Fix: handle "quotes" and #hashes';
    const md = formatForObsidian(conv);
    expect(md).toContain('title: "Fix: handle \\"quotes\\" and #hashes"');
  });

  test("includes parent_session when present", () => {
    const conv = makeConversation();
    conv.session.parentID = "ses_parent001";
    const md = formatForObsidian(conv);
    expect(md).toContain("parent_session: ses_parent001");
  });
});

describe("splitIfNeeded", () => {
  test("returns single result for small conversations", () => {
    const md = formatForObsidian(makeConversation(4));
    const results = splitIfNeeded(md);
    expect(results).toHaveLength(1);
    expect(results[0].partNumber).toBe(1);
    expect(results[0].totalParts).toBe(1);
    expect(results[0].markdown).toBe(md);
  });

  test("splits large conversations", () => {
    const conv = makeConversation(10);
    const md = formatForObsidian(conv);
    const results = splitIfNeeded(md, 3);
    expect(results.length).toBeGreaterThan(1);
    expect(results[0].partNumber).toBe(1);
    expect(results[results.length - 1].totalParts).toBe(results.length);
  });

  test("each split has frontmatter with part info", () => {
    const conv = makeConversation(10);
    const md = formatForObsidian(conv);
    const results = splitIfNeeded(md, 3);

    for (const r of results) {
      expect(r.markdown).toContain(`part: ${r.partNumber}`);
      expect(r.markdown).toContain(`total_parts: ${r.totalParts}`);
    }
  });

  test("handles markdown without frontmatter", () => {
    const md = "# No frontmatter here\nJust content.";
    const results = splitIfNeeded(md);
    expect(results).toHaveLength(1);
    expect(results[0].markdown).toBe(md);
  });
});
