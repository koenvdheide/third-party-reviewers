// Disposable process-lifetime fixture. Never invokes a reviewer CLI, reads a
// project, or contacts a provider. Not loaded by hooks/register.tsx.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [requestedRole, dir, mode] = process.argv.slice(2)
let role = requestedRole
const self = fileURLToPath(import.meta.url)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const read = async name => JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8'))
const request = await read('request')
if (!request.jobId || !Number.isFinite(request.deadline) || request.deadline > Date.now() + 300000) {
  throw new Error('Fixture requires a job id and a deadline within five minutes')
}
if (role === 'claimed-host') {
  try {
    await writeFile(join(dir, 'claim.json'), JSON.stringify({ jobId: request.jobId, hostPid: process.pid }), { flag: 'wx', mode: 0o600 })
  } catch (err) {
    if (err.code !== 'EEXIST') throw err
    console.log('Probe already claimed; prepare a new directory for another run.')
    process.exit(0)
  }
  role = 'host'
}
async function optional(name) {
  try { return await read(name) } catch (err) { if (err.code === 'ENOENT') return null; throw err }
}
// Single writer per filename; reader sees absent or a complete JSON document.
// Atomic visibility only: this experiment does not claim power-loss durability.
async function publish(name, value) {
  const tmp = join(dir, `${name}.${process.pid}.tmp`)
  await writeFile(tmp, JSON.stringify(value), { mode: 0o600 })
  await rename(tmp, join(dir, `${name}.json`))
}

if (role === 'host') {
  const worker = spawn(process.execPath, [self, 'worker', dir], {
    detached: mode !== 'attached', stdio: 'ignore', windowsHide: true,
  })
  worker.on('error', err => { console.error(err); process.exitCode = 1 })
  worker.unref()
  let ready
  while (!(ready = await optional('ready'))) {
    if (Date.now() >= request.deadline) throw new Error('Worker did not become ready')
    await sleep(20)
  }
  console.log(JSON.stringify(ready))
  if (mode !== 'exit') {
    while (Date.now() < request.deadline + 2500 && !(await optional('result'))) await sleep(30)
  }
} else if (role === 'reviewer') {
  // A bounded fake reviewer with a visible heartbeat. Its emergency deadline
  // limits a failed test's impact; a real reviewer need not have such a limit.
  for (let tick = 0; Date.now() < request.deadline + 2000; tick++) {
    await publish('reviewer', { tick, pid: process.pid })
    await sleep(30)
  }
} else if (role === 'worker') {
  const child = spawn(process.execPath, [self, 'reviewer', dir], { stdio: 'ignore', windowsHide: true })
  const exited = once(child, 'exit')
  let childError
  child.on('error', err => { childError = err })
  // Handle a failed spawn before another await can make its rejection unhandled.
  void exited.catch(() => undefined)
  let stopping = false
  process.on('SIGTERM', () => { stopping = true })
  process.on('SIGINT', () => { stopping = true })
  let status = 'failed'
  let failure = null
  try {
    while (!(await optional('reviewer'))) {
      if (childError) throw childError
      if (Date.now() >= request.deadline) throw new Error('Reviewer did not become ready')
      await sleep(20)
    }
    await publish('ready', { jobId: request.jobId, pid: process.pid, reviewerPid: child.pid })
    for (;;) {
      if (stopping) { status = 'terminated'; break }
      if ((await optional('cancel'))?.jobId === request.jobId) { status = 'cancelled'; break }
      if (Date.now() >= request.deadline) { status = 'timed-out'; break }
      if ((await optional('finish'))?.jobId === request.jobId) { status = 'complete'; break }
      await sleep(20)
    }
  } catch (err) {
    failure = String(err)
  } finally {
    // Owns only this immediate fixture child. Real reviewer grandchildren and
    // a SIGKILL of this worker require OS supervision, not a JS finally block.
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited.catch(() => undefined)
  }
  await publish('result', { jobId: request.jobId, status, failure })
} else if (role === 'read') {
  console.log(JSON.stringify(await read('result')))
} else {
  throw new Error(`Unknown fixture role: ${role}`)
}
