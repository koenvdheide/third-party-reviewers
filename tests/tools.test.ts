import { describe, expect, test } from 'claude-code/testing'

import { CODEX_EXE, boot, call, endSession, world } from './world'

const finding = (o: Record<string, unknown>) => ({ severity: 'breakage', title: 'op', claim: 'c', file: null, line: null, symbol: null, ...o })
const codexReview = (findings: unknown[]) => [
  { type: 'thread.started' },
  { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ verdict: 'v', response: 'r', findings }) } },
  { type: 'turn.completed' },
]
const start = { reviewer: 'codex', mode: 'red-team', question: 'Q?', instructions: 'Find weaknesses.', artifact: { text: 'body' } }
const startOf = async ($: any, args: Record<string, unknown> = start) => JSON.parse((await call($, 'review_start', args)).result).runId as string
const resultOf = async ($: any, runId: string) => JSON.parse((await call($, 'review_results', { runId })).result)

describe('runs', () => {
  test('clean codex run: native binary, complete, one delivery', async ($, on) => {
    const w = world(on)
    w.files.set('C:/work/a.ts', 'x')
    w.scripts.push({ lines: codexReview([finding({ file: 'a.ts', line: 2, symbol: 'add' }), finding({ severity: 'other' }), finding({ file: '//server/share/a.ts', line: 1, symbol: null })]) })
    await boot($, w)
    const id = await startOf($, { ...start, artifact: { files: ['C:/work/a.ts'] } })
    await w.clock.settle()
    const r = await resultOf($, id)
    expect(id).toMatch(/^r-[0-9a-f]{8}$/)
    expect(r.status).toBe('complete')
    expect(r.findings.map((f: any) => f.id)).toEqual([`${id}.1`, `${id}.2`, `${id}.3`])
    expect(r.findings.map((f: any) => f.citation)).toEqual(['line-out-of-range', 'no-location', 'not-checked'])
    expect(typeof r.durationMs).toBe('number')
    expect(w.spawns[0]?.argv[0]).toBe(CODEX_EXE)
    expect(w.spawns[0]?.cwd).toBe('C:/work')
    expect(w.submitted).toEqual([`[third-party-reviewers] Review ${id} (Codex red-team) finished: 3 findings, 2 breakage. Read it with review_results ${id} before acting on it.`])
  })

  test('non-zero exit fails and still delivers', async ($, on) => {
    const w = world(on)
    w.scripts.push({ exit: 1 })
    await boot($, w)
    const id = await startOf($)
    await w.clock.settle()
    const r = await resultOf($, id)
    expect(r.status).toBe('failed')
    expect(r.failure).toContain('exited 1')
    expect(w.submitted.length).toBe(1)
  })

  test('cancel ends a silent run without delivery', async ($, on) => {
    const w = world(on)
    w.scripts.push({ silent: true })
    await boot($, w)
    const id = await startOf($)
    await w.clock.settle()
    const running = await resultOf($, id)
    expect(running.status).toBe('running')
    expect(typeof running.elapsedMs).toBe('number')
    expect((await call($, 'review_cancel', { runId: id })).result).toContain('Cancelled')
    await w.clock.settle()
    expect((await resultOf($, id)).status).toBe('cancelled')
    expect(w.submitted.length).toBe(0)
  })

  test('session end cancels, clears, suppresses delivery', async ($, on) => {
    const w = world(on)
    w.scripts.push({ silent: true })
    await boot($, w)
    const id = await startOf($)
    await w.clock.settle()
    await endSession($)
    await w.clock.settle()
    expect((await call($, 'review_results', { runId: id })).deny).toContain('no run')
    expect(w.submitted.length).toBe(0)
  })

  test('a session that ends while the CLIs resolve admits nothing', async ($, on) => {
    const w = world(on, { slowResolve: true })
    const pending = call($, 'review_start', start)
    await w.clock.settle()
    await endSession($)
    await w.clock.advance(100)
    expect((await pending).deny).toContain('conversation changed')
    expect(w.spawns.length).toBe(0)
  })

  test('a session that ends after the run is allocated admits nothing', async ($, on) => {
    const w = world(on, { slowSetup: true })
    await boot($, w)
    const pending = call($, 'review_start', start)
    await w.clock.settle()
    await endSession($)
    await w.clock.advance(100)
    expect((await pending).deny).toContain('conversation changed')
    expect(w.spawns.length).toBe(0)
  })

  test('a missing target is refused before any run exists', async ($, on) => {
    const w = world(on)
    await boot($, w)
    expect((await call($, 'review_start', { ...start, artifact: { files: ['C:/work/nope.ts'] } })).deny).toContain('Cannot find')
    w.files.set('C:/work/rel.ts', 'x')
    expect((await call($, 'review_start', { ...start, artifact: { files: ['rel.ts'] } })).deny).toContain('not an absolute path')
    expect(w.spawns.length).toBe(0)
  })

  test('gemini run uses agy in a run directory that is removed; refused steps are named', async ($, on) => {
    const w = world(on)
    w.scripts.push({ lines: [
      { event: 'init', conversation_id: 'c1' },
      { event: 'step_update', step_update: { step_type: 'tool', state: 'ERROR', tool_name: 'view_file', tool_info: { parameters: { AbsolutePath: 'C:/work/a.ts' } } } },
      { event: 'result', result: { status: 'SUCCESS', structured_output: { verdict: 'v', response: 'r', findings: [] } } },
    ] })
    await boot($, w)
    const id = await startOf($, { ...start, reviewer: 'gemini' })
    await w.clock.settle()
    expect((await resultOf($, id)).status).toBe('complete')
    expect(w.spawns[0]?.argv).toContain('--print=')
    expect(w.spawns[0]?.argv).toContain('gemini-3.8-flash-high')
    expect(w.spawns[0]?.cwd).toBe(`C:/tmp/tpr/third-party-reviewers/${id}`)
    expect(w.removed).toContain(`C:/tmp/tpr/third-party-reviewers/${id}`)
    expect(w.submitted[0]).toContain('Steps the reviewer reported as refused: view_file C:/work/a.ts.')
  })

  test('a setup failure fails the run instead of stranding it', async ($, on) => {
    const w = world(on, { failWrite: true })
    await boot($, w)
    const r = await call($, 'review_start', { ...start, reviewer: 'gemini' })
    expect(r.deny).toContain('could not start')
    expect((await resultOf($, String(r.deny).split(':')[0] ?? '')).status).toBe('failed')
    expect(w.spawns.length).toBe(0)
  })

  test('a running row left by a reload is marked cancelled', async ($, on) => {
    const w = world(on)
    w.seed([{ id: 'r1', reviewer: 'gemini', mode: 'red-team', model: 'm', effort: 'high', targets: [], startedAt: 0, endedAt: null, status: 'running', response: null, verdict: null, findings: [], deniedSteps: [], failure: null }])
    await boot($, w)
    expect((await resultOf($, 'r1')).status).toBe('cancelled')
    expect(w.removed).toEqual(['C:/tmp/tpr/third-party-reviewers/r1'])
  })

  test('0.2.0 findings get ids and statuses at load', async ($, on) => {
    const w = world(on)
    w.seed([{ id: 'r2', reviewer: 'codex', mode: 'red-team', model: 'm', effort: 'high', targets: [], startedAt: 0, endedAt: 1, status: 'complete', response: 'r', verdict: 'v', findings: [{ severity: 'breakage', title: 't', claim: 'c', file: null, line: null, symbol: null }], deniedSteps: [], failure: null }])
    await boot($, w)
    expect((await resultOf($, 'r2')).findings[0]).toMatchObject({ id: 'r2.1', citation: 'not-checked', status: 'unresolved', overrule: null })
  })

  test('a codex.exe on PATH runs directly', async ($, on) => {
    const w = world(on, { nativeCodex: 'C:\\bin\\codex.exe' })
    w.scripts.push({ lines: codexReview([]) })
    await boot($, w)
    await startOf($)
    await w.clock.settle()
    expect(w.spawns[0]?.argv[0]).toBe('C:/bin/codex.exe')
  })

  test('simultaneous starts get distinct ids', async ($, on) => {
    const w = world(on)
    w.scripts.push({ silent: true }, { silent: true })
    await boot($, w)
    const [a, b] = await Promise.all([startOf($), startOf($)])
    expect(a).not.toBe(b)
    await endSession($)
  })
})

describe('records', () => {
  test('concurrent records both land; unknown and bad status refused', async ($, on) => {
    const w = world(on)
    w.scripts.push({ lines: codexReview([finding({}), finding({ title: 'second' })]) })
    await boot($, w)
    const id = await startOf($)
    await w.clock.settle()
    await Promise.all([
      call($, 'review_record', { findingId: `${id}.1`, status: 'applied', evidence: 'fixed' }),
      call($, 'review_record', { findingId: `${id}.2`, status: 'rejected', evidence: 'contradicted' }),
    ])
    expect((await resultOf($, id)).findings.map((f: any) => [f.status, f.evidence])).toEqual([['applied', 'fixed'], ['rejected', 'contradicted']])
    expect((await call($, 'review_record', { findingId: 'r-00000000.1', status: 'applied', evidence: 'x' })).deny).toContain('no finding')
    expect((await call($, 'review_record', { findingId: `${id}.1`, status: 'done', evidence: 'x' })).deny).toContain('one of')
  })
})

describe('refusals', () => {
  test('gemini xhigh, unsafe model, missing reviewer: no child', async ($, on) => {
    const w = world(on, { codex: false })
    await boot($, w)
    expect((await call($, 'review_start', { ...start, reviewer: 'gemini', effort: 'xhigh' })).deny).toContain('xhigh')
    expect((await call($, 'review_start', { ...start, reviewer: 'gemini', model: 'gemini & calc' })).deny).toContain('model')
    expect((await call($, 'review_start', start)).deny).toContain('not installed')
    expect(w.spawns.length).toBe(0)
  })
  test('codex max refused', async ($, on) => {
    const w = world(on)
    await boot($, w)
    expect((await call($, 'review_start', { ...start, effort: 'max' })).deny).toContain('max')
    expect(w.spawns.length).toBe(0)
  })
})

describe('skill note', () => {
  test('missing CLI replaces the skill text and names the other reviewer', async ($, on) => {
    const w = world(on, { codex: false })
    await boot($, w)
    const r = await $.skill.prompt({ skill: 'third-party-reviewers:codex', text: 'original' })
    expect(r.text).toContain('not installed')
    expect(r.text).toContain('Gemini')
  })
  test('an installed CLI leaves the skill text alone', async ($, on) => {
    const w = world(on)
    await boot($, w)
    expect((await $.skill.prompt({ skill: 'third-party-reviewers:codex', text: 'original' })).text).toBe('original')
    expect((await $.skill.prompt({ skill: 'constructor', text: 'original' })).text).toBe('original')
  })
})
