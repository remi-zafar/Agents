/**
 * A ~100-line HTTP layer on node:http. The server has zero npm dependencies on
 * purpose: nothing to compile, nothing to fetch, nothing to break in a sandbox.
 */

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

export const errorResponse = (res, status, code, message, details) =>
  sendJson(res, status, { error: { code, message, ...(details ? { details } : {}) } });

export async function readJsonBody(req, limitBytes = 4_000_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw Object.assign(new Error('request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('body must be valid JSON'), { status: 400 });
  }
}

/** Minimal Server-Sent Events writer. */
export function openSse(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const ping = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15_000);
  ping.unref?.();

  req.on('close', () => clearInterval(ping));

  return {
    send,
    close() {
      clearInterval(ping);
      if (!res.writableEnded) res.end();
    },
  };
}

/** Compile "/api/projects/:id/files/*" into a matcher that yields params. */
function compile(pattern) {
  const parts = pattern.split('/').filter(Boolean);
  return (pathname) => {
    const segments = pathname.split('/').filter(Boolean);
    const params = {};

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (part === '*') {
        params['0'] = segments.slice(i).join('/');
        return params;
      }
      if (i >= segments.length) return null;
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(segments[i]);
      } else if (part !== segments[i]) {
        return null;
      }
    }
    return segments.length === parts.length ? params : null;
  };
}

export function createRouter() {
  const routes = [];

  const register = (method, pattern, handler) => {
    routes.push({ method, match: compile(pattern), handler, pattern });
  };

  return {
    get: (pattern, handler) => register('GET', pattern, handler),
    post: (pattern, handler) => register('POST', pattern, handler),
    delete: (pattern, handler) => register('DELETE', pattern, handler),

    handle(req, res, url) {
      let methodMismatch = false;
      for (const route of routes) {
        const params = route.match(url.pathname);
        if (!params) continue;
        if (route.method !== req.method) {
          methodMismatch = true;
          continue;
        }
        return { handler: route.handler, params };
      }
      return methodMismatch ? { methodNotAllowed: true } : null;
    },
  };
}
