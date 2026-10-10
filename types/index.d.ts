export type Reviewer = 'codex' | 'gemini'
export type RunStatus = 'running' | 'complete' | 'failed' | 'cancelled'
export type FindingStatus = 'applied' | 'rejected' | 'unresolved'
export type Overrule = 'apply' | 'reject'
// Whether the cited place exists; never whether the claim about it holds.
export type Citation = 'ok' | 'no-location' | 'file-missing' | 'line-out-of-range' | 'symbol-not-found' | 'not-checked'

export type Finding = {
  id: string
  severity: string
  title: string
  claim: string
  file: string | null
  line: number | null
  symbol: string | null
  citation: Citation
  status: FindingStatus
  evidence: string | null
  overrule: Overrule | null
}

export type Run = {
  id: string
  reviewer: Reviewer
  mode: string
  model: string
  effort: string
  targets: string[]
  startedAt: number
  endedAt: number | null
  status: RunStatus
  response: string | null
  verdict: string | null
  findings: Finding[]
  deniedSteps: string[]
  stderr?: string
  failure: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'third-party-reviewers': { runs: Run[]; selected: string | null; picker: Reviewer[] | null }
  }
}
