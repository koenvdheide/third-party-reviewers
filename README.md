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

## What it runs and sends

Your local `codex`, read-only and with live web search, or `agy`, from a temporary directory as an agent whose only tools read files and fetch URLs. The review, and any file the reviewer reads, go to the provider your CLI is configured for (OpenAI or Google by default). [PRIVACY.md](PRIVACY.md) covers what is sent, to whom, and what is kept.

To find the CLIs, and to clean up after a Gemini review (which runs from a temporary directory holding its agent definition), it runs:

- On Linux and macOS: `codex --version`, `agy models`, and `rm -rf` on that directory.
- On Windows: `where.exe codex`, then `--version` on the `codex.exe` it finds (on `PATH` or inside npm's `@openai/codex` package), `agy models`, and PowerShell's `Remove-Item` on that directory.

## Troubleshooting

- No `review` above the prompt: Claude Code draws it only in the terminal and the Desktop app's Code tab, and claude.ai chat and Cowork load no mods. In a terminal, run `/plugin` and check that its `mods active` line names third-party-reviewers. If it doesn't, update Claude Code to v2.1.287 or later and check that `disableAllHooks` or `--safe-mode` isn't stopping mods.
- A reviewer is missing under `review`, or Claude says its CLI is unavailable: run `codex --version` or `agy models` in a terminal, install or sign in until that works, then start a new session. The plugin looks for the CLIs when a session starts.
- A review fails: Claude reports the failure, including the CLI's own error when it printed one, such as a sign-in or usage-limit message. Fix the cause it names, then ask again.

## License

MIT
