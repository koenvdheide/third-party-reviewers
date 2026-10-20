// OS-level experiment, not a Claude Desktop test or a production worker.
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, writeFile, rename, rm, readdir, readlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { test } from 'node:test'

const fixture = fileURLToPath(new URL('./desktop-probe/processes.mjs', import.meta.url))
const exec = promisify(execFile)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const procIds = new Map()

async function linuxStat(pid) {
  // Some sandbox runners bind an ancestor's /proc into a new PID namespace.
  // process.kill uses local PIDs; that /proc uses outer PIDs. Resolve the
  // namespace before inspecting a zombie, rather than inspecting another PID.
  if (Number((await readFile('/proc/self/stat', 'utf8')).split(' ')[0]) === process.pid) {
    return readFile(`/proc/${pid}/stat`, 'utf8')
  }
  if (!procIds.has(pid)) {
    const ns = await readlink('/proc/self/ns/pid')
    for (const entry of await readdir('/proc')) {
      if (!/^\d+$/.test(entry)) continue
      try {
        const status = await readFile(`/proc/${entry}/status`, 'utf8')
        const ids = status.match(/^NSpid:\s+(.+)$/m)?.[1].trim().split(/\s+/)
        if (Number(ids?.at(-1)) === pid && await readlink(`/proc/${entry}/ns/pid`) === ns) {
          procIds.set(pid, entry)
          break
        }
      } catch (err) { if (!['ENOENT', 'ESRCH', 'EACCES'].includes(err.code)) throw err }
    }
  }
  if (!procIds.has(pid)) return ''
  return readFile(`/proc/${procIds.get(pid)}/stat`, 'utf8')
}

async function until(read, description, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await sleep(20)
  }
  throw new Error(`Timed out: ${description}`)
}

async function optional(path) {
  try { return await json(path) } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

async function running(pid) {
  try { process.kill(pid, 0) } catch (err) {
    if (err.code === 'ESRCH') return false
    throw err
  }
  // A container's PID 1 may not reap an adopted child promptly. A zombie is
  // already dead; do not mistake it for continuing reviewer work.
  if (process.platform === 'linux') {
    try {
      const stat = await linuxStat(pid)
      if (/^\s*Z\s/.test(stat.slice(stat.lastIndexOf(')') + 1))) return false
    } catch (err) { if (err.code === 'ENOENT') return false; throw err }
  }
  return true
}

async function setup(t, mode = 'hold', lifetime = 8000) {
  const dir = await mkdtemp(join(tmpdir(), 'tpr-detach-'))
  const jobId = randomUUID()
  const deadline = Date.now() + lifetime
  await writeFile(join(dir, 'request.json'), JSON.stringify({ jobId, deadline }), { flag: 'wx', mode: 0o600 })
  const command = async (name, token = jobId) => {
    const tmp = join(dir, `${name}.${randomUUID()}.tmp`)
    await writeFile(tmp, JSON.stringify({ jobId: token }), { flag: 'wx', mode: 0o600 })
    await rename(tmp, join(dir, `${name}.json`))
  }
  const host = spawn(process.execPath, [fixture, mode === 'claim' ? 'claimed-host' : 'host', dir, mode], {
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = once(host, 'exit')
  let stderr = ''
  host.stderr.setEncoding('utf8').on('data', data => { stderr += data })
  let ready
  t.after(async () => {
    if (host.exitCode === null && host.signalCode === null) host.kill('SIGKILL')
    await exited
    ready ??= await optional(join(dir, 'ready.json'))
    // Never signal saved worker PIDs after exit: they might be reused. Ask a
    // living worker to stop by job token; the deliberately orphaned fake child
    // has its own bounded emergency deadline. Keep its directory until then.
    await command('cancel')
    if (ready) {
      await until(async () => !(await running(ready.pid)) && !(await running(ready.reviewerPid)),
        'fixture cleanup by token/deadline', Math.max(1000, deadline - Date.now() + 4000))
    } else {
      // Setup failed before publishing PIDs. Any fixture launched meanwhile
      // must still reach its hard deadline before its files are removed.
      await sleep(Math.max(0, deadline - Date.now() + 2500))
    }
    await rm(dir, { recursive: true, force: true })
  })
  ready = await until(async () => {
    const r = await optional(join(dir, 'ready.json'))
    if (r) return r
    if (host.exitCode !== null || host.signalCode !== null) throw new Error(`Host exited before ready: ${stderr}`)
    return null
  }, 'worker ready')
  assert.equal(ready.jobId, jobId)
  const result = () => until(() => optional(join(dir, 'result.json')), 'durable result')
  const stopped = () => until(async () => !(await running(ready.pid)) && !(await running(ready.reviewerPid)), 'worker and reviewer exit')
  return { dir, jobId, deadline, host, exited, ready, command, result, stopped }
}

for (const mode of ['exit', 'kill']) {
  test(`detached worker survives host ${mode}; fresh reader recovers result`, { timeout: 15000 }, async t => {
    const p = await setup(t, mode === 'exit' ? 'exit' : 'hold')
    if (mode === 'kill') p.host.kill('SIGKILL')
    await p.exited
    assert.equal(await running(p.ready.pid), true)
    await p.command('finish')
    const result = await p.result()
    assert.equal(result.status, 'complete')
    assert.equal(result.jobId, p.jobId)
    const fresh = await exec(process.execPath, [fixture, 'read', p.dir])
    assert.deepEqual(JSON.parse(fresh.stdout), result)
    await p.stopped()
  })
}

test('detached worker survives termination of the host process group', { skip: process.platform === 'win32', timeout: 15000 }, async t => {
  const p = await setup(t)
  process.kill(-p.host.pid, 'SIGKILL')
  await p.exited
  assert.equal(await running(p.ready.pid), true)
  await p.command('finish')
  assert.equal((await p.result()).status, 'complete')
  await p.stopped()
})

test('control: an attached worker dies with the host process group', { skip: process.platform === 'win32', timeout: 15000 }, async t => {
  const p = await setup(t, 'attached')
  process.kill(-p.host.pid, 'SIGKILL')
  await p.exited
  await p.stopped()
  assert.equal(await optional(join(p.dir, 'result.json')), null)
})

test('the manual probe cannot relaunch an already claimed job after host exit', { timeout: 15000 }, async t => {
  const p = await setup(t, 'claim')
  p.host.kill('SIGKILL')
  await p.exited
  const second = await exec(process.execPath, [fixture, 'claimed-host', p.dir, 'hold'])
  assert.match(second.stdout, /already claimed/)
  assert.deepEqual(await json(join(p.dir, 'ready.json')), p.ready)
  await p.command('finish')
  assert.equal((await p.result()).status, 'complete')
  await p.stopped()
})

test('the managed probe host exits after its worker completes', { timeout: 15000 }, async t => {
  const p = await setup(t)
  await p.command('finish')
  assert.equal((await p.result()).status, 'complete')
  await until(() => p.host.exitCode !== null || p.host.signalCode !== null, 'managed host exit')
  assert.equal((await p.exited)[0], 0)
  await p.stopped()
})

test('cancellation after host death stops the owned reviewer before recording cancellation', { timeout: 15000 }, async t => {
  const p = await setup(t)
  p.host.kill('SIGKILL')
  await p.exited
  await p.command('cancel')
  assert.equal((await p.result()).status, 'cancelled')
  assert.equal(await running(p.ready.reviewerPid), false)
  await p.stopped()
})

test('a cancellation for another job cannot stop this worker', { timeout: 15000 }, async t => {
  const p = await setup(t)
  await p.command('cancel', randomUUID())
  await p.command('finish')
  assert.equal((await p.result()).status, 'complete')
  await p.stopped()
})

test('an unattended worker deadline stops its reviewer after the host has exited', { timeout: 15000 }, async t => {
  const p = await setup(t, 'exit', 1800)
  await p.exited
  assert.equal((await p.result()).status, 'timed-out')
  assert.equal(await running(p.ready.reviewerPid), false)
  await p.stopped()
})

test('POSIX counterexample: killing the detached worker leaves its reviewer running', { skip: process.platform === 'win32', timeout: 15000 }, async t => {
  const p = await setup(t)
  p.host.kill('SIGKILL')
  await p.exited
  process.kill(p.ready.pid, 'SIGKILL')
  await until(async () => !(await running(p.ready.pid)), 'worker killed')
  // Positive heartbeat evidence, not just kill(pid, 0): the orphan does work.
  const before = (await json(join(p.dir, 'reviewer.json'))).tick
  await until(async () => (await json(join(p.dir, 'reviewer.json'))).tick > before, 'orphan reviewer heartbeat')
  assert.equal(await running(p.ready.reviewerPid), true)
  assert.equal(await optional(join(p.dir, 'result.json')), null)
  // t.after owns cleanup even if an assertion above fails.
})

test('Windows: killing the worker also terminates its attached fake reviewer', { skip: process.platform !== 'win32', timeout: 15000 }, async t => {
  const p = await setup(t, 'hold', 12000)
  p.host.kill('SIGKILL')
  await p.exited
  process.kill(p.ready.pid, 'SIGKILL')
  await p.stopped()
  assert.ok(Date.now() < p.deadline, 'worker-death cleanup must precede the fixture emergency deadline')
  assert.equal(await optional(join(p.dir, 'result.json')), null)
})
