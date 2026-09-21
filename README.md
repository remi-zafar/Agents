# Agents

An **Emergent-class agentic app builder**: describe an application in one line and an
LLM agent scaffolds it, writes the files, starts the services, verifies them over HTTP
and hands back a live preview URL.

The agent runs a real tool-calling loop against a real filesystem and real processes.
Nothing here is a mock of a mock — the demo mode just swaps the LLM for a script.

```
User prompt
   │
   ▼
┌────────────┐   tool_calls    ┌─────────────┐   spawn / fs   ┌──────────────┐
│  LLM       │ ──────────────► │ agent loop  │ ─────────────► │  sandbox     │
│ (provider) │ ◄────────────── │  loop.js    │ ◄───────────── │ workspace/…  │
└────────────┘   tool results  └──────┬──────┘   stdout/exit  └──────┬───────┘
                                      │ SSE                          │ port
                                      ▼                              ▼
                               ┌────────────┐              ┌──────────────────┐
                               │  React UI  │   iframe     │ public preview   │
                               │  client/   │ ◄─────────── │ https://{port}-… │
                               └────────────┘              └──────────────────┘
```

---

## Quick start

```bash
npm install --prefix client      # the server has zero dependencies
npm run dev:server               # agent API  → http://0.0.0.0:8000
npm run dev:client               # builder UI → http://0.0.0.0:3000
```

Open the UI, describe an app, press **Build it**. With the default key-free provider
the agent writes a small task board, starts it on a port, checks `/api/health` over
HTTP, and reports what it verified.

Requires **Node ≥ 22.5** (the server uses the built-in `node:sqlite`).

### Using a real model

```bash
cp server/.env.example server/.env
# then in server/.env:
#   AGENT_PROVIDER=openai
#   LLM_API_KEY=sk-...
#   LLM_MODEL=gpt-4o-mini
```

`LLM_BASE_URL` works with anything OpenAI-compatible: OpenAI, OpenRouter, Together,
Groq, vLLM, Ollama. `server/.env` is gitignored.

---

## What is in the box

| Layer | Where | Notes |
| --- | --- | --- |
| System prompt | `prompts/` | Generic template + this sandbox's filled-in build |
| Agent loop | `server/src/agent/loop.js` | Model → tool calls → results → model, with an iteration ceiling |
| Tools | `server/src/tools/` | 13 tools: filesystem, shell, background services, HTTP, control |
| Sandbox | `workspace/<slug>/` | Per-project directory with a path-traversal guard |
| Providers | `server/src/providers/` | OpenAI-compatible streaming, plus a key-free scripted provider |
| State | `server/src/db/index.js` | SQLite via `node:sqlite` — projects, messages, tool calls, runs |
| Streaming | `server/src/http.js` | SSE writer; 9 event types |
| UI | `client/src/` | React 18 + Vite: transcript, live tool cards, preview iframe, file tree, log console |

**Full explanation of how all of this works — in Roman Urdu — is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).** Read that first if you are here to
learn how Emergent-style agents are built.

---

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Provider, model, paths, project count |
| `GET` | `/api/projects` | List projects with services and preview URLs |
| `POST` | `/api/projects` | `{ prompt, name? }` → creates project + workspace |
| `GET` | `/api/projects/:id` | Full transcript, tool calls and file tree |
| `GET` | `/api/projects/:id/files/*` | Read one workspace file |
| `POST` | `/api/projects/:id/run` | Start the agent; responds with an SSE stream |
| `POST` | `/api/projects/:id/messages` | Answer a paused `ask_user`, resumes the run |

---

## Design decisions worth knowing

- **The server has zero npm dependencies.** `node:http` + `node:sqlite`. Native addons
  such as `better-sqlite3` cannot be compiled in sandboxes where `nodejs.org` headers
  are unreachable, and a build step that can fail is a build step that will fail.
- **Tool failures come back as text, not exceptions.** `ERROR: no such file: …` goes
  into the model's history so the agent can fix its own mistake. This single choice is
  most of what makes an agent feel autonomous.
- **`start_service` waits for the port.** A service is not "started" because `spawn`
  returned; it is started when something answers on TCP. That is why the agent can
  honestly claim a running app.
- **The prompt stays generic, the machine specifics do not.** `arena-notes.js` appends
  a `<runtime_facts>` block, so the shipped prompt is portable and the runtime truth is
  injected at load time.

---

## Roadmap

Git per project · real container/VM sandbox · auth and multi-user · Playwright-based
`browse` with screenshots · `deploy` tool · parallel agents · token and cost metering.
Details in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#10-aage-kya-banta-hai-roadmap).
