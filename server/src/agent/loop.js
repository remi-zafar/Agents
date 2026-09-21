import { historyForModel, messages, runs, toolCalls } from '../db/index.js';
import { config } from '../env.js';
import { resolveProvider } from '../providers/index.js';
import { CONTROL_TOOLS, runTool } from '../tools/handlers.js';
import { loadSystemPrompt } from './system-prompt.js';

const provider = resolveProvider();
const systemPrompt = loadSystemPrompt();

/**
 * One agent turn: model -> tool calls -> tool results -> model, until the model
 * stops calling tools, hits the iteration ceiling, or pauses to ask the user.
 *
 * `emit` is the only way state leaves this function, which keeps the loop
 * testable without an HTTP layer.
 */
export async function runAgent({ projectId, workspace, emit, signal }) {
  const runId = runs.start(projectId);
  const startedAt = Date.now();

  try {
    for (let iteration = 1; iteration <= config.agent.maxIterations; iteration += 1) {
      if (signal.aborted) throw new Error('run cancelled');

      const history = [
        { role: 'system', content: systemPrompt },
        ...historyForModel(projectId),
      ];

      let assistantText = '';
      let calls = [];

      for await (const event of provider.stream({
        messages: history,
        context: { projectId, workspace, runId },
        signal,
      })) {
        if (event.type === 'delta') {
          assistantText += event.text;
          emit({ type: 'delta', text: event.text });
        } else if (event.type === 'tool_calls') {
          calls = event.toolCalls;
          if (event.text) assistantText = event.text;
        }
      }

      if (!calls.length) {
        messages.append({ projectId, role: 'assistant', content: assistantText.trim() });
        emit({ type: 'assistant_message', text: assistantText.trim() });
        runs.finish(runId, { status: 'completed' });
        return { status: 'completed', iterations: iteration, ms: Date.now() - startedAt };
      }

      const assistantMessageId = messages.append({
        projectId,
        role: 'assistant',
        content: assistantText.trim(),
        toolCalls: calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
        })),
      });
      emit({ type: 'assistant_message', text: assistantText.trim() });

      for (const call of calls) {
        const toolCallId = toolCalls.start({
          projectId,
          messageId: assistantMessageId,
          iteration,
          name: call.name,
          args: call.args ?? {},
        });
        emit({ type: 'tool_start', id: toolCallId, name: call.name, args: call.args ?? {}, iteration });

        const outcome = await runTool({
          projectId,
          workspace,
          name: call.name,
          args: call.args ?? {},
          signal,
        });

        toolCalls.finish(toolCallId, { result: outcome.text, isError: outcome.isError });
        messages.append({
          projectId,
          role: 'tool',
          content: outcome.text,
          toolCallId: call.id,
          name: call.name,
        });
        emit({
          type: 'tool_result',
          id: toolCallId,
          name: call.name,
          result: outcome.text,
          isError: outcome.isError,
        });

        if (outcome.control?.type === 'ask_user') {
          runs.finish(runId, { status: 'waiting_for_user' });
          emit({ type: 'ask_user', question: outcome.control.payload.question, options: outcome.control.payload.options });
          return { status: 'waiting_for_user', iterations: iteration, ms: Date.now() - startedAt };
        }

        if (outcome.control?.type === 'report_done') {
          runs.finish(runId, { status: 'completed' });
          emit({ type: 'done', payload: outcome.control.payload });
          return {
            status: 'completed',
            iterations: iteration,
            ms: Date.now() - startedAt,
            report: outcome.control.payload,
          };
        }
      }

      emit({ type: 'iteration', iteration });
    }

    runs.finish(runId, { status: 'stopped', error: 'iteration ceiling reached' });
    emit({
      type: 'error',
      message: `Stopped after ${config.agent.maxIterations} tool rounds without a report_done. Raise AGENT_MAX_ITERATIONS or narrow the task.`,
    });
    return { status: 'stopped', iterations: config.agent.maxIterations, ms: Date.now() - startedAt };
  } catch (error) {
    runs.finish(runId, { status: 'failed', error: error.message });
    emit({ type: 'error', message: `${error.name}: ${error.message}` });
    return { status: 'failed', error: error.message, ms: Date.now() - startedAt };
  }
}

export { CONTROL_TOOLS, provider };
