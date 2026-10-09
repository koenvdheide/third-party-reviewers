import { describe, expect, test } from 'claude-code/testing'

import { CODEX_EXE, boot, call, endSession, world } from './world'

const finding = (o: Record<string, unknown>) => ({ severity: 'breakage', title: 'op', claim: 'c', file: null, line: null, symbol: null, ...o })
const codexReview = (findings: unknown[]) => [
  { type: 'thread.started' },
  { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ verdict: 'v', response: 'r', findings }) } },
  { type: 'turn.completed' },
]
const start = { reviewer: 'codex', mode: 'red-team', question: 'Q?', instructions: 'Find weaknesses.', artifact: { text: 'body' } }
const startOf = async ($: any, args: Record<string, unknown> = start) => JSON.parse((await call($, 'review_start', args)).result).id as string
const resultOf = async ($: any, runId: string) => JSON.parse((await call($, 'review_results', { runId })).result)

describe('runs', () => {
  test('clean codex run: native binary, returned complete, nothing submitted', async ($, on) => {
    const w = world(on)
    w.files.set('C:/work/a.ts', 'x')
    w.scripts.push({ lines: codexReview([finding({ file: 'a.ts', line: 2, symbol: 'add' }), finding({ severity: 'other' }), finding({ file: '//server/share/a.ts', line: 1, symbol: null })]) })
    await boot($, w)
    const r = JSON.parse((await call($, 'review_start', { ...start, artifact: { files: ['C:/work/a.ts'] } })).result)
    const id = r.id
    expect(id).toMatch(/^r-[0-9a-f]{8}$/)
    expect(r.status).toBe('complete')
    expect(r.findings.map((f: any) => f.id)).toEqual([`${id}.1`, `${id}.2`, `${id}.3`])
    expect(r.findings.map((f: any) => f.citation)).toEqual(['line-out-of-range', 'no-location', 'not-checked'])
    expect(typeof r.durationMs).toBe('number')
    expect(w.spawns[0]?.argv[0]).toBe(CODEX_EXE)
    expect(w.spawns[0]?.cwd).toBe('C:/work')
    expect(w.submitted).toEqual([])
  })

  test('non-zero exit returns a failed run', async ($, on) => {
    const w = world(on)
    w.scripts.push({ exit: 1 })
    await boot($, w)
    const r = JSON.parse((await call($, 'review_start', start)).result)
    expect(r.status).toBe('failed')
    expect(r.failure).toContain('exited 1')
    expect(w.submitted.length).toBe(0)
  })

  for (const reviewer of ['codex', 'gemini']) {
    test(`${reviewer} preserves process-start errors`, async ($, on) => {
      const w = world(on)
      w.scripts.push({ error: 'EACCES: reviewer executable' })
      await boot($, w)
      const r = JSON.parse((await call($, 'review_start', { ...start, reviewer })).result)
      expect(r.status).toBe('failed')
      expect(r.failure).toContain('EACCES: reviewer executable')
      expect(r.findings).toEqual([])
    })
  }

  test('a failed Gemini stream keeps both its error and prior stderr', async ($, on) => {
    const w = world(on)
    w.scripts.push({ stderr: ['notice: view_file C:/x.ts denied'], error: 'EPIPE: reviewer stream' })
    await boot($, w)
    const r = JSON.parse((await call($, 'review_start', { ...start, reviewer: 'gemini' })).result)
    expect(r.status).toBe('failed')
    expect(r.failure).toContain('EPIPE: reviewer stream')
    expect(r.failure).toContain('view_file C:/x.ts denied')
    expect(r.findings).toEqual([])
  })

  test('cancel ends a silent run and returns it cancelled', async ($, on) => {
    const w = world(on)
    w.scripts.push({ silent: true })
    await boot($, w)
    const pending = call($, 'review_start', start)
    await w.clock.settle()
    const id = w.runs()[0]?.id ?? ''
    const running = await resultOf($, id)
    expect(running.status).toBe('running')
    expect(typeof running.elapsedMs).toBe('number')
    expect((await call($, 'review_cancel', { runId: id })).result).toContain('Cancelled')
    expect(JSON.parse((await pending).result).status).toBe('cancelled')
    expect(w.submitted.length).toBe(0)
  })

  test('session end cancels and clears; the start is refused', async ($, on) => {
    const w = world(on)
    w.scripts.push({ silent: true })
    await boot($, w)
    const pending = call($, 'review_start', start)
    await w.clock.settle()
    const id = w.runs()[0]?.id ?? ''
    await endSession($)
    expect((await pending).deny).toContain('conversation changed')
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

  test('gemini gets target contents numbered in its prompt, and no path to read', async ($, on) => {
    const w = world(on)
    w.files.set('C:/work/a.ts', 'one\ntwo')
    w.scripts.push({ lines: [{ event: 'result', result: { status: 'SUCCESS', structured_output: { verdict: 'v', response: 'r', findings: [] } } }] })
    await boot($, w)
    await startOf($, { ...start, reviewer: 'gemini', artifact: { text: 'note', files: ['C:/work/a.ts'] } })
    const content = JSON.parse(w.spawns[0]?.input ?? '{}').message.content as string
    expect(content).toMatch(/<<<ARTIFACT BEGIN:\w+>>>\nnote\n\nFile C:\/work\/a.ts:\n1\| one\n2\| two\n<<<ARTIFACT END:\w+>>>/)
    expect(content).not.toContain('to read at these absolute paths')
  })

  test('a gemini target that cannot be read as UTF-8 text is refused', async ($, on) => {
    const w = world(on)
    w.files.set('C:/work/w.txt', 'caf\uFFFD')
    w.files.set('C:/work/u16.txt', 'a\0b\0')
    await boot($, w)
    expect((await call($, 'review_start', { ...start, reviewer: 'gemini', artifact: { files: ['C:/work/nope.ts'] } })).deny).toContain('Cannot read C:/work/nope.ts')
    expect((await call($, 'review_start', { ...start, reviewer: 'gemini', artifact: { files: ['C:/work/w.txt'] } })).deny).toContain('NUL or U+FFFD')
    expect((await call($, 'review_start', { ...start, reviewer: 'gemini', artifact: { files: ['C:/work/u16.txt'] } })).deny).toContain('NUL or U+FFFD')
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
    const r = JSON.parse((await call($, 'review_start', { ...start, reviewer: 'gemini' })).result)
    const id = r.id
    expect(r.status).toBe('complete')
    expect(w.spawns[0]?.argv).toContain('--print=')
    expect(w.spawns[0]?.argv).toContain('gemini-3.8-flash-high')
    expect(w.spawns[0]?.cwd).toBe(`C:/tmp/tpr/third-party-reviewers/${id}`)
    expect(w.removed).toContain(`C:/tmp/tpr/third-party-reviewers/${id}`)
    expect(w.files.has(`C:/tmp/tpr/third-party-reviewers/${id}/.agents/agents/tpr-reviewer.md`)).toBe(false)
    expect(w.toasts.some(t => t.startsWith('Could not delete'))).toBe(false)
    expect(r.deniedSteps).toEqual(['view_file C:/work/a.ts'])
  })

  test('agy stderr reaches the result: kept on success, the reason on failure', async ($, on) => {
    const w = world(on)
    w.scripts.push({ stderr: ['notice: view_file C:/x.ts denied'], lines: [{ event: 'result', result: { status: 'SUCCESS', structured_output: { verdict: 'v', response: 'r', findings: [] } } }] })
    w.scripts.push({ stderr: ['error: bad agent'], exit: 3 })
    await boot($, w)
    const ok = JSON.parse((await call($, 'review_start', { ...start, reviewer: 'gemini' })).result)
    expect(ok.stderr).toBe('notice: view_file C:/x.ts denied')
    expect(ok.deniedSteps).toEqual([])
    const bad = JSON.parse((await call($, 'review_start', { ...start, reviewer: 'gemini' })).result)
    expect(bad.status).toBe('failed')
    expect(bad.failure).toContain('agy printed: error: bad agent')
  })

  test('a run directory that cannot be deleted is named in a toast', async ($, on) => {
    const w = world(on, { failRemove: true })
    w.scripts.push({ lines: [{ event: 'result', result: { status: 'SUCCESS', structured_output: { verdict: 'v', response: 'r', findings: [] } } }] })
    await boot($, w)
    const id = await startOf($, { ...start, reviewer: 'gemini' })
    expect(w.toasts).toContain(`Could not delete C:/tmp/tpr/third-party-reviewers/${id}; remove it yourself.`)
    expect(w.spawns[0]?.argv).toContain('tpr-reviewer')
    expect(w.files.get(`C:/tmp/tpr/third-party-reviewers/${id}/.agents/agents/tpr-reviewer.md`)).toContain('tools: [view_file, grep_search, read_url_content, finish]')
  })

  test('a setup failure fails the run instead of stranding it', async ($, on) => {
    const w = world(on, { failWrite: true })
    await boot($, w)
    const r = await call($, 'review_start', { ...start, reviewer: 'gemini' })
    expect(r.deny).toContain('review failed')
    expect((await resultOf($, String(r.deny).split(':')[0] ?? '')).status).toBe('failed')
    expect(w.spawns.length).toBe(0)
  })

  test('a run directory that was never created raises no deletion toast', async ($, on) => {
    const w = world(on, { failWrite: true, failRemove: true })
    await boot($, w)
    await call($, 'review_start', { ...start, reviewer: 'gemini' })
    expect(w.removed.length).toBe(1)
    expect(w.toasts.some(t => t.startsWith('Could not delete'))).toBe(false)
  })

  test('a running row left by a reload is marked cancelled', async ($, on) => {
    const w = world(on)
    w.seed([{ id: 'r1', reviewer: 'gemini', mode: 'red-team', model: 'm', effort: 'high', targets: [], startedAt: 0, endedAt: null, status: 'running', response: null, verdict: null, findings: [], deniedSteps: [], failure: null }])
    await boot($, w)
    expect((await resultOf($, 'r1')).status).toBe('cancelled')
    expect(w.removed).toEqual(['C:/tmp/tpr/third-party-reviewers/r1'])
  })

  test('a codex.exe on PATH runs directly', async ($, on) => {
    const w = world(on, { nativeCodex: 'C:\\bin\\codex.exe' })
    w.scripts.push({ lines: codexReview([]) })
    await boot($, w)
    await startOf($)
    expect(w.spawns[0]?.argv[0]).toBe('C:/bin/codex.exe')
  })

  test('simultaneous starts get distinct ids', async ($, on) => {
    const w = world(on)
    w.scripts.push({ lines: codexReview([]) }, { lines: codexReview([]) })
    await boot($, w)
    const [a, b] = await Promise.all([startOf($), startOf($)])
    expect(a).not.toBe(b)
  })

  test('a relative finding path is stored resolved against the review directory', async ($, on) => {
    const w = world(on)
    w.files.set('C:/work/a.ts', 'one\nfunction add() {}\n')
    w.scripts.push({ lines: codexReview([finding({ file: 'a.ts', line: 2, symbol: 'add' }), finding({ file: '//server/share/a.ts', line: 1 }), finding({ file: '\\\\server\\share\\a.ts', line: 1 }), finding({})]) })
    await boot($, w)
    const r = JSON.parse((await call($, 'review_start', start)).result)
    expect(r.findings.map((f: any) => f.file)).toEqual(['C:/work/a.ts', '//server/share/a.ts', '\\\\server\\share\\a.ts', null])
    expect(r.findings[0].citation).toBe('ok')
  })
})

describe('records', () => {
  test('concurrent records both land; unknown and bad status refused', async ($, on) => {
    const w = world(on)
    w.scripts.push({ lines: codexReview([finding({}), finding({ title: 'second' })]) })
    await boot($, w)
    const id = await startOf($)
    await Promise.all([
      call($, 'review_record', { findingId: `${id}.1`, status: 'applied', evidence: 'fixed' }),
      call($, 'review_record', { findingId: `${id}.2`, status: 'rejected', evidence: 'contradicted' }),
    ])
    expect((await resultOf($, id)).findings.map((f: any) => [f.status, f.evidence])).toEqual([['applied', 'fixed'], ['rejected', 'contradicted']])
    expect((await call($, 'review_record', { findingId: 'r-00000000.1', status: 'applied', evidence: 'x' })).deny).toContain('no finding')
    expect((await call($, 'review_record', { findingId: `${id}.1`, status: 'done', evidence: 'x' })).deny).toContain('one of')
  })
})

describe('resume', () => {
  test('a resumed conversation gets its own reviews back, a running one cancelled', async ($, on) => {
    const w = world(on)
    w.scripts.push({ lines: codexReview([finding({})]) }, { silent: true }, { lines: codexReview([]) })
    await boot($, w)
    const done = await startOf($)
    await call($, 'review_record', { findingId: `${done}.1`, status: 'applied', evidence: 'fixed' })
    const pending = call($, 'review_start', start)
    await w.clock.settle()
    const running = w.runs()[1]?.id ?? ''
    await endSession($)
    await pending
    w.sessionId = 's2'
    expect((await call($, 'review_results', { runId: done })).deny).toContain('no run')
    const other = await startOf($)
    await $.session.end({ reason: 'resume', sessionId: 's2', resume: { id: 's2' } })

    w.sessionId = 's1'
    await $.classic.SessionStart({ source: 'resume', session_id: 's1' })
    expect((await resultOf($, done)).findings[0].status).toBe('applied')
    const cancelled = await resultOf($, running)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.failure).toContain('conversation ended')
    expect((await call($, 'review_results', { runId: other })).deny).toContain('no run')
    // Compaction keeps the conversation, so the store is not read back.
    w.store.delete('runs:s1')
    await $.classic.SessionStart({ source: 'compact', session_id: 's1' })
    expect((await resultOf($, done)).status).toBe('complete')
  })

  test('a change waits for the save before it, and one queued before the conversation ended never lands', async ($, on) => {
    const w = world(on)
    w.scripts.push({ lines: codexReview([finding({}), finding({})]) })
    await boot($, w)
    const id = await startOf($)
    w.holdStore = true
    const first = call($, 'review_record', { findingId: `${id}.1`, status: 'applied', evidence: 'e' })
    await w.clock.settle()
    const second = call($, 'review_record', { findingId: `${id}.2`, status: 'applied', evidence: 'e' })
    await w.clock.settle()
    expect((w.runs()[0] as any).findings[1].status).toBe('unresolved')
    await endSession($)
    w.holdStore = false
    w.heldStore.forEach(release => release())
    await Promise.all([first, second])
    expect((w.store.get('runs:s1') as any).runs.map((r: any) => r.findings.map((f: any) => f.status))).toEqual([['applied', 'unresolved']])
  })

  test('a change whose conversation ends while it is written is not stored under the next one', async ($, on) => {
    const w = world(on)
    w.scripts.push({ lines: codexReview([finding({})]) })
    await boot($, w)
    const id = await startOf($)
    w.holdWrites = true
    const pending = call($, 'review_record', { findingId: `${id}.1`, status: 'applied', evidence: 'e' })
    await w.clock.settle()
    w.holdWrites = false
    await endSession($)
    w.sessionId = 's2'
    w.heldWrites.forEach(release => release())
    await pending
    expect(w.store.has('runs:s2')).toBe(false)
    expect((w.store.get('runs:s1') as any).runs[0].findings[0].status).toBe('unresolved')
  })

  test('a change held across the end of its conversation does not apply when that conversation is resumed', async ($, on) => {
    const w = world(on)
    w.scripts.push({ lines: codexReview([finding({})]) })
    await boot($, w)
    const id = await startOf($)
    w.holdWrites = true
    const pending = call($, 'review_record', { findingId: `${id}.1`, status: 'applied', evidence: 'e' })
    await w.clock.settle()
    w.holdWrites = false
    await endSession($)
    await $.classic.SessionStart({ source: 'resume', session_id: 's1' })
    w.heldWrites.forEach(release => release())
    await pending
    expect((await resultOf($, id)).findings[0].status).toBe('unresolved')
    expect((w.store.get('runs:s1') as any).runs[0].findings[0].status).toBe('unresolved')
  })

  test('session start drops the least recently saved conversations past the budget, never the current one', async ($, on) => {
    const w = world(on)
    const MiB = 1024 * 1024
    // Two UTF-8 bytes a character, so a budget counted in characters would keep them all.
    const saved = (savedAt: number, size: number) => ({ savedAt, runs: [{ id: 'r', response: 'é'.repeat(size / 2) }] })
    w.store.set('runs:s1', saved(0, 0.5 * MiB))
    w.store.set('runs:new', saved(3, 0.5 * MiB))
    w.store.set('runs:mid', saved(2, 0.5 * MiB))
    w.store.set('runs:old', saved(1, 0.75 * MiB))
    await boot($, w)
    expect([...w.store.keys()].sort()).toEqual(['runs:mid', 'runs:new', 'runs:s1'])
  })

  test('a failed save is named in a toast and the review still returns', async ($, on) => {
    const w = world(on, { failStore: true })
    w.scripts.push({ lines: codexReview([]) })
    await boot($, w)
    expect(JSON.parse((await call($, 'review_start', start)).result).status).toBe('complete')
    expect(w.toasts.some(t => t.includes('Could not save'))).toBe(true)
  })
})

describe('refusals', () => {
  test('gemini xhigh, unsafe model, missing reviewer: no child', async ($, on) => {
    const w = world(on, { codex: false })
    await boot($, w)
    expect((await call($, 'review_start', { ...start, reviewer: 'gemini', effort: 'xhigh' })).deny).toContain('xhigh')
    expect((await call($, 'review_start', { ...start, reviewer: 'gemini', model: 'gemini & calc' })).deny).toContain('model')
    expect((await call($, 'review_start', start)).deny).toContain('unavailable')
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
  test('missing CLI preserves the skill text and names the other reviewer', async ($, on) => {
    const w = world(on, { codex: false })
    await boot($, w)
    const r = await $.skill.prompt({ skill: 'third-party-reviewers:codex', text: 'original' })
    expect(r.text).toContain('unavailable')
    expect(r.text).toContain('Gemini')
    expect(r.text).toContain('original')
  })
  test('a failed model catalogue preserves recovery instructions and the diagnostic', async ($, on) => {
    const w = world(on, { catalogueError: 'catalogue unavailable' })
    await boot($, w)
    const r = await $.skill.prompt({ skill: 'third-party-reviewers:antigravity', text: 'original recovery instructions' })
    expect(r.text).toContain('catalogue unavailable')
    expect(r.text).toContain('original recovery instructions')
    expect(r.text).not.toContain('not installed')
    expect((await call($, 'review_start', { ...start, reviewer: 'gemini' })).deny).toContain('catalogue unavailable')
    expect(w.spawns.length).toBe(0)
  })

  test('an installed CLI leaves the skill text alone', async ($, on) => {
    const w = world(on)
    await boot($, w)
    expect((await $.skill.prompt({ skill: 'third-party-reviewers:codex', text: 'original' })).text).toBe('original')
    expect((await $.skill.prompt({ skill: 'constructor', text: 'original' })).text).toBe('original')
  })
})
