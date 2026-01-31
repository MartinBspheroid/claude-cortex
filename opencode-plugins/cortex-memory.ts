/**
 * Claude Cortex Memory Plugin for OpenCode
 *
 * Provides equivalent functionality to Claude Code's shell hooks:
 * - session.created → SessionStart hook (loads project context)
 * - session.compacted → PreCompact hook (extracts memories before compaction)
 *
 * This plugin integrates the claude-cortex memory system with OpenCode,
 * giving any LLM model access to persistent, brain-like memory.
 *
 * Plugin Format: OpenCode plugins export an async function that receives
 * context and returns an object mapping event names to handlers.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ==================== TYPES ====================

interface PluginContext {
  client: {
    app: {
      log: (message: string, options?: { level?: string; data?: unknown }) => Promise<void>;
    };
  };
  project: {
    name: string;
    path: string;
  };
  directory: string;
  worktree: string;
  $: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

interface SessionEvent {
  sessionId: string;
  [key: string]: unknown;
}

interface Memory {
  id: number;
  title: string;
  content: string;
  category: string;
  type: string;
  salience: number;
  tags: string;
  created_at: string;
}

interface ExtractedMemory {
  title: string;
  content: string;
  category: string;
  salience: number;
  tags: string[];
  extractorType?: string;
}

// ==================== DATABASE CONFIG ====================

const NEW_DB_DIR = join(homedir(), '.claude-cortex');
const LEGACY_DB_DIR = join(homedir(), '.claude-memory');

function getDbPath(): { dir: string; path: string } {
  const newPath = join(NEW_DB_DIR, 'memories.db');
  const legacyPath = join(LEGACY_DB_DIR, 'memories.db');
  if (existsSync(newPath) || !existsSync(legacyPath)) {
    return { dir: NEW_DB_DIR, path: newPath };
  }
  return { dir: LEGACY_DB_DIR, path: legacyPath };
}

function connectDatabase(dbPath: string, options?: { readonly?: boolean }): Database.Database {
  return new Database(dbPath, {
    readonly: options?.readonly ?? false,
    timeout: 5000,
  });
}

// ==================== PROJECT DETECTION ====================

const SKIP_DIRECTORIES = [
  'src', 'lib', 'dist', 'build', 'out',
  'node_modules', '.git', '.next', '.cache',
  'test', 'tests', '__tests__', 'spec',
  'bin', 'scripts', 'config', 'public', 'static',
];

function extractProjectFromPath(path: string | undefined): string | null {
  if (!path) return null;

  const segments = path.split(/[/\\]/).filter(Boolean);
  if (segments.length === 0) return null;

  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (!SKIP_DIRECTORIES.includes(segment.toLowerCase())) {
      if (segment.startsWith('.')) continue;
      return segment;
    }
  }

  return null;
}

// ==================== CONTEXT RETRIEVAL ====================

const MAX_CONTEXT_MEMORIES = 15;
const MIN_SALIENCE_THRESHOLD = 0.3;

function getProjectContext(db: Database.Database, project: string): Memory[] {
  const memories: Memory[] = [];

  const highPriority = db
    .prepare(`
      SELECT id, title, content, category, type, salience, tags, created_at
      FROM memories
      WHERE (project = ? OR project IS NULL)
        AND salience >= ?
        AND type IN ('long_term', 'episodic')
      ORDER BY salience DESC, last_accessed DESC
      LIMIT ?
    `)
    .all(project, MIN_SALIENCE_THRESHOLD, MAX_CONTEXT_MEMORIES) as Memory[];

  memories.push(...highPriority);

  if (memories.length < 5) {
    const excludeIds = memories.map((m) => m.id);
    const placeholders = excludeIds.length > 0 ? excludeIds.map(() => '?').join(',') : '0';
    const recent = db
      .prepare(`
        SELECT id, title, content, category, type, salience, tags, created_at
        FROM memories
        WHERE (project = ? OR project IS NULL)
          AND id NOT IN (${placeholders})
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(project, ...excludeIds, 5 - memories.length) as Memory[];

    memories.push(...recent);
  }

  return memories;
}

function formatContext(memories: Memory[], project: string): string | null {
  if (memories.length === 0) {
    return null;
  }

  const lines = [`# Project Context: ${project}`, ''];

  const byCategory: Record<string, Memory[]> = {};
  for (const mem of memories) {
    const cat = mem.category || 'note';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(mem);
  }

  const categoryOrder = ['architecture', 'pattern', 'preference', 'error', 'context', 'learning', 'note', 'todo'];

  for (const cat of categoryOrder) {
    if (!byCategory[cat] || byCategory[cat].length === 0) continue;

    const categoryTitle = cat.charAt(0).toUpperCase() + cat.slice(1);
    lines.push(`## ${categoryTitle}`);

    for (const mem of byCategory[cat]) {
      const salience = Math.round(mem.salience * 100);
      lines.push(`- **${mem.title}** (${salience}% salience)`);
      const content = mem.content.length > 200 ? mem.content.slice(0, 200) + '...' : mem.content;
      lines.push(`  ${content}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ==================== MEMORY EXTRACTION ====================

const ARCHITECTURE_KEYWORDS = ['architecture', 'design', 'pattern', 'structure', 'system', 'database', 'api', 'schema', 'model', 'framework'];
const ERROR_KEYWORDS = ['error', 'bug', 'fix', 'issue', 'problem', 'crash', 'fail', 'exception', 'debug', 'resolve'];
const DECISION_KEYWORDS = ['decided', 'decision', 'chose', 'chosen', 'selected', 'going with', 'will use', 'opted for'];
const LEARNING_KEYWORDS = ['learned', 'discovered', 'realized', 'found out', 'turns out', 'TIL', 'figured out'];
const PREFERENCE_KEYWORDS = ['prefer', 'always', 'never', 'style', 'convention', 'standard'];
const PATTERN_KEYWORDS = ['pattern', 'practice', 'approach', 'method', 'technique', 'implementation'];
const EMOTIONAL_MARKERS = ['important', 'critical', 'crucial', 'essential', 'key', 'finally', 'breakthrough'];

function detectKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function calculateSalience(text: string): number {
  let score = 0.25;

  if (detectKeywords(text, ARCHITECTURE_KEYWORDS)) score += 0.4;
  if (detectKeywords(text, ERROR_KEYWORDS)) score += 0.35;
  if (detectKeywords(text, DECISION_KEYWORDS)) score += 0.35;
  if (detectKeywords(text, LEARNING_KEYWORDS)) score += 0.3;
  if (detectKeywords(text, PATTERN_KEYWORDS)) score += 0.25;
  if (detectKeywords(text, PREFERENCE_KEYWORDS)) score += 0.25;
  if (detectKeywords(text, EMOTIONAL_MARKERS)) score += 0.2;

  return Math.min(1.0, score);
}

function suggestCategory(text: string): string {
  const lower = text.toLowerCase();

  if (detectKeywords(lower, ARCHITECTURE_KEYWORDS)) return 'architecture';
  if (detectKeywords(lower, ERROR_KEYWORDS)) return 'error';
  if (detectKeywords(lower, DECISION_KEYWORDS)) return 'context';
  if (detectKeywords(lower, LEARNING_KEYWORDS)) return 'learning';
  if (detectKeywords(lower, PREFERENCE_KEYWORDS)) return 'preference';
  if (detectKeywords(lower, PATTERN_KEYWORDS)) return 'pattern';

  return 'note';
}

function extractTags(text: string): string[] {
  const tags = new Set<string>();

  const hashtagMatches = text.match(/#[a-zA-Z][a-zA-Z0-9_-]*/g);
  if (hashtagMatches) {
    hashtagMatches.forEach((tag) => tags.add(tag.slice(1).toLowerCase()));
  }

  const techTerms = ['react', 'vue', 'node', 'python', 'typescript', 'javascript', 'api', 'database', 'docker', 'git'];
  const lowerText = text.toLowerCase();
  techTerms.forEach((term) => {
    if (lowerText.includes(term)) tags.add(term);
  });

  tags.add('auto-extracted');
  tags.add('source:opencode');

  return Array.from(tags).slice(0, 12);
}

const EXTRACTORS = [
  {
    name: 'decision',
    patterns: [
      /(?:we\s+)?decided\s+(?:to\s+)?(.{15,200})/gi,
      /(?:going|went)\s+with\s+(.{15,150})/gi,
      /(?:chose|chosen|selected)\s+(.{15,150})/gi,
      /(?:using|will\s+use)\s+(.{15,150})/gi,
    ],
    titlePrefix: 'Decision: ',
  },
  {
    name: 'error-fix',
    patterns: [
      /(?:fixed|solved|resolved)\s+(?:by\s+)?(.{15,200})/gi,
      /the\s+(?:fix|solution|workaround)\s+(?:is|was)\s+(.{15,200})/gi,
      /(?:root\s+cause|issue)\s+(?:is|was)\s+(.{15,200})/gi,
    ],
    titlePrefix: 'Fix: ',
  },
  {
    name: 'learning',
    patterns: [
      /(?:learned|discovered|realized|found\s+out)\s+(?:that\s+)?(.{15,200})/gi,
      /turns\s+out\s+(?:that\s+)?(.{15,200})/gi,
      /(?:figured\s+out|worked\s+out)\s+(.{15,150})/gi,
    ],
    titlePrefix: 'Learned: ',
  },
  {
    name: 'architecture',
    patterns: [
      /the\s+architecture\s+(?:is|uses|consists\s+of)\s+(.{15,200})/gi,
      /(?:created|added|implemented|built)\s+(?:a\s+)?(.{15,200})/gi,
    ],
    titlePrefix: 'Architecture: ',
  },
  {
    name: 'important-note',
    patterns: [
      /important[:\s]+(.{15,200})/gi,
      /(?:note|remember)[:\s]+(.{15,200})/gi,
    ],
    titlePrefix: 'Note: ',
  },
];

function extractMemorableSegments(conversationText: string): ExtractedMemory[] {
  const segments: ExtractedMemory[] = [];

  for (const extractor of EXTRACTORS) {
    for (const pattern of extractor.patterns) {
      let match;
      while ((match = pattern.exec(conversationText)) !== null) {
        const content = match[1].trim();
        if (content.length >= 20) {
          const titleContent = content.slice(0, 50).replace(/\s+/g, ' ').trim();
          const title = extractor.titlePrefix + (titleContent.length < 50 ? titleContent : titleContent + '...');
          const text = title + ' ' + content;

          segments.push({
            title,
            content: content.slice(0, 500),
            category: suggestCategory(text),
            salience: calculateSalience(text),
            tags: extractTags(text),
            extractorType: extractor.name,
          });
        }
      }
    }
  }

  return segments;
}

function calculateOverlap(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  const intersection = new Set([...words1].filter((w) => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  return intersection.size / union.size;
}

function processSegments(segments: ExtractedMemory[], threshold: number = 0.35): ExtractedMemory[] {
  const unique: ExtractedMemory[] = [];

  for (const seg of segments) {
    const isDupe = unique.some((existing) => calculateOverlap(existing.content, seg.content) > 0.8);
    if (!isDupe) {
      unique.push(seg);
    }
  }

  unique.sort((a, b) => b.salience - a.salience);

  return unique.filter((seg) => seg.salience >= threshold).slice(0, 5);
}

function saveMemory(db: Database.Database, memory: ExtractedMemory, project: string | null): void {
  const timestamp = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO memories (title, content, type, category, salience, tags, project, created_at, last_accessed)
    VALUES (?, ?, 'short_term', ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    memory.title,
    memory.content,
    memory.category,
    memory.salience,
    JSON.stringify(memory.tags),
    project,
    timestamp,
    timestamp
  );
}

// ==================== PROACTIVE INSTRUCTIONS ====================

const PROACTIVE_INSTRUCTIONS = `
## Proactive Memory Use

You have access to a persistent memory system. Use it proactively:

**ALWAYS use \`remember\` immediately when:**
- Making architecture/design decisions
- Fixing bugs (capture the root cause and solution)
- Learning something new about the codebase
- User states a preference
- Completing significant features

**Don't wait** - call \`remember\` right after the event, not at the end of the session.
`;

// ==================== PLUGIN EXPORT ====================

/**
 * OpenCode Plugin: Claude Cortex Memory
 *
 * This follows the official OpenCode plugin format:
 * - Export an async function that receives context
 * - Return an object mapping event names to handlers
 */
export const CortexMemoryPlugin = async (ctx: PluginContext) => {
  const { client, project, directory } = ctx;

  // Log plugin initialization
  await client.app.log('[cortex-memory] Plugin initialized', { level: 'info' });

  return {
    /**
     * Fires when a new OpenCode session starts
     * Loads project context from memory
     */
    'session.created': async (_event: SessionEvent) => {
      try {
        const projectName = project?.name || extractProjectFromPath(directory);
        if (!projectName) return;

        const { path: dbPath } = getDbPath();
        if (!existsSync(dbPath)) {
          await client.app.log(`[cortex-memory] New project "${projectName}" - no memories yet`, { level: 'info' });
          return;
        }

        const db = connectDatabase(dbPath, { readonly: true });
        const memories = getProjectContext(db, projectName);
        const context = formatContext(memories, projectName);
        db.close();

        if (context) {
          await client.app.log(`[cortex-memory] Loaded ${memories.length} memories for "${projectName}"`, { level: 'info' });
          // Note: OpenCode plugins can't inject content into the conversation directly
          // The MCP server's get_context tool should be used instead
        } else {
          await client.app.log(`[cortex-memory] No memories found for "${projectName}"`, { level: 'info' });
        }
      } catch (error) {
        await client.app.log(`[cortex-memory] session.created error: ${error}`, { level: 'error' });
      }
    },

    /**
     * Fires before context compaction
     * Extracts and saves important memories
     */
    'session.compacted': async (event: SessionEvent) => {
      try {
        const projectName = project?.name || extractProjectFromPath(directory);
        const { dir: dbDir, path: dbPath } = getDbPath();

        if (!existsSync(dbDir)) {
          mkdirSync(dbDir, { recursive: true });
        }

        if (!existsSync(dbPath)) {
          await client.app.log('[cortex-memory] Database not initialized', { level: 'warn' });
          return;
        }

        // Note: OpenCode's session.compacted event may not include conversation text
        // The MCP server's remember tool should be used for explicit memory storage
        // This hook serves as a reminder/log point

        await client.app.log(`[cortex-memory] Session compacted - use 'remember' tool to save important context`, {
          level: 'info',
          data: { sessionId: event.sessionId, project: projectName },
        });
      } catch (error) {
        await client.app.log(`[cortex-memory] session.compacted error: ${error}`, { level: 'error' });
      }
    },

    /**
     * Fires when session becomes idle
     * Opportunity for background maintenance
     */
    'session.idle': async (_event: SessionEvent) => {
      // No action needed - consolidation is handled by the MCP server
    },
  };
};

// Default export for OpenCode plugin discovery
export default CortexMemoryPlugin;
