# third-party-reviewers

Codex and Gemini reviews inside [Claude Code](https://claude.ai/code), with live status, a cancel that stops the CLI, and structured findings.

## What it does

- `review_start` runs a review and returns its result; `review_results` reads a run again; `review_cancel` stops one.
- `review_record`: Claude records what it did with each finding, with its evidence: applied, rejected or unresolved. Each finding also gets a quick textual check of the file, line and symbol it cites.
- The findings pane, from `findings` above the prompt: every review in the conversation, each finding with Claude's judgement. Apply or Reject overrules it, and Ask starts a question about a finding.
- The `/codex` and `/antigravity` skills tell Claude when to review, which mode to use and how to treat the findings.
- `review` above the prompt starts a review, one round or to convergence.

## Prerequisites

- Claude Code v2.1.287 or later, with mods on.
- At least one signed-in reviewer: the [Codex CLI](https://github.com/openai/codex) (`codex`) or the Antigravity CLI (`agy`).

## Installation

```text
/plugin marketplace add koenvdheide/agent-tools
/plugin install third-party-reviewers@agent-tools
/reload-plugins
```

## What it runs and sends

Your local `codex`, read-only and with live web search, or `agy`, from a temporary directory as an agent whose only tools read files and fetch URLs. The review, and any file the reviewer reads, go to the provider your CLI is configured for (OpenAI or Google by default). [PRIVACY.md](PRIVACY.md) covers what is sent, to whom, and what is kept.

## License

MIT
