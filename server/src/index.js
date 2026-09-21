import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { config } from './env.js';
import { errorResponse } from './http.js';
import { router } from './routes/api.js';

fs.mkdirSync(config.workspaceRoot, { recursive: true });
fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

const server = http.createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', req.headers.origin ?? '*');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const matched = router.handle(req, res, url);

  if (!matched) return errorResponse(res, 404, 'NOT_FOUND', `no route for ${req.method} ${url.pathname}`);
  if (matched.methodNotAllowed) {
    return errorResponse(res, 405, 'METHOD_NOT_ALLOWED', `${req.method} is not allowed on ${url.pathname}`);
  }

  try {
    await matched.handler(req, res, url, matched.params);
  } catch (error) {
    console.error('[error]', `${req.method} ${url.pathname}`, error);
    if (!res.headersSent) errorResponse(res, 500, 'INTERNAL', error.message);
    else res.end();
  }
});

server.listen(config.port, config.host, () => {
  console.log(`[server] agent API on http://${config.host}:${config.port}`);
  console.log(`[server] provider=${config.provider} model=${config.provider === 'fake' ? 'scripted-demo' : config.llm.model}`);
  console.log(`[server] workspace=${config.workspaceRoot}`);
  console.log(`[server] db=${config.dbFile}`);
  if (config.previewBaseUrl) console.log(`[server] preview=${config.previewBaseUrl}`);
});
