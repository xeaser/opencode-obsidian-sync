import type { Config, ConversationEntry, ReconstructedConversation, TextPart, ToolPart, Part } from "./types";
import { readSession, readMessages, readParts, readProject, resolveProjectName } from "./reader";

export async function reconstructConversation(
  sessionId: string,
  projectId: string,
  config?: Partial<Config>,
): Promise<ReconstructedConversation | null> {
  const session = await readSession(sessionId, projectId, config);
  if (!session) return null;

  const project = await readProject(projectId, config);
  const projectName = project ? (project.worktree.split("/").pop() || projectId) : projectId;
  const projectPath = project?.worktree ?? "";

  const messages = await readMessages(sessionId, config);
  const entries: ConversationEntry[] = [];

  for (const msg of messages) {
    const parts = await readParts(msg.id, config);

    const textParts = parts.filter((p): p is TextPart => p.type === "text");
    const toolParts = parts.filter((p): p is ToolPart => p.type === "tool");

    const textContent = textParts.map((p) => p.text).join("\n\n");

    const toolCalls = toolParts.map((tp) => ({
      tool: tp.tool,
      input: tp.state.input,
      output: tp.state.output,
      status: tp.state.status,
    }));

    entries.push({
      role: msg.role,
      messageId: msg.id,
      timestamp: msg.time.created,
      textContent,
      toolCalls,
      model: msg.modelID,
      agent: msg.agent,
      cost: msg.cost,
    });
  }

  return {
    session,
    projectName,
    projectPath,
    entries,
  };
}
