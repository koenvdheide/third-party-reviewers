# third-party-reviewers

Independent reviews from Codex and Gemini inside [Claude Code](https://claude.ai/code). Claude starts a review with one tool call and keeps working while it runs; the status line shows how far it is, a cancel really stops the CLI, and the result comes back as structured findings Claude checks before acting on them.

## What it does

- Claude calls `review_start` with a reviewer, a mode (red-team, diff review, plan review, explain and more) and the material, as inline text or as file paths the reviewer reads itself. The review runs in the background, and the status line shows the reviewer, the elapsed time and what it is doing.
- When the review ends, a short notification starts a turn, and Claude reads the result with `review_results`: a verdict, the full answer, and each finding with its file, line and symbol where it points at code. `review_cancel` stops a run and its CLI.
- The `/codex` and `/antigravity` skills (full names `/third-party-reviewers:codex` and `/third-party-reviewers:antigravity`) carry the judgement: when to review, which mode, and how to treat what comes back.
- The External review button above the prompt picks a reviewer and one round or a loop to convergence.

A review that finishes while Claude is busy waits for that turn to end. If you `/clear` before then, its notification still arrives in the new conversation, which no longer holds that review.

## Prerequisites

Claude Code v2.1.287 or later with mods on, plus at least one reviewer CLI, signed in:

- [Codex CLI](https://github.com/openai/codex) (`codex`), with a ChatGPT account or an OpenAI API key.
- Antigravity CLI (`agy`), with a Google account. For Gemini to read the files you review, allow file reads in `~/.gemini/antigravity-cli/settings.json` (`"allow": ["read_file(*)"]`); for web lookups, `read_url(*)`. These settings are yours, and the plugin never edits them.

Only installed reviewers are offered. `disableAllHooks`, or an organization's `allowManagedModsOnly`, stops the mod and leaves the skills loaded; so do claude.ai and Cowork, which load no mods. The skills then say that reviews need the mod.

## Installation

```text
/plugin marketplace add koenvdheide/agent-tools
/plugin install third-party-reviewers@agent-tools
/reload-plugins
```

It replaces the `codex` and `antigravity` plugins from the same marketplace. Uninstall those, or you get two skills each for `/codex` and `/antigravity`. Keep `codex` while you use `orchestrated-build-flow`, which depends on it and installs it again on `/reload-plugins`.

## What it runs and sends

- It starts your local `codex` and `agy` CLIs from an argument list. On Windows it runs `codex.exe` directly, because the `codex` command npm installs is a script that goes through `cmd.exe`, and it deletes temporary run directories with PowerShell's `Remove-Item`.
- Each review sends its prompt and the text included for it to OpenAI (Codex) or Google (Gemini), under your own accounts and their terms. The reviewer reads the files named for it itself, and what it reads goes the same way.
- Codex runs read-only from your project directory, with live web search on.
- Gemini runs from an empty temporary directory, which the plugin deletes when the run ends (one it cannot delete stays in your temp folder); what it can read or fetch beyond the prompt follows your Antigravity settings. Antigravity also keeps its own plan files under `~/.gemini/antigravity-cli/brain/`.
- The result comes back into your Claude Code conversation.

## Privacy

The plugin itself collects nothing. Review runs live in Claude Code's session state and are cleared when the session ends; the only files it writes are the temporary run directories above, which it deletes. What a review sends is governed by the provider you chose: [OpenAI privacy policy](https://openai.com/policies/privacy-policy/), [Google privacy policy](https://policies.google.com/privacy). Do not include secrets, credentials or personal data in material you review.

## How it is built

A Claude Code mod in TypeScript. `hooks/cli.ts` holds the pure parts: prompt framing, each CLI's arguments, and the parsers for their JSON event streams. `hooks/register.tsx` holds everything that calls the engine, since a mod can only pass the engine handle to functions in its own hooks file: finding the CLIs, a run from spawn to delivery, the tools, the skill note and the button. Results arrive as a queued prompt, because a hook cannot wait minutes for a child process. A run still going when `/clear`, exit or a resume ends the session is cancelled and sends nothing. Tests run with `claude plugin test`.

## License

MIT
