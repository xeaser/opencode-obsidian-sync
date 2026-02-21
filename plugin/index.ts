import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { healthCheck, startProcessor } from "./obsidian";
import { handleEvent, onCompacting, pollForDeletions } from "./hooks";

const OBSIDIAN_URL = process.env.OBSIDIAN_URL || "http://127.0.0.1:27123";
const OBSIDIAN_KEY = process.env.OBSIDIAN_API_KEY || "";

interface SearchResult {
  filename: string;
  score: number;
  matches?: Array<{
    match: { start: number; end: number };
    context: string;
  }>;
}

async function searchSessionLogs(
  query: string,
  project?: string,
  dateFrom?: string,
  dateTo?: string
): Promise<string> {
  try {
    const url = `${OBSIDIAN_URL}/search/simple/`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OBSIDIAN_KEY}`,
        "Content-Type": "text/plain",
      },
      body: query,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return JSON.stringify({
        error: `Obsidian search failed: ${response.statusText}`,
        results: [],
      });
    }

    const results: SearchResult[] = await response.json();

    const filtered = results
      .filter((r) => r.filename.includes("/sessions/"))
      .filter((r) => {
        if (!project) return true;
        return r.filename.includes(`/${project}/`);
      })
      .slice(0, 10)
      .map((r) => {
        const pathParts = r.filename.split("/");
        const projectName = pathParts[pathParts.length - 3] || "unknown";
        const sessionDate = pathParts[pathParts.length - 1]?.replace(".md", "") || "unknown";
        const context = r.matches?.[0]?.context?.substring(0, 500) || "";

        return {
          path: r.filename,
          project: projectName,
          date: sessionDate,
          context,
          score: r.score,
        };
      });

    return JSON.stringify({
      query,
      results: filtered,
      count: filtered.length,
    });
  } catch (error) {
    return JSON.stringify({
      error: `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      results: [],
    });
  }
}

const plugin: Plugin = async (_input) => {
  await healthCheck();

  startProcessor();
  setInterval(() => pollForDeletions().catch(() => {}), 60_000);

  return {
    async event({ event }) {
      handleEvent(event);
    },

    async "experimental.session.compacting"(input, _output) {
      await onCompacting(input.sessionID);
    },

    tool: {
      search_session_logs: tool({
        description: "Search across all session logs stored in Obsidian vault. Filters to session notes and returns matching context snippets.",
        args: {
          query: tool.schema.string().describe("Search query to find in session logs"),
          project: tool.schema.string().optional().describe("Optional project name to filter results"),
          date_from: tool.schema.string().optional().describe("Optional start date filter (ISO 8601 format)"),
          date_to: tool.schema.string().optional().describe("Optional end date filter (ISO 8601 format)"),
        },
        async execute(args) {
          return await searchSessionLogs(args.query, args.project, args.date_from, args.date_to);
        },
      }),
    },
  };
};

export default plugin;
