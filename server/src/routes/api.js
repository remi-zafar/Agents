import fs from 'node:fs';
import path from 'node:path';
import { config } from '../env.js';
import { createRouter, errorResponse, openSse, readJsonBody, sendJson } from '../http.js';
import { messages, projects, slugify, toolCalls } from '../db/index.js';
import { runAgent } from '../agent/loop.js';
import { listServices, previewUrlFor, relTo, resolveInWorkspace } from '../tools/runner.js';

export const router = createRouter();

/** One AbortController per running project so a client disconnect stops the work. */
const activeRuns = new Map();

const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'coverage']);

const workspaceOf = (project) => path.resolve(config.workspaceRoot, project.slug);

function fileTree(workspace, dir = workspace, depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes = [];
  const sorted = entries.sort(
    (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
  );
  for (const entry of sorted) {
    if (IGNORED.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relTo(workspace, full),
        type: 'dir',
        children: fileTree(workspace, full, depth + 1, maxDepth),
      });
    } else if (entry.isFile()) {
      nodes.push({ name: entry.name, path: relTo(workspace, full), type: 'file', size: fs.statSync(full).size });
    }
    if (nodes.length > 500) break;
  }
  return nodes;
}

const decorate = (project) => ({
  ...project,
  preview_url: project.preview_port ? previewUrlFor(project.preview_port) : null,
  services: listServices(project.id),
  running: activeRuns.has(project.id),
});

router.get('/api/health', (_req, res) => {
  sendJson(res, 200, {
    ok: true,
    provider: config.provider,
    model: config.provider === 'fake' ? 'scripted-demo' : config.llm.model,
    node: process.version,
    workspace_root: config.workspaceRoot,
    db: config.dbFile,
    preview_base_url: config.previewBaseUrl || null,
    projects: projects.list().length,
  });
});

router.get('/api/projects', (_req, res) => {
  sendJson(res, 200, { data: projects.list().map(decorate) });
});

router.post('/api/projects', async (req, res) => {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return errorResponse(res, error.status ?? 400, 'BAD_REQUEST', error.message);
  }

  const prompt = String(body.prompt ?? '').trim();
  if (!prompt) return errorResponse(res, 400, 'VALIDATION_FAILED', 'prompt is required');

  const name = String(body.name ?? '').trim() || prompt.split('\n')[0].slice(0, 60);
  const base = slugify(name);
  const existing = new Set(projects.list().map((project) => project.slug));
  let slug = base;
  for (let i = 2; existing.has(slug); i += 1) slug = `${base}-${i}`;

  const workspace = path.resolve(config.workspaceRoot, slug);
  fs.mkdirSync(workspace, { recursive: true });

  const project = projects.create({ name, slug, workspace });
  messages.append({ projectId: project.id, role: 'user', content: prompt });

  sendJson(res, 201, { data: decorate(project) });
});

router.get('/api/projects/:id', (req, res, _url, params) => {
  const project = projects.get(params.id);
  if (!project) return errorResponse(res, 404, 'NOT_FOUND', 'no such project');

  const workspace = workspaceOf(project);
  sendJson(res, 200, {
    data: {
      ...decorate(project),
      messages: messages.forProject(project.id),
      tool_calls: toolCalls.forProject(project.id),
      files: fs.existsSync(workspace) ? fileTree(workspace) : [],
    },
  });
});

router.get('/api/projects/:id/files/*', (req, res, _url, params) => {
  const project = projects.get(params.id);
  if (!project) return errorResponse(res, 404, 'NOT_FOUND', 'no such project');

  try {
    const target = resolveInWorkspace(workspaceOf(project), params['0']);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return errorResponse(res, 404, 'NOT_FOUND', 'no such file');
    }
    const body = fs.readFileSync(target);
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': body.length });
    res.end(body);
  } catch (error) {
    errorResponse(res, 400, 'BAD_PATH', error.message);
  }
});

async function startRun(req, res, project) {
  if (activeRuns.has(project.id)) {
    return errorResponse(res, 409, 'RUN_IN_PROGRESS', 'this project already has a run in flight');
  }

  const workspace = workspaceOf(project);
  fs.mkdirSync(workspace, { recursive: true });

  const sse = openSse(req, res);
  const controller = new AbortController();
  activeRuns.set(project.id, controller);
  req.on('close', () => controller.abort());

  projects.setStatus(project.id, 'running');
  sse.send('project', decorate(projects.get(project.id)));

  const emit = (event) => {
    if (event.type === 'done' && event.payload?.previewPort) {
      projects.setStatus(project.id, 'idle', event.payload.previewPort);
    } else if (event.type === 'ask_user') {
      projects.setStatus(project.id, 'waiting_for_user');
    }
    sse.send(event.type, event);
    if (event.type === 'done' || event.type === 'ask_user') {
      sse.send('project', decorate(projects.get(project.id)));
    }
  };

  try {
    const result = await runAgent({ projectId: project.id, workspace, emit, signal: controller.signal });
    if (result.status !== 'waiting_for_user') projects.setStatus(project.id, 'idle');
    sse.send('run_finished', { status: result.status, iterations: result.iterations ?? null, ms: result.ms ?? null });
    sse.send('project', decorate(projects.get(project.id)));
  } catch (error) {
    projects.setStatus(project.id, 'idle');
    sse.send('error', { message: `${error.name}: ${error.message}` });
  } finally {
    activeRuns.delete(project.id);
    sse.close();
  }
}

router.post('/api/projects/:id/run', (req, res, _url, params) => {
  const project = projects.get(params.id);
  if (!project) return errorResponse(res, 404, 'NOT_FOUND', 'no such project');
  return startRun(req, res, project);
});

router.post('/api/projects/:id/messages', async (req, res, _url, params) => {
  const project = projects.get(params.id);
  if (!project) return errorResponse(res, 404, 'NOT_FOUND', 'no such project');

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return errorResponse(res, error.status ?? 400, 'BAD_REQUEST', error.message);
  }

  const content = String(body.content ?? '').trim();
  if (!content) return errorResponse(res, 400, 'VALIDATION_FAILED', 'content is required');
  if (project.status !== 'waiting_for_user') {
    return errorResponse(res, 409, 'NOT_WAITING', 'this project is not waiting for an answer');
  }

  messages.append({ projectId: project.id, role: 'user', content });
  projects.setStatus(project.id, 'idle');
  return startRun(req, res, project);
});
