import type { EngineInterface } from 'claude-code'

import type { Finding, FindingStatus, Run } from '../types'
import { NAME } from './cli'
import { outcome } from './findings'

export const PANE = 'third-party-reviewers-findings'

type Elements = ReturnType<EngineInterface['ui']['resolve']>

const MARK: Record<FindingStatus, string> = { unresolved: '○', applied: '✓', rejected: '✗' }
const base = (p: string) => p.split(/[\\/]/).pop() ?? p
const where = (f: Finding) => (f.file ? `${base(f.file)}${f.line ? `:${f.line}` : ''}` : '')

function summary(r: Run): string {
  if (r.status === 'running') return 'running'
  if (r.status === 'cancelled') return 'cancelled'
  if (r.status === 'failed') return `failed: ${r.failure}`
  const open = r.findings.filter(f => outcome(f) === 'unresolved').length
  return r.findings.length === 0 ? 'no findings' : `${r.findings.length} findings, ${open} open`
}

function judgement(f: Finding): string {
  if (f.status === 'unresolved' && !f.evidence) return 'Claude: not judged yet'
  return `Claude: ${f.status}${f.evidence ? `, ${f.evidence}` : ''}`
}

// One line per finding, its mark the outcome; pressing it (`pick|<id>`) opens Claude's
// judgement and the user's overrule: `apply|<id>`, `reject|<id>`, `withdraw|<id>`, `ask|<id>`.
export function paneTree({ Box, Button, Text }: Elements, all: readonly Run[], selected: string | null) {
  if (all.length === 0) return <Text dimColor>No reviews in this conversation yet.</Text>
  return (
    <Box flexDirection="column">
      {[...all].reverse().map(r => (
        <Box key={r.id} flexDirection="column" marginBottom={1}>
          <Text>
            <Text bold>{NAME[r.reviewer]} {r.mode}</Text>
            <Text dimColor> · {summary(r)} · {r.id}</Text>
          </Text>
          {r.findings.map(f => (
            <Box key={f.id} flexDirection="column">
              <Box>
                <Button key={`pick|${f.id}`} plain dimColor={outcome(f) !== 'unresolved'} label={`${MARK[outcome(f)]} ${f.title}`} onPress={() => {}} />
                <Text dimColor wrap="truncate-end">
                  {'  '}
                  {[f.severity, where(f), f.overrule ? 'overruled' : ''].filter(Boolean).join(' · ')}
                </Text>
              </Box>
              {f.id === selected ? (
                <Box flexDirection="column" marginLeft={2} marginBottom={1}>
                  <Text>{f.claim}</Text>
                  {f.citation !== 'ok' && f.citation !== 'no-location' ? <Text dimColor>citation: {f.citation}</Text> : null}
                  <Text dimColor>{judgement(f)}</Text>
                  {f.overrule ? <Text>{`You: ${f.overrule === 'reject' ? 'rejected it' : 'asked Claude to apply it'}`}</Text> : null}
                  <Box>
                    {f.overrule ? <Button key={`withdraw|${f.id}`} variant="secondary" label="Withdraw" onPress={() => {}} /> : null}
                    {!f.overrule && f.status !== 'applied' ? <Button key={`apply|${f.id}`} variant="secondary" label="Apply" onPress={() => {}} /> : null}
                    {!f.overrule && f.status !== 'rejected' ? <Button key={`reject|${f.id}`} variant="secondary" label="Reject" onPress={() => {}} /> : null}
                    <Button key={`ask|${f.id}`} variant="secondary" label="Ask" onPress={() => {}} />
                  </Box>
                </Box>
              ) : null}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}
