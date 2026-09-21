/**
 * All API access lives here. Relative URLs only — the browser reaches this
 * sandbox through the preview proxy, never through localhost.
 */

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = payload?.error?.message ?? `request failed (${response.status})`;
    throw Object.assign(new Error(message), { status: response.status, code: payload?.error?.code });
  }
  return payload.data;
}

export const getHealth = () => fetch('/api/health').then((r) => r.json());

export const listProjects = async () => {
  const payload = await request('/api/projects');
  return payload.data ?? [];
};

export const getProject = (id) => request(`/api/projects/${id}`);

export const createProject = (prompt, name) =>
  request('/api/projects', { method: 'POST', body: JSON.stringify({ prompt, name }) });

export const getFile = async (projectId, path) => {
  const response = await fetch(`/api/projects/${projectId}/files/${path}`);
  if (!response.ok) throw new Error(`could not read ${path}`);
  return response.text();
};

/**
 * Stream one agent run. `onEvent(type, data)` is called for every SSE frame.
 * Returns a promise that resolves when the server closes the stream.
 */
export async function streamRun(url, { body, onEvent, signal }) {
  const response = await fetch(url, {
    method: 'POST',
    signal,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    throw new Error(`run failed (${response.status}) ${detail.slice(0, 200)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const lines = frame.split('\n');
      const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
      const data = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');

      if (event && data) {
        try {
          onEvent(event, JSON.parse(data));
        } catch {
          // A malformed frame must not kill the stream.
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

export const startRun = (projectId, handlers) =>
  streamRun(`/api/projects/${projectId}/run`, { ...handlers });

export const answerAgent = (projectId, content, handlers) =>
  streamRun(`/api/projects/${projectId}/messages`, { body: { content }, ...handlers });
