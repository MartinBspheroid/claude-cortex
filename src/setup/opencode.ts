/**
 * OpenCode Setup and Configuration
 *
 * Configures claude-cortex to work with OpenCode:
 * 1. MCP server configuration in opencode.json
 * 2. Plugin installation for session hooks
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

// Get the directory of this file for relative paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// OpenCode config locations
const OPENCODE_CONFIG_DIR = path.join(os.homedir(), '.config', 'opencode');
const OPENCODE_GLOBAL_CONFIG = path.join(OPENCODE_CONFIG_DIR, 'opencode.json');
// Note: OpenCode uses 'plugin/' (singular) not 'plugins/'
const OPENCODE_PLUGINS_DIR = path.join(OPENCODE_CONFIG_DIR, 'plugin');

// Plugin source location (relative to dist/)
const PLUGIN_SOURCE_DIR = path.resolve(__dirname, '..', '..', 'opencode-plugins');

interface OpenCodeConfig {
  $schema?: string;
  mcp?: Record<
    string,
    {
      type: string;
      command?: string[];
      enabled?: boolean;
      environment?: Record<string, string>;
    }
  >;
  [key: string]: unknown;
}

/**
 * Read and parse OpenCode config, or return empty config
 */
function readOpenCodeConfig(): OpenCodeConfig {
  if (!fs.existsSync(OPENCODE_GLOBAL_CONFIG)) {
    return {};
  }

  try {
    const content = fs.readFileSync(OPENCODE_GLOBAL_CONFIG, 'utf-8');
    // Handle JSONC (JSON with comments) by stripping comments
    const jsonContent = content
      .replace(/\/\/.*$/gm, '') // Remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments
    return JSON.parse(jsonContent);
  } catch (error) {
    console.log('  Warning: Could not parse existing config, will create new one');
    return {};
  }
}

/**
 * Write OpenCode config file
 */
function writeOpenCodeConfig(config: OpenCodeConfig): void {
  // Ensure config directory exists
  fs.mkdirSync(OPENCODE_CONFIG_DIR, { recursive: true });

  // Add schema if not present
  if (!config.$schema) {
    config.$schema = 'https://opencode.ai/config.json';
  }

  fs.writeFileSync(OPENCODE_GLOBAL_CONFIG, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Configure claude-cortex as an MCP server in OpenCode
 */
export function setupOpenCodeMcp(): void {
  console.log('\n  Configuring MCP server...\n');

  const config = readOpenCodeConfig();

  // Ensure mcp section exists
  if (!config.mcp) {
    config.mcp = {};
  }

  // Check if already configured
  if (config.mcp['claude-cortex']) {
    console.log('    = MCP server already configured');
  } else {
    config.mcp['claude-cortex'] = {
      type: 'local',
      command: ['npx', 'claude-cortex'],
      enabled: true,
    };
    console.log('    + Added MCP server configuration');
  }

  writeOpenCodeConfig(config);
  console.log(`    Wrote ${OPENCODE_GLOBAL_CONFIG}`);
}

/**
 * Copy directory recursively
 */
function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Install OpenCode plugins for hook functionality
 */
export function installOpenCodePlugins(): void {
  console.log('\n  Installing OpenCode plugins...\n');

  // Ensure plugins directory exists
  fs.mkdirSync(OPENCODE_PLUGINS_DIR, { recursive: true });

  const pluginDest = path.join(OPENCODE_PLUGINS_DIR, 'cortex-memory');

  // Check if plugin source exists
  if (!fs.existsSync(PLUGIN_SOURCE_DIR)) {
    console.log('    Warning: Plugin source not found at', PLUGIN_SOURCE_DIR);
    console.log('    Skipping plugin installation (MCP server will still work)');
    return;
  }

  // Check if already installed
  if (fs.existsSync(pluginDest)) {
    // Remove existing to update
    fs.rmSync(pluginDest, { recursive: true, force: true });
    console.log('    - Removed existing plugin');
  }

  // Copy plugin files
  copyDirRecursive(PLUGIN_SOURCE_DIR, pluginDest);
  console.log(`    + Installed plugin: ${pluginDest}`);
}

/**
 * Verify OpenCode is installed
 */
function checkOpenCodeInstalled(): boolean {
  try {
    const { execSync } = require('child_process');
    execSync('which opencode', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Full OpenCode setup
 */
export async function setupOpenCode(): Promise<void> {
  console.log(`
================================================================================
                     Claude Cortex - OpenCode Integration
================================================================================
`);

  // Check if OpenCode is installed
  const hasOpenCode = checkOpenCodeInstalled();
  if (!hasOpenCode) {
    console.log(`  Note: OpenCode CLI not detected in PATH.
        This is fine - you can still configure the integration.
        Install OpenCode from: https://opencode.ai
`);
  }

  // Configure MCP server
  setupOpenCodeMcp();

  // Install plugins
  installOpenCodePlugins();

  // Success message
  console.log(`
================================================================================
                         Setup Complete!
================================================================================

  MCP Server:  npx claude-cortex
  Config:      ~/.config/opencode/opencode.json
  Plugin:      ~/.config/opencode/plugin/cortex-memory/

  Available memory tools:
    remember    - Store important information
    recall      - Search and retrieve memories
    forget      - Remove memories
    get_context - Get project context summary

  Next steps:
    1. Start or restart OpenCode
    2. The memory tools will be available automatically
    3. Use 'remember' proactively to save important context

  For Claude Code users:
    Run 'npx claude-cortex setup' for Claude Code integration

================================================================================
`);
}

/**
 * Show OpenCode integration status
 */
export function showOpenCodeStatus(): void {
  console.log('\n  OpenCode Integration Status\n');

  // Check config
  if (fs.existsSync(OPENCODE_GLOBAL_CONFIG)) {
    const config = readOpenCodeConfig();
    if (config.mcp?.['claude-cortex']) {
      console.log('    MCP Server: Configured');
      console.log(`      Command: ${config.mcp['claude-cortex'].command?.join(' ') || 'n/a'}`);
      console.log(`      Enabled: ${config.mcp['claude-cortex'].enabled !== false}`);
    } else {
      console.log('    MCP Server: Not configured');
    }
  } else {
    console.log('    Config: Not found');
  }

  // Check plugins
  const pluginPath = path.join(OPENCODE_PLUGINS_DIR, 'cortex-memory');
  if (fs.existsSync(pluginPath)) {
    console.log('    Plugin: Installed');
  } else {
    console.log('    Plugin: Not installed');
  }

  console.log('');
}

/**
 * Handle opencode subcommand
 */
export async function handleOpenCodeCommand(action: string): Promise<void> {
  switch (action) {
    case 'setup':
      await setupOpenCode();
      break;
    case 'mcp':
      setupOpenCodeMcp();
      break;
    case 'plugins':
      installOpenCodePlugins();
      break;
    case 'status':
      showOpenCodeStatus();
      break;
    default:
      console.log(`
OpenCode Integration Commands:

  npx claude-cortex opencode setup     Full setup (MCP + plugins)
  npx claude-cortex opencode mcp       Configure MCP server only
  npx claude-cortex opencode plugins   Install plugins only
  npx claude-cortex opencode status    Show integration status

For more info: https://github.com/mkdelta221/claude-cortex#opencode
`);
  }
}
