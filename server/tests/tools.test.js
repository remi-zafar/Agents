import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { executeTool, resolveInWorkspace, ToolError } from '../src/tools/runner.js';
import { runTool } from '../src/tools/handlers.js';
import { loadSystemPrompt } from '../src/agent/system-prompt.js';
import { TOOL_DEFINITIONS, TOOL_NAMES } from '../src/tools/definitions.js';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-test-'));
const ctx = { projectId: 'prj_test', workspace };

after(() => fs.rmSync(workspace, { recursive: true, force: true }));

describe('sandbox guard', () => {
  it('accepts paths inside the workspace', () => {
    assert.equal(resolveInWorkspace(workspace, 'src/app.js'), path.join(workspace, 'src/app.js'));
  });

  it('rejects traversal above the workspace', () => {
    assert.throws(() => resolveInWorkspace(workspace, '../../etc/passwd'), ToolError);
  });

  it('rejects absolute paths outside the workspace', () => {
    assert.throws(() => resolveInWorkspace(workspace, '/etc/passwd'), ToolError);
  });
});

describe('filesystem tools', () => {
  it('writes, reads and edits a file', async () => {
    await executeTool({ ...ctx, name: 'write_file', args: { path: 'a.txt', content: 'hello world' } });
    assert.equal(fs.readFileSync(path.join(workspace, 'a.txt'), 'utf8'), 'hello world');

    const read = await executeTool({ ...ctx, name: 'read_file', args: { path: 'a.txt' } });
    assert.match(read, /hello world/);

    await executeTool({ ...ctx, name: 'edit_file', args: { path: 'a.txt', old_text: 'world', new_text: 'agent' } });
    assert.equal(fs.readFileSync(path.join(workspace, 'a.txt'), 'utf8'), 'hello agent');
  });

  it('refuses an ambiguous edit', async () => {
    await executeTool({ ...ctx, name: 'write_file', args: { path: 'b.txt', content: 'x\nx\n' } });
    const outcome = await runTool({ ...ctx, name: 'edit_file', args: { path: 'b.txt', old_text: 'x', new_text: 'y' } });
    assert.equal(outcome.isError, true);
    assert.match(outcome.text, /matches 2 times/);
  });

  it('turns a missing file into text the model can act on', async () => {
    const outcome = await runTool({ ...ctx, name: 'read_file', args: { path: 'nope.js' } });
    assert.equal(outcome.isError, true);
    assert.match(outcome.text, /^ERROR: no such file/);
  });

  it('lists and searches the workspace', async () => {
    const listing = await executeTool({ ...ctx, name: 'list_dir', args: {} });
    assert.match(listing, /a\.txt/);

    const found = await executeTool({ ...ctx, name: 'search', args: { pattern: 'hello' } });
    assert.match(found, /a\.txt:1/);
  });
});

describe('bash tool', () => {
  it('reports stdout and exit code', async () => {
    const result = await executeTool({ ...ctx, name: 'bash', args: { command: 'echo hi; exit 3' } });
    assert.match(result, /exit_code: 3/);
    assert.match(result, /hi/);
  });

  it('runs inside the workspace', async () => {
    const result = await executeTool({ ...ctx, name: 'bash', args: { command: 'pwd' } });
    assert.match(result, new RegExp(path.basename(workspace)));
  });
});

describe('control tools', () => {
  it('pauses the run on ask_user', async () => {
    const outcome = await runTool({ ...ctx, name: 'ask_user', args: { question: 'Which DB?', options: ['SQLite', 'Postgres'] } });
    assert.equal(outcome.control.type, 'ask_user');
    assert.deepEqual(outcome.control.payload.options, ['SQLite', 'Postgres']);
  });

  it('reports done with a preview port', async () => {
    const outcome = await runTool({ ...ctx, name: 'report_done', args: { summary: 'Built it.', preview_port: 4321 } });
    assert.equal(outcome.control.type, 'report_done');
    assert.equal(outcome.control.payload.previewPort, 4321);
  });

  it('rejects an unknown tool instead of throwing out of the loop', async () => {
    const outcome = await runTool({ ...ctx, name: 'launch_missiles', args: {} });
    assert.equal(outcome.isError, true);
    assert.match(outcome.text, /unknown tool/);
  });
});

describe('system prompt', () => {
  const prompt = loadSystemPrompt();

  it('strips the markdown wrapper and keeps every section', () => {
    assert.ok(!prompt.startsWith('# AGENTIC'), 'markdown header must not reach the model');
    for (const tag of ['identity', 'core_directives', 'verification_protocol', 'error_recovery']) {
      assert.ok(prompt.includes(`<${tag}>`), `missing <${tag}>`);
    }
  });

  it('appends the runtime facts block', () => {
    assert.match(prompt, /<runtime_facts>/);
    assert.match(prompt, /report_done/);
  });

  it('has no unfilled placeholders in the arena build', () => {
    const arena = fs.readFileSync(new URL('../../prompts/app-builder-system-prompt.arena.md', import.meta.url), 'utf8');
    const open = arena.indexOf('```');
    const body = arena.slice(arena.indexOf('\n', open) + 1, arena.lastIndexOf('```'));
    assert.deepEqual(body.match(/\{\{[^}]*\}\}/g) ?? [], []);
  });
});

describe('tool contracts', () => {
  it('advertises a valid schema for every tool', () => {
    assert.equal(TOOL_DEFINITIONS.length, TOOL_NAMES.length);
    for (const tool of TOOL_DEFINITIONS) {
      assert.equal(tool.type, 'function');
      assert.equal(tool.function.parameters.type, 'object');
      assert.ok(Array.isArray(tool.function.parameters.required) || tool.function.parameters.required === undefined);
    }
  });

  it('keeps prompt names and schema names in sync', () => {
    for (const name of ['read_file', 'write_file', 'edit_file', 'bash', 'start_service', 'read_logs', 'browse', 'web_search', 'ask_user']) {
      assert.ok(TOOL_NAMES.includes(name), `${name} missing from the schemas`);
    }
  });
});
