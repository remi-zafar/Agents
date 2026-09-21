import { config } from '../env.js';

/**
 * Appended to the generic system prompt so the agent knows the machine it is
 * actually running on. Keeping this separate means the shipped prompt stays
 * portable and only this block is environment-specific.
 */
export const PREVIEW_ENVIRONMENT_NOTES = `<runtime_facts>
These override any conflicting value above. They describe the machine you are on right now.

  Working directory : the project workspace given to you per run (relative paths resolve there)
  Runtime           : Node ${process.versions.node}, Python ${process.env.PYTHON_VERSION ?? '3.11'}
  Database          : SQLite by default (no Postgres server is installed)
  Object storage    : none — write uploads to the workspace filesystem
  Preview           : services must bind 0.0.0.0; each listening port is proxied at
                      ${config.previewBaseUrl || 'http://localhost:{port}'}
  Secrets           : never print them, never commit them; read from process.env

TOOL DIFFERENCES FROM THE PROMPT ABOVE
  - browse(url) returns status, headers and the extracted page text. There is no
    screenshot and no click/type action; drive interactions with curl or the API.
  - deploy() does not exist. "Deployed" means a service running on a port that is
    reachable through the preview URL. Report that URL.
  - Extra tools you have: stop_service(name) and report_done(summary, preview_port,
    verified, gaps). Call report_done as your final action when the run is finished.
</runtime_facts>`;
