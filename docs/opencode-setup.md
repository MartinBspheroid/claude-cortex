# OpenCode Integration

Claude Cortex provides brain-like memory for OpenCode, giving any LLM model access to persistent context.

## Quick Start

```bash
# Install claude-cortex globally
npm install -g claude-cortex

# Configure for OpenCode
npx claude-cortex opencode setup
```

This command:
1. Adds claude-cortex as an MCP server in `~/.config/opencode/opencode.json`
2. Installs session hooks as OpenCode plugins

## Manual Configuration

If you prefer manual setup, add this to your OpenCode config:

### Global Configuration

Edit `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "claude-cortex": {
      "type": "local",
      "command": ["npx", "claude-cortex"],
      "enabled": true
    }
  }
}
```

### Project Configuration

For per-project settings, create `opencode.json` in your project root:

```json
{
  "mcp": {
    "claude-cortex": {
      "type": "local",
      "command": ["npx", "claude-cortex"],
      "enabled": true,
      "environment": {
        "CORTEX_PROJECT": "my-project-name"
      }
    }
  }
}
```

## Available Memory Tools

Once configured, these MCP tools are available:

| Tool | Description |
|------|-------------|
| `remember` | Store important information with title, content, and category |
| `recall` | Search and retrieve memories by query, tags, or category |
| `forget` | Remove memories by ID or query |
| `get_context` | Get a summary of project context |
| `set_project` | Switch project context |
| `get_project` | Show current project |

## Session Hooks (Optional)

The OpenCode plugin provides automatic context loading and memory extraction:

### Session Start
- Loads project-specific memories when you start a session
- Shows architecture decisions, patterns, and learnings
- Provides proactive memory usage instructions

### Pre-Compaction
- Automatically extracts important content before context compaction
- Saves decisions, fixes, learnings, and architecture notes
- Tags memories with `auto-extracted` and `source:opencode`

### Installing Hooks Manually

Copy the plugin to your OpenCode plugins directory:

```bash
cp -r /path/to/claude-cortex/opencode-plugins ~/.config/opencode/plugins/cortex-memory
```

Or run:

```bash
npx claude-cortex opencode plugins
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CORTEX_PROJECT` | Override auto-detected project name |
| `CLAUDE_MEMORY_PROJECT` | Alternative to CORTEX_PROJECT (Claude Code compatibility) |
| `CLAUDE_MEMORY_DB` | Custom database path |

## Shared Memory Database

Claude Cortex uses a single SQLite database at `~/.claude-cortex/memories.db`. This means:

- Memories are shared between Claude Code and OpenCode
- You can switch between tools without losing context
- Project scoping keeps memories organized

## Proactive Memory Usage

Don't rely solely on auto-extraction. Use `remember` proactively:

```
remember({
  title: "SQLite concurrent access fix",
  content: "Multiple processes accessing the DB caused crashes. Fixed with busy_timeout and WAL mode.",
  category: "error"
})
```

### When to Remember

- **Decisions**: Architecture choices, library selections
- **Fixes**: Bug root causes and solutions
- **Learnings**: New discoveries about the codebase
- **Preferences**: User stated preferences
- **Patterns**: Reusable code patterns

## Troubleshooting

### MCP Server Not Loading

1. Check config syntax: `cat ~/.config/opencode/opencode.json | jq .`
2. Verify npx works: `npx claude-cortex --version`
3. Check OpenCode logs for errors

### Plugin Not Running

1. Verify plugin is installed: `ls ~/.config/opencode/plugins/cortex-memory/`
2. Restart OpenCode after installing
3. Check that `better-sqlite3` is available

### Database Locked

The database uses WAL mode and busy_timeout to handle concurrent access. If issues persist:

```bash
# Check for lock file
ls ~/.claude-cortex/.lock

# Force cleanup (only if no processes are using it)
rm ~/.claude-cortex/.lock
```

## Comparison: Claude Code vs OpenCode

| Feature | Claude Code | OpenCode |
|---------|-------------|----------|
| Config file | `~/.claude.json` | `~/.config/opencode/opencode.json` |
| Hooks | Shell commands | TypeScript plugins |
| MCP key | `mcpServers` | `mcp` |
| Transport | `stdio` type | `local` type |
| Session end hook | Supported | Limited (session.deleted) |

## Further Reading

- [OpenCode Documentation](https://opencode.ai/docs/)
- [OpenCode MCP Servers](https://opencode.ai/docs/mcp-servers/)
- [Claude Cortex README](../README.md)
