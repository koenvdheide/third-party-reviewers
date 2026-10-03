# external-review

A [Claude Code](https://claude.ai/code) mod that puts one button above the prompt and turns a press into an external review, by Codex or by Gemini, at a depth and effort you pick.

## What it does

The row above the prompt carries a single `External review` button. Pressing it asks two questions and then submits the instruction as if you had typed it:

- **Reviewer** — Codex, or Gemini through the Antigravity CLI.
- **Depth** — to convergence, carrying prior findings forward each round, or one round.

The instruction names no reasoning effort. The reviewing skill picks one from the mode and the difficulty of the artifact, which is a judgement a menu cannot make.

Nothing in the instruction names a diff. The target is whatever is salient in the session, so pressing it while you are on a spec, a plan or a decision reviews that instead.

## Prerequisites

The mod submits an instruction; the skills do the work. So it needs whichever of these you plan to use:

- The `codex` plugin, which wraps the [Codex CLI](https://github.com/openai/codex).
- The `antigravity` plugin, which wraps Google's Antigravity CLI (`agy`).

Both are in the same `agent-tools` marketplace. Without them the instruction still arrives, and Claude will review without an external model.

## Installation

```text
/plugin marketplace add koenvdheide/agent-tools
/plugin install external-review@agent-tools
/reload-plugins
```

Refresh later with `/plugin marketplace update agent-tools`, then `/plugin update external-review@agent-tools` and `/reload-plugins`.

## How it is built

One hooks module, three files, no stored state.

A `ui.render` hook on `AbovePrompt` draws the button and yields the row while the engine has a survey in it. A `ui.press` hook runs the questions, because `onPress` is declared to return void and is not awaited — an ask chain started there is charged to the hook's 10-second budget and killed, while a `$` call in flight inside a hook is not. Every answer is checked against a closed set, since a dismissed dialog returns a marker string rather than an empty one, and the instruction is submitted without a leading `/`, which `$.prompt.submit` refuses.

## License

MIT
