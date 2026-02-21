# opencode-obsidian-sync

Sync [OpenCode](https://github.com/sst/opencode) AI coding sessions into an [Obsidian](https://obsidian.md) vault as structured, searchable Markdown notes. Supports historical bulk import and real-time sync via an oh-my-opencode plugin.

OpenCode stores session data (messages, tool calls, metadata) in a local JSON-based store. This project extracts that data, formats it as Markdown with YAML frontmatter, and writes it to an Obsidian vault via the [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin. The result is a fully navigable knowledge base of every AI coding session, complete with Dataview dashboards, cross-session backlinks, auto-tagging, and full-text search.

## Architecture

The project is a Bun workspace with three packages:

```
opencode-obsidian-sync/
  lib/       Core extraction & formatting library (zero external deps)
  sync/      One-shot CLI scripts for historical import, backlinks, daily notes
  plugin/    oh-my-opencode plugin for real-time sync + search tool
```

### Data Flow

```
OpenCode Storage                    Obsidian Vault
~/.local/share/opencode/storage/    /your-vault/
  session/{projectId}/*.json   -->    10-Projects/{project}/sessions/{YYYY-MM}/{DD}-{slug}/
  message/{sessionId}/*.json   -->      summary.md      (metadata + formatted conversation)
  part/{messageId}/*.json      -->      raw-log.md       (full transcript, may be split)
  project/*.json               -->    00-Dashboard/
                                        Session Dashboard.md
                                        Daily Notes/*.md
```

### Packages

**`lib/`** -- Session extraction library. Reads OpenCode's storage, reconstructs conversations from messages and parts, formats Markdown with YAML frontmatter, auto-tags based on content, and splits large sessions into numbered parts. No external dependencies (only `node:fs`, `node:path`).

**`sync/`** -- One-shot CLI scripts for batch operations:
- `import.ts` -- Bulk import all sessions to Obsidian (with state tracking and resume support)
- `backlinks.ts` -- Apply bidirectional parent/child session wikilinks
- `daily-notes.ts` -- Generate daily summary notes with Dataview queries

**`plugin/`** -- oh-my-opencode plugin that hooks into OpenCode's event system for real-time sync. Creates/updates session notes as you work, queues writes when Obsidian is offline, and exposes a `search_session_logs` tool for AI agents.

## Prerequisites

- [Bun](https://bun.sh) v1.0+ runtime
- [OpenCode](https://github.com/sst/opencode) with [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) plugin system (for real-time sync)
- [Obsidian](https://obsidian.md) with:
  - [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) community plugin (required)
  - [Dataview](https://github.com/blacksmithgu/obsidian-dataview) community plugin (for dashboard queries)

## Installation

```bash
git clone https://github.com/xeaser/opencode-obsidian-sync.git
cd opencode-obsidian-sync
bun install
```

This installs all three workspace packages (`lib`, `sync`, `plugin`) in one step.

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OBSIDIAN_API_KEY` | *(required)* | Bearer token from the Local REST API plugin settings |
| `OBSIDIAN_URL` | `http://127.0.0.1:27123` | Obsidian REST API base URL |

Set these in your shell profile or in your OpenCode environment config.

### Obsidian Local REST API Setup

1. Open Obsidian Settings > Community Plugins > Browse
2. Search for "Local REST API" and install it
3. Enable the plugin
4. Copy the API key from the plugin settings
5. Export it: `export OBSIDIAN_API_KEY="your-key-here"`

### OpenCode Storage Location

The library reads from `~/.local/share/opencode/storage/` by default. This is OpenCode's standard local storage path containing:

```
storage/
  session/{projectId}/{sessionId}.json    Session metadata (title, time, project)
  message/{sessionId}/{messageId}.json    Individual messages (role, cost, tokens)
  part/{messageId}/{partId}.json          Message parts (text content, tool calls)
  project/{projectId}.json                Project info (directory, VCS)
```

## Vault Structure

After import, your Obsidian vault will have this structure:

```
Vault/
  00-Dashboard/
    Session Dashboard.md          Dataview queries: recent sessions, by project, cost
    Daily Notes/
      2026-02-14.md               Session links grouped by project for that day
  10-Projects/
    my-project/
      _MOC.md                     Map of Content with Dataview session index
      sessions/
        2026-02/
          14-fix-auth-bug-login/
            summary.md            Session metadata + formatted conversation
            raw-log.md            Full transcript (or raw-log-part-1.md, etc.)
          15-add-user-dashboard/
            summary.md
            raw-log.md
      trash/                      Deleted sessions (moved here, not permanently deleted)
  90-Templates/
    Session Summary.md
    Session Raw Log.md
    Daily Note.md
    Project MOC.md
```

### Session Note Frontmatter

Every `summary.md` includes YAML frontmatter for Dataview queries:

```yaml
---
aliases: []
tags: [type/session-log, type/summary, topic/auth, tech/typescript, activity/bugfix]
created: 2026-02-14
session_id: ses_abc123
project: my-project
project_path: /path/to/my-project
branch: feature/auth
status: completed
agents: [atlas, sisyphus-junior]
models: [claude-sonnet-4-20250514]
message_count: 24
total_cost: 0.1250
total_tokens: 45000
duration: 12m 30s
files_changed: 5
parent_session: ""
child_sessions: []
---
```

### Auto-Tagging

Sessions are automatically tagged based on conversation content:

| Category | Examples |
|---|---|
| `topic/*` | auth, database, testing, ci-cd, refactoring, debugging, api, security, ui |
| `tech/*` | typescript, python, react, nextjs, bun, postgres, docker, aws, kubernetes |
| `activity/*` | bugfix, feature, exploration, review, setup, migration |
| `domain/*` | opencode, obsidian, bifrost, neovim, aws (project-specific patterns) |

Tags are derived by regex matching against the concatenated conversation text and tool call inputs/outputs. Maximum 15 tags per session.

## Usage

### 1. Historical Import

Import all existing OpenCode sessions into your vault:

```bash
bun run sync/import.ts --all                  # Import all sessions
bun run sync/import.ts --all --resume         # Resume if interrupted
bun run sync/backlinks.ts                     # Apply parent-child wikilinks
bun run sync/daily-notes.ts --generate-dailies  # Generate daily summaries
```

The import script:
- Processes sessions with concurrency of 3
- Tracks state in `sync/.sync-state.json` for resume support
- Skips sessions with 0 messages
- Derives note folder names from session titles (not random slugs)
- Splits sessions exceeding 300 messages into numbered parts

### 2. Real-Time Sync (oh-my-opencode Plugin)

**Install via npm** (recommended):

Add to the `plugin` array in `~/.config/opencode/opencode.json`:

```jsonc
{
  "plugin": [
    "oh-my-opencode@latest",
    "@xeaser/opencode-obsidian-sync"
    // ... other plugins
  ]
}
```

OpenCode auto-installs npm plugins at startup. No cloning or local paths needed.

**Or use a local path** (for development):

```jsonc
{
  "plugin": [
    "/path/to/opencode-obsidian-sync/plugin"
  ]
}
```

The plugin hooks into OpenCode's event lifecycle:

| Event | Action |
|---|---|
| `session.created` | Creates skeleton summary note |
| `session.updated` | Updates summary with full conversation, handles title renames |
| Session idle (30s) | Syncs raw log transcript |
| `session.compacting` | Final raw log sync before compaction |
| Poll (60s) | Detects deleted sessions, moves to `trash/` after 3 consecutive failures |

#### Deletion Protection

The plugin uses a 3-strike system before trashing any session. If reading a session from OpenCode storage fails (transient IO, file being written, or session cleaned up), the failure count increments. Only after 3 consecutive failures is the session moved to `trash/`. The counter resets on any successful read.

#### Offline Queue

When Obsidian is unreachable, writes are queued to `~/.cache/opencode-obsidian-sync/queue/`. The queue processor runs every 7 seconds and flushes when connectivity returns. Items are retried up to 50 times before being discarded.

### 3. Search Tool

Once the plugin is loaded, AI agents get a `search_session_logs` tool:

```
search_session_logs({ query: "auth middleware", project: "my-project", date_from: "2026-02-01" })
```

Returns the top 10 matching notes with file path, project, date, context snippet, and relevance score.

## How It Works

### Session Reconstruction Pipeline

```
reader.ts          Read session + message + part JSONs from storage
reconstruction.ts  Assemble into ConversationEntry[] (user/assistant pairs with tool calls)
formatter.ts       Convert to Markdown with YAML frontmatter, tool calls as blockquotes
tagger.ts          Auto-tag via content regex (topic, tech, activity, domain)
splitter.ts        Split if > 300 messages into numbered parts
```

### Plugin Event Lifecycle

```
session.created   --> skeleton summary note
session.updated   --> full summary + handle title renames
                      (30s debounce) --> raw log sync
session.compacting --> final raw log sync
```

### File-Based Queue

```
~/.cache/opencode-obsidian-sync/queue/
  {uuid}.json  -->  { type: "create"|"update"|"delete", path, content, retries, createdAt }
```

Processed sequentially every 7 seconds. Stops on first failure to preserve ordering.

## Tests

```bash
# Library tests (parsing, formatting, splitting, tagging, reconstruction)
cd lib && bun test       # 28 tests

# Plugin tests (deletion protection, console output, session lifecycle, renames)
cd plugin && bun test    # 25 tests
```

## Troubleshooting

| Issue | Fix |
|---|---|
| Obsidian REST API unreachable | Ensure Obsidian is running and Local REST API plugin is enabled. Check `OBSIDIAN_URL` and `OBSIDIAN_API_KEY`. |
| Queue buildup in `~/.cache/` | Writes queue to disk when Obsidian is offline. Flushes automatically when connectivity returns. |
| Missing sessions after import | Check `sync/.sync-state.json` for skipped IDs. Sessions with 0 messages are skipped. Re-run with `--all --resume`. |
| Session title shows as timestamp | Sessions that never received an AI-generated title fall back to a timestamp-based slug. |
| Large session split into parts | Sessions over 300 messages are split into `raw-log-part-1.md`, `raw-log-part-2.md`, etc. By design. |
| Dataview queries not rendering | Install the [Dataview](https://github.com/blacksmithgu/obsidian-dataview) community plugin in Obsidian. |

## License

MIT
