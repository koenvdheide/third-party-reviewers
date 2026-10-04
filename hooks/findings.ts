import type { Citation, Finding, FindingStatus, Overrule, Run } from '../types'
import type { RawFinding } from './cli'

export const STATUSES: readonly FindingStatus[] = ['applied', 'rejected', 'unresolved']

// Reviewers' line numbers drift by a few lines; a symbol this close to the cited line counts.
const NEAR = 3

// `text` is the cited file's contents, null when the file is missing, undefined when it
// exists but could not be read (over the engine's 4 MiB read limit).
export function citationOf(f: RawFinding, text: string | null | undefined): Citation {
  if (f.file === null) return 'no-location'
  if (text === null) return 'file-missing'
  if (text === undefined) return 'not-checked'
  const lines = text.split(/\r?\n/)
  if (f.line !== null && (f.line < 1 || f.line > lines.length)) return 'line-out-of-range'
  if (f.symbol === null) return 'ok'
  const symbol = f.symbol
  const window = f.line === null ? lines : lines.slice(Math.max(0, f.line - 1 - NEAR), f.line + NEAR)
  return window.some(l => l.includes(symbol)) ? 'ok' : 'symbol-not-found'
}

// Claude's judgement is `status` with its `evidence`; the user's `overrule` sits on top of it,
// and an Apply stays open until Claude records the fix.
export function outcome(f: Finding): FindingStatus {
  if (f.overrule === 'reject') return 'rejected'
  if (f.overrule === 'apply' && f.status !== 'applied') return 'unresolved'
  return f.status
}

export function findingOf(all: readonly Run[], findingId: string): Finding | undefined {
  const runId = findingId.slice(0, findingId.lastIndexOf('.'))
  return all.find(r => r.id === runId)?.findings.find(f => f.id === findingId)
}

// A press in the pane reaches Claude as the user's own prompt, so Claude answers it at once.
// It names the finding by id only: a title is the reviewer's text, never the user's words.
export function overrulePrompt(id: string, o: Overrule | null): string {
  if (o === 'apply') return `Apply finding ${id}: make the fix, check it, and record it with review_record.`
  if (o === 'reject') return `Reject finding ${id}: don't act on it, and undo any fix you made for it.`
  return `I withdraw my overrule on finding ${id}; use your own judgement on it.`
}

export type RecordResult = { ok: true } | { ok: false; reason: string }

function write(all: readonly Run[], findingId: string, change: Partial<Finding>): Run[] {
  const runId = findingId.slice(0, findingId.lastIndexOf('.'))
  return all.map(r => (r.id !== runId ? r : { ...r, findings: r.findings.map(f => (f.id !== findingId ? f : { ...f, ...change })) }))
}

const missing = (findingId: string) => ({ ok: false as const, reason: `There is no finding ${findingId} in this conversation.` })

export function applyRecord(all: readonly Run[], findingId: string, status: FindingStatus, evidence: string): { next: Run[]; result: RecordResult } {
  const target = findingOf(all, findingId)
  if (!target) return { next: [...all], result: missing(findingId) }
  if (target.overrule === 'reject' && status === 'applied') {
    return { next: [...all], result: { ok: false, reason: `The user rejected ${findingId}; do not apply it.` } }
  }
  if (target.overrule === 'apply' && status === 'rejected') {
    return { next: [...all], result: { ok: false, reason: `The user asked for ${findingId} to be applied; apply it, or ask them before rejecting it.` } }
  }
  return { next: write(all, findingId, { status, evidence }), result: { ok: true } }
}

export function applyOverrule(all: readonly Run[], findingId: string, overrule: Overrule | null): Run[] {
  return findingOf(all, findingId) ? write(all, findingId, { overrule }) : [...all]
}
