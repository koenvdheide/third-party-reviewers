---
name: antigravity
description: >-
  Use when the user asks for an independent Gemini (Google) perspective on a
  concrete question or artifact: brainstorming, breakage review, red-teaming, simplification,
  churn and strategic design reviews, debugging, reviewing
  plans, diffs or prose, extracting requirements, rollout, test gaps, explanation,
  incident analysis or security hypotheses. Requests naming Gemini, a
  Gemini model, Antigravity or agy for that work select this skill. Exclude questions
  about the provider's API, SDK, pricing or model capabilities.
---

# Gemini as a thinking partner

Before selecting a mode, starting a review or handling results, read the [shared review guide](../review-guide.md), resolving the path from this skill's directory. If it cannot be read, report the missing guide before running a review.

## Starting a review

Use `review_start` with `reviewer: "gemini"`, following the shared guide.

The tool runs the Antigravity CLI (`agy`) from a temporary directory with read-only tools. It reads the UTF-8 text files at the absolute `artifact.files` paths and embeds numbered snapshots in the prompt, so they need no Antigravity file permissions. Keep the reviewed files unchanged until the review ends: citation checks then read them from disk.

If this skill includes a discovery failure, report its diagnostic and follow the recovery guidance below; availability is rechecked when a new session starts. Otherwise, if `review_start` is unavailable, check CLI discovery and mod loading: reviews require this plugin enabled in Claude Code v2.1.287 or later with mods on; claude.ai and Cowork load no mods.

## Model and effort

Defaults: the newest Gemini Flash release on offer, with effort set from the mode. Override when requested or justified by the material: `model` takes a base ID without an effort suffix; `effort` takes `low`, `medium` or `high`. The tool requests `<model>-<effort>` without checking `agy models`, so pick an effort that model offers.

`agy` also serves `claude-*` models. Selecting one changes the requested model family: explain that before using it and proceed only if the user wants it. Label that result as same-family when Claude is the host.

## Permissions, failures and recovery

Additional file and URL reads use the user's Antigravity permissions in `~/.gemini/antigravity-cli/settings.json`. Preserve the reviewer's tool boundary: only `view_file`, `grep_search`, `read_url_content` and `finish`. Never edit the user's settings or suggest granting `write_file`, `command` or `unsandboxed` to get a review through.

Inspect `deniedSteps`, `stderr` and `failure`. `deniedSteps` includes reported tool errors as well as permission refusals; call an entry a failed step unless a diagnostic establishes a refusal. agy's permission notices can appear on stderr: a successful result retains its tail in `stderr`, a failure includes it in `failure`. Report any explicit denial and the evidence it blocked. These outputs are incomplete evidence: their absence cannot establish that every necessary read succeeded.

Apply the shared guide's coverage rules even when the result event, exit and schema checks succeed despite failed steps. For an essential failed read, check whether the user-authorized material can be supplied as `artifact.files` snapshots or a sanitized `artifact.text` excerpt; snapshots avoid repeating the CLI read. State what was supplied and what remains unverified.

For a failed run, report its `failure` text and any diagnostic establishing the cause. Retry only after a concrete change addresses that cause, such as correcting the input, supplying the missing material or restoring CLI availability. Authentication, rate-limit and environment failures require that condition to change. After a cancellation, resume only when requested. If recovery depends on the user, state the needed action and stop.
