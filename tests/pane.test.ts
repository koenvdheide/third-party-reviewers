import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { boot, call, world } from './world'

const PANE = 'third-party-reviewers-findings'
const codexReview = [
  { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ verdict: 'v', response: 'r', findings: [{ severity: 'breakage', title: 'wrong operator', claim: 'c', file: 'a.ts', line: 2, symbol: 'add' }] }) } },
  { type: 'turn.completed' },
]
const props = (surface: string) => ({ title: 'Review findings', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: {}, view: {}, surface })
// Nothing beneath the plugins draws the band in a test, so this stands in for another plugin's row.
const beneath = (on: On) => on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'other' }))

describe('review button', () => {
  for (const reviewer of ['codex', 'gemini'] as const) {
    for (const depth of ['To convergence', 'One round']) {
      test(`${reviewer} ${depth} uses the selected skill's workflow`, async ($, on) => {
        const w = world(on, { codex: reviewer === 'codex', gemini: reviewer === 'gemini' })
        on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => ({ result: { questions: e.questions, answers: { 'How far should it go?': depth } } }))
        beneath(on)
        await boot($, w)
        const view = await $.ui.mount({ plugin: 'third-party-reviewers', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } } as any)
        await view.press({ key: 'external-review' })
        expect(w.submitted.length).toBe(1)
        const prompt = w.submitted[0]!
        expect(prompt).toContain(`third-party-reviewers:${reviewer === 'codex' ? 'codex' : 'antigravity'}`)
        if (depth === 'To convergence') {
          expect(prompt).toContain('shared review guide')
          expect(prompt).toContain('convergence')
          expect(prompt).not.toContain('until no actionable findings remain')
        } else {
          expect(prompt).toContain('one round')
          expect(prompt).not.toContain('convergence')
        }
        await view.unmount()
      })
    }
  }

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`keeps what the plugins beneath drew in the band, on ${surface}`, async ($, on) => {
      const w = world(on)
      beneath(on)
      w.seed([{ id: 'r1', findings: [] }])
      await boot($, w)
      const band = await $.ui.mount({ plugin: 'third-party-reviewers', surface, component: 'AbovePrompt', props: { hasSurvey: false } } as any)
      expect(await band.find({ key: 'external-review' })).toBeDefined()
      expect(await band.find({ key: 'findings' })).toBeDefined()
      expect(await band.find({ type: 'Text', text: 'other' })).toBeDefined()
    })

    test(`yields the band to a survey, on ${surface}`, async ($, on) => {
      const w = world(on)
      beneath(on)
      await boot($, w)
      const band = await $.ui.mount({ plugin: 'third-party-reviewers', surface, component: 'AbovePrompt', props: { hasSurvey: true } } as any)
      expect(await band.find({ key: 'external-review' })).toBeUndefined()
      expect(await band.find({ type: 'Text', text: 'other' })).toBeDefined()
    })
  }
})

describe('pane', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`shows Claude's judgement, takes the user's overrule, and asks, on ${surface}`, async ($, on) => {
      const w = world(on)
      beneath(on)
      w.files.set('C:/work/a.ts', 'one\nfunction add() {}\n')
      w.scripts.push({ lines: codexReview })
      await boot($, w)
      const runId = JSON.parse((await call($, 'review_start', { reviewer: 'codex', mode: 'red-team', question: 'Q', instructions: 'I', artifact: { files: ['C:/work/a.ts'] } })).result).id
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
    const runId = JSON.parse((await call($, 'review_start', { reviewer: 'codex', mode: 'red-team', question: 'Q', instructions: 'I', artifact: { files: ['C:/work/a.ts'] } })).result).id
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
    const runId = JSON.parse((await call($, 'review_start', { reviewer: 'codex', mode: 'red-team', question: 'Q', instructions: 'I', artifact: { files: ['C:/work/a.ts'] } })).result).id
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

  test('a later accepted instruction is written after an earlier one, in state and store', async ($, on) => {
    const w = world(on, { holdPrompts: true })
    w.files.set('C:/work/a.ts', 'one\nfunction add() {}\n')
    w.scripts.push({ lines: codexReview })
    await boot($, w)
    const runId = JSON.parse((await call($, 'review_start', { reviewer: 'codex', mode: 'red-team', question: 'Q', instructions: 'I', artifact: { files: ['C:/work/a.ts'] } })).result).id
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
    // Reject is accepted first and its write held; Apply's waits behind it.
    w.holdWrites = true
    w.held[0]?.({})
    for (let i = 0; i < 50 && w.heldWrites.length < 1; i++) await w.clock.advance(0)
    w.held[1]?.({})
    for (let i = 0; i < 20; i++) await w.clock.advance(0)
    expect(w.heldWrites.length).toBe(1)
    w.holdWrites = false
    w.heldWrites[0]?.()
    await Promise.all([reject.pressed, apply.pressed])
    const r = JSON.parse((await call($, 'review_results', { runId })).result)
    expect(r.findings[0].overrule).toBe('apply')
    expect((w.store.get('runs:s1') as any).runs[0].findings[0].overrule).toBe('apply')
  })
})
