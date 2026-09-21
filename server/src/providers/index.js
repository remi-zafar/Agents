import { TOOL_DEFINITIONS } from '../tools/definitions.js';
import { createOpenAiProvider } from './openai.js';
import { createFakeProvider } from './fake.js';
import { config } from '../env.js';

/**
 * Every provider yields the same event stream:
 *   { type: 'delta',      text }              — assistant prose, token by token
 *   { type: 'tool_calls', toolCalls: [{id, name, args}] } — one round of calls
 *   { type: 'done',       stopReason, usage? }
 */
export function resolveProvider() {
  switch (config.provider) {
    case 'openai':
      return createOpenAiProvider({ ...config.llm, tools: TOOL_DEFINITIONS });
    case 'fake':
      return createFakeProvider({ tools: TOOL_DEFINITIONS });
    default:
      throw new Error(
        `unknown AGENT_PROVIDER "${config.provider}". Use "openai" (any OpenAI-compatible endpoint) or "fake".`,
      );
  }
}

export { TOOL_DEFINITIONS };
