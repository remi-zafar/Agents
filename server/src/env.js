import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root: server/src/env.js -> server/src -> server -> root */
export const ROOT = path.resolve(here, '..', '..');

/**
 * Hand-rolled .env loader (no dotenv dependency). Real environment variables
 * always win, so a deployed process is configured by its platform, not a file.
 */
const envFile = path.resolve(ROOT, 'server/.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

function int(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: int(process.env.PORT, 8000),
  host: process.env.HOST || '0.0.0.0',

  /** Every generated project lives in its own directory under here. */
  workspaceRoot: path.resolve(ROOT, process.env.WORKSPACE_ROOT || 'workspace'),

  dbFile: path.resolve(ROOT, process.env.DB_FILE || 'data/agents.db'),

  /** Where the agent's system prompt is loaded from. */
  systemPromptFile: path.resolve(
    ROOT,
    process.env.SYSTEM_PROMPT_FILE || 'prompts/app-builder-system-prompt.arena.md',
  ),
  systemPromptFallbackFile: path.resolve(ROOT, 'prompts/app-builder-system-prompt.md'),

  /** 'openai' | 'fake' — 'fake' needs no API key and replays a scripted build. */
  provider: (process.env.AGENT_PROVIDER || 'fake').toLowerCase(),

  llm: {
    baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
  },

  agent: {
    /** Hard ceiling on tool-call rounds for a single run. */
    maxIterations: int(process.env.AGENT_MAX_ITERATIONS, 40),
    /** Ceiling for a single bash() call, in ms. */
    bashTimeoutMs: int(process.env.AGENT_BASH_TIMEOUT_MS, 120_000),
    /** Ceiling for anything written back to the model as one tool result. */
    maxToolResultChars: int(process.env.AGENT_MAX_TOOL_RESULT_CHARS, 24_000),
  },

  /** Public preview base with a {port} placeholder, e.g. https://{port}-xyz.e2b.app */
  previewBaseUrl: process.env.PREVIEW_BASE_URL || '',
};
