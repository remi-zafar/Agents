/**
 * Key-free provider used for demos, tests and first-run.
 *
 * It is not a toy: it replays a real, complete agent run — write files, start a
 * service, verify it over HTTP, report done — so the whole loop (streaming,
 * tool execution, persistence, preview) can be exercised without an API key.
 */

const SCRIPT_NAME = 'Demo Task Board';

function portForProject(projectId = '') {
  let hash = 0;
  for (const char of String(projectId)) hash = (hash * 31 + char.charCodeAt(0)) % 100_000;
  return 4300 + (hash % 100);
}

const SERVER_SOURCE = `import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE = path.join(here, 'tasks.json');

let tasks = [];
try {
  tasks = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch {
  tasks = [
    { id: 1, title: 'Read the agent system prompt', status: 'done' },
    { id: 2, title: 'Wire the tool runner', status: 'doing' },
    { id: 3, title: 'Ship the preview URL', status: 'todo' },
  ];
}

const persist = () => fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2));

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/health') return send(res, 200, { ok: true, tasks: tasks.length });

  if (url.pathname === '/api/tasks' && req.method === 'GET') {
    return send(res, 200, { data: tasks });
  }

  if (url.pathname === '/api/tasks' && req.method === 'POST') {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    return req.on('end', () => {
      try {
        const input = JSON.parse(raw || '{}');
        const title = String(input.title ?? '').trim();
        if (!title) return send(res, 400, { error: { code: 'VALIDATION_FAILED', message: 'title is required' } });
        const task = { id: Date.now(), title, status: 'todo' };
        tasks.push(task);
        persist();
        send(res, 201, { data: task });
      } catch {
        send(res, 400, { error: { code: 'INVALID_JSON', message: 'body must be JSON' } });
      }
    });
  }

  const staticPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(here, 'public', path.normalize(staticPath).replace(/^(\\.\\.[/\\\\])+/, ''));
  if (file.startsWith(path.join(here, 'public')) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain';
    res.writeHead(200, { 'content-type': type });
    return res.end(fs.readFileSync(file));
  }

  send(res, 404, { error: { code: 'NOT_FOUND', message: \`no route for \${req.method} \${url.pathname}\` } });
});

server.listen(PORT, HOST, () => {
  console.log(\`[demo-app] listening on http://\${HOST}:\${PORT}\`);
});
`;

const PAGE_SOURCE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Demo Task Board</title>
<style>
  :root {
    --bg: #0f1115; --panel: #171a21; --line: #262b36;
    --text: #e7eaf0; --muted: #8d95a7; --accent: #f0a500;
    --radius: 12px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    display: flex; min-height: 100vh; align-items: flex-start; justify-content: center; padding: 48px 16px;
  }
  main { width: 100%; max-width: 560px; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
  p.sub { margin: 0 0 24px; color: var(--muted); font-size: 13px; }
  form { display: flex; gap: 8px; margin-bottom: 24px; }
  input {
    flex: 1; background: var(--panel); border: 1px solid var(--line); color: var(--text);
    border-radius: var(--radius); padding: 10px 12px; font: inherit;
  }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button {
    background: var(--accent); color: #1a1200; border: 0; border-radius: var(--radius);
    padding: 10px 16px; font: inherit; font-weight: 600; cursor: pointer;
    transition: filter 180ms ease-out;
  }
  button:hover { filter: brightness(1.08); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  li {
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 12px 14px; display: flex; align-items: center; gap: 12px;
  }
  .pill {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px;
  }
  .empty { color: var(--muted); border: 1px dashed var(--line); border-radius: var(--radius); padding: 24px; text-align: center; }
  .error { color: #ff8f8f; font-size: 13px; margin-top: 12px; min-height: 18px; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
<main>
  <h1>Demo Task Board</h1>
  <p class="sub">Generated by the agent during a key-free demo run. Data lives in <code>tasks.json</code>.</p>

  <form id="add">
    <label for="title" class="sr-only" style="position:absolute;left:-9999px">New task</label>
    <input id="title" name="title" placeholder="What needs doing?" autocomplete="off" required />
    <button type="submit">Add</button>
  </form>

  <div id="list" class="empty">Loading tasks...</div>
  <div id="error" class="error" role="alert"></div>
</main>

<script>
  const list = document.getElementById('list');
  const error = document.getElementById('error');

  async function load() {
    try {
      const res = await fetch('/api/tasks');
      if (!res.ok) throw new Error('request failed: ' + res.status);
      const { data } = await res.json();
      if (!data.length) {
        list.className = 'empty';
        list.textContent = 'Nothing here yet. Add the first task above.';
        return;
      }
      list.className = '';
      const ul = document.createElement('ul');
      for (const task of data) {
        const li = document.createElement('li');
        const pill = document.createElement('span');
        pill.className = 'pill';
        pill.textContent = task.status;
        const span = document.createElement('span');
        span.textContent = task.title;
        li.append(span, pill);
        ul.append(li);
      }
      list.replaceChildren(ul);
    } catch (err) {
      list.className = 'empty';
      list.textContent = 'Could not load tasks.';
      error.textContent = err.message;
    }
  }

  document.getElementById('add').addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    const input = document.getElementById('title');
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: input.value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? 'could not add task');
      }
      input.value = '';
      await load();
    } catch (err) {
      error.textContent = err.message;
    }
  });

  load();
</script>
</body>
</html>
`;

export function createFakeProvider() {
  return {
    name: 'fake',
    model: 'scripted-demo',

    async *stream({ messages, context }) {
      const port = portForProject(context?.projectId);
      const script = scriptFor(port);
      const round = messages.filter((m) => m.role === 'assistant' && m.tool_calls?.length).length;
      const step = script[Math.min(round, script.length - 1)];

      if (step.say) {
        for (const word of step.say.split(' ')) {
          yield { type: 'delta', text: `${word} ` };
          await sleep(12);
        }
      }

      if (step.call) {
        yield { type: 'tool_calls', toolCalls: [step.call], text: step.say ?? '' };
        yield { type: 'done', stopReason: 'tool_calls' };
        return;
      }

      yield { type: 'done', stopReason: 'stop' };
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function scriptFor(port) {
  return [
    {
      say: `Building "${SCRIPT_NAME}". No API key configured, so this is a scripted run that still exercises the real loop: files on disk, a live service, an HTTP check. Plan: server, page, start, verify.`,
      call: {
        id: 'call_plan',
        name: 'write_file',
        args: { path: 'server.mjs', content: SERVER_SOURCE },
      },
    },
    {
      say: 'Server written. Now the UI.',
      call: { id: 'call_page', name: 'write_file', args: { path: 'public/index.html', content: PAGE_SOURCE } },
    },
    {
      say: 'Manifest next, then I will start it.',
      call: {
        id: 'call_pkg',
        name: 'write_file',
        args: {
          path: 'package.json',
          content: `${JSON.stringify(
            {
              name: 'demo-task-board',
              version: '1.0.0',
              private: true,
              type: 'module',
              scripts: { start: 'node server.mjs' },
            },
            null,
            2,
          )}\n`,
        },
      },
    },
    {
      say: `Starting the service on port ${port}, bound to 0.0.0.0 so the preview proxy can reach it.`,
      call: {
        id: 'call_start',
        name: 'start_service',
        args: { command: 'node server.mjs', port, name: 'Demo app' },
      },
    },
    {
      say: 'Service is up. Verifying it actually answers before I claim anything.',
      call: { id: 'call_browse', name: 'browse', args: { url: `http://127.0.0.1:${port}/api/health` } },
    },
    {
      say: `Verified: the app answers on port ${port} and the page is served. Done.`,
      call: {
        id: 'call_done',
        name: 'report_done',
        args: {
          summary: `Built "${SCRIPT_NAME}": a zero-dependency Node HTTP server with a JSON task API (GET/POST /api/tasks, /api/health) and a dark-themed responsive page with loading, empty and error states. Tasks persist to tasks.json.`,
          preview_port: port,
          verified: `Started the service, confirmed port ${port} accepts connections, and fetched /api/health over HTTP.`,
          gaps: 'Scripted demo run: no LLM reasoning, no auth, no database beyond a JSON file. Set AGENT_PROVIDER=openai and LLM_API_KEY for real builds.',
        },
      },
    },
    {
      say: 'Nothing left to do on this run.',
    },
  ];
}
