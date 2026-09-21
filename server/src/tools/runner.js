import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { config } from '../env.js';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.venv', '__pycache__', '.cache', 'coverage',
]);

export class ToolError extends Error {}

/** Resolve a model-supplied path and refuse anything that escapes the workspace. */
export function resolveInWorkspace(workspace, relativePath) {
  const raw = String(relativePath ?? '').trim();
  if (!raw) throw new ToolError('path is required');
  if (raw.includes('\0')) throw new ToolError('path contains a null byte');

  const absolute = path.resolve(workspace, raw.replace(/^~\//, ''));
  const root = path.resolve(workspace);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new ToolError(`path escapes the project workspace: ${raw}`);
  }
  return absolute;
}

export function relTo(workspace, absolute) {
  return path.relative(workspace, absolute) || '.';
}

function truncate(text, max) {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.floor(max * 0.7));
  const tail = text.slice(-Math.floor(max * 0.25));
  return `${head}\n\n... [${text.length - head.length - tail.length} chars truncated] ...\n\n${tail}`;
}

function runProcess(command, { cwd, timeoutMs, env }) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', command], {
      cwd,
      env: { ...process.env, ...env, FORCE_COLOR: '0', TERM: 'dumb' },
    });

    let stdout = '';
    let stderr = '';
    let killedByTimeout = false;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, stdout, stderr: `${stderr}\n${err.message}`, killedByTimeout });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr, killedByTimeout });
    });
  });
}

/** Registry of background services, keyed by project so runs cannot cross wires. */
const services = new Map();

function serviceKey(projectId) {
  if (!services.has(projectId)) services.set(projectId, new Map());
  return services.get(projectId);
}

async function waitForPort(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise((resolve) => {
      const socket = net.createConnection({ port, host: '127.0.0.1' });
      socket.setTimeout(700);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
      socket.once('error', () => { socket.destroy(); resolve(false); });
    });
    if (open) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

export function stopAllServices(projectId) {
  for (const service of serviceKey(projectId).values()) {
    if (!service.child.killed) service.child.kill('SIGTERM');
  }
  serviceKey(projectId).clear();
}

export function listServices(projectId) {
  return [...serviceKey(projectId).values()].map((s) => ({
    id: s.id,
    name: s.name,
    command: s.command,
    port: s.port,
    alive: !s.child.killed && s.child.exitCode === null,
    preview_url: s.previewUrl,
  }));
}

export function previewUrlFor(port) {
  if (!config.previewBaseUrl) return `http://localhost:${port}`;
  return config.previewBaseUrl.replace('{port}', String(port));
}

/**
 * Execute one tool call. Always resolves to a string the model can read;
 * failures come back as text rather than throwing, so the agent can recover.
 */
export async function executeTool({ projectId, workspace, name, args, signal }) {
  const input = args ?? {};

  switch (name) {
    case 'read_file': {
      const target = resolveInWorkspace(workspace, input.path);
      if (!fs.existsSync(target)) throw new ToolError(`no such file: ${input.path}`);
      const stat = fs.statSync(target);
      if (stat.isDirectory()) throw new ToolError(`${input.path} is a directory; use list_dir`);
      if (stat.size > 2_000_000) throw new ToolError('file is larger than 2 MB');

      const lines = fs.readFileSync(target, 'utf8').split('\n');
      const start = Math.max(1, Number(input.start_line) || 1);
      const end = Math.min(lines.length, Number(input.end_line) || lines.length);
      const slice = lines.slice(start - 1, end);
      const numbered = slice.map((line, i) => `${String(start + i).padStart(5)}| ${line}`).join('\n');
      return truncate(`${input.path} (lines ${start}-${end} of ${lines.length})\n${numbered}`, config.agent.maxToolResultChars);
    }

    case 'write_file': {
      const target = resolveInWorkspace(workspace, input.path);
      if (typeof input.content !== 'string') throw new ToolError('content must be a string');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, input.content, 'utf8');
      return `wrote ${input.content.length} chars to ${input.path}`;
    }

    case 'edit_file': {
      const target = resolveInWorkspace(workspace, input.path);
      if (!fs.existsSync(target)) throw new ToolError(`no such file: ${input.path}`);
      const original = fs.readFileSync(target, 'utf8');
      const occurrences = original.split(String(input.old_text)).length - 1;
      if (occurrences === 0) throw new ToolError('old_text not found in the file');
      if (occurrences > 1) throw new ToolError(`old_text matches ${occurrences} times; it must be unique`);
      const updated = original.replace(String(input.old_text), String(input.new_text));
      fs.writeFileSync(target, updated, 'utf8');
      return `edited ${input.path} (${original.length} -> ${updated.length} chars)`;
    }

    case 'list_dir': {
      const start = input.path ? resolveInWorkspace(workspace, input.path) : workspace;
      const maxDepth = Math.min(Math.max(Number(input.depth) || 3, 1), 6);
      const out = [];

      const walk = (dir, depth) => {
        if (depth > maxDepth) return;
        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (IGNORED_DIRS.has(entry.name)) continue;
          const relative = relTo(workspace, path.join(dir, entry.name));
          out.push(`${'  '.repeat(depth - 1)}${entry.isDirectory() ? `${relative}/` : relative}`);
          if (entry.isDirectory()) walk(path.join(dir, entry.name), depth + 1);
          if (out.length > 600) return;
        }
      };

      walk(start, 1);
      return out.length ? truncate(out.join('\n'), config.agent.maxToolResultChars) : '(empty directory)';
    }

    case 'search': {
      let regex;
      try {
        regex = new RegExp(String(input.pattern), 'i');
      } catch (err) {
        throw new ToolError(`invalid regex: ${err.message}`);
      }
      const start = input.path ? resolveInWorkspace(workspace, input.path) : workspace;
      const matches = [];

      const scan = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (IGNORED_DIRS.has(entry.name)) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scan(full);
          } else if (entry.isFile() && fs.statSync(full).size < 1_000_000) {
            const text = fs.readFileSync(full, 'utf8');
            if (text.includes('\u0000')) continue;
            text.split('\n').forEach((line, index) => {
              if (regex.test(line) && matches.length < 200) {
                matches.push(`${relTo(workspace, full)}:${index + 1}: ${line.trim().slice(0, 200)}`);
              }
            });
          }
          if (matches.length >= 200) return;
        }
      };

      scan(start);
      return matches.length ? matches.join('\n') : `no matches for /${input.pattern}/i`;
    }

    case 'bash': {
      const cwd = input.cwd ? resolveInWorkspace(workspace, input.cwd) : workspace;
      const timeoutMs = Math.min(Math.max(Number(input.timeout_seconds) || 120, 1), 600) * 1000;
      const { exitCode, stdout, stderr, killedByTimeout } = await runProcess(String(input.command), {
        cwd,
        timeoutMs,
        env: {},
      });
      const body = [
        `exit_code: ${exitCode}`,
        killedByTimeout ? `(killed after ${timeoutMs / 1000}s timeout)` : '',
        stdout ? `--- stdout ---\n${stdout}` : '',
        stderr ? `--- stderr ---\n${stderr}` : '',
      ].filter(Boolean).join('\n');
      return truncate(body || '(no output)', config.agent.maxToolResultChars);
    }

    case 'start_service': {
      const port = Number(input.port);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new ToolError('port must be 1-65535');
      const cwd = input.cwd ? resolveInWorkspace(workspace, input.cwd) : workspace;
      const registry = serviceKey(projectId);
      const existing = [...registry.values()].find((s) => s.port === port);
      if (existing) {
        return `port ${port} is already served by service "${existing.name}" (${existing.id}).\nPreview: ${existing.previewUrl}`;
      }

      const id = `svc_${port}_${Math.random().toString(36).slice(2, 6)}`;
      const child = spawn('bash', ['-lc', String(input.command)], {
        cwd,
        env: { ...process.env, PORT: String(port), HOST: '0.0.0.0', FORCE_COLOR: '0' },
        detached: true,
      });

      let logs = '';
      const append = (chunk) => {
        logs = (logs + chunk.toString()).slice(-40_000);
      };
      child.stdout.on('data', append);
      child.stderr.on('data', append);

      const record = {
        id,
        name: String(input.name || `service-${port}`),
        command: String(input.command),
        port,
        child,
        logs: () => logs,
        previewUrl: previewUrlFor(port),
        startedAt: new Date().toISOString(),
      };
      registry.set(id, record);
      child.on('close', (code) => { record.exitCode = code; });

      const listening = await waitForPort(port, 30_000);
      return [
        `service "${record.name}" started (id ${id}).`,
        listening ? `port ${port} is accepting connections.` : `WARNING: port ${port} not listening after 30s.`,
        `preview: ${record.previewUrl}`,
        logs.trim() ? `--- startup logs ---\n${logs.trim().slice(-2000)}` : '',
      ].filter(Boolean).join('\n');
    }

    case 'read_logs': {
      const registry = serviceKey(projectId);
      const wanted = String(input.name);
      const service =
        registry.get(wanted) ?? [...registry.values()].find((s) => s.name === wanted || s.port === Number(wanted));
      if (!service) {
        const known = [...registry.values()].map((s) => `${s.name} (${s.id}, port ${s.port})`).join(', ');
        throw new ToolError(`no such service: ${wanted}. Known services: ${known || 'none'}`);
      }
      const lines = Number(input.lines) || 100;
      const tail = service.logs().split('\n').slice(-lines).join('\n');
      return `--- ${service.name} (port ${service.port}, ${service.child.exitCode === null ? 'running' : `exited ${service.child.exitCode}`}) ---\n${tail || '(no output yet)'}`;
    }

    case 'stop_service': {
      const registry = serviceKey(projectId);
      const wanted = String(input.name);
      const service =
        registry.get(wanted) ?? [...registry.values()].find((s) => s.name === wanted || s.port === Number(wanted));
      if (!service) throw new ToolError(`no such service: ${wanted}`);
      if (!service.child.killed) service.child.kill('SIGTERM');
      registry.delete(service.id);
      return `stopped ${service.name} (port ${service.port})`;
    }

    case 'browse': {
      const maxChars = Math.min(Number(input.max_chars) || 4000, 20_000);
      const response = await fetch(String(input.url), { redirect: 'follow', signal });
      const body = await response.text();
      const text = body
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return [
        `GET ${input.url}`,
        `status: ${response.status} ${response.statusText}`,
        `content-type: ${response.headers.get('content-type') ?? 'unknown'}`,
        `--- body ---`,
        truncate(text || '(empty)', maxChars),
      ].join('\n');
    }

    case 'web_search': {
      const query = String(input.query);
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36' },
        signal,
      });
      const html = await response.text();
      const results = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
        .slice(0, 6)
        .map(([, href, title], i) => `${i + 1}. ${title.replace(/<[^>]+>/g, '').trim()}\n   ${decodeURIComponent(href.replace(/^.*uddg=/, '').replace(/&rut=.*$/, ''))}`);
      return results.length ? results.join('\n') : `no results for: ${query}`;
    }

    default:
      throw new ToolError(`unknown tool: ${name}`);
  }
}
