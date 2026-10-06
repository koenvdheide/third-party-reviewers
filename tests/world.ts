import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export type Script = { lines?: unknown[]; exit?: number; silent?: boolean }

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

export const CODEX_EXE = 'C:/u/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'

export function world(on: On, opts: { codex?: boolean; nativeCodex?: string; gemini?: boolean; slowResolve?: boolean; slowSetup?: boolean; failWrite?: boolean; dropPrompts?: boolean; holdPrompts?: boolean } = {}) {
  const clock = mock.clock(on)
  mock.env(on, { OS: 'Windows_NT', TEMP: 'C:/tmp/tpr' })
  const files = new Map<string, string>([[CODEX_EXE, '']])
  const state = new Map<string, { value: unknown; version: number }>()
  const w = {
    clock, files,
    scripts: [] as Script[],
    spawns: [] as { argv: readonly string[]; cwd?: string }[],
    removed: [] as string[],
    submitted: [] as string[],
    filled: [] as { text: string; mode?: string }[],
    opened: [] as string[],
    toasts: [] as string[],
    // With holdPrompts, each submitted prompt waits here until the test answers it.
    held: [] as ((answer: { drop?: string }) => void)[],
    // With holdWrites on, each write of the runs ledger waits here until the test releases it.
    holdWrites: false,
    heldWrites: [] as (() => void)[],
    seed(runs: unknown[]) {
      state.set('third-party-reviewers/runs', { value: runs, version: 1 })
    },
    // The ledger, for a run whose review_start has not returned yet.
    runs: () => (state.get('third-party-reviewers/runs')?.value ?? []) as { id: string }[],
  }
  const codex = opts.codex ?? true
  const gemini = opts.gemini ?? true

  // The engine hands fs hooks the platform's own path form.
  const key = (path: string) => path.replaceAll('\\', '/')
  // The engine rejects a network location, as the real one does.
  on('fs.exists', ($, e) => (key(e.path).startsWith('//') ? { deny: `network location: ${e.path}` } : { value: files.has(key(e.path)) }))
  on('fs.read', ($, e) => (files.has(key(e.path)) ? { value: files.get(key(e.path)) as string } : { deny: `ENOENT: ${e.path}` }))
  on('prompt.fill', ($, e) => {
    w.filled.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('fs.write', ($, e) => {
    if (opts.failWrite) return { deny: `EACCES: ${e.path}` }
    files.set(key(e.path), e.text)
    return { value: undefined }
  })
  on('state.get', ($, e: any) => {
    const s = state.get(`${e.plugin}/${e.key}`)
    return { value: { value: s?.value, version: s?.version ?? 0 } }
  })
  on('state.set', async ($, e: any) => {
    if (w.holdWrites && e.key === 'runs') await new Promise<void>(resolve => w.heldWrites.push(resolve))
    const k = `${e.plugin}/${e.key}`
    const current = state.get(k)?.version ?? 0
    if (e.ifVersion !== undefined && e.ifVersion !== current) return { value: { isSet: false, version: current } }
    state.set(k, { value: e.value, version: current + 1 })
    return { value: { isSet: true, version: current + 1 } }
  })
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', async () => {
    if (opts.slowSetup) await clock.sleep(100)
    return { value: 'C:/work' }
  })
  on('session.repo', () => ({ value: { root: 'C:/work', remote: null, internal: false, name: null } }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__third-party-reviewers__${e.name}` } }))
  on('process.run', async ($, e) => {
    const cmd = e.argv.join(' ')
    if (cmd === 'where.exe codex') {
      if (!codex) return { value: { exitCode: 1, stdout: '', stderr: 'not found', isStdoutTruncated: false, isStderrTruncated: false } }
      return ok(opts.nativeCodex ? `${opts.nativeCodex}\r\n` : 'C:\\u\\npm\\codex\r\nC:\\u\\npm\\codex.cmd\r\n')
    }
    if (cmd === `${opts.nativeCodex?.replaceAll('\\', '/') ?? CODEX_EXE} --version`) {
      if (opts.slowResolve) await clock.sleep(100)
      return ok('codex-cli 0.159.3')
    }
    if (cmd === 'agy models') return gemini ? ok('gemini-3.8-flash-high\tGemini 3.8 Flash (High)') : { deny: 'ENOENT: agy' }
    if (e.argv[0] === 'powershell.exe') {
      w.removed.push(e.init?.env?.TPR_DIR ?? '')
      return ok('')
    }
    return { deny: `not installed: ${cmd}` }
  })
  on('process.spawn', async function* ($, e, next) {
    w.spawns.push({ argv: e.argv, cwd: e.cwd })
    const s = w.scripts.shift() ?? {}
    // A silent child writes nothing until it is killed, which aborts this dispatch.
    if (s.silent) await new Promise<void>(resolve => next.signal.addEventListener('abort', () => resolve()))
    for (const l of s.lines ?? []) yield { stream: 'stdout' as const, text: JSON.stringify(l) + '\n' }
    return { value: { code: s.exit ?? 0, signal: null } }
  })
  on('prompt.submit', async ($, e) => {
    if (opts.dropPrompts) return { drop: 'blocked by a policy hook' }
    if (opts.holdPrompts) {
      const answer = await new Promise<{ drop?: string }>(resolve => w.held.push(resolve))
      if (answer.drop !== undefined) return { drop: answer.drop }
    }
    w.submitted.push(e.text)
    return { text: e.text }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('skill.prompt', ($, e) => ({ text: e.text }))
  return w
}

export const T = <N extends string>(name: N) => `mcp__third-party-reviewers__${name}` as const

let calls = 0
export const call = ($: any, name: string, args: Record<string, unknown>) =>
  $.tool.call({ tool: T(name), tool_use_id: `tu${(calls += 1)}`, ...args })

export async function boot($: any, w: ReturnType<typeof world>) {
  await $.session.start({ cwd: 'C:/work', surface: null, isInteractive: true })
  await w.clock.settle()
}

export const endSession = ($: any) => $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
