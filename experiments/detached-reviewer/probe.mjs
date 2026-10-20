// Manual fixture controls; no provider calls and no PID-based cancellation.
import { mkdtemp, readFile, writeFile, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const [action, dir] = process.argv.slice(2)
if (action === 'prepare') {
  const path = await mkdtemp(join(tmpdir(), 'tpr-desktop-probe-'))
  await writeFile(join(path, 'request.json'), JSON.stringify({ jobId: randomUUID(), deadline: Date.now() + 300000 }), { flag: 'wx', mode: 0o600 })
  console.log(path)
} else if (['status', 'cancel', 'finish'].includes(action) && dir) {
  const request = JSON.parse(await readFile(join(dir, 'request.json'), 'utf8'))
  if (action !== 'status') {
    const tmp = join(dir, `${action}.${randomUUID()}.tmp`)
    await writeFile(tmp, JSON.stringify({ jobId: request.jobId }), { flag: 'wx', mode: 0o600 })
    await rename(tmp, join(dir, `${action}.json`))
  }
  const status = { request }
  for (const name of ['ready', 'reviewer', 'result']) {
    try { status[name] = JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8')) }
    catch (err) { if (err.code !== 'ENOENT') throw err }
  }
  console.log(JSON.stringify(status, null, 2))
} else {
  throw new Error('Usage: node probe.mjs prepare | status|cancel|finish <job-directory>')
}
