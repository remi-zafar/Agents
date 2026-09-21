/**
 * OpenAI-compatible chat completions with streaming tool calls.
 * Works against api.openai.com, OpenRouter, Together, Groq, vLLM, Ollama —
 * anything that speaks POST {baseUrl}/chat/completions with `stream: true`.
 */
export function createOpenAiProvider({ baseUrl, apiKey, model, tools }) {
  if (!apiKey) {
    throw new Error(
      'AGENT_PROVIDER=openai but LLM_API_KEY is empty. Set it in server/.env, or use AGENT_PROVIDER=fake.',
    );
  }

  return {
    name: 'openai',
    model,

    async *stream({ messages, signal }) {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools,
          tool_choice: 'auto',
          stream: true,
          stream_options: { include_usage: true },
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`LLM request failed (${response.status}): ${detail.slice(0, 600)}`);
      }

      const pending = new Map();
      let text = '';
      let finishReason = null;
      let usage = null;

      for await (const chunk of parseSse(response.body, signal)) {
        if (chunk.usage) usage = chunk.usage;

        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta ?? {};
        if (delta.content) {
          text += delta.content;
          yield { type: 'delta', text: delta.content };
        }

        for (const part of delta.tool_calls ?? []) {
          const key = part.index ?? part.id ?? 0;
          if (!pending.has(key)) {
            pending.set(key, { id: part.id ?? '', name: '', arguments: '' });
          }
          const call = pending.get(key);
          if (part.id) call.id = part.id;
          if (part.function?.name) call.name += part.function.name;
          if (part.function?.arguments) call.arguments += part.function.arguments;
        }
      }

      const toolCalls = [...pending.values()]
        .filter((call) => call.name)
        .map((call) => ({
          id: call.id || `call_${Math.random().toString(36).slice(2, 10)}`,
          name: call.name,
          args: safeParseArgs(call.arguments),
        }));

      if (toolCalls.length) {
        yield { type: 'tool_calls', toolCalls, text };
      }
      yield { type: 'done', stopReason: finishReason ?? (toolCalls.length ? 'tool_calls' : 'stop'), usage };
    },
  };
}

function safeParseArgs(raw) {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { value: parsed };
  } catch {
    return { _raw: raw };
  }
}

/** Split an SSE byte stream into decoded `data:` JSON payloads. */
export async function* parseSse(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('');

        if (data && data !== '[DONE]') {
          try {
            yield JSON.parse(data);
          } catch {
            // Keep going: a malformed frame must not kill the whole run.
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
