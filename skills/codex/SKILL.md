---
name: codex
description: >-
  Use when an independent Codex (OpenAI) perspective is requested or useful for a
  concrete question or artifact: brainstorming, breakage review, red-teaming, simplification and
  churn reviews, debugging, reviewing
  plans, diffs or prose, extracting requirements, rollout, test gaps, explanation,
  incident analysis or security hypotheses. Explicit requests naming Codex or an
  OpenAI model for that work select this skill. Exclude questions about the
  provider's API, SDK, pricing or model capabilities. Skip trivial tasks and simple
  lookups unless a second opinion is explicitly requested.
---

# Codex as a thinking partner

Before selecting a mode, starting a review or handling results, read the [shared review guide](../review-guide.md), resolving that path from this skill's directory. If the bundled file cannot be read, report the missing guide before running a review. It supplies the full mode catalogue, mode instructions, evidence standards, finding dispositions, convergence and summary rules for both reviewers.

## Starting a review

Use `review_start` with `reviewer: "codex"` and the mode, question, instructions and artifact described in the shared guide. Use `review_record` for finding dispositions.

The tool runs the Codex CLI in its read-only sandbox, from the current session directory, with live web search and an ephemeral session. `artifact.files` are absolute paths Codex reads from disk; `artifact.text` is inline material. Prefer files when surrounding code matters, and keep the reviewed files unchanged until the call returns.

If this skill includes a discovery failure, report its diagnostic and use the recovery guidance below; availability is checked again when a new session starts. If `review_start` is unavailable without that diagnostic, check CLI discovery and mod loading: reviews require this plugin enabled in Claude Code v2.1.287 or later with mods on; claude.ai and Cowork load no mods.

## Model and effort

Omit `model` and `effort` to use the tool's configured Codex model and mode-specific effort defaults. Override when explicitly requested or justified by the material. The tool accepts `low`, `medium`, `high` and `xhigh`; it refuses `max`. Report the exact returned model and effort in the summary.

## Permissions, failures and recovery

Codex's read-only sandbox and live web search govern its access. A path in `artifact.files` is a request to read it, not proof of access. The parser requires a successful process exit, `turn.completed` and schema-valid output; those checks do not prove review coverage. Codex results do not populate `deniedSteps`, so an empty list cannot establish that every read or search succeeded. Check the returned response for missing evidence and independently verify material claims.

For an inaccessible target, verify the path and local readability. If a relevant sanitized excerpt can provide the missing evidence, supply it as `artifact.text` and state the narrower scope. If repository context remains necessary but inaccessible, report the coverage gap. Keep the sandbox read-only; do not bypass it to obtain a review.

For a failed run, report its `failure` text. Retry only after a concrete change addresses the reported cause, such as correcting an input or restoring CLI availability. Authentication, rate-limit and environment failures require that condition to change; do not repeat an unchanged failing call. A cancellation ends the attempt; resume only when requested. If recovery depends on the user, state the needed action and stop.
