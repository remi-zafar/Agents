/**
 * The tool contracts advertised to the model. Names are kept identical to the
 * <tools> block of the system prompt so prompt and schema never drift apart.
 */
export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read a text file from the project workspace. Returns the file contents.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the project workspace.' },
          start_line: { type: 'integer', description: 'Optional 1-based first line to return.' },
          end_line: { type: 'integer', description: 'Optional 1-based last line to return.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create a file or overwrite it entirely. Parent directories are created.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the project workspace.' },
          content: { type: 'string', description: 'Full file contents.' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Exact-match replacement inside an existing file. `old_text` must appear exactly once. Preferred over write_file for existing files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_text: { type: 'string', description: 'Text to find. Must be unique in the file.' },
          new_text: { type: 'string', description: 'Replacement text. Empty string deletes.' },
        },
        required: ['path', 'old_text', 'new_text'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List the project workspace as a tree. Skips node_modules and .git.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory to list. Defaults to the root.' },
          depth: { type: 'integer', description: 'Maximum depth. Defaults to 3.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Regex search across the workspace. Returns matching file:line:text entries.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regular expression (JS syntax).' },
          path: { type: 'string', description: 'Restrict to this subdirectory.' },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description:
        'Run a shell command inside the project workspace. Returns stdout, stderr and exit code.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          timeout_seconds: { type: 'integer', description: 'Defaults to 120, max 600.' },
          cwd: { type: 'string', description: 'Subdirectory to run in. Defaults to the root.' },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_service',
      description:
        'Start a long-lived background process (dev server, API). Returns a service id and the ports it bound. Bind servers to 0.0.0.0 so the preview proxy can reach them.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          port: { type: 'integer', description: 'Port the service is expected to listen on.' },
          name: { type: 'string', description: 'Human label shown in the UI, e.g. "Frontend".' },
          cwd: { type: 'string' },
        },
        required: ['command', 'port', 'name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_logs',
      description: 'Tail the output of a service started with start_service.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Service id or name.' },
          lines: { type: 'integer', description: 'Trailing lines to return. Defaults to 100.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_service',
      description: 'Stop a background service.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browse',
      description:
        'Fetch a URL and report status, headers and the page text. Use it to verify a running app responds before reporting success.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          max_chars: { type: 'integer', description: 'Truncate the body. Defaults to 4000.' },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current library APIs, docs and error messages.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description:
        'Pause the run and ask the user one question with concrete options. Expensive: use only when guessing wrong would cause real rework.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'Up to 4 short options. The user may also answer free-form.',
          },
        },
        required: ['question'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'report_done',
      description:
        'Signal that the run is complete. Call only after the verification protocol has passed.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'What was built, in 2-4 lines.' },
          preview_port: { type: 'integer', description: 'Port the finished app is served on.' },
          verified: { type: 'string', description: 'What you actually exercised, one line.' },
          gaps: { type: 'string', description: 'Anything stubbed or deferred.' },
        },
        required: ['summary'],
        additionalProperties: false,
      },
    },
  },
];

export const TOOL_NAMES = TOOL_DEFINITIONS.map((t) => t.function.name);
