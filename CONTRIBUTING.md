# Contributing to opencode-obsidian-sync

Thanks for your interest in contributing. This guide covers everything you need to get started.

## Prerequisites

- [Bun](https://bun.sh/) >= 1.0
- [Obsidian](https://obsidian.md/) with [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin enabled
- [OpenCode](https://github.com/sst/opencode) with [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) (for plugin testing)

## Project Setup

```bash
git clone https://github.com/xeaser/opencode-obsidian-sync.git
cd opencode-obsidian-sync
bun install
```

This is a Bun workspace with three packages:

| Package | Path | Purpose |
|---------|------|---------|
| `@opencode-obsidian-sync/lib` | `lib/` | Session extraction library |
| `@opencode-obsidian-sync/plugin` | `plugin/` | Real-time sync plugin for OpenCode |
| sync scripts | `sync/` | CLI tools for historical import |

## Running Tests

```bash
# All lib tests (28 tests)
cd lib && bun test

# All plugin tests (25 tests)
cd plugin && bun test

# Type checking
cd plugin && bun run typecheck
```

All tests must pass before submitting a PR. Run both test suites.

## Building the Plugin

The plugin bundles all `lib/` code into a single file for npm distribution:

```bash
cd plugin
bun run build        # outputs dist/index.js
```

Verify the bundle works after any changes to `lib/` or `plugin/` source files.

## Development Workflow

### 1. Fork and Clone

```bash
gh repo fork xeaser/opencode-obsidian-sync --clone
cd opencode-obsidian-sync
bun install
```

### 2. Create a Branch

```bash
git checkout -b feat/your-feature-name
```

Use prefixes: `feat/`, `fix/`, `docs/`, `test/`, `chore/`.

### 3. Make Changes

- Follow existing code patterns and style
- Do not add unnecessary comments
- Keep changes focused on one concern per PR

### 4. Test Your Changes

```bash
cd lib && bun test
cd ../plugin && bun test
```

If you changed plugin code, also rebuild and verify:

```bash
cd plugin && bun run build
```

### 5. Submit a PR

```bash
git push origin feat/your-feature-name
gh pr create
```

## Code Guidelines

### Style

- TypeScript strict mode
- No `as any`, `@ts-ignore`, or `@ts-expect-error`
- No empty catch blocks
- Prefer `node:` protocol for built-in imports (`node:fs`, `node:path`)
- No external runtime dependencies in `lib/` (stdlib only)

### Testing

- Add tests for new functionality
- Tests live in `__tests__/` directories alongside source
- Use `bun:test` (`describe`, `test`, `expect`)
- Plugin tests use `mock.module()` for dependency isolation

### Commit Messages

Follow conventional commits:

```
feat: add session export to CSV
fix: prevent false-positive trashing on transient read errors
test: add pollForDeletions consecutive failure tests
docs: update setup guide for Windows
chore: bump bun-types to 1.2
```

## Architecture Overview

```
OpenCode Storage (~/.local/share/opencode/storage/)
        |
    lib/ (read, reconstruct, format, split, tag)
        |
   +---------+----------+
   |                     |
sync/ (CLI)         plugin/ (real-time)
   |                     |
   +------> Obsidian <---+
            REST API
```

- **lib/**: Pure extraction logic. Reads session JSON files, reconstructs conversations, formats as Markdown with YAML frontmatter, auto-tags, splits large sessions.
- **plugin/**: Event-driven sync. Listens to OpenCode session events, writes notes via Obsidian REST API through a file-based queue. Includes 3-strike deletion protection.
- **sync/**: One-shot scripts for bulk historical import, backlink generation, and daily summaries.

## Key Design Decisions

- **No external runtime deps in lib/** -- keeps the extraction layer portable
- **File-based queue** -- survives crashes, processes sequentially to avoid Obsidian API race conditions
- **3-strike deletion** -- sessions are only trashed after 3 consecutive poll failures, preventing false positives from transient IO errors
- **Title-based slugs** -- note filenames derive from session titles, not random IDs

## Reporting Issues

Use [GitHub Issues](https://github.com/xeaser/opencode-obsidian-sync/issues). Include:

- What you expected vs what happened
- OpenCode version, Bun version, OS
- Relevant error messages or logs

## Questions?

Open a [Discussion](https://github.com/xeaser/opencode-obsidian-sync/discussions) or file an issue.
