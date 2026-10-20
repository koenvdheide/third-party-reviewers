# Detached reviewer feasibility, 2026-10-20

**Decision: OS detachment is feasible, but safe Claude Desktop detachment has
not been established. Do not replace the production runner yet.** This spike
adds a reproducible process experiment and an opt-in Desktop probe. It does not
change `review_start`, cancellation, findings, notifications, stored runs, or the
plugin's version (0.5.7).

## What was inspected

Baseline: [`1582a98`](https://github.com/koenvdheide/third-party-reviewers/commit/1582a98ed7c784d7340794afe5d8c47cfc0a0910),
including [PR #4](https://github.com/koenvdheide/third-party-reviewers/pull/4).

- `hooks/register.tsx:startRun` launches the reviewer with `$.process.spawn`.
  `consume` parses its stream and saves the final result from inside the plugin.
- `endSession` closes every stream; moving the spawn alone would not change that
  policy. `recoverStopped` assumes a running row without an in-memory stopper is
  dead, and deletes a stopped Gemini run's working directory. A live independent
  worker would violate both assumptions.
- Generation checks protect conversation boundaries, and `announce` and
  `reportStopped` deliver only through the currently attached session. A worker
  cannot retain those plugin objects or use the plugin's store after unloading.
- The [mods API](https://code.claude.com/docs/en/plugins/mods/api) provides
  `process.run`, streaming `process.spawn`, HTTP, filesystem access and a plugin
  store. It documents no persistent detached-job/reattach API. Background timers
  stop on module reload; `prompt.submit` targets a live session and may drop a
  message. These are not durable queue or delivery acknowledgements.
- [Hooks modules have no Node runtime](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts).
  Importing `node:child_process` into `register.tsx` is not the implementation.
  An external launcher is needed. The optional probe uses an explicitly selected
  Node executable and only the existing `$.process.spawn({ argv })` interface.
- The public declarations can lag the installed build, as the
  [reference](https://code.claude.com/docs/en/plugins/mods/reference) explains.
  The production mod and probe were validated with Claude Code **2.1.301**, the
  CI-pinned build. No undocumented detached option is assumed. `claude plugin
  test` supplies test event implementations; it is not evidence of real OS
  children surviving actual plugin unloading.

## Process mechanisms and their limits

| Mechanism | What it offers | What it does not establish |
| --- | --- | --- |
| Node `spawn(..., { detached: true, stdio: 'ignore' })`, then `unref()` | Independent parent exit; on POSIX, a new session and process group | Escape from descendant enumeration, Windows Job Objects, a containing cgroup, logout, shutdown, or OOM |
| POSIX `setsid` / `nohup` | New session/group / ignored SIGHUP respectively | Durable result handling or cleanup when the worker itself is killed; `nohup` is not a new ownership boundary |
| Windows PowerShell `Start-Process` | Independent local process relative to the launching shell | A guarantee about Desktop's Job Object limits or tree-termination policy |
| Windows `CREATE_BREAKAWAY_FROM_JOB` | Job escape when the containing job permits it | Guaranteed availability; breakaway depends on the job's limits and nesting |
| External OS user service | A lifetime owner outside the conversation; a place to enforce process cleanup and time limits | Implemented adapters, installation, authentication, or Desktop compatibility in this spike |

Primary references: [Node child processes](https://nodejs.org/api/child_process.html#optionsdetached),
[PowerShell Start-Process](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process),
[Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects),
[Windows creation flags](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags),
[systemd cleanup policy](https://www.freedesktop.org/software/systemd/man/systemd.kill.html),
[Apple user agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html).
Job/cgroup cleanup is a documented possibility, **not a claim that Desktop uses
that mechanism**. We have not observed Desktop's shutdown implementation here.

## Automated evidence

Run with Node 24 or later, from the repository root:

```sh
node --test experiments/detached-reviewer/lifecycle.test.mjs
```

These are real local OS processes with **simulated host lifecycle and fake
reviewers**, no models, network, project files, or provider credentials. Each
test uses a fresh directory, job token and bounded deadline. The test runner
owns cleanup; the fake reviewer has an emergency deadline even if cleanup fails.
The existing CI matrix also runs this command on Linux and Windows. A configured
CI job is not a claim that it has passed on that OS.

| Scenario | What the assertion establishes |
| --- | --- |
| Normal host exit | Worker outlives its launcher and publishes a final JSON result |
| Hard-killed host | Same after killing only the launcher |
| Host process-group termination (POSIX) | Detached worker survives group cleanup |
| Attached-worker control (POSIX) | The same group cleanup kills an attached worker |
| Fresh result reader | A new process can read exactly the completed result after host death |
| Manual probe reloaded/resumed (simulation) | An exclusive claim prevents relaunching the same job |
| Managed probe host cleanup | The launcher exits when the fake worker completes |
| Cancellation after host death | A matching job token stops the fake reviewer before publishing cancellation |
| Wrong-job cancellation | A different token does not cancel the job |
| Unattended deadline | A living worker terminates its immediate child and records timeout |
| **Hard-killed worker counterexample (POSIX)** | **Reviewer continues heartbeating; no terminal result is written** |
| Hard-killed worker (Windows) | Attached fake reviewer also terminates; no terminal result is written |

Locally verified: Linux, Node 24.19.0; **10 process tests pass** (one Windows-only
case skipped), and **134 existing mod tests pass** under Claude Code 2.1.301.
Windows and macOS were not executed locally. The POSIX counterexample passes
by detecting an orphan and then cleaning it up; it
does **not** prove orphan prevention. A process-group test does not simulate a
Windows Job Object, containing cgroup, recursive descendant kill, or Desktop.
The new-reader test is file recovery, not plugin result import or message delivery.
Atomic rename gives complete-file visibility, not power-loss durability.

The first Windows CI run confirmed parent-exit survival, cancellation, recovery,
deadline and host cleanup, but no reviewer heartbeat followed worker death.
The suite therefore asserts worker-death outcomes separately for POSIX and
Windows; the Windows assertion requires both processes to exit before the
fixture's emergency deadline. This platform difference is consistent with
[libuv's Windows process implementation](https://github.com/libuv/libuv/blob/v1.x/src/win/process.c):
it assigns non-detached children to a kill-on-close job and does not set
`CREATE_BREAKAWAY_FROM_JOB` for detached children. That source explains why the
containing job's policy matters; **it is not a measurement of Desktop's policy**.

## Optional real Desktop experiment

`desktop-probe/` is a separate, disposable mod, **not loaded by the production
plugin**. It launches a managed Node host with `$.process.spawn`; the host creates
the independent fake worker. An exclusive claim prevents duplicate launches on
reload/resume. It never starts a real review, submits a prompt, or imports a
result into the production ledger. Its hooks and local marketplace validate on
2.1.301. **No Desktop execution is claimed.**

1. In a disposable Desktop **Code** conversation, add this local marketplace
   using its absolute checkout path, then install the probe:

   ```text
   /plugin marketplace add /absolute/checkout/experiments/detached-reviewer
   /plugin install detach-lifetime-probe@detach-lifetime-experiment
   ```

2. In a separate terminal, prepare one bounded job:

   ```sh
   node experiments/detached-reviewer/probe.mjs prepare
   ```

   It prints an absolute temporary directory. The worker's deadline is five
   minutes from preparation. Use a fresh job for each scenario. No worker starts
   during preparation.

3. Configure the installed probe with that `jobDirectory` and an absolute
   `nodeExecutable`, using `claude plugin configure
   detach-lifetime-probe@detach-lifetime-experiment --values-stdin`. Supply a JSON
   object on stdin with those two keys. For example, put the object in a temporary
   JSON file and pipe it with `cat` (PowerShell: `Get-Content -Raw`). On Windows,
   use forward slashes or JSON-escaped backslashes. Reload the plugins in the
   Desktop test conversation. Check the probe's log and the external status:

   ```sh
   node experiments/detached-reviewer/probe.mjs status "<job-directory>"
   ```

   `ready` must exist before triggering the lifecycle event. `reviewer.tick`
   must advance in repeated status reads. Record Desktop, Claude Code, Node and
   OS versions, job ID, timestamps and process IDs.

4. Test **plugin reload**, **explicit plugin disable**, **conversation switch**,
   **an actually observed Desktop session suspension**, and **app exit** as
   separate cases. Note the exact operation; an ordinary window switch or a
   manufactured signal is not evidence of a Desktop suspension. Check from the
   external terminal while the conversation is unavailable. A new heartbeat
   after the event is the survival evidence; an old ready file is not.

5. While detached, issue either `finish` or `cancel`, then read `status` until
   `result` appears. Confirm the job ID matches, heartbeat stops, and both worker
   and fake-reviewer processes have exited. For `finish`, resume the original
   conversation and verify the final file is still readable and no second job
   was launched. This checks the probe's journal, **not production result delivery**.

   ```sh
   node experiments/detached-reviewer/probe.mjs finish "<job-directory>"
   node experiments/detached-reviewer/probe.mjs status "<job-directory>"
   ```

6. Cancel any remaining probe, confirm termination, uninstall the probe and
   remove its local marketplace. Retain the JSON files if recording evidence;
   otherwise delete that job's temporary directory after termination. They hold
   synthetic IDs/status only. The fake reviewer exits by deadline plus two
   seconds even if its worker is killed; this test-only backstop is not a
   property of Codex or Antigravity.

## What blocks production integration

The missing evidence is specifically **managed launcher → independent worker
under actual Desktop teardown**, on each supported OS. Parent-exit survival is
not that evidence. Windows job inheritance/breakaway is untested here. Even if
that boundary passes, the reproduced Linux worker-death orphan means a bare
detached Node process does not meet the cleanup requirement on every supported OS.

A viable implementation should put execution under an independent OS-supervised
owner, with the plugin only an attaching client. That owner must enforce process
tree termination on cancellation, deadline, worker crash and service shutdown.
It also needs:

- A persistent private spool outside temporary Gemini working directories and
  replaceable plugin-install directories; publish the request before launch and
  acknowledge launch before accepting the run. An interrupted acknowledgement
  must not cause duplicate execution.
- Worker-owned raw output and terminal status, atomic publication and bounded
  retention. Do not let plugin pruning or `recoverStopped` remove live work.
  Keep the current reviewer arguments, prompts, permissions and parsers.
- A stable job identity and authenticated local control channel; do not kill a
  stored PID after resume (PID reuse), trust a stale heartbeat alone, or assume
  that killing a wrapper terminates reviewer grandchildren.
- Reattachment scoped to the originating conversation. Only the plugin imports
  the final result into its store, checks citations and records findings/counts.
  Detached workers cannot call `$.store`, `$.state` or `$.prompt`.
- A persistent delivery acknowledgement separate from execution status, with
  retry when the correct conversation returns, no cross-conversation delivery,
  and the existing suppression when Claude already read the results. Exactly-once
  prompt delivery is not promised by the current API; define at-least-once crash
  behavior rather than silently claiming a transaction with the conversation.

Those are a new execution owner and recovery protocol, not a spawn-flag change.
No service, scheduled task, native job helper or production mode is installed by
this investigation.

**Practical alternative now:** run a long review in an independent terminal
outside Desktop, save the CLI output there, and give that output to the resumed
conversation. The production `review_results` tool does not import external runs,
so this is manual handoff. For automatic survival and delivery, pursue the
supervised local worker above after the Desktop boundary is measured. Keep 0.5.7's
interruption reporting until that replacement passes real-host and recovery tests.
