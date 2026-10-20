import type { Register } from 'claude-code'

// Operator-only experiment: configuring a prepared directory arms one launch.
// A reload never starts it a second time, even if the first launch failed.
export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const dir = options.jobDirectory as string
    if (!dir) return started
    const request = `${dir}/request.json`
    if (!(await $.fs.exists(request))) {
      $.ui.toast(`Probe request missing: ${request}`)
      return started
    }
    // The external launcher creates the exclusive claim, so concurrent sessions
    // and reloaded module instances cannot start duplicate workers.
    const stream = $.process.spawn({
      argv: [options.nodeExecutable as string, `${$.plugin.root}/processes.mjs`, 'claimed-host', dir, 'hold'],
    })
    void (async () => {
      try {
        for await (const chunk of stream) {
          $.ui.log(`lifetime probe ${chunk.stream}: ${chunk.text.trim()}`)
        }
      } catch (err) {
        $.ui.log(`lifetime probe host stopped: ${String(err)}`)
      }
    })()
    return started
  })
}
