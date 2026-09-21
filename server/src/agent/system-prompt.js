import fs from 'node:fs';
import { config } from '../env.js';
import { PREVIEW_ENVIRONMENT_NOTES } from './arena-notes.js';

/**
 * The shipped prompt document wraps the prompt body in a markdown fence so it
 * renders nicely on GitHub. For the model we want the body only.
 */
function extractPromptBody(markdown) {
  const firstFence = markdown.indexOf('```');
  if (firstFence === -1) return markdown.trim();
  const bodyStart = markdown.indexOf('\n', firstFence) + 1;
  const lastFence = markdown.lastIndexOf('```');
  if (lastFence <= bodyStart) return markdown.slice(bodyStart).trim();
  return markdown.slice(bodyStart, lastFence).trim();
}

export function loadSystemPrompt() {
  for (const file of [config.systemPromptFile, config.systemPromptFallbackFile]) {
    if (fs.existsSync(file)) {
      return `${extractPromptBody(fs.readFileSync(file, 'utf8'))}\n\n${PREVIEW_ENVIRONMENT_NOTES}`;
    }
  }
  throw new Error(`no system prompt found at ${config.systemPromptFile}`);
}
