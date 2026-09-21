import { ToolError, executeTool, listServices } from './runner.js';

/**
 * Control tools are handled by the runtime rather than the sandbox:
 * they change the state of the run itself.
 */
export const CONTROL_TOOLS = new Set(['ask_user', 'report_done']);

/**
 * @returns {Promise<{text: string, isError: boolean, control?: {type: string, payload: object}}>}
 */
export async function runTool({ projectId, workspace, name, args, signal }) {
  try {
    if (name === 'ask_user') {
      const question = String(args.question ?? '').trim();
      if (!question) throw new ToolError('question is required');
      const options = Array.isArray(args.options) ? args.options.slice(0, 4).map(String) : [];
      return {
        text: `Asked the user: ${question}${options.length ? `\nOptions: ${options.join(' | ')}` : ''}\nThe run is paused until they answer.`,
        isError: false,
        control: { type: 'ask_user', payload: { question, options } },
      };
    }

    if (name === 'report_done') {
      const summary = String(args.summary ?? '').trim();
      if (!summary) throw new ToolError('summary is required');
      const previewPort = Number.isInteger(args.preview_port) ? args.preview_port : null;
      return {
        text: [
          summary,
          args.verified ? `Verified: ${args.verified}` : '',
          args.gaps ? `Gaps: ${args.gaps}` : '',
          previewPort ? `Preview port: ${previewPort}` : '',
        ].filter(Boolean).join('\n'),
        isError: false,
        control: {
          type: 'report_done',
          payload: {
            summary,
            verified: args.verified ?? null,
            gaps: args.gaps ?? null,
            previewPort,
            services: listServices(projectId),
          },
        },
      };
    }

    const text = await executeTool({ projectId, workspace, name, args, signal });
    return { text, isError: false };
  } catch (error) {
    const isError = true;
    const message = error instanceof ToolError ? error.message : `${error.name}: ${error.message}`;
    return { text: `ERROR: ${message}`, isError };
  }
}
