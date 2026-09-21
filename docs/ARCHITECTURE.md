# Emergent-jaisa agent platform kaise kaam karta hai

Yeh document do cheezein karta hai: (1) Emergent / Lovable / Bolt class ke product ka
asli architecture samjhata hai, aur (2) batata hai ke is repo mein woh architecture
kaise implement hua hai — kaun si file kya karti hai.

---

## 1. Product kya hai, asal mein

User ek line likhta hai: *"ek expense claim app bana do"*.
Platform ek **poora chalta hua application** wapas deta hai — files, database, server,
UI, aur ek public URL.

Yeh chatbot nahi hai. Farq sirf itna hai:

| Chatbot | Agent platform |
| --- | --- |
| Model text likhta hai | Model **tools call** karta hai |
| Output = jawab | Output = **filesystem + chalte hue processes** |
| Ek turn | Ek **loop** (kai turn, khud decide karta hai kab rukna hai) |
| Galti user dekhta hai | Galti agent khud padhta hai aur theek karta hai |

Poora platform 5 layers hai. Neeche har layer ka kaam aur is repo ki file.

---

## 2. Layer 1 — System prompt (agent ka dimaagh)

**Kaam:** model ko batana ke woh kaun hai, uske paas kya tools hain, kaam kis tarteeb
mein karna hai, aur "done" kab bolna hai.

**Repo mein:**
- `prompts/app-builder-system-prompt.md` — generic template (`{{ }}` placeholders ke sath)
- `prompts/app-builder-system-prompt.arena.md` — isi sandbox ke liye bhara hua version;
  **yahi file server load karta hai**
- `server/src/agent/system-prompt.js` — fence strip kar ke sirf prompt body nikaalta hai
- `server/src/agent/arena-notes.js` — ek chhota `<runtime_facts>` block end mein jodta hai,
  taake generic prompt portable rahe aur machine-specific baatein alag rahein

**Sab se important idea:** prompt mein `<verification_protocol>` aur `<error_recovery>`
woh do sections hain jo "agent jo ship karta hai" aur "agent jo dawa karta hai" ke
beech ka farq hain. Inhein kabhi mat kaato.

---

## 3. Layer 2 — Agent loop (dil)

**Kaam:** yeh woh cycle hai jo Emergent ko agent banata hai.

```
   ┌──────────────────────────────────────────────────────────┐
   │  1. Poori history (system + user + assistant + tool)     │
   │     LLM ko bhejo, TOOLS ke sath                          │
   │  2. LLM ya to text likhta hai, ya tool_calls maangta hai │
   │  3. Tool_calls aaye? → har call execute karo             │
   │  4. Har result ko history mein 'tool' role se daalo      │
   │  5. Wapas step 1 ── jab tak model tools maangna band     │
   │     na kar de, ya report_done na call kare               │
   └──────────────────────────────────────────────────────────┘
```

Yeh loop **model ke andar nahi hota** — yeh aap ka apna code hota hai. Model sirf
kehta hai *"mujhe yeh tool, in arguments ke sath, chahiye"*. Baaki sab aap karte ho.

**Repo mein:** `server/src/agent/loop.js`

Do cheezein jo log sab se aksar ghalat karte hain:

1. **Tool result history ka hissa banta hai.** Har `tool_call` ke baad ek `role: "tool"`
   message wapas jaata hai, jismein `tool_call_id` wahi hota hai. Yeh pairing tooti to
   API 400 deta hai.
2. **Ek ceiling zaroori hai.** `AGENT_MAX_ITERATIONS` (default 40). Iske baghair agent
   kabhi kabhi infinite loop mein chala jaata hai aur aap ka bill banta hai.

---

## 4. Layer 3 — Tools (haath aur pair)

**Kaam:** model ke paas filesystem, shell, background processes aur browser nahi hota.
Aap use dete ho — ek defined, limited, safe tarika se.

13 tools, teen qisam ke:

| Qisam | Tools | Kya karte hain |
| --- | --- | --- |
| **Filesystem** | `read_file` `write_file` `edit_file` `list_dir` `search` | project workspace ke andar padhna / likhna |
| **Execution** | `bash` `start_service` `read_logs` `stop_service` | commands aur chalte hue servers |
| **Duniya** | `browse` `web_search` | HTTP check aur docs lookup |
| **Control** | `ask_user` `report_done` | run ko rokna / khatam karna |

**Repo mein:**
- `server/src/tools/definitions.js` — JSON schemas jo model ko bheje jaate hain
- `server/src/tools/runner.js` — asal execution (fs, spawn, ports)
- `server/src/tools/handlers.js` — control tools (`ask_user`, `report_done`)

### Do rules jo kabhi nahi tornay chahiye

**Rule 1 — Path traversal guard.** Model `../../etc/passwd` bhej sakta hai (galti se ya
prompt injection se). Har path pehle resolve karo, phir check karo ke woh workspace ke
andar hi hai:

```js
const absolute = path.resolve(workspace, raw);
if (!absolute.startsWith(path.resolve(workspace) + path.sep)) throw new ToolError(...);
```

**Rule 2 — Tool failure exception nahi, TEXT honi chahiye.** Agar `read_file` throw
kare to loop toot jaata hai. Iske bajaye error ko string bana kar model ko wapas do:

```
ERROR: no such file: src/app.js
```

Ab model khud theek kar lega. **Yehi cheez agent ko "self-healing" banati hai** — yeh
koi jaadu nahi, sirf error messages ka model tak pohanchna hai.

### Background services

`start_service` do kaam karta hai jo `bash` nahi kar sakta:
1. Process ko **zinda rakhta hai** (detached spawn, logs buffer mein)
2. **Port ka wait karta hai** (30s tak TCP connect try karta hai) aur preview URL deta hai

Isi liye agent "server chalu hai" bolne se pehle jaan sakta hai ke server waqai chalu hai.

---

## 5. Layer 4 — Sandbox (deewar)

**Kaam:** agent ka code user ki machine par nahi chalna chahiye. Emergent isi liye
**E2B / Firecracker microVM** use karta hai — har user ka apna chhota Linux VM.

Is repo mein sandbox = **har project ki apni directory**:

```
workspace/
  build-me-a-small-task-board/     ← project A ka poora sansar
    server.mjs
    public/index.html
  expense-claims/                  ← project B, alag
```

Har tool call isi directory ke andar qaid hai (Rule 1 upar).

**Production mein isko barhana ho to:** E2B SDK, Docker containers, ya Firecracker —
interface wahi rahega, sirf `runner.js` badlega. Isliye saara execution ek hi file
mein rakha gaya hai.

---

## 6. Layer 5 — Streaming + preview (user ko dikhta hua hissa)

**Kaam:** ek run 30 second se 10 minute tak chalta hai. Agar user ko kuch na dikhe to
woh chala jaata hai. Isi liye **SSE (Server-Sent Events)** use hoti hai.

### SSE event contract

| Event | Kab | Payload |
| --- | --- | --- |
| `delta` | model ka har token | `{ text }` |
| `assistant_message` | ek assistant turn poora hua | `{ text }` |
| `tool_start` | tool execute hone se pehle | `{ id, name, args, iteration }` |
| `tool_result` | tool ke baad | `{ id, name, result, isError }` |
| `ask_user` | agent ne sawal poocha | `{ question, options }` |
| `done` | `report_done` call hua | `{ summary, verified, gaps, previewPort }` |
| `project` | status / preview URL badla | poora project object |
| `run_finished` | stream band hone se pehle | `{ status, iterations, ms }` |
| `error` | kuch toota | `{ message }` |

`EventSource` sirf GET support karta hai, aur humein POST chahiye — isliye client
`fetch()` + `ReadableStream` reader use karta hai (`client/src/api/client.js`).

### Preview

Sandbox ka har listening port ek public URL ban jaata hai:

```
port 4384  →  https://4384-<sandbox-id>.e2b.app
```

UI us URL ko iframe mein embed kar deta hai. **Zaroori:** services `0.0.0.0` par bind
honi chahiye, `127.0.0.1` par nahi — warna proxy pohanch nahi sakta.

Aur browser kabhi `localhost:8000` call nahi karta. Vite dev server `/api` ko proxy
karta hai (`client/vite.config.js`), isliye UI aur API ek hi origin se aate hain.

---

## 7. Is repo ka file map

```
Agents/
├── prompts/
│   ├── app-builder-system-prompt.md          generic template ({{ }} ke sath)
│   └── app-builder-system-prompt.arena.md    ← server yahi load karta hai
│
├── server/                                   ZERO npm dependencies
│   ├── .env / .env.example                   provider, ports, limits, secrets
│   └── src/
│       ├── index.js                          node:http server + routing
│       ├── http.js                           router, SSE writer, JSON body
│       ├── env.js                            config + .env loader
│       ├── db/index.js                       node:sqlite schema + queries
│       ├── agent/
│       │   ├── loop.js                       ← AGENT LOOP (Layer 2)
│       │   ├── system-prompt.js              prompt load + fence strip
│       │   └── arena-notes.js                <runtime_facts> block
│       ├── providers/
│       │   ├── index.js                      provider resolver
│       │   ├── openai.js                     OpenAI-compatible streaming + tool calls
│       │   └── fake.js                       key-free scripted run (demo/tests)
│       ├── tools/
│       │   ├── definitions.js                13 JSON schemas (Layer 3)
│       │   ├── runner.js                     execution + sandbox guard (Layer 4)
│       │   └── handlers.js                   control tools
│       └── routes/api.js                     REST + SSE endpoints
│
├── client/                                   React 18 + Vite
│   └── src/
│       ├── api/client.js                     fetch + SSE stream reader
│       ├── App.jsx                           state machine, event handling
│       ├── components/
│       │   ├── Sidebar.jsx                   projects + new-project form
│       │   ├── Timeline.jsx                  transcript + report card
│       │   ├── ToolCallCard.jsx              live tool call, expandable
│       │   ├── Composer.jsx                  message input
│       │   └── Inspector.jsx                 preview / files / logs
│       └── styles/app.css                    design tokens + layout
│
├── workspace/                                har generated project yahan (gitignored)
└── data/agents.db                            SQLite (gitignored)
```

---

## 8. Ek run ka poora safar

```
User: "ek task board bana do"
  │
  ├─ POST /api/projects          → workspace/<slug>/ banta hai, prompt DB mein
  ├─ POST /api/projects/:id/run  → SSE stream khulti hai
  │
  ├─ loop iteration 1:  model → write_file(server.mjs)      → disk par likha
  ├─ loop iteration 2:  model → write_file(public/index.html)
  ├─ loop iteration 3:  model → write_file(package.json)
  ├─ loop iteration 4:  model → start_service(node server.mjs, port 4384)
  │                              → spawn, 30s port wait, preview URL
  ├─ loop iteration 5:  model → browse(http://127.0.0.1:4384/api/health)
  │                              → 200 {"ok":true} ← AB model ko yaqeen hai
  ├─ loop iteration 6:  model → report_done(summary, preview_port: 4384)
  │
  └─ UI: preview iframe mein app live, files panel mein code, logs mein trail
```

Yeh poora run **1.5 second** mein hota hai (scripted provider ke sath). Real LLM ke
sath 1–5 minute, kyunke model sochta hai.

---

## 9. Real LLM par switch karna

`server/.env`:

```
AGENT_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

`LLM_BASE_URL` badal kar yeh OpenRouter, Together, Groq, vLLM ya local Ollama — kisi
par bhi chalega, kyunke sab OpenAI-compatible `chat/completions` bolte hain.

**Model chunne ka rule:** tool-calling strong honi chahiye aur context lamba hona
chahiye. Chhote models tool arguments mein JSON tod dete hain.

---

## 10. Aage kya banta hai (roadmap)

| # | Feature | Kyun | Kahan |
| --- | --- | --- | --- |
| 1 | **Git per project** | versioning, rollback, "pichla version wapas lao" | `runner.js` mein `bash git ...` |
| 2 | **Real sandbox** | isolation — Docker ya E2B | sirf `runner.js` badalna hai |
| 3 | **Auth + multi-user** | har user ke apne projects | `routes/api.js` par middleware |
| 4 | **Browser tool** | Playwright se clicks, screenshots, console errors | naya tool `browse` ki jagah |
| 5 | **Deploy** | Vercel/Fly/Render par publish | naya tool `deploy` |
| 6 | **Parallel agents** | frontend aur backend ek sath | `loop.js` mein orchestration |
| 7 | **Cost + token metering** | `usage` SSE mein already aata hai, dikhana baaki hai | `providers/*` → UI |

---

## 11. Common failure modes (aur unka ilaaj)

| Symptom | Asal wajah | Ilaaj |
| --- | --- | --- |
| Model tool call karta hi nahi | `tools` payload mein nahi gaya, ya model chhota hai | `providers/openai.js` ka request body check karo |
| `400: tool_call_id missing` | tool result ka id assistant ke call se match nahi karta | `loop.js` mein pairing dekho |
| Agent bar bar ek hi galti karta hai | error message model tak poora nahi pohanch raha | result truncate na karo, stack trace bhejo |
| Server "chalu" hai magar preview khali | `127.0.0.1` par bind hua hai | `HOST=0.0.0.0` |
| Preview CORS error de raha hai | browser ne direct backend call ki | Vite proxy use karo, relative URLs |
| Run kabhi khatam nahi hota | iteration ceiling nahi hai | `AGENT_MAX_ITERATIONS` |
| Native module install fail | sandbox mein headers blocked hain | zero-dep ya pure JS chuno (isi liye `node:sqlite`) |
