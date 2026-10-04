import { describe, expect, test } from 'claude-code/testing'

import { boot, call, world } from './world'

const PANE = 'third-party-reviewers-findings'
const codexReview = [
  { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ verdict: 'v', response: 'r', findings: [{ severity: 'breakage', title: 'wrong operator', claim: 'c', file: 'a.ts', line: 2, symbol: 'add' }] }) } },
  { type: 'turn.completed' },
]
const props = (surface: string) => ({ title: 'Review findings', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: {}, view: {}, surface })

describe('pane', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`shows Claude's judgement, takes the user's overrule, and asks, on ${surface}`, async ($, on) => {
      const w = world(on)
      w.files.set('C:/work/a.ts', 'one\nfunction add() {}\n')
      w.scripts.push({ lines: codexReview })
      await boot($, w)
      const runId = JSON.parse((await call($, 'review_start', { reviewer: 'codex', mode: 'red-team', question: 'Q', instructions: 'I', artifact: { files: ['C:/work/a.ts'] } })).result).runId
      await w.clock.settle()
      const band = await $.ui.mount({ plugin: 'third-party-reviewers', surface, component: 'AbovePrompt', props: { hasSurvey: false } } as any)
      expect(JSON.stringify(await band.drawn())).toContain('findings (1 open)')
      await band.press({ key: 'findings' })
      expect(w.opened).toEqual([PANE])
      const view = await $.ui.mount({ plugin: 'third-party-reviewers', surface, component: 'Pane', requestId: PANE, props: props(surface) } as any)
      expect(JSON.stringify(await view.drawn())).toContain('○ wrong operator')
      await view.press({ key: `pick|${runId}.1` })
      // The world answers state itself, so the engine sees no write to redraw on: mount afresh.
      await view.unmount()
      const open = await $.ui.mount({ plugin: 'third-party-reviewers', surface, component: 'Pane', requestId: PANE, props: props(surface) } as any)
      expect(JSON.stringify(await open.drawn())).toContain('Claude: not judged yet')
      await open.press({ key: `reject|${runId}.1` })
      expect(w.submitted.at(-1)).toBe(`Reject finding ${runId}.1: don't act on it, and undo any fix you made for it.`)
      expect((await call($, 'review_record', { findingId: `${runId}.1`, status: 'applied', evidence: 'x' })).deny).toContain('do not apply it')
      await open.unmount()
      const rejected = await $.ui.mount({ plugin: 'third-party-reviewers', surface, component: 'Pane', requestId: PANE, props: props(surface) } as any)
      expect(JSON.stringify(await rejected.drawn())).toContain('You: rejected it')
      await rejected.press({ key: `withdraw|${runId}.1` })
      expect(w.submitted.at(-1)).toContain('withdraw my overrule')
      await rejected.unmount()
      const again = await $.ui.mount({ plugin: 'third-party-reviewers', surface, component: 'Pane', requestId: PANE, props: props(surface) } as any)
      await again.press({ key: `apply|${runId}.1` })
      expect(w.submitted.at(-1)).toBe(`Apply finding ${runId}.1: make the fix, check it, and record it with review_record.`)
      await again.press({ key: `ask|${runId}.1` })
      expect(w.filled).toEqual([{ text: `About finding ${runId}.1 (wrong operator): `, mode: 'insert' }])
    })
  }

  test('a refused instruction stores no overrule', async ($, on) => {
    const w = world(on, { dropPrompts: true })
    w.files.set('C:/work/a.ts', 'one\nfunction add() {}\n')
    w.scripts.push({ lines: codexReview })
    await boot($, w)
    const runId = JSON.parse((await call($, 'review_start', { reviewer: 'codex', mode: 'red-team', question: 'Q', instructions: 'I', artifact: { files: ['C:/work/a.ts'] } })).result).runId
    await w.clock.settle()
    const view = await $.ui.mount({ plugin: 'third-party-reviewers', surface: 'terminal', component: 'Pane', requestId: PANE, props: props('terminal') } as any)
    await view.press({ key: `pick|${runId}.1` })
    await view.unmount()
    const open = await $.ui.mount({ plugin: 'third-party-reviewers', surface: 'terminal', component: 'Pane', requestId: PANE, props: props('terminal') } as any)
    await open.press({ key: `reject|${runId}.1` })
    const r = JSON.parse((await call($, 'review_results', { runId })).result)
    expect(r.findings[0].overrule).toBe(null)
  })

  test('the stored overrule is the last instruction Claude accepted', async ($, on) => {
    const w = world(on, { holdPrompts: true })
    w.files.set('C:/work/a.ts', 'one\nfunction add() {}\n')
    w.scripts.push({ lines: codexReview })
    await boot($, w)
    const runId = JSON.parse((await call($, 'review_start', { reviewer: 'codex', mode: 'red-team', question: 'Q', instructions: 'I', artifact: { files: ['C:/work/a.ts'] } })).result).runId
    await w.clock.settle()
    // The review's own notification is held too; let it through first.
    w.held.shift()?.({})
    await w.clock.settle()
    // The world answers state itself, so each step mounts afresh to see the new buttons.
    const press = async (key: string) => {
      const view = await $.ui.mount({ plugin: 'third-party-reviewers', surface: 'terminal', component: 'Pane', requestId: PANE, props: props('terminal') } as any)
      const pressed = view.press({ key })
      // settle() would wait for the held prompt; one step lets the press reach it.
      const held = w.held.length
      for (let i = 0; i < 50 && w.held.length === held && !key.startsWith('pick'); i++) await w.clock.advance(0)
      if (key.startsWith('pick')) await pressed
      await view.unmount()
      // Wrapped: an async function returning the promise itself would wait for it.
      return { pressed }
    }
    await press(`pick|${runId}.1`)
    // Nothing is stored before a prompt is accepted, so Apply and Reject both stay on the row.
    const reject = await press(`reject|${runId}.1`)
    const apply = await press(`apply|${runId}.1`)
    w.held[1]?.({})
    w.held[0]?.({ drop: 'blocked' })
    await Promise.all([reject.pressed, apply.pressed])
    const r = JSON.parse((await call($, 'review_results', { runId })).result)
    expect(r.findings[0].overrule).toBe('apply')
  })

  test('a late write of an older accepted instruction does not undo a newer one', async ($, on) => {
    const w = world(on, { holdPrompts: true })
    w.files.set('C:/work/a.ts', 'one\nfunction add() {}\n')
    w.scripts.push({ lines: codexReview })
    await boot($, w)
    const runId = JSON.parse((await call($, 'review_start', { reviewer: 'codex', mode: 'red-team', question: 'Q', instructions: 'I', artifact: { files: ['C:/work/a.ts'] } })).result).runId
    await w.clock.settle()
    w.held.shift()?.({})
    await w.clock.settle()
    const press = async (key: string) => {
      const view = await $.ui.mount({ plugin: 'third-party-reviewers', surface: 'terminal', component: 'Pane', requestId: PANE, props: props('terminal') } as any)
      const pressed = view.press({ key })
      const held = w.held.length
      for (let i = 0; i < 50 && w.held.length === held && !key.startsWith('pick'); i++) await w.clock.advance(0)
      if (key.startsWith('pick')) await pressed
      await view.unmount()
      return { pressed }
    }
    await press(`pick|${runId}.1`)
    const reject = await press(`reject|${runId}.1`)
    const apply = await press(`apply|${runId}.1`)
    // Both are accepted, Reject first; their writes then land in the opposite order.
    w.holdWrites = true
    w.held[0]?.({})
    for (let i = 0; i < 50 && w.heldWrites.length < 1; i++) await w.clock.advance(0)
    w.held[1]?.({})
    for (let i = 0; i < 50 && w.heldWrites.length < 2; i++) await w.clock.advance(0)
    w.holdWrites = false
    w.heldWrites[1]?.()
    for (let i = 0; i < 20; i++) await w.clock.advance(0)
    w.heldWrites[0]?.()
    await Promise.all([reject.pressed, apply.pressed])
    const r = JSON.parse((await call($, 'review_results', { runId })).result)
    expect(r.findings[0].overrule).toBe('apply')
  })
})
