import type { ReconstructedConversation, ConversationEntry } from "./types";

function formatDate(ts: number): string {
  return new Date(ts).toISOString().split("T")[0];
}

function formatDateTime(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function escapeFrontmatter(value: string): string {
  if (value.includes('"') || value.includes(":") || value.includes("#") || value.includes("\n")) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

function formatToolCall(tc: { tool: string; input?: Record<string, unknown>; output?: string; status?: string }): string {
  const lines: string[] = [];
  lines.push(`> **Tool: ${tc.tool}** (${tc.status ?? "unknown"})`);

  if (tc.input) {
    const inputKeys = Object.keys(tc.input);
    if (inputKeys.length > 0) {
      const summary = inputKeys
        .filter((k) => typeof tc.input![k] === "string" || typeof tc.input![k] === "number")
        .map((k) => {
          const val = String(tc.input![k]);
          return `${k}: ${val.length > 120 ? val.slice(0, 120) + "..." : val}`;
        })
        .join(", ");
      if (summary) {
        lines.push(`> Input: ${summary}`);
      }
    }
  }

  if (tc.output) {
    const trimmed = tc.output.length > 500 ? tc.output.slice(0, 500) + "\n...(truncated)" : tc.output;
    lines.push("> Output:");
    lines.push("> ```");
    for (const line of trimmed.split("\n")) {
      lines.push(`> ${line}`);
    }
    lines.push("> ```");
  }

  return lines.join("\n");
}

function formatEntry(entry: ConversationEntry): string {
  const lines: string[] = [];
  const roleLabel = entry.role === "user" ? "User" : "Assistant";
  const time = formatDateTime(entry.timestamp);
  const meta: string[] = [];
  if (entry.model) meta.push(entry.model);
  if (entry.agent) meta.push(`agent:${entry.agent}`);
  if (entry.cost) meta.push(`$${entry.cost.toFixed(4)}`);

  lines.push(`### ${roleLabel} (${time})${meta.length > 0 ? " - " + meta.join(" | ") : ""}`);
  lines.push("");

  if (entry.textContent.trim()) {
    lines.push(entry.textContent.trim());
    lines.push("");
  }

  if (entry.toolCalls.length > 0) {
    for (const tc of entry.toolCalls) {
      lines.push(formatToolCall(tc));
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

export function formatForObsidian(conversation: ReconstructedConversation): string {
  const lines: string[] = [];

  const created = formatDate(conversation.session.time.created);
  const title = conversation.session.title || conversation.session.slug || conversation.session.id;

  lines.push("---");
  lines.push(`title: ${escapeFrontmatter(title)}`);
  lines.push(`session_id: ${conversation.session.id}`);
  lines.push(`project: ${escapeFrontmatter(conversation.projectName)}`);
  lines.push(`project_path: ${escapeFrontmatter(conversation.projectPath)}`);
  lines.push(`date: ${created}`);
  lines.push(`messages: ${conversation.entries.length}`);
  if (conversation.session.parentID) {
    lines.push(`parent_session: ${conversation.session.parentID}`);
  }
  lines.push("tags:");
  lines.push("  - opencode-session");
  lines.push(`  - project/${conversation.projectName}`);
  lines.push("---");
  lines.push("");

  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`**Project:** ${conversation.projectName} (\`${conversation.projectPath}\`)`);
  lines.push(`**Date:** ${created}`);
  lines.push(`**Messages:** ${conversation.entries.length}`);
  lines.push("");

  for (const entry of conversation.entries) {
    lines.push(formatEntry(entry));
  }

  return lines.join("\n");
}
