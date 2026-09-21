import { useState } from 'react';

const HIDDEN_ARG_KEYS = new Set(['content', 'new_text', 'old_text']);

export default function ToolCallCard({ call }) {
  const [open, setOpen] = useState(false);
  const running = call.status === 'running';

  return (
    <article className={`tool tool-${running ? 'running' : call.isError ? 'error' : 'ok'}`}>
      <button type="button" className="tool-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="tool-status" aria-hidden="true">
          {running ? <span className="spinner" /> : call.isError ? '✕' : '✓'}
        </span>
        <code className="tool-name">{call.name}</code>
        <span className="tool-args">{preview(call.args)}</span>
        <span className="tool-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="tool-body">
          <h4>arguments</h4>
          <pre>{prettyArgs(call.args)}</pre>
          <h4>{call.isError ? 'error' : 'result'}</h4>
          <pre className={call.isError ? 'pre-error' : undefined}>
            {call.result ?? (running ? 'running…' : '(no output)')}
          </pre>
        </div>
      )}
    </article>
  );
}

function preview(args = {}) {
  const shown = Object.entries(args)
    .filter(([key]) => !HIDDEN_ARG_KEYS.has(key))
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');
  const hidden = Object.keys(args).filter((key) => HIDDEN_ARG_KEYS.has(key));
  const text = [shown, hidden.length ? `+${hidden.length} hidden` : ''].filter(Boolean).join(' ');
  return text.replace(/\s+/g, ' ').slice(0, 90) || '—';
}

function prettyArgs(args = {}) {
  const safe = Object.fromEntries(
    Object.entries(args).map(([key, value]) =>
      typeof value === 'string' && value.length > 400 ? [key, `${value.slice(0, 400)}\n… (${value.length} chars)`] : [key, value],
    ),
  );
  return JSON.stringify(safe, null, 2);
}
