import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  answerAgent,
  createProject,
  getHealth,
  getProject,
  listProjects,
  startRun,
} from './api/client.js';
import Sidebar from './components/Sidebar.jsx';
import Timeline from './components/Timeline.jsx';
import Composer from './components/Composer.jsx';
import Inspector from './components/Inspector.jsx';

const uid = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

/** Merge persisted messages and tool calls into one chronological transcript. */
function buildTimeline(project) {
  const rows = project.tool_calls ?? [];
  const items = [];
  let cursor = 0;

  for (const message of project.messages ?? []) {
    if (message.role === 'user') {
      items.push({ kind: 'user', id: message.id, text: message.content, at: message.created_at });
      continue;
    }
    if (message.role !== 'assistant') continue;

    if (message.content) items.push({ kind: 'assistant', id: message.id, text: message.content, at: message.created_at });
    for (const call of message.tool_calls ?? []) {
      const row = rows[cursor];
      cursor += 1;
      items.push({
        kind: 'tool',
        id: row?.id ?? call.id,
        name: call.function.name,
        args: safeJson(call.function.arguments),
        result: row?.result ?? null,
        isError: Boolean(row?.is_error),
        status: row?.status ?? 'running',
      });
    }
  }
  return items;
}

function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [streamingText, setStreamingText] = useState('');
  const [files, setFiles] = useState([]);
  const [services, setServices] = useState([]);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [report, setReport] = useState(null);
  const [pendingQuestion, setPendingQuestion] = useState(null);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const [mobilePanel, setMobilePanel] = useState('chat');
  const abortRef = useRef(null);

  const log = useCallback((line) => {
    const stamp = new Date().toLocaleTimeString([], { hour12: false });
    setLogs((previous) => [...previous.slice(-400), { id: uid('log'), at: stamp, line }]);
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    getHealth().then(setHealth).catch((err) => setError(err.message));
    refreshProjects();
  }, [refreshProjects]);

  const openProject = useCallback(
    async (id) => {
      setSelectedId(id);
      setError(null);
      setStreamingText('');
      setReport(null);
      setPendingQuestion(null);
      try {
        const project = await getProject(id);
        setTimeline(buildTimeline(project));
        setFiles(project.files ?? []);
        setServices(project.services ?? []);
        setPreviewUrl(project.preview_url ?? null);
        setPendingQuestion(project.status === 'waiting_for_user' ? { question: 'The agent is waiting for your answer.', options: [] } : null);
      } catch (err) {
        setError(err.message);
      }
    },
    [],
  );

  /** Every SSE frame from the run lands here; this is the whole live UI contract. */
  const onEvent = useCallback(
    (event, data) => {
      switch (event) {
        case 'delta':
          setStreamingText((previous) => previous + (data.text ?? ''));
          break;

        case 'assistant_message':
          setStreamingText('');
          if (data.text) setTimeline((previous) => [...previous, { kind: 'assistant', id: uid('msg'), text: data.text }]);
          break;

        case 'tool_start':
          log(`→ ${data.name}(${summariseArgs(data.args)})`);
          setTimeline((previous) => [
            ...previous,
            { kind: 'tool', id: data.id, name: data.name, args: data.args, status: 'running' },
          ]);
          break;

        case 'tool_result': {
          log(`← ${data.name}: ${data.isError ? 'ERROR ' : ''}${firstLine(data.result)}`);
          setTimeline((previous) =>
            previous.map((item) =>
              item.id === data.id
                ? { ...item, result: data.result, isError: data.isError, status: data.isError ? 'error' : 'ok' }
                : item,
            ),
          );
          break;
        }

        case 'project':
          if (data.preview_url) setPreviewUrl(data.preview_url);
          if (Array.isArray(data.services)) setServices(data.services);
          break;

        case 'done':
          setReport(data.payload ?? null);
          if (data.payload?.previewPort) log(`preview port ${data.payload.previewPort}`);
          break;

        case 'ask_user':
          setPendingQuestion({ question: data.question, options: data.options ?? [] });
          log(`? ${data.question}`);
          break;

        case 'run_finished':
          log(`run ${data.status} in ${data.iterations ?? 0} rounds / ${((data.ms ?? 0) / 1000).toFixed(1)}s`);
          break;

        case 'error':
          setError(data.message);
          log(`! ${data.message}`);
          break;

        default:
          break;
      }
    },
    [log],
  );

  const runWith = useCallback(
    async (starter) => {
      setError(null);
      setReport(null);
      setRunning(true);
      setStreamingText('');
      abortRef.current = new AbortController();
      try {
        await starter({ onEvent, signal: abortRef.current.signal });
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message);
      } finally {
        setRunning(false);
        setStreamingText('');
        setPendingQuestion(null);
        if (selectedId) {
          try {
            const project = await getProject(selectedId);
            setTimeline(buildTimeline(project));
            setFiles(project.files ?? []);
            setServices(project.services ?? []);
            setPreviewUrl(project.preview_url ?? null);
          } catch {
            /* the transcript we already streamed is good enough */
          }
        }
        refreshProjects();
      }
    },
    [onEvent, refreshProjects, selectedId],
  );

  const onCreate = useCallback(
    async (prompt) => {
      try {
        const project = await createProject(prompt);
        await refreshProjects();
        setSelectedId(project.id);
        setTimeline([{ kind: 'user', id: uid('msg'), text: prompt }]);
        setFiles([]);
        setServices([]);
        setReport(null);
        log(`project ${project.slug} created`);
        await runWith(({ onEvent: handler, signal }) => startRun(project.id, { onEvent: handler, signal }));
      } catch (err) {
        setError(err.message);
      }
    },
    [log, refreshProjects, runWith],
  );

  const onSend = useCallback(
    async (text) => {
      if (!selectedId) return onCreate(text);
      setTimeline((previous) => [...previous, { kind: 'user', id: uid('msg'), text }]);
      await runWith(({ onEvent: handler, signal }) => startRun(selectedId, { onEvent: handler, signal }));
    },
    [onCreate, selectedId, runWith],
  );

  const onAnswer = useCallback(
    async (text) => {
      if (!selectedId) return;
      setPendingQuestion(null);
      setTimeline((previous) => [...previous, { kind: 'user', id: uid('msg'), text }]);
      await runWith(({ onEvent: handler, signal }) => answerAgent(selectedId, text, { onEvent: handler, signal }));
    },
    [runWith, selectedId],
  );

  const headerMeta = useMemo(
    () => [
      health ? `provider ${health.provider}` : 'connecting…',
      health ? `model ${health.model}` : null,
      running ? 'running' : null,
    ].filter(Boolean),
    [health, running],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>Agents</h1>
            <p>agentic full-stack app builder</p>
          </div>
        </div>
        <div className="topbar-meta">
          {headerMeta.map((item) => (
            <span key={item} className={`chip ${item === 'running' ? 'chip-live' : ''}`}>
              {item === 'running' && <span className="pulse" aria-hidden="true" />}
              {item}
            </span>
          ))}
        </div>
      </header>

      <nav className="mobile-tabs" aria-label="Panels">
        {['chat', 'preview', 'files', 'logs'].map((panel) => (
          <button
            key={panel}
            type="button"
            className={mobilePanel === panel ? 'tab tab-active' : 'tab'}
            onClick={() => setMobilePanel(panel)}
          >
            {panel}
          </button>
        ))}
      </nav>

      <div className="layout">
        <aside className={`pane pane-sidebar ${mobilePanel === 'chat' ? 'mobile-show' : ''}`}>
          <Sidebar projects={projects} selectedId={selectedId} onSelect={openProject} onCreate={onCreate} />
        </aside>

        <main className={`pane pane-chat ${mobilePanel === 'chat' ? 'mobile-show' : ''}`}>
          <Timeline
            timeline={timeline}
            streamingText={streamingText}
            report={report}
            running={running}
            error={error}
            hasProject={Boolean(selectedId)}
          />
          {pendingQuestion && (
            <div className="ask-card" role="status">
              <p className="ask-question">{pendingQuestion.question}</p>
              <div className="ask-options">
                {(pendingQuestion.options ?? []).map((option) => (
                  <button key={option} type="button" className="btn btn-ghost" disabled={running} onClick={() => onAnswer(option)}>
                    {option}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Composer onSend={pendingQuestion ? onAnswer : onSend} disabled={running} hasProject={Boolean(selectedId)} />
        </main>

        <section className={`pane pane-inspector ${mobilePanel !== 'chat' ? 'mobile-show' : ''}`}>
          <Inspector
            panel={mobilePanel === 'chat' ? 'preview' : mobilePanel}
            previewUrl={previewUrl}
            services={services}
            files={files}
            logs={logs}
            projectId={selectedId}
          />
        </section>
      </div>
    </div>
  );
}

function summariseArgs(args = {}) {
  const parts = Object.entries(args).map(([key, value]) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return `${key}=${text.length > 48 ? `${text.slice(0, 48)}…` : text}`;
  });
  return parts.join(', ').replace(/\s+/g, ' ').slice(0, 120);
}

function firstLine(text = '') {
  const line = String(text).split('\n').find((candidate) => candidate.trim()) ?? '';
  return line.trim().slice(0, 160);
}
