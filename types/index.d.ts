export type Reviewer = 'codex' | 'gemini'
export type RunStatus = 'running' | 'complete' | 'failed' | 'cancelled'

export type Finding = {
  severity: string
  title: string
  claim: string
  file: string | null
  line: number | null
  symbol: string | null
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
  failure: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'third-party-reviewers': { runs: Run[] }
  }
}
