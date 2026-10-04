import { describe, expect, test } from 'claude-code/testing'

import { applyOverrule, applyRecord, citationOf, outcome, overrulePrompt } from '../hooks/findings'
import type { Finding, Run } from '../types'

const raw = (o: Partial<Finding>) => ({ severity: 'breakage', title: 't', claim: 'c', file: 'a.ts', line: 2, symbol: 'add', ...o })

describe('citations', () => {
  const text = 'one\nfunction add() {}\nthree\n'
  test('each outcome', () => {
    expect(citationOf(raw({}), text)).toBe('ok')
    expect(citationOf(raw({ file: null }), text)).toBe('no-location')
    expect(citationOf(raw({}), null)).toBe('file-missing')
    expect(citationOf(raw({}), undefined)).toBe('not-checked')
    expect(citationOf(raw({ line: 99 }), text)).toBe('line-out-of-range')
    expect(citationOf(raw({ symbol: 'nowhere' }), text)).toBe('symbol-not-found')
    expect(citationOf(raw({ line: null, symbol: 'add' }), text)).toBe('ok')
  })
})

const f = (id: string, overrule: Finding['overrule'] = null): Finding => ({
  ...raw({}), id, citation: 'ok', status: 'unresolved', evidence: null, overrule,
})
const run = (id: string, findings: Finding[]): Run => ({
  id, reviewer: 'codex', mode: 'red-team', model: 'm', effort: 'high', targets: [], startedAt: 0, endedAt: 1,
  status: 'complete', response: '', verdict: '', findings, deniedSteps: [], failure: null,
})

describe('judgement and overrule', () => {
  const all = [run('r-1', [f('r-1.1'), f('r-1.2', 'reject'), f('r-1.3', 'apply')])]
  test('Claude records its judgement; an overrule limits it; unknown refused', () => {
    const ok = applyRecord(all, 'r-1.1', 'applied', 'fixed at a.ts:2')
    expect(ok.result.ok).toBe(true)
    expect(ok.next[0]?.findings[0]).toMatchObject({ status: 'applied', evidence: 'fixed at a.ts:2', overrule: null })
    expect(applyRecord(all, 'r-1.2', 'applied', 'x').result.ok).toBe(false)
    expect(applyRecord(all, 'r-1.2', 'rejected', 'agreed').result.ok).toBe(true)
    expect(applyRecord(all, 'r-1.3', 'rejected', 'x').result.ok).toBe(false)
    expect(applyRecord(all, 'r-9.1', 'applied', 'x').result.ok).toBe(false)
  })
  test('the outcome follows the overrule; an Apply stays open until applied', () => {
    expect(outcome({ ...f('a.1'), status: 'applied', overrule: 'reject' })).toBe('rejected')
    expect(outcome({ ...f('a.1'), status: 'applied' })).toBe('applied')
    expect(outcome({ ...f('a.1'), status: 'rejected', overrule: 'apply' })).toBe('unresolved')
    expect(outcome({ ...f('a.1'), status: 'applied', overrule: 'apply' })).toBe('applied')
  })
  test('an overrule is set and withdrawn; an unknown finding changes nothing', () => {
    const rejected = applyOverrule(all, 'r-1.1', 'reject')
    expect(rejected[0]?.findings[0]?.overrule).toBe('reject')
    expect(applyOverrule(rejected, 'r-1.1', null)[0]?.findings[0]?.overrule).toBe(null)
    expect(applyOverrule(all, 'r-9.1', 'reject')).toEqual(all)
  })
  test('the prompts a press sends', () => {
    expect(overrulePrompt('r-1.2', 'reject')).toBe("Reject finding r-1.2: don't act on it, and undo any fix you made for it.")
    expect(overrulePrompt('r-1.2', 'apply')).toContain('Apply finding r-1.2:')
    expect(overrulePrompt('r-1.2', null)).toContain('withdraw my overrule')
  })
})
