# Claude Cortex Plugin for OpenCode

This plugin provides brain-like memory for OpenCode sessions.

## Installation

Run `npx claude-cortex opencode setup` to automatically install this plugin.

Or manually copy this directory to `~/.config/opencode/plugins/cortex-memory/`

## What It Does

### Session Start (`session.created`)
- Loads project-specific context from memory
- Shows relevant architecture decisions, patterns, and learnings
- Provides proactive memory usage instructions

### Pre-Compaction (`session.compacted`)
- Automatically extracts important content before context compaction
- Saves decisions, fixes, learnings, and architecture notes
- Tags memories with `auto-extracted` and `source:opencode`

## Manual Memory Usage

The MCP server provides these tools:

- `remember` - Store important information
- `recall` - Search and retrieve memories
- `forget` - Remove memories
- `get_context` - Get project context summary

Use `remember` proactively whenever you make a decision, fix a bug, or learn something new.
