import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../env.js';

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

/**
 * Node's built-in SQLite (node:sqlite, Node >= 22.5). No native build step,
 * which matters in sandboxes where nodejs.org headers are unreachable.
 */
export const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  workspace    TEXT NOT NULL,
  preview_port INTEGER,
  status       TEXT NOT NULL DEFAULT 'idle',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,
  content      TEXT NOT NULL DEFAULT '',
  tool_calls   TEXT,
  tool_call_id TEXT,
  name         TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  message_id  TEXT,
  iteration   INTEGER NOT NULL,
  name        TEXT NOT NULL,
  args        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'running',
  result      TEXT,
  is_error    INTEGER NOT NULL DEFAULT 0,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'running',
  error       TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tool_calls_project ON tool_calls(project_id, started_at);
CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id, started_at);
`);

const now = () => new Date().toISOString();

export const uid = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function slugify(input) {
  const base = String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'project';
}

/** node:sqlite rejects undefined/boolean binds, so normalise everything here. */
const bindable = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
};

const run = (sql, ...params) => db.prepare(sql).run(...params.map(bindable));
const get = (sql, ...params) => db.prepare(sql).get(...params.map(bindable)) ?? null;
const all = (sql, ...params) => db.prepare(sql).all(...params.map(bindable)).map((row) => ({ ...row }));

const withPreview = (project) =>
  project && { ...project, preview_port: project.preview_port ?? null };

export const projects = {
  create({ name, slug, workspace }) {
    const id = uid('prj');
    const stamp = now();
    run(
      `INSERT INTO projects (id, name, slug, workspace, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'idle', ?, ?)`,
      id, name, slug, workspace, stamp, stamp,
    );
    return projects.get(id);
  },

  get: (id) => withPreview(get('SELECT * FROM projects WHERE id = ?', id)),

  list: () => all('SELECT * FROM projects ORDER BY created_at DESC').map(withPreview),

  setStatus(id, status, previewPort) {
    run(
      `UPDATE projects SET status = ?, preview_port = COALESCE(?, preview_port), updated_at = ? WHERE id = ?`,
      status, previewPort ?? null, now(), id,
    );
  },

  touch(id) {
    run('UPDATE projects SET updated_at = ? WHERE id = ?', now(), id);
  },
};

export const messages = {
  append({ projectId, role, content = '', toolCalls = null, toolCallId = null, name = null }) {
    const id = uid('msg');
    run(
      `INSERT INTO messages (id, project_id, role, content, tool_calls, tool_call_id, name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, projectId, role, content,
      toolCalls ? JSON.stringify(toolCalls) : null,
      toolCallId, name, now(),
    );
    projects.touch(projectId);
    return id;
  },

  forProject(projectId) {
    return all('SELECT * FROM messages WHERE project_id = ? ORDER BY rowid', projectId).map((row) => ({
      ...row,
      tool_calls: row.tool_calls ? JSON.parse(row.tool_calls) : null,
    }));
  },
};

export const toolCalls = {
  start({ projectId, messageId, iteration, name, args }) {
    const id = uid('tc');
    run(
      `INSERT INTO tool_calls (id, project_id, message_id, iteration, name, args, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`,
      id, projectId, messageId ?? null, iteration, name, JSON.stringify(args ?? {}), now(),
    );
    return id;
  },

  finish(id, { result, isError }) {
    run(
      `UPDATE tool_calls SET status = ?, result = ?, is_error = ?, finished_at = ? WHERE id = ?`,
      isError ? 'error' : 'ok', result, isError, now(), id,
    );
  },

  forProject: (projectId) => all('SELECT * FROM tool_calls WHERE project_id = ? ORDER BY rowid', projectId),
};

export const runs = {
  start(projectId) {
    const id = uid('run');
    run(`INSERT INTO runs (id, project_id, status, started_at) VALUES (?, ?, 'running', ?)`, id, projectId, now());
    return id;
  },

  finish(id, { status, error = null }) {
    run(`UPDATE runs SET status = ?, error = ?, finished_at = ? WHERE id = ?`, status, error, now(), id);
  },
};

/**
 * Provider-facing history. Only the four roles an LLM API accepts;
 * internal bookkeeping never leaks past this function.
 */
export function historyForModel(projectId) {
  return messages.forProject(projectId).map((row) => {
    const message = { role: row.role, content: row.content };
    if (row.tool_calls) message.tool_calls = row.tool_calls;
    if (row.tool_call_id) message.tool_call_id = row.tool_call_id;
    if (row.name) message.name = row.name;
    return message;
  });
}
