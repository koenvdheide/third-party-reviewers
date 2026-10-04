# third-party-reviewers

Codex and Gemini reviews inside [Claude Code](https://claude.ai/code). Claude starts a review with one tool call and keeps working while it runs. The status line shows its progress, a cancel stops the CLI, and the findings come back structured.

## What it does

- `review_start`, `review_results` and `review_cancel`: the tools Claude uses to run a review in the background, read the result and stop a run.
- The `/codex` and `/antigravity` skills tell Claude when to review, which mode to use and how to treat the findings.
- The External review button above the prompt starts a review, one round or to convergence.

A review that finishes during a busy turn waits for that turn to end; if you `/clear` first, its notification still arrives in the new conversation.

## Prerequisites

- Claude Code v2.1.287 or later, with mods on.
- At least one signed-in reviewer: the [Codex CLI](https://github.com/openai/codex) (`codex`) or the Antigravity CLI (`agy`). For Gemini to read files, allow `read_file(*)` in `~/.gemini/antigravity-cli/settings.json`.

## Installation

```text
/plugin marketplace add koenvdheide/agent-tools
/plugin install third-party-reviewers@agent-tools
/reload-plugins
```

It replaces the `codex` and `antigravity` plugins, so uninstall those. Keep `codex` while you use `orchestrated-build-flow`, which depends on it.

## What it runs and sends

- Your local `codex`, read-only and with live web search, and `agy`, from an empty temporary directory it deletes afterwards.
- The prompt, and any file the reviewer reads, go to OpenAI or Google under your own account. Antigravity also keeps its plan files under `~/.gemini/antigravity-cli/brain/`.
- The plugin keeps nothing past the session. See the [OpenAI](https://openai.com/policies/privacy-policy/) and [Google](https://policies.google.com/privacy) privacy policies.

## License

MIT
