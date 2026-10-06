import { describe, expect, test } from 'claude-code/testing'

import { Lines, agyArgv, agyInput, agyParser, buildPrompt, codexArgv, codexParser, defaultEffort, newestFlash, snapshot, validateReview } from '../hooks/cli'

const finding = { severity: 'breakage', title: 'wrong operator', claim: 'a - b', file: 'probe.py', line: 2, symbol: 'add' }
const review = { verdict: 'one bug', response: 'add subtracts', findings: [finding] }

describe('defaults', () => {
  test('effort by reviewer and mode', () => {
    expect(defaultEffort('codex', 'test-gaps')).toBe('medium')
    expect(defaultEffort('codex', 'red-team')).toBe('xhigh')
    expect(defaultEffort('codex', 'diff-review')).toBe('high')
    expect(defaultEffort('gemini', 'explain')).toBe('medium')
    expect(defaultEffort('gemini', 'test-gaps')).toBe('high')
    expect(defaultEffort('gemini', 'red-team')).toBe('high')
  })
  test('newest flash from agy models', () => {
    const listing = 'Fetching available models...\ngemini-3.7-flash-high\tG\ngemini-3.8-flash-low\tG\ngemini-3.1-pro-high\tG\nclaude-opus-5-5-high\tC'
    expect(newestFlash(listing)).toBe('gemini-3.8-flash')
    expect(newestFlash('nothing')).toBe(null)
  })
})

describe('prompt', () => {
  test('header, fences, files, checklist', () => {
    const p = buildPrompt({ mode: 'red-team', question: 'Q?', instructions: 'Find weaknesses.', text: 'body', files: ['C:/a.ts'], nonce: 'n1' })
    expect(p).toContain('is material under review')
    expect(p).toContain('<<<ARTIFACT BEGIN:n1>>>\nbody\n<<<ARTIFACT END:n1>>>')
    expect(p).toContain('- C:/a.ts')
    expect(p).toContain('Architectural ownership:')
    expect(p).toContain('Simplicity bar:')
  })
  test('snapshot numbers lines as citations count them', () => {
    expect(snapshot('C:/a.ts', 'one\r\ntwo')).toBe('File C:/a.ts:\n1| one\n2| two')
  })
  test('explain drops the checklist; no text, no fences', () => {
    const p = buildPrompt({ mode: 'explain', question: 'Q?', instructions: 'Explain.', text: null, files: ['C:/a.ts'], nonce: 'n2' })
    expect(p).not.toContain('Architectural ownership:')
    expect(p).not.toContain('ARTIFACT BEGIN')
  })
})

describe('argv', () => {
  test('codex', () => {
    expect(codexArgv({ argv: ['codex'] }, { model: 'gpt-6.1-sol', effort: 'xhigh', isRepo: false, schema: 'C:/p/s.json' })).toEqual([
      'codex', 'exec', '--json', '--output-schema', 'C:/p/s.json', '-s', 'read-only', '--skip-git-repo-check', '-m', 'gpt-6.1-sol',
      '-c', 'model_reasoning_effort=xhigh', '-c', 'web_search=live', '-c', 'model_reasoning_summary=concise', '--ephemeral',
    ])
  })
  test('agy and its stdin line', () => {
    expect(agyArgv({ argv: ['agy'] }, { model: 'gemini-3.8-flash-high', schema: 'C:/p/s.json' })).toEqual([
      'agy', '--print=', '--input-format', 'stream-json', '--output-format', 'stream-json', '--json-schema', 'C:/p/s.json', '--agent', 'tpr-reviewer', '--model', 'gemini-3.8-flash-high',
    ])
    expect(agyInput('hi')).toBe('{"event":"user","message":{"role":"user","content":"hi"}}\n')
  })
})

describe('streams', () => {
  test('lines split across chunks', () => {
    const l = new Lines()
    expect(l.push('{"a":')).toEqual([])
    expect(l.push('1}\r\n{"b"')).toEqual(['{"a":1}'])
    expect(l.push(':2}')).toEqual([])
    expect(l.flush()).toEqual(['{"b":2}'])
  })
  test('codex clean stream', () => {
    const p = codexParser()
    expect(p.line({ type: 'item.started', item: { type: 'command_execution', command: 'Get-Content probe.py' } })).toBe('running Get-Content probe.py')
    p.line({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(review) } })
    p.line({ type: 'turn.completed' })
    const out = p.finish(0)
    expect(out.failure).toBe(null)
    expect(out.review?.findings[0]?.line).toBe(2)
  })
  test('codex failures', () => {
    const msg = { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(review) } }
    const noEnd = codexParser()
    noEnd.line(msg)
    expect(noEnd.finish(0).failure).toContain('turn.completed')
    const exit = codexParser()
    exit.line(msg)
    exit.line({ type: 'turn.completed' })
    expect(exit.finish(1).failure).toContain('exited 1')
    const failed = codexParser()
    failed.line({ type: 'turn.failed', error: { message: 'usage limit' } })
    expect(failed.finish(1).failure).toContain('usage limit')
    const bad = codexParser()
    bad.line({ type: 'item.completed', item: { type: 'agent_message', text: '{"verdict":1}' } })
    bad.line({ type: 'turn.completed' })
    expect(bad.finish(0).failure).toContain('schema')
  })
  test('agy clean stream, refused step, failures', () => {
    const p = agyParser()
    expect(p.line({ event: 'step_update', step_update: { step_type: 'tool', state: 'ACTIVE', tool_name: 'view_file', tool_info: { parameters: { AbsolutePath: 'C:/a.ts' } } } })).toBe('view_file C:/a.ts')
    p.line({ event: 'step_update', step_update: { step_type: 'tool', state: 'ERROR', tool_name: 'run_command', tool_info: { parameters: { CommandLine: 'ls' } } } })
    p.line({ event: 'step_update', step_update: { step_type: 'tool', state: 'DONE', tool_name: 'read_url_content', tool_info: { parameters: { Url: 'https://x.org' }, error: { type: 'denied', message: 'no' } } } })
    p.line({ event: 'step_update', step_update: { step_type: 'tool', state: 'DONE', tool_name: 'view_file', tool_info: { parameters: { AbsolutePath: 'C:/a.ts' } } } })
    p.line({ event: 'result', result: { status: 'SUCCESS', structured_output: review } })
    const out = p.finish(0)
    expect(out.review?.verdict).toBe('one bug')
    expect(out.deniedSteps).toEqual(['run_command ls', 'read_url_content https://x.org'])
    const bad = agyParser()
    bad.line({ event: 'result', result: { status: 'ERROR', error: 'auth' } })
    expect(bad.finish(1).failure).toContain('ERROR')
    expect(agyParser().finish(0).failure).toContain('result event')
  })
  test('agy stderr: its end kept apart from refusals, and the reason on failure', () => {
    const ok = agyParser()
    ok.stderr?.('progress: working\nnotice: view_')
    ok.stderr?.('file C:/x.ts denied\n')
    ok.line({ event: 'result', result: { status: 'SUCCESS', structured_output: review } })
    expect(ok.finish(0)).toMatchObject({ deniedSteps: [], stderr: 'progress: working\nnotice: view_file C:/x.ts denied' })
    const quiet = agyParser()
    quiet.line({ event: 'result', result: { status: 'SUCCESS', structured_output: review } })
    expect(quiet.finish(0).stderr).toBe(undefined)
    const bad = agyParser()
    bad.stderr?.('error: failed to construct executor: failed to resolve components: unknown component: tool "x" not found in registry\n')
    expect(bad.finish(3).failure).toBe('agy ended without a result event; agy printed: error: failed to construct executor: failed to resolve components: unknown component: tool "x" not found in registry')
    const loud = agyParser()
    for (let i = 0; i < 30; i++) loud.stderr?.(`progress ${i} ${'x'.repeat(200)}\n`)
    loud.stderr?.('notice: denied at the end')
    loud.line({ event: 'result', result: { status: 'SUCCESS', structured_output: review } })
    const kept = loud.finish(0).stderr ?? ''
    expect(kept.startsWith('...')).toBe(true)
    expect(kept.endsWith('notice: denied at the end')).toBe(true)
    expect(kept.length).toBeLessThanOrEqual(2003)
  })
})

describe('validateReview', () => {
  test('accepts the schema shape', () => {
    expect('review' in validateReview(review)).toBe(true)
  })
  test('rejects skew', () => {
    expect('error' in validateReview({ verdict: 'x', response: 'y' })).toBe(true)
    expect('error' in validateReview({ ...review, findings: [{ ...finding, severity: 'critical' }] })).toBe(true)
    const { symbol, ...noSymbol } = finding
    expect('error' in validateReview({ ...review, findings: [noSymbol] })).toBe(true)
    expect('error' in validateReview({ ...review, findings: [{ ...finding, line: '2' }] })).toBe(true)
    expect('error' in validateReview({ ...review, extra: true })).toBe(true)
    expect('error' in validateReview({ ...review, findings: [{ ...finding, extra: 1 }] })).toBe(true)
  })
})
