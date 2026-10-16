import { describe, expect, test } from 'claude-code/testing'

import { boot, call, endSession, world } from './world'

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
  for (const windows of [false, true]) {
    test(`clean codex run (${windows ? 'Windows' : 'POSIX'}): returned complete, nothing submitted`, async ($, on) => {
      const w = world(on, { windows })
      w.unreadable.add('/restricted/a.ts')
      w.files.set(`${w.work}/a.ts`, 'x')
      w.scripts.push({ lines: codexReview([finding({ file: 'a.ts', line: 2, symbol: 'add' }), finding({ severity: 'other' }), finding({ file: '/restricted/a.ts', line: 1, symbol: null })]) })
      await boot($, w)
      const r = JSON.parse((await call($, 'review_start', { ...start, artifact: { files: [`${w.work}/a.ts`] } })).result)
      const id = r.id
      expect(id).toMatch(/^r-[0-9a-f]{8}$/)
      expect(r.status).toBe('complete')
      expect(r.findings.map((f: any) => f.id)).toEqual([`${id}.1`, `${id}.2`, `${id}.3`])
      expect(r.findings.map((f: any) => f.citation)).toEqual(['line-out-of-range', 'no-location', 'not-checked'])
      expect(typeof r.durationMs).toBe('number')
      expect(w.spawns[0]?.argv[0]).toBe(w.codexExe)
      expect(w.spawns[0]?.cwd).toBe(w.work)
      expect(w.submitted).toEqual([])
    })
  }

  test('non-zero exit returns a failed run', async ($, on) => {
    const w = world(on)
    w.scripts.push({ exit: 1 })
    await boot($, w)
    const r = JSON.parse((await call($, 'review_start', start)).result)
    expect(r.status).toBe('failed')
    expect(r.failure).toContain('exited 1')
    expect(w.submitted.length).toBe(0)
  })

  for (const { name, reviewer, script, failure } of [
    { name: 'codex preserves process-start errors', reviewer: 'codex', script: { error: 'EACCES: reviewer executable' }, failure: ['EACCES: reviewer executable'] },
    { name: 'gemini preserves process-start errors', reviewer: 'gemini', script: { error: 'EACCES: reviewer executable' }, failure: ['EACCES: reviewer executable'] },
    { name: 'a failed Gemini stream keeps both its error and prior stderr', reviewer: 'gemini', script: { stderr: ['notice: view_file /x.ts denied'], error: 'EPIPE: reviewer stream' }, failure: ['EPIPE: reviewer stream', 'view_file /x.ts denied'] },
  ]) {
    test(name, async ($, on) => {
      const w = world(on)
      w.scripts.push(script)
      await boot($, w)
      const r = JSON.parse((await call($, 'review_start', { ...start, reviewer })).result)
      expect(r.status).toBe('failed')
      for (const text of failure) expect(r.failure).toContain(text)
      expect(r.findings).toEqual([])
    })
  }

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
    expect((await call($, 'review_start', { ...start, artifact: { files: [`${w.work}/nope.ts`] } })).deny).toContain('Cannot find')
    w.files.set(`${w.work}/rel.ts`, 'x')
    expect((await call($, 'review_start', { ...start, artifact: { files: ['rel.ts'] } })).deny).toContain('not an absolute path')
    expect(w.spawns.length).toBe(0)
  })

  test('gemini gets target contents numbered in its prompt, and no path to read', async ($, on) => {
    const w = world(on)
    w.files.set(`${w.work}/a.ts`, 'one\ntwo')
    w.scripts.push({ lines: [{ event: 'result', result: { status: 'SUCCESS', structured_output: { verdict: 'v', response: 'r', findings: [] } } }] })
    await boot($, w)
    await startOf($, { ...start, reviewer: 'gemini', artifact: { text: 'note', files: [`${w.work}/a.ts`] } })
    const content = JSON.parse(w.spawns[0]?.input ?? '{}').message.content as string
    expect(content).toMatch(/<<<ARTIFACT BEGIN:\w+>>>\nnote\n\nFile /)
    expect(content).toContain(`File ${w.work}/a.ts:\n1| one\n2| two\n`)
    expect(content).toMatch(/\n<<<ARTIFACT END:\w+>>>/)
    expect(content).not.toContain('to read at these absolute paths')
  })

  test('a gemini target that cannot be read as UTF-8 text is refused', async ($, on) => {
    const w = world(on)
    w.files.set(`${w.work}/w.txt`, 'caf\uFFFD')
    w.files.set(`${w.work}/u16.txt`, 'a\0b\0')
    await boot($, w)
    expect((await call($, 'review_start', { ...start, reviewer: 'gemini', artifact: { files: [`${w.work}/nope.ts`] } })).deny).toContain(`Cannot read ${w.work}/nope.ts`)
    expect((await call($, 'review_start', { ...start, reviewer: 'gemini', artifact: { files: [`${w.work}/w.txt`] } })).deny).toContain('NUL or U+FFFD')
    expect((await call($, 'review_start', { ...start, reviewer: 'gemini', artifact: { files: [`${w.work}/u16.txt`] } })).deny).toContain('NUL or U+FFFD')
    expect(w.spawns.length).toBe(0)
  })

  for (const windows of [false, true]) {
    test(`gemini run (${windows ? 'Windows' : 'POSIX'}) removes its directory and names refused steps`, async ($, on) => {
      const w = world(on, { windows })
      w.scripts.push({ lines: [
        { event: 'init', conversation_id: 'c1' },
        { event: 'step_update', step_update: { step_type: 'tool', state: 'ERROR', tool_name: 'view_file', tool_info: { parameters: { AbsolutePath: `${w.work}/a.ts` } } } },
        { event: 'result', result: { status: 'SUCCESS', structured_output: { verdict: 'v', response: 'r', findings: [] } } },
      ] })
      await boot($, w)
      const r = JSON.parse((await call($, 'review_start', { ...start, reviewer: 'gemini' })).result)
      const id = r.id
      expect(r.status).toBe('complete')
      expect(w.spawns[0]?.argv).toContain('--print=')
      expect(w.spawns[0]?.argv).toContain('gemini-3.8-flash-high')
      expect(w.spawns[0]?.cwd).toBe(`${w.temp}/third-party-reviewers/${id}`)
      expect(w.removed).toContain(`${w.temp}/third-party-reviewers/${id}`)
      expect(w.files.has(`${w.temp}/third-party-reviewers/${id}/.agents/agents/tpr-reviewer.md`)).toBe(false)
      expect(w.toasts.some(t => t.startsWith('Could not delete'))).toBe(false)
      expect(r.deniedSteps).toEqual([`view_file ${w.work}/a.ts`])
    })
  }

  test('agy stderr reaches the result: kept on success, the reason on failure', async ($, on) => {
    const w = world(on)
    w.scripts.push({ stderr: ['notice: view_file /x.ts denied'], lines: [{ event: 'result', result: { status: 'SUCCESS', structured_output: { verdict: 'v', response: 'r', findings: [] } } }] })
    w.scripts.push({ stderr: ['error: bad agent'], exit: 3 })
    await boot($, w)
    const ok = JSON.parse((await call($, 'review_start', { ...start, reviewer: 'gemini' })).result)
    expect(ok.stderr).toBe('notice: view_file /x.ts denied')
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
    expect(w.toasts).toContain(`Could not delete ${w.temp}/third-party-reviewers/${id}; remove it yourself.`)
    expect(w.spawns[0]?.argv).toContain('tpr-reviewer')
    expect(w.files.get(`${w.temp}/third-party-reviewers/${id}/.agents/agents/tpr-reviewer.md`)).toContain('tools: [view_file, grep_search, read_url_content, finish]')
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
    expect(w.removed).toEqual([`${w.temp}/third-party-reviewers/r1`])
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
    w.files.set(`${w.work}/a.ts`, 'one\nfunction add() {}\n')
    w.scripts.push({ lines: codexReview([finding({ file: 'a.ts', line: 2, symbol: 'add' }), finding({ file: '//server/share/a.ts', line: 1 }), finding({ file: '\\\\server\\share\\a.ts', line: 1 }), finding({})]) })
    await boot($, w)
    const r = JSON.parse((await call($, 'review_start', start)).result)
    expect(r.findings.map((f: any) => f.file)).toEqual([`${w.work}/a.ts`, '//server/share/a.ts', '\\\\server\\share\\a.ts', null])
    expect(r.findings[0].citation).toBe('ok')
  })
})

describe('background', () => {
  // What a call has answered once the event loop settles; undefined while it still waits.
  const answerOf = async (w: ReturnType<typeof world>, pending: Promise<any>) => {
    let answer: any
    void pending.then(a => (answer = a))
    await w.clock.settle()
    return answer
  }

  test('with a surface the call returns the run at once and one message announces its end', async ($, on) => {
    const w = world(on)
    w.surfaces = ['desktop']
    w.scripts.push({ silent: true, lines: codexReview([finding({}), finding({ title: 'second' })]) })
    await boot($, w)
    const pending = call($, 'review_start', start)
    const early = await answerOf(w, pending)
    const sentEarly = w.submitted.length
    w.waiting.shift()?.()
    await pending
    await w.clock.settle()
    const r = JSON.parse(early?.result ?? '{}')
    expect(r.status).toBe('running')
    expect(r.activity).toBe('starting')
    expect(typeof r.elapsedMs).toBe('number')
    expect(sentEarly).toBe(0)
    expect((await resultOf($, r.id)).status).toBe('complete')
    expect(w.submitted).toEqual([`Codex red-team review ${r.id} finished: "v", 2 findings. Read it with review_results ${r.id}.`])
    expect(w.origins[0]).toMatchObject({ kind: 'plugin', name: 'third-party-reviewers' })
    expect((w.origins[0] as { asUser?: boolean }).asUser).toBe(undefined)
  })

  for (const { name, env, answer } of [
    { name: 'in the desktop app the call returns the run at once', env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' }, answer: 'running' },
    { name: 'in its third-party-provider build too', env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop-3p' }, answer: 'running' },
    { name: 'a claude -p a desktop shell or hook started waits', env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', CLAUDE_CODE_CHILD_SESSION: '1' }, answer: 'waiting' },
    { name: 'a claude -p a desktop MCP server started waits', env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', CLAUDECODE: '1' }, answer: 'waiting' },
  ]) {
    test(`with no surface, ${name}`, async ($, on) => {
      const w = world(on, { env })
      w.scripts.push({ silent: true, lines: codexReview([]) })
      await boot($, w)
      const pending = call($, 'review_start', start)
      const early = await answerOf(w, pending)
      w.waiting.shift()?.()
      await pending
      await w.clock.settle()
      expect(early === undefined ? 'waiting' : JSON.parse(early.result).status).toBe(answer)
    })
  }

  test('with no surface the call waits for the review and nothing is submitted', async ($, on) => {
    const w = world(on)
    w.scripts.push({ lines: codexReview([finding({})]) })
    await boot($, w)
    const r = JSON.parse((await call($, 'review_start', start)).result)
    await w.clock.settle()
    expect(r.status).toBe('complete')
    expect(r.findings.length).toBe(1)
    expect(w.submitted).toEqual([])
  })

  test('a run that fails at once is announced with the first line of its failure', async ($, on) => {
    const w = world(on)
    w.surfaces = ['desktop']
    w.scripts.push({ exit: 1, stderr: ['not signed in', 'run codex login'] })
    await boot($, w)
    const { id } = JSON.parse((await call($, 'review_start', start)).result)
    await w.clock.settle()
    expect((await resultOf($, id)).status).toBe('failed')
    expect(w.submitted).toEqual([`Codex red-team review ${id} failed: Codex exited 1; Codex printed: not signed in. Read it with review_results ${id}.`])
  })

  test('a ledger write refused as the run settles records it failed and announces that', async ($, on) => {
    const w = world(on)
    w.surfaces = ['desktop']
    w.scripts.push({ silent: true, lines: codexReview([]) })
    await boot($, w)
    const pending = call($, 'review_start', start)
    const early = await answerOf(w, pending)
    const id = w.runs()[0]?.id ?? ''
    w.failRunsWrites = 1
    w.waiting.shift()?.()
    await pending
    await w.clock.settle()
    expect(JSON.parse(early?.result ?? '{}').status).toBe('running')
    const r = await resultOf($, id)
    expect(r.status).toBe('failed')
    expect(r.failure).toContain('The review failed:')
    expect(r.failure).toContain('EIO')
    expect(w.submitted).toEqual([`Codex red-team review ${id} failed: ${r.failure}. Read it with review_results ${id}.`])
  })

  test('a cancelled run whose ledger write is refused as it settles stays cancelled and is not announced', async ($, on) => {
    const w = world(on)
    w.surfaces = ['desktop']
    w.scripts.push({ silent: true })
    await boot($, w)
    void call($, 'review_start', start)
    await w.clock.settle()
    const id = w.runs()[0]?.id ?? ''
    w.failRunsWrites = 1
    expect((await call($, 'review_cancel', { runId: id })).result).toContain('Cancelled')
    await w.clock.settle()
    const r = await resultOf($, id)
    expect(r.status).toBe('cancelled')
    expect(r.failure).toContain('EIO')
    expect(w.submitted).toEqual([])
  })

  for (const { name, opts } of [
    { name: 'a refused message', opts: { dropPrompts: true } },
    { name: 'a message whose submission fails', opts: { failPrompts: true } },
  ]) {
    test(`${name} leaves the run complete and names it in a toast`, async ($, on) => {
      const w = world(on, opts)
      w.surfaces = ['desktop']
      w.scripts.push({ silent: true, lines: codexReview([finding({})]) })
      await boot($, w)
      const pending = call($, 'review_start', start)
      const early = await answerOf(w, pending)
      const id = w.runs()[0]?.id ?? ''
      w.waiting.shift()?.()
      await pending
      await w.clock.settle()
      expect(JSON.parse(early?.result ?? '{}').status).toBe('running')
      const r = await resultOf($, id)
      expect(r.status).toBe('complete')
      expect(r.findings.length).toBe(1)
      expect(w.toasts).toContain(`Codex red-team review ${id} has ended; ask Claude to read it with review_results ${id}.`)
    })
  }

  test('a run stopped by review_cancel or by the end of its conversation is not announced', async ($, on) => {
    const w = world(on)
    w.surfaces = ['desktop']
    w.scripts.push({ silent: true }, { silent: true })
    await boot($, w)
    const first = call($, 'review_start', start)
    await w.clock.settle()
    const second = call($, 'review_start', start)
    await w.clock.settle()
    const [cancelled, ended] = w.runs().map(r => r.id)
    expect((await call($, 'review_cancel', { runId: cancelled })).result).toContain('Cancelled')
    await w.clock.settle()
    expect((await resultOf($, cancelled ?? '')).status).toBe('cancelled')
    await endSession($)
    await Promise.all([first, second])
    await w.clock.settle()
    expect((await call($, 'review_results', { runId: ended })).deny).toContain('no run')
    expect(w.submitted).toEqual([])
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
    expect(w.store.get(`count:s1/${id}`)).toEqual([2, 1, 1])
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

    // As in Claude Code, the session id names the conversation left behind until the hook is done.
    await $.classic.SessionStart({ source: 'resume', session_id: 's1' })
    w.sessionId = 's1'
    expect((w.store.get('runs:s2') as any).runs.map((r: any) => r.id)).toEqual([other])
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

  test('a run whose conversation ends before it is allocated lands in neither', async ($, on) => {
    const w = world(on)
    w.files.set(`${w.work}/a.ts`, 'x')
    await boot($, w)
    w.holdRead = true
    const pending = call($, 'review_start', { ...start, reviewer: 'gemini', artifact: { files: [`${w.work}/a.ts`] } })
    await w.clock.settle()
    w.holdRead = false
    await endSession($)
    w.sessionId = 's2'
    w.heldRead.forEach(release => release())
    expect((await pending).deny).toContain('conversation changed')
    expect(w.runs()).toEqual([])
    expect(w.store.has('runs:s2')).toBe(false)
  })

  test('a run allocated across the end of its conversation lands in neither', async ($, on) => {
    const w = world(on)
    await boot($, w)
    w.holdWrites = true
    const pending = call($, 'review_start', start)
    await w.clock.settle()
    w.holdWrites = false
    await endSession($)
    w.sessionId = 's2'
    w.heldWrites.forEach(release => release())
    expect((await pending).deny).toContain('conversation changed')
    expect(w.runs()).toEqual([])
    expect(w.store.has('runs:s2')).toBe(false)
  })

  test('a resume waits for a save still in flight', async ($, on) => {
    const w = world(on)
    w.scripts.push({ lines: codexReview([finding({})]) })
    await boot($, w)
    const id = await startOf($)
    w.holdStore = true
    const pending = call($, 'review_record', { findingId: `${id}.1`, status: 'applied', evidence: 'e' })
    await w.clock.settle()
    w.holdStore = false
    await endSession($)
    const resumed = $.classic.SessionStart({ source: 'resume', session_id: 's1' })
    await w.clock.settle()
    w.heldStore.forEach(release => release())
    await Promise.all([pending, resumed])
    expect((await resultOf($, id)).findings[0].status).toBe('applied')
    expect((w.store.get('runs:s1') as any).runs[0].findings[0].status).toBe('applied')
  })

  test('session start drops the least recently saved conversations past the budget, never the current one', async ($, on) => {
    const w = world(on)
    const MiB = 1024 * 1024
    // Two UTF-8 bytes a character, so a budget counted in characters would keep them all.
    const saved = (savedAt: number, size: number) => ({ savedAt, runs: [{ id: 'r', response: 'é'.repeat(size / 2), findings: [{ status: 'applied', overrule: null }, { status: 'applied', overrule: 'reject' }] }] })
    w.store.set('runs:s1', saved(0, 0.5 * MiB))
    w.store.set('runs:new', saved(3, 0.5 * MiB))
    w.store.set('runs:mid', saved(2, 0.5 * MiB))
    w.store.set('runs:old', saved(1, 0.75 * MiB))
    await boot($, w)
    // Every ledger's runs are counted before the oldest ledger is pruned.
    expect([...w.store.keys()].sort()).toEqual(['count:mid/r', 'count:new/r', 'count:old/r', 'count:s1/r', 'runs:mid', 'runs:new', 'runs:s1'])
    expect(w.store.get('count:old/r')).toEqual([2, 1, 1])
  })

  test('a count whose write failed is written by the next save', async ($, on) => {
    const opts: { failStore: boolean | string } = { failStore: false }
    const w = world(on, opts)
    w.scripts.push({ lines: codexReview([finding({}), finding({ title: 'second' })]) }, { lines: codexReview([]) })
    await boot($, w)
    const id = await startOf($)
    opts.failStore = 'count:'
    await call($, 'review_record', { findingId: `${id}.1`, status: 'applied', evidence: 'fixed' })
    opts.failStore = false
    // A save that leaves the first run as it was.
    await startOf($)
    expect(w.store.get(`count:s1/${id}`)).toEqual([2, 1, 0])
  })

  test('any save repairs a stale count of its conversation', async ($, on) => {
    const w = world(on)
    w.scripts.push({ lines: codexReview([finding({})]) }, { lines: codexReview([]) })
    await boot($, w)
    const id = await startOf($)
    w.store.set(`count:s1/${id}`, [9, 9, 9])
    await startOf($)
    expect(w.store.get(`count:s1/${id}`)).toEqual([1, 0, 0])
  })

  test('session start repairs a stale count before pruning its ledger', async ($, on) => {
    const w = world(on)
    const MiB = 1024 * 1024
    const saved = (savedAt: number, size: number) => ({ savedAt, runs: [{ id: 'r', response: 'x'.repeat(size), findings: [{ status: 'applied', overrule: null }] }] })
    w.store.set('runs:new', saved(3, 1.5 * MiB))
    w.store.set('runs:old', saved(1, 0.75 * MiB))
    w.store.set('count:old/r', [1, 0, 0])
    await boot($, w)
    expect(w.store.has('runs:old')).toBe(false)
    expect(w.store.get('count:old/r')).toEqual([1, 1, 0])
  })

  test('a ledger whose runs cannot be counted is not pruned', async ($, on) => {
    const MiB = 1024 * 1024
    const saved = (savedAt: number, size: number) => ({ savedAt, runs: [{ id: `r-${savedAt}`, response: 'x'.repeat(size), findings: [{ status: 'rejected', overrule: null }] }] })
    const seeded = { 'runs:new': saved(3, 1.5 * MiB), 'runs:old': saved(1, 0.75 * MiB) }
    const w = world(on, { storeCap: JSON.stringify(seeded).length })
    for (const [k, v] of Object.entries(seeded)) w.store.set(k, v)
    await boot($, w)
    expect([...w.store.keys()].sort()).toEqual(['runs:new', 'runs:old'])
    expect(w.toasts.some(t => t.includes('Could not count earlier reviews'))).toBe(true)
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
