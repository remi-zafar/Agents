import { useState } from 'react';

const STATUS_LABEL = {
  idle: 'idle',
  running: 'running',
  waiting_for_user: 'waiting',
};

export default function Sidebar({ projects, selectedId, onSelect, onCreate }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(text);
      setPrompt('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sidebar">
      <form className="new-project" onSubmit={submit}>
        <label htmlFor="prompt">Describe the app</label>
        <textarea
          id="prompt"
          rows={4}
          value={prompt}
          placeholder="Build me a tool where my team can submit expense claims and I approve them."
          onChange={(event) => setPrompt(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !prompt.trim()}>
          {busy ? 'Starting…' : 'Build it'}
        </button>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>

      <div className="project-list">
        <h2>Projects</h2>
        {projects.length === 0 ? (
          <p className="empty-note">
            Nothing built yet. Describe an app above and the agent will scaffold it, run it and
            verify it end to end.
          </p>
        ) : (
          <ul>
            {projects.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  className={project.id === selectedId ? 'project project-active' : 'project'}
                  onClick={() => onSelect(project.id)}
                >
                  <span className="project-name">{project.name}</span>
                  <span className="project-meta">
                    <span className={`dot dot-${project.status}`} aria-hidden="true" />
                    {STATUS_LABEL[project.status] ?? project.status}
                    {project.preview_port ? ` · :${project.preview_port}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
