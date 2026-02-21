import { describe, test, expect } from "bun:test";
import { extractTags } from "../tagger";
import type { ReconstructedConversation, ConversationEntry } from "../types";

function makeConv(
  overrides: Partial<{
    projectName: string;
    entries: Partial<ConversationEntry>[];
    sessionTitle: string;
  }> = {},
): ReconstructedConversation {
  const entries: ConversationEntry[] = (overrides.entries || []).map((e, i) => ({
    role: e.role ?? "user",
    messageId: e.messageId ?? `msg_${i}`,
    timestamp: e.timestamp ?? Date.now(),
    textContent: e.textContent ?? "",
    toolCalls: e.toolCalls ?? [],
    model: e.model,
    agent: e.agent,
    cost: e.cost,
  }));

  return {
    session: {
      id: "ses_test",
      projectID: "proj_test",
      title: overrides.sessionTitle,
      time: { created: Date.now() },
    },
    projectName: overrides.projectName ?? "my-app",
    projectPath: "/home/dev/my-app",
    entries,
  };
}

describe("extractTags", () => {
  test("always includes project tag", () => {
    const conv = makeConv({ projectName: "MyProject" });
    const tags = extractTags(conv);
    expect(tags).toContain("project/myproject");
  });

  test("returns only project tag for empty conversation", () => {
    const conv = makeConv({ projectName: "test-app", entries: [] });
    const tags = extractTags(conv);
    expect(tags).toEqual(["project/test-app"]);
  });

  test("matches topic/authentication keywords", () => {
    const conv = makeConv({
      entries: [{ textContent: "I need to fix the JWT authentication flow and OAuth login" }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("topic/authentication");
  });

  test("matches topic/database keywords", () => {
    const conv = makeConv({
      entries: [{ textContent: "Let me write a SQL migration for the postgres schema" }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("topic/database");
  });

  test("matches topic/testing keywords", () => {
    const conv = makeConv({
      entries: [{ textContent: "Run the vitest suite and check the expect assertions" }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("topic/testing");
  });

  test("matches topic/debugging keywords", () => {
    const conv = makeConv({
      entries: [{ textContent: "There is a bug causing a stack trace error" }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("topic/debugging");
  });

  test("matches topic/api keywords", () => {
    const conv = makeConv({
      entries: [{ textContent: "Create a new REST API endpoint for user profiles" }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("topic/api");
  });

  test("matches tech/typescript from file extensions in tool calls", () => {
    const conv = makeConv({
      entries: [{
        textContent: "Edit the file",
        toolCalls: [{
          tool: "edit",
          input: { filePath: "/src/auth.ts" },
          output: "File edited",
        }],
      }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("tech/typescript");
  });

  test("matches tech/react from hooks", () => {
    const conv = makeConv({
      entries: [{ textContent: "Added useState and useEffect hooks to the React component" }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("tech/react");
  });

  test("matches tech/postgres", () => {
    const conv = makeConv({
      entries: [{ textContent: "Connect to the PostgreSQL database using psql" }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("tech/postgres");
  });

  test("matches tech/docker", () => {
    const conv = makeConv({
      entries: [{ textContent: "Update the Dockerfile and docker-compose configuration" }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("tech/docker");
  });

  test("matches tech/ai keywords", () => {
    const conv = makeConv({
      entries: [{ textContent: "Using the Anthropic Claude API with embeddings for search" }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("tech/ai");
  });

  test("matches activity/bugfix", () => {
    const conv = makeConv({
      entries: [{ textContent: "Fix the broken login issue with a hotfix patch" }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("activity/bugfix");
  });

  test("matches activity/feature", () => {
    const conv = makeConv({
      entries: [{ textContent: "Implement a new feature to create user profiles" }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("activity/feature");
  });

  test("matches activity/exploration", () => {
    const conv = makeConv({
      entries: [{ textContent: "I want to explore and investigate how the caching works" }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("activity/exploration");
  });

  test("matches activity/migration", () => {
    const conv = makeConv({
      entries: [{ textContent: "Migrate the database schema and upgrade the version" }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("activity/migration");
  });

  test("caps at 15 tags maximum", () => {
    const conv = makeConv({
      entries: [{
        textContent: `
          Fix the authentication JWT OAuth login bug. Debug the stack trace error.
          Write SQL migration for postgres database schema.
          Run vitest tests with expect assertions.
          Deploy CI/CD pipeline with github-actions workflow.
          Refactor and rename the extracted function.
          Create new REST API endpoint route.
          Optimize cache performance latency.
          Fix security vulnerability XSS injection.
          Update UI frontend CSS style component layout.
          Configure setup install init scaffold.
          Docker container kubernetes k8s.
          TypeScript React NextJS Vue NodeJS.
          Python Redis AWS GraphQL Tailwind Prisma OpenAI.
        `,
        toolCalls: [
          { tool: "edit", input: { filePath: "/src/app.tsx" } },
        ],
      }],
    });
    const tags = extractTags(conv);
    expect(tags.length).toBeLessThanOrEqual(15);
  });

  test("extracts multiple tag categories from a realistic conversation", () => {
    const conv = makeConv({
      projectName: "web-dashboard",
      entries: [
        {
          role: "user",
          textContent: "Fix the authentication bug in the React login component",
        },
        {
          role: "assistant",
          textContent: "I'll fix the authentication bug in the login component. Let me edit the TypeScript file.",
          toolCalls: [
            { tool: "edit", input: { filePath: "/src/components/Login.tsx", oldString: "bad", newString: "good" }, output: "ok" },
            { tool: "bash", input: { command: "bun test" }, output: "3 tests passed" },
          ],
        },
      ],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("project/web-dashboard");
    expect(tags).toContain("topic/authentication");
    expect(tags).toContain("topic/debugging");
    expect(tags).toContain("tech/typescript");
  });

  test("handles conversation with no project name", () => {
    const conv = makeConv({ projectName: "" });
    conv.entries = [{ role: "user", messageId: "m1", timestamp: 0, textContent: "hello", toolCalls: [] }];
    const tags = extractTags(conv);
    expect(tags.every((t) => !t.startsWith("project/"))).toBe(true);
  });

  test("tool names contribute to search text", () => {
    const conv = makeConv({
      entries: [{
        textContent: "Let me check that",
        toolCalls: [{ tool: "bash", input: { command: "docker-compose up" }, output: "started" }],
      }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("tech/docker");
  });

  test("domain/bifrost from session title", () => {
    const conv = makeConv({
      sessionTitle: "Bifrost deployment fix",
      entries: [{ textContent: "Fixing the deployment pipeline" }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("domain/bifrost");
  });

  test("domain/opencode from session title", () => {
    const conv = makeConv({
      sessionTitle: "Fix opencode plugin",
      entries: [{ textContent: "Updating the plugin hooks" }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("domain/opencode");
  });

  test("domain/neovim from session title with LazyVim", () => {
    const conv = makeConv({
      sessionTitle: "LazyVim keybinding setup",
      entries: [{ textContent: "Configuring keybindings for the editor" }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("domain/neovim");
  });

  test("domain/aws from content with repeated mentions", () => {
    const conv = makeConv({
      sessionTitle: "Infrastructure update",
      entries: [{
        textContent: "Deploy to AWS Lambda. Check the S3 bucket. Update the EC2 instance. Configure AWS CloudFront.",
      }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("domain/aws");
  });

  test("domain tags do not appear for low-count content mentions", () => {
    const conv = makeConv({
      sessionTitle: "General coding session",
      entries: [{ textContent: "I mentioned AWS once" }],
    });
    const tags = extractTags(conv);
    expect(tags).not.toContain("domain/aws");
  });

  test("domain tags appear alongside existing tag categories", () => {
    const conv = makeConv({
      sessionTitle: "Bifrost auth bugfix",
      projectName: "bifrost-app",
      entries: [{
        textContent: "Fix the authentication JWT bug in the TypeScript React component",
      }],
    });
    const tags = extractTags(conv);
    expect(tags).toContain("project/bifrost-app");
    expect(tags).toContain("topic/authentication");
    expect(tags).toContain("activity/bugfix");
    expect(tags).toContain("domain/bifrost");
  });
});
