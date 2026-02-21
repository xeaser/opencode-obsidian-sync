export interface Config {
  storagePath: string;
}

export const DEFAULT_CONFIG: Config = {
  storagePath: `${process.env.HOME}/.local/share/opencode/storage`,
};

export interface Timestamp {
  created: number;
  updated?: number;
  completed?: number;
  initialized?: number;
}

export interface Session {
  id: string;
  slug?: string;
  version?: string;
  projectID: string;
  directory?: string;
  parentID?: string;
  title?: string;
  time: Timestamp;
  permission?: Array<{
    permission: string;
    action: string;
    pattern: string;
  }>;
}

export interface MessageModel {
  providerID: string;
  modelID: string;
}

export interface MessageTokens {
  input: number;
  output: number;
  reasoning: number;
  cache?: {
    read: number;
    write: number;
  };
}

export interface Message {
  id: string;
  sessionID: string;
  role: "user" | "assistant";
  parentID?: string;
  modelID?: string;
  providerID?: string;
  mode?: string | null;
  agent?: string;
  system?: string;
  time: {
    created: number;
    completed?: number;
  };
  path?: {
    cwd: string;
    root: string;
  };
  cost?: number;
  tokens?: MessageTokens;
  variant?: string;
  finish?: string;
  tools?: Record<string, boolean>;
}

export interface TextPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text";
  text: string;
  time?: {
    start: number;
    end: number;
  };
}

export interface ToolPartState {
  status: string;
  input?: Record<string, unknown>;
  output?: string;
  title?: string;
  time?: {
    start?: number;
    end?: number;
    compacted?: number;
  };
  metadata?: Record<string, unknown>;
}

export interface ToolPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "tool";
  callID?: string;
  tool: string;
  state: ToolPartState;
  metadata?: Record<string, unknown>;
}

export interface StepStartPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-start";
  snapshot?: string;
}

export interface StepFinishPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-finish";
  reason?: string;
  snapshot?: string;
  cost?: number;
  tokens?: MessageTokens;
}

export type Part = TextPart | ToolPart | StepStartPart | StepFinishPart;

export interface Project {
  id: string;
  worktree: string;
  vcs?: string;
  sandboxes?: unknown[];
  time: Timestamp;
  icon?: {
    color?: string;
  };
}

export interface ConversationEntry {
  role: "user" | "assistant";
  messageId: string;
  timestamp: number;
  textContent: string;
  toolCalls: Array<{
    tool: string;
    input?: Record<string, unknown>;
    output?: string;
    status?: string;
  }>;
  model?: string;
  agent?: string;
  cost?: number;
}

export interface ReconstructedConversation {
  session: Session;
  projectName: string;
  projectPath: string;
  entries: ConversationEntry[];
}

export interface SplitResult {
  markdown: string;
  partNumber: number;
  totalParts: number;
}
