---
name: codex
description: >-
  Use when the user asks for an independent Codex (OpenAI) perspective on a
  concrete question or artifact: brainstorming, breakage review, red-teaming, simplification,
  churn and strategic design reviews, debugging, reviewing
  plans, diffs or prose, extracting requirements, rollout, test gaps, explanation,
  incident analysis or security hypotheses. Requests naming Codex or an
  OpenAI model for that work select this skill. Exclude questions about the
  provider's API, SDK, pricing or model capabilities.
---

# Codex as a thinking partner

Before selecting a mode, starting a review or handling results, read the [shared review guide](../review-guide.md), resolving the path from this skill's directory. If it cannot be read, report the missing guide before running a review.

## Starting a review

Use `review_start` with `reviewer: "codex"`, following the shared guide.

The tool runs the Codex CLI in a read-only sandbox from the current session directory, with live web search and an ephemeral session. Codex reads `artifact.files` from disk; prefer files when surrounding code matters.

If this skill includes a discovery failure, report its diagnostic and follow the recovery guidance below; availability is rechecked when a new session starts. Otherwise, if `review_start` is unavailable, check CLI discovery and mod loading: reviews require this plugin enabled in Claude Code v2.1.287 or later with mods on; claude.ai and Cowork load no mods.

## Model and effort

Omit `model` and `effort` for the configured Codex model and mode-specific effort defaults. Override when explicitly requested or justified by the material. Accepted efforts: `low`, `medium`, `high`, `xhigh`; `max` is refused.

## Permissions, failures and recovery

An `artifact.files` path does not prove access. Parser acceptance requires a successful process exit, `turn.completed` and schema-valid output; it does not prove review coverage. Codex does not populate `deniedSteps`, so an empty list cannot establish that every read or search succeeded. Check the returned response for missing evidence.

For an inaccessible target, verify the path and local readability. If a sanitized excerpt supplies the missing evidence, use `artifact.text` and state the narrower scope. Report any necessary repository context that stays inaccessible. Do not bypass the read-only sandbox.

For a failed run, report its `failure` text. Retry only after a concrete change addresses the cause, such as correcting an input or restoring CLI availability. Authentication, rate-limit and environment failures require that condition to change. After a cancellation, resume only when requested. If recovery depends on the user, state the needed action and stop.
