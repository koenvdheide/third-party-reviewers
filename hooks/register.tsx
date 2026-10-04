import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Reviewer, Run } from '../types'
import { CODEX_MODEL, EFFORTS, Lines, NAME, SAFE_ID, agyArgv, agyInput, agyParser, buildPrompt, codexArgv, codexParser, defaultEffort, newestFlash } from './cli'
import type { Exe, Outcome, Parser } from './cli'

// Everything that calls the engine lives in this file: the mod loader follows `$` only into
// functions declared here, never across an import. cli.ts holds the pure parts.

type Engine = EngineInterface
type Stream = ReturnType<Engine['process']['spawn']>
type Installed = { codex: Exe | null; gemini: { exe: Exe; flash: string } | null }

const T = <N extends string>(name: N) => `mcp__third-party-reviewers__${name}` as const
const BUTTON = 'external-review'
const ENDED = 'The conversation changed before the review could start.'
const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\/)/

const runs = atom({ plugin: 'third-party-reviewers', key: 'runs' } as const, [])

let installed: Installed | null = null
const progress = new Map<string, { label: string; startedAt: number; activity: string }>()
const stoppers = new Map<string, () => Promise<void>>()
const cancelled = new Set<string>()
// Moves on every session end; work captured under an older value is dropped, so a run that
// /clear ended never delivers into the next conversation.
let generation = 0
let ticker: { cancel: () => void } | null = null

async function works($: Engine, exe: Exe, args: string[]): Promise<string | null> {
  try {
    const r = await $.process.run([...exe.argv, ...args], { timeoutMs: 30_000, env: exe.env })
    return r.exitCode === 0 ? r.stdout : null
  } catch {
    return null
  }
}

// npm installs Codex on Windows as script shims only, so a bare `codex` goes through
// cmd.exe, which parses the arguments. Run a codex.exe on PATH directly, or else the binary
// the npm launcher (@openai/codex/bin/codex.js) runs, found where the launcher looks for it
// (the platform package nested or beside @openai/codex, then its vendor folder), with the
// two variables the launcher sets.
async function windowsCodex($: Engine): Promise<Exe | null> {
  const found = await works($, { argv: ['where.exe'] }, ['codex'])
  const paths = (found ?? '').split(/\r?\n/).map(p => p.trim().replaceAll('\\', '/')).filter(p => p !== '')
  const native = paths.find(p => p.toLowerCase().endsWith('.exe'))
  if (native !== undefined) return (await works($, { argv: [native] }, ['--version'])) ? { argv: [native] } : null
  const shim = paths.find(p => p.toLowerCase().endsWith('.cmd'))
  if (shim === undefined) return null
  const prefix = shim.slice(0, shim.lastIndexOf('/'))
  const root = `${prefix}/node_modules/@openai/codex`
  const arm = (await $.env.get('PROCESSOR_ARCHITECTURE')) === 'ARM64'
  const pkg = arm ? 'codex-win32-arm64' : 'codex-win32-x64'
  const bin = `vendor/${arm ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'}/bin/codex.exe`
  for (const candidate of [`${root}/node_modules/@openai/${pkg}/${bin}`, `${prefix}/node_modules/@openai/${pkg}/${bin}`, `${root}/${bin}`]) {
    if (!(await $.fs.exists(candidate))) continue
    const exe: Exe = { argv: [candidate], env: { CODEX_MANAGED_BY_NPM: '1', CODEX_MANAGED_PACKAGE_ROOT: root } }
    return (await works($, exe, ['--version'])) ? exe : null
  }
  return null
}

async function resolveCodex($: Engine): Promise<Exe | null> {
  if ((await $.env.get('OS')) === 'Windows_NT') return windowsCodex($)
  const bare: Exe = { argv: ['codex'] }
  return (await works($, bare, ['--version'])) ? bare : null
}

async function resolveGemini($: Engine): Promise<Installed['gemini']> {
  const exe: Exe = { argv: ['agy'] }
  const listing = await works($, exe, ['models'])
  const flash = listing === null ? null : newestFlash(listing)
  return flash === null ? null : { exe, flash }
}

async function ensure($: Engine): Promise<Installed> {
  if (installed === null) {
    const [codex, gemini] = await Promise.all([resolveCodex($), resolveGemini($)])
    installed = { codex, gemini }
  }
  return installed
}

function available(i: Installed): Reviewer[] {
  const out: Reviewer[] = []
  if (i.codex) out.push('codex')
  if (i.gemini) out.push('gemini')
  return out
}

// The directory goes in through the environment, so no shell parses it: cmd.exe would expand
// `%NAME%` and act on `&` inside a path.
async function removeDir($: Engine, dir: string): Promise<void> {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const argv = isWindows
    ? ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', 'Remove-Item -LiteralPath $env:TPR_DIR -Recurse -Force']
    : ['rm', '-rf', '--', dir]
  await $.process.run(argv, { env: { TPR_DIR: dir } }).catch(() => undefined)
}

async function runDirOf($: Engine, id: string): Promise<string> {
  const tmp = ((await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp').replaceAll('\\', '/')
  return `${tmp}/third-party-reviewers/${id}`
}

function mmss(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

function tick($: Engine): void {
  if (ticker !== null) return
  ticker = $.clock.every(1000, () => {
    void $.clock.now().then(now => {
      if (progress.size === 0) {
        $.ui.status(undefined)
        ticker?.cancel()
        ticker = null
        return
      }
      $.ui.status([...progress.values()].map(p => `${p.label} · ${mmss(now - p.startedAt)} · ${p.activity}`).join('  |  '))
    })
  })
}

type StartRequest = {
  reviewer: Reviewer
  mode: string
  question: string
  instructions: string
  text: string | null
  files: string[]
  effort: string
  model: string
  exe: Exe
}

async function startRun($: Engine, req: StartRequest, gen: number): Promise<Run> {
  const startedAt = await $.clock.now()
  const draft: Run = {
    id: '', reviewer: req.reviewer, mode: req.mode, model: req.model, effort: req.effort, targets: req.files,
    startedAt, endedAt: null, status: 'running', response: null, verdict: null, findings: [], deniedSteps: [], failure: null,
  }
  let id = ''
  await update($, runs, list => {
    if (gen !== generation) return list
    // Random, so an id never repeats across /clear or a resumed conversation; short for
    // notifications, and redrawn until no run in the ledger has it.
    do id = `r-${crypto.randomUUID().slice(0, 8)}`
    while (list.some(r => r.id === id))
    return [...list, { ...draft, id }]
  })
  const run: Run = { ...draft, id }
  if (gen !== generation || id === '') return run

  let runDir: string | null = null
  try {
    const root = await $.session.cwd()
    const isRepo = (await $.session.repo()) !== null
    const schema = `${$.plugin.root}/schemas/review.schema.json`
    const prompt = buildPrompt({
      mode: req.mode, question: req.question, instructions: req.instructions, text: req.text, files: req.files,
      nonce: Math.random().toString(36).slice(2, 10),
    })
    let argv: string[]
    let input: string
    let parser: Parser
    if (req.reviewer === 'gemini') {
      // agy can write inside its working directory, so it gets an empty one of its own.
      runDir = await runDirOf($, id)
      await $.fs.write(`${runDir}/.run`, id)
      argv = agyArgv(req.exe, { model: req.model, schema })
      input = agyInput(prompt)
      parser = agyParser()
    } else {
      argv = codexArgv(req.exe, { model: req.model, effort: req.effort, isRepo, schema })
      input = prompt
      parser = codexParser()
    }
    if (gen !== generation) {
      if (runDir !== null) await removeDir($, runDir)
      return run
    }
    const label = `${NAME[req.reviewer]} · ${req.mode}`
    progress.set(id, { label, startedAt, activity: 'starting' })
    const stream = $.process.spawn({ argv, cwd: runDir ?? root, env: req.exe.env, input })
    stoppers.set(id, async () => {
      await stream.return(undefined as never)
    })
    tick($)
    const target = req.files.length > 0 ? req.files.map(f => f.split(/[\\/]/).pop()).join(', ') : 'inline text'
    $.ui.toast(`${label} started on ${target}`)
    void consume($, run, stream, parser, runDir, gen)
    return run
  } catch (err) {
    if (runDir !== null) await removeDir($, runDir)
    const endedAt = await $.clock.now()
    const failure = `The review could not start: ${err instanceof Error ? err.message : String(err)}`
    await update($, runs, list => list.map(r => (r.id === id ? { ...r, status: 'failed' as const, endedAt, failure } : r)))
    return { ...run, status: 'failed', endedAt, failure }
  }
}

async function consume($: Engine, run: Run, stream: Stream, parser: Parser, runDir: string | null, gen: number): Promise<void> {
  const lines = new Lines()
  const note = (line: string) => {
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      return
    }
    const activity = parser.line(event)
    const p = progress.get(run.id)
    if (activity !== null && p) p.activity = activity
  }
  try {
    for await (const chunk of stream) {
      if (chunk.stream === 'stdout') lines.push(chunk.text).forEach(note)
    }
    lines.flush().forEach(note)
  } catch {
    // closed by a cancel or a session end; `cancelled` and `generation` say which
  }
  const exit = await stream.result.catch(() => null)
  progress.delete(run.id)
  stoppers.delete(run.id)
  const wasCancelled = cancelled.delete(run.id)
  const outcome: Outcome = wasCancelled ? { review: null, failure: null, deniedSteps: [] } : parser.finish(exit?.code ?? null)
  if (runDir !== null) await removeDir($, runDir)

  const findings = outcome.review?.findings ?? []
  const status = wasCancelled ? 'cancelled' : outcome.review ? 'complete' : 'failed'
  const endedAt = await $.clock.now()
  if (gen !== generation) return
  await update($, runs, list =>
    gen !== generation
      ? list
      : list.map(r =>
          r.id !== run.id
            ? r
            : { ...r, status, endedAt, response: outcome.review?.response ?? null, verdict: outcome.review?.verdict ?? null, findings, deniedSteps: outcome.deniedSteps, failure: outcome.failure },
        ),
  )
  if (wasCancelled || gen !== generation) return

  const breakage = findings.filter(f => f.severity === 'breakage').length
  const parts = [
    `[third-party-reviewers] Review ${run.id} (${NAME[run.reviewer]} ${run.mode}) `,
    status === 'complete' ? `finished: ${findings.length} findings, ${breakage} breakage.` : `failed: ${outcome.failure}.`,
  ]
  if (outcome.deniedSteps.length > 0) parts.push(` Steps the reviewer reported as refused: ${outcome.deniedSteps.join('; ')}.`)
  parts.push(` Read it with review_results ${run.id} before acting on it.`)
  await $.prompt.submit({ text: parts.join('') })
}

async function cancelRun(id: string): Promise<boolean> {
  const stop = stoppers.get(id)
  if (!stop) return false
  cancelled.add(id)
  await stop()
  return true
}

// After a reload the children are gone with the old module, but `$.state` keeps their rows,
// and a Gemini run's directory stays on disk.
async function markOrphans($: Engine): Promise<void> {
  const orphans = (await read($, runs)).filter(r => r.status === 'running' && !stoppers.has(r.id))
  for (const r of orphans) if (r.reviewer === 'gemini') await removeDir($, await runDirOf($, r.id))
  const endedAt = await $.clock.now()
  await update($, runs, list =>
    list.map(r => (orphans.some(o => o.id === r.id) ? { ...r, status: 'cancelled' as const, endedAt, failure: 'The plugin reloaded while this review ran, which ended it.' } : r)),
  )
}

async function endSession($: Engine): Promise<void> {
  generation += 1
  const stops = [...stoppers.values()]
  stoppers.clear()
  progress.clear()
  ticker?.cancel()
  ticker = null
  await Promise.allSettled(stops.map(stop => stop()))
  $.ui.status(undefined)
  await update($, runs, () => [])
}

async function registerTools($: Engine, i: Installed): Promise<void> {
  const reviewers = available(i)
  if (reviewers.length === 0) return
  const names = reviewers.map(r => NAME[r]).join(' or ')
  await $.tool.register({
    name: 'review_start',
    description: `Start an independent review by ${names}. Returns a run id at once; the result arrives later as a notification. Follow the codex or antigravity skill for when to review, which mode, the instructions to pass, and how to handle findings.`,
    inputSchema: {
      type: 'object',
      required: ['reviewer', 'mode', 'question', 'instructions', 'artifact'],
      properties: {
        reviewer: { type: 'string', enum: reviewers },
        mode: { type: 'string' },
        question: { type: 'string' },
        instructions: { type: 'string', description: 'the mode instructions from the skill' },
        artifact: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'inline material, fenced as data' },
            files: { type: 'array', items: { type: 'string' }, description: 'absolute paths the reviewer reads' },
          },
        },
        effort: { type: 'string', description: 'defaults by mode; codex up to xhigh, gemini up to high; never max' },
        model: { type: 'string', description: 'override; for gemini a base id without an effort suffix' },
      },
    },
  })
  await $.tool.register({ name: 'review_results', description: 'A review run: its status while running, or its full result.', inputSchema: { type: 'object', required: ['runId'], properties: { runId: { type: 'string' } } } })
  await $.tool.register({ name: 'review_cancel', description: 'Stop a running review.', inputSchema: { type: 'object', required: ['runId'], properties: { runId: { type: 'string' } } } })
}

function instruction(reviewer: Reviewer, depth: string): string {
  const skill = reviewer === 'codex' ? 'the third-party-reviewers:codex skill' : 'the third-party-reviewers:antigravity skill'
  // Deliberately not diff-bound: the target is whatever is salient in the session,
  // which may be a spec, a plan, a file or a decision rather than a diff.
  const target = 'whatever we are working on'
  return depth === 'To convergence'
    ? `Use ${skill} to review ${target}, carrying prior findings forward each round, until no actionable findings remain; stop and report any blocker needing my input or evidence you cannot reach.`
    : `Use ${skill} to review ${target}, one round.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    installed = null
    await markOrphans($)
    await registerTools($, await ensure($))
    return started
  })

  on('session.end', async ($, e, next) => {
    await endSession($)
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    // `skill.prompt` carries the plugin-qualified name.
    const reviewer: Reviewer | null = e.skill === 'third-party-reviewers:codex' ? 'codex' : e.skill === 'third-party-reviewers:antigravity' ? 'gemini' : null
    if (reviewer === null) return next(e)
    const i = await ensure($)
    if (available(i).includes(reviewer)) return next(e)
    const other = available(i).find(r => r !== reviewer)
    const cli = reviewer === 'codex' ? 'Codex CLI (`codex`)' : 'Antigravity CLI (`agy`)'
    return { text: `The ${cli} is not installed on this machine, so this skill cannot run a review. Tell the user${other ? `, and offer a review by ${NAME[other]} instead` : ''}.` }
  })

  on('tool.call', { tool: T('review_start') }, async ($, e) => {
    const gen = generation
    const input = e as unknown as { reviewer: Reviewer; mode: string; question: string; instructions: string; artifact?: { text?: string; files?: string[] }; effort?: string; model?: string }
    const i = await ensure($)
    if (gen !== generation) return { deny: ENDED }
    const exe = input.reviewer === 'codex' ? i.codex : input.reviewer === 'gemini' ? i.gemini?.exe : null
    if (!exe) return { deny: `${NAME[input.reviewer] ?? input.reviewer} is not installed here. Installed: ${available(i).map(r => NAME[r]).join(', ') || 'none'}.` }
    const effort = input.effort ?? defaultEffort(input.reviewer, input.mode)
    if (!EFFORTS[input.reviewer].includes(effort)) return { deny: `Effort ${effort} is not allowed for ${NAME[input.reviewer]}; use one of ${EFFORTS[input.reviewer].join(', ')}.` }
    if (input.model !== undefined && !SAFE_ID.test(input.model)) return { deny: `The model id ${JSON.stringify(input.model)} has characters a model id never has.` }
    const model = input.reviewer === 'codex' ? (input.model ?? CODEX_MODEL) : `${input.model ?? i.gemini?.flash}-${effort}`
    const files = input.artifact?.files ?? []
    // Gemini runs from a directory of its own, so a relative path would point elsewhere.
    for (const file of files) {
      if (!ABSOLUTE.test(file)) return { deny: `${file} is not an absolute path; artifact.files takes absolute paths.` }
      if (!(await $.fs.exists(file))) return { deny: `Cannot find ${file}.` }
    }
    const run = await startRun($, {
      reviewer: input.reviewer, mode: input.mode, question: input.question, instructions: input.instructions,
      text: input.artifact?.text ?? null, files, effort, model, exe,
    }, gen)
    if (run.id === '' || gen !== generation) return { deny: ENDED }
    if (run.status === 'failed') return { deny: `${run.id}: ${run.failure}` }
    return { result: JSON.stringify({ runId: run.id, reviewer: run.reviewer, mode: run.mode, model: run.model, effort: run.effort, note: 'The result arrives as a notification when the review ends; you may work on something unrelated meanwhile.' }) }
  })

  on('tool.call', { tool: T('review_results') }, async ($, e) => {
    const { runId } = e as unknown as { runId: string }
    const run = (await read($, runs)).find(r => r.id === runId)
    if (!run) return { deny: `There is no run ${runId} in this conversation.` }
    const now = await $.clock.now()
    const extra = run.status === 'running'
      ? { elapsedMs: now - run.startedAt, activity: progress.get(runId)?.activity ?? 'starting' }
      : { durationMs: (run.endedAt ?? now) - run.startedAt }
    return { result: JSON.stringify({ ...run, ...extra }, null, 2) }
  })

  on('tool.call', { tool: T('review_cancel') }, async ($, e) => {
    const { runId } = e as unknown as { runId: string }
    return (await cancelRun(runId)) ? { result: `Cancelled ${runId}.` } : { deny: `${runId} is not running.` }
  })

  /**
   * The flow lives in a `ui.press` hook rather than in the Button's `onPress`, because
   * `onPress` is declared `(e) => void`: the engine does not await it, so an async chain
   * started there runs unawaited past the point the engine considers the press finished.
   * A hook is `($, e, next)` and is awaited, so `$.ui.ask` and `$.prompt.submit` are safe.
   * A press raises `ui.press` with `onPress` as its bottom, so a hook that answers for
   * itself (returning without `next`) keeps the stub from running.
   */
  on('ui.press', { element: BUTTON }, async ($, e) => {
    const answered = { element: e.element }
    const reviewers = available(await ensure($))
    const [first] = reviewers
    if (first === undefined) {
      $.ui.toast('Neither the Codex CLI nor the Antigravity CLI is installed.')
      return answered
    }
    let who: Reviewer = first
    if (reviewers.length > 1) {
      const picked = await $.ui.ask('Which reviewer?', { header: 'Reviewer', options: [...reviewers.map(r => NAME[r]), 'Cancel'] })
      // Matched against a closed set: a dismissed dialog returns a marker string.
      const match = reviewers.find(r => NAME[r] === picked)
      if (match === undefined) return answered
      who = match
    }
    const depth = await $.ui.ask('How far should it go?', { header: 'Depth', options: ['To convergence', 'One round', 'Cancel'] })
    if (depth !== 'To convergence' && depth !== 'One round') return answered
    // asUser so the transcript reads as the instruction it is, not as a plugin message.
    await $.prompt.submit({ text: instruction(who, depth), asUser: true })
    return answered
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    // Yield the row while the engine has a survey in it.
    if (e.props.hasSurvey) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box>
        <Button key={BUTTON} label="External review" onPress={() => {}} />
      </Box>
    )
  })
}
