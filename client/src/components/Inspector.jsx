import { useEffect, useState } from 'react';
import { getFile } from '../api/client.js';

const PANELS = ['preview', 'files', 'logs'];

/**
 * Right-hand pane. On wide screens all three panels are stacked and the tabs
 * scroll to one; on narrow screens the tabs switch between them.
 */
export default function Inspector({ panel, previewUrl, services, files, logs, projectId }) {
  const [narrow, setNarrow] = useState(
    typeof window === 'undefined' ? false : window.matchMedia('(max-width: 900px)').matches,
  );
  const [tab, setTab] = useState('preview');

  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)');
    const update = (event) => setNarrow(event.matches);
    update(query);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const active = narrow ? (panel === 'chat' ? tab : panel) : null;

  function onTab(next) {
    setTab(next);
    if (!narrow) document.querySelector(`[data-panel="${next}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="inspector">
      <div className="inspector-tabs" role="tablist" aria-label="Inspector">
        {PANELS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={tab === name ? 'inspector-tab inspector-tab-active' : 'inspector-tab'}
            onClick={() => onTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="inspector-body">
        <section data-panel="preview" className={isVisible('preview', active, narrow)}>
          <PreviewPanel previewUrl={previewUrl} services={services} />
        </section>
        <section data-panel="files" className={isVisible('files', active, narrow)}>
          <FileTree files={files} projectId={projectId} />
        </section>
        <section data-panel="logs" className={isVisible('logs', active, narrow)}>
          <LogConsole logs={logs} />
        </section>
      </div>
    </div>
  );
}

function isVisible(name, active, narrow) {
  if (!narrow) return 'panel panel-active';
  return active === name ? 'panel panel-active' : 'panel';
}

function PreviewPanel({ previewUrl, services }) {
  if (!previewUrl) {
    return (
      <div className="empty-state empty-state-small">
        <h3>No preview yet</h3>
        <p>
          When the agent starts a service its public URL appears here, embedded live. Nothing has
          been started in this project yet.
        </p>
      </div>
    );
  }

  return (
    <div className="preview">
      <div className="preview-bar">
        <code className="preview-url" title={previewUrl}>{previewUrl}</code>
        <a className="btn btn-ghost btn-small" href={previewUrl} target="_blank" rel="noreferrer">
          open ↗
        </a>
      </div>
      <iframe className="preview-frame" src={previewUrl} title="Generated app preview" />
      {services.length > 0 && (
        <ul className="service-list">
          {services.map((service) => (
            <li key={service.id}>
              <span className={`dot ${service.alive ? 'dot-running' : 'dot-idle'}`} aria-hidden="true" />
              <strong>{service.name}</strong>
              <code>:{service.port}</code>
              <span className="muted">{service.alive ? 'listening' : 'stopped'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FileTree({ files, projectId }) {
  const [openPath, setOpenPath] = useState(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  async function select(node) {
    if (node.type === 'dir') return;
    setOpenPath(node.path);
    setLoading(true);
    try {
      setContent(await getFile(projectId, node.path));
    } catch (err) {
      setContent(`could not read ${node.path}: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  if (!files.length) {
    return (
      <div className="empty-state empty-state-small">
        <h3>No files yet</h3>
        <p>Everything the agent writes lands in this project's workspace and shows up here.</p>
      </div>
    );
  }

  return (
    <div className="files">
      <ul className="tree">{renderNodes(files, select, openPath)}</ul>
      {openPath && (
        <div className="file-view">
          <div className="preview-bar">
            <code className="preview-url">{openPath}</code>
          </div>
          <pre>{loading ? 'loading…' : content}</pre>
        </div>
      )}
    </div>
  );
}

function renderNodes(nodes, select, openPath) {
  return nodes.map((node) =>
    node.type === 'dir' ? (
      <li key={node.path} className="tree-dir">
        <details open>
          <summary>{node.name}/</summary>
          <ul>{renderNodes(node.children ?? [], select, openPath)}</ul>
        </details>
      </li>
    ) : (
      <li key={node.path}>
        <button
          type="button"
          className={openPath === node.path ? 'tree-file tree-file-active' : 'tree-file'}
          onClick={() => select(node)}
        >
          {node.name}
          <span className="muted">{formatBytes(node.size)}</span>
        </button>
      </li>
    ),
  );
}

function LogConsole({ logs }) {
  if (!logs.length) {
    return (
      <div className="empty-state empty-state-small">
        <h3>No output yet</h3>
        <p>Every tool call and its result is logged here as the run streams.</p>
      </div>
    );
  }

  return (
    <pre className="logs">
      {logs.map((entry) => (
        <div key={entry.id}>
          <span className="muted">{entry.at}</span> {entry.line}
        </div>
      ))}
    </pre>
  );
}

function formatBytes(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
