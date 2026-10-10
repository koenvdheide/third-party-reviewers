# third-party-reviewers

Codex and Gemini reviews inside [Claude Code](https://claude.ai/code), with live status, a cancel that stops the CLI, and structured findings.

## What it does

- `review_start` runs a review and returns its result; `review_results` reads a run again; `review_cancel` stops one.
- `review_record`: Claude records what it did with each finding, with its evidence: applied, rejected or unresolved. Each finding also gets a quick textual check of the file, line and symbol it cites.
- The findings pane, from `findings` above the prompt: every review in the conversation, each finding with Claude's judgement. Apply or Reject overrules it, and Ask starts a question about a finding.
- The `/codex` and `/antigravity` skills offer the same modes and use one [review guide](skills/review-guide.md) for mode prompts, evidence standards and finding handling. Each skill supplies its own model, file-access, permission and recovery instructions.
- `review` above the prompt opens one row per reviewer CLI it finds, each offering one round or to convergence. Click a choice, or type its number into an empty prompt; `review` again closes the rows. The [convergence workflow](skills/review-guide.md#convergence) resolves breakage, then reviews simplifications and churn, and verifies final correctness.

## Prerequisites

- Claude Code v2.1.287 or later, with mods on.
- At least one signed-in reviewer: the [Codex CLI](https://github.com/openai/codex) (`codex`) or the [Antigravity CLI](https://antigravity.google/docs/cli/install) (`agy`).

## Installation

In Claude Code, from the `agent-tools` marketplace:

```text
/plugin marketplace add koenvdheide/agent-tools
/plugin install third-party-reviewers@agent-tools
/reload-plugins
```

## Examples

Prompts that work:

- "Ask Codex to red-team the plan in docs/plan.md."
- "Have Gemini check my uncommitted changes for breakage."
- "Get Codex's view on why this test only fails on Windows."
- "Review this branch with Codex until convergence."

## What it runs, sends and writes

The plugin is a mod, code that Claude Code runs. It has no server and makes no network request of its own: a review leaves through the reviewer CLI you installed. [PRIVACY.md](PRIVACY.md) covers what is sent, to whom, and what is kept.

### Programs it runs

- A Codex review, in the session's working directory, with the review prompt on standard input: `codex exec --json --output-schema <plugin>/schemas/review.schema.json -s read-only -m <model> -c model_reasoning_effort=<effort> -c web_search=live -c model_reasoning_summary=concise --ephemeral`, plus `--skip-git-repo-check` outside a git repository.
- A Gemini review, in a temporary directory, with the review prompt on standard input as one JSON line: `agy --print= --input-format stream-json --output-format stream-json --json-schema <plugin>/schemas/review.schema.json --agent tpr-reviewer --model <model>`.
- When a session starts, to find the CLIs and pick the newest supported Gemini Flash model: `codex --version` and `agy models`. On Windows it runs `where.exe codex` first, then `--version` on the `codex.exe` it finds, on `PATH` or in npm's Codex installation (that one with the `CODEX_MANAGED_BY_NPM` and `CODEX_MANAGED_PACKAGE_ROOT` variables npm's launcher sets).
- To delete a Gemini review's temporary directory: `rm -rf -- <dir>`, or on Windows `powershell.exe -NoProfile -NonInteractive -Command "Remove-Item -LiteralPath $env:TPR_DIR -Recurse -Force"` with the directory in `TPR_DIR`.

### What it sends, and where

- The review prompt: the mode, the question, the instructions, any inline text and the paths of the files to review (for Gemini, the files' contents too), inside the plugin's own framing: the material marked as data, review checklists and the JSON format for the answer. The CLI sends it, and any file the reviewer reads, to the provider it is configured for (OpenAI or Google by default). Codex may also search the web.
- A prompt to Claude as you, only when you choose one of its buttons (by click or key):
  - A choice under `review` asks Claude to use the codex or antigravity skill to review whatever you are working on, either one round or through the review guide's convergence workflow (carrying earlier findings forward and stopping for blockers), and to name the target and question in one line first.
  - Apply, Reject or Withdraw in the findings pane sends a one-line instruction about that finding: make and record the fix, leave it and undo any fix, or go back to Claude's own judgement.
  - Ask puts `About finding <id> (<title>): ` in the prompt box and sends nothing.

### Files it writes

- `.agents/agents/tpr-reviewer.md` in a Gemini review's temporary directory, `third-party-reviewers/<run id>/` under `TEMP`, `TMPDIR` or `/tmp`. It is the agent definition `agy` loads, which gives the reviewer tools to read and search files, fetch URLs and return its answer, and none that write. The plugin deletes the directory when the review ends, and shows its path if that fails.
- Each conversation's reviews and decisions, in Claude Code's plugin store, so a resumed conversation has them again.

It writes no other file, and none of your build, settings or instructions files.

### What its hooks change

- When at least one reviewer is available, it registers four tools, `review_start`, `review_results`, `review_record` and `review_cancel`, and answers their calls itself. Other tool calls pass through untouched.
- When the codex or antigravity skill loads while its CLI is missing, it adds the discovery error to the skill's text, so Claude tells you (and offers the other reviewer, if that one is available).
- Above the prompt, it adds `review` (and `findings` once there is a review) beside whatever Claude Code and other plugins draw there, and gives the row back while Claude Code shows a survey in it.
- While a review runs, the status line shows its reviewer, mode, elapsed time and current step. Short notices report a review starting and problems outside a review's result, such as a failed cleanup.
- When a session starts it trims the store. On a resume it restores that conversation's reviews. A review left running by a reload or an ended conversation is marked cancelled, and when a conversation ends (`/clear` included) the plugin stops the reviews still running.

## Troubleshooting

- No `review` above the prompt: Claude Code draws it only in the terminal and the Desktop app's Code tab, and claude.ai chat and Cowork load no mods. In a terminal, run `/plugin` and check that its `mods active` line names third-party-reviewers. If it doesn't, update Claude Code to v2.1.287 or later and check that `disableAllHooks` or `--safe-mode` isn't stopping mods.
- A reviewer is missing under `review`, or Claude says its CLI is unavailable: run `codex --version` or `agy models` in a terminal, install or sign in until that works, then start a new session. The plugin looks for the CLIs when a session starts.
- A review fails: Claude reports the failure, including the CLI's own error when it printed one, such as a sign-in or usage-limit message. Fix the cause it names, then ask again.

## License

MIT
