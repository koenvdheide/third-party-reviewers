---
name: antigravity
description: >-
  Use when the user asks for an independent Gemini (Google) perspective on a
  concrete question or artifact: brainstorming, breakage review, red-teaming, simplification and
  churn reviews, debugging, reviewing
  plans, diffs or prose, extracting requirements, rollout, test gaps, explanation,
  incident analysis or security hypotheses. Requests naming Gemini, a
  Gemini model, Antigravity or agy for that work select this skill. Exclude questions
  about the provider's API, SDK, pricing or model capabilities.
---

# Gemini as a thinking partner

Before selecting a mode, starting a review or handling results, read the [shared review guide](../review-guide.md), resolving that path from this skill's directory. If the bundled file cannot be read, report the missing guide before running a review. It supplies the full mode catalogue, mode instructions, evidence standards, finding dispositions, convergence and summary rules for both reviewers.

## Starting a review

Use `review_start` with `reviewer: "gemini"` and the mode, question, instructions and artifact described in the shared guide. Use `review_record` for finding dispositions.

The tool runs the Antigravity CLI (`agy`) from a temporary directory as an agent with read-only tools. `artifact.files` are absolute paths of UTF-8 text files: the tool reads them and puts numbered snapshots into the prompt. Those supplied contents need no Antigravity file permissions. `artifact.text` is inline material. Keep the reviewed files unchanged until the call returns, because citation checks read them from disk at the end.

If this skill includes a discovery failure, report its diagnostic and use the recovery guidance below; availability is checked again when a new session starts. If `review_start` is unavailable without that diagnostic, check CLI discovery and mod loading: reviews require this plugin enabled in Claude Code v2.1.287 or later with mods on; claude.ai and Cowork load no mods.

## Model and effort

The tool selects the newest Gemini Flash release on offer and sets effort from the mode. Override `model` with a base ID without an effort suffix and `effort` with `low`, `medium` or `high` when requested or justified by the material. The tool accepts no higher Gemini effort. Report the exact returned model and effort in the summary.

`agy` also serves `claude-*` models. Selecting one changes the requested model family: explain that before using it and proceed only if the user wants it. Label that result as same-family when Claude is the host.

## Permissions, failures and recovery

Additional files or URLs Gemini reads go through the user's Antigravity permissions in `~/.gemini/antigravity-cli/settings.json`. The reviewer agent has only `view_file`, `grep_search`, `read_url_content` and `finish`. Preserve that tool boundary. Never edit the user's settings or suggest granting `write_file`, `command` or `unsandboxed` to get a review through.

Inspect `deniedSteps`, `stderr` and `failure`. Despite its name, `deniedSteps` contains reported tool errors as well as permission refusals. Describe an entry as a failed step unless the available diagnostic explicitly establishes a refusal; the field alone does not identify the cause. agy's permission notices can appear on stderr: a successful result retains its tail in `stderr`, and a failure includes it in `failure`. Report any explicit denial and the evidence it prevented the reviewer from obtaining. The retained output and failed-step list are incomplete evidence: their absence cannot establish that every necessary read succeeded.

A successful result event, exit and schema check can coexist with failed steps. Use the shared guide's coverage rules for that case. If an essential additional read fails, check whether the user-authorized material can be supplied as `artifact.files` or a sanitized excerpt in `artifact.text`; the file snapshots avoid requiring the CLI to repeat that read. State what was supplied and what remains unverified. If an essential fetch remains unavailable, report the gap instead of treating the verdict as convergence.

For a failed run, report its `failure` text and any diagnostic establishing the cause. Retry only after a concrete change addresses it, such as correcting the input, supplying the missing material or restoring CLI availability. Authentication, rate-limit and environment failures require that condition to change; do not repeat an unchanged failing call. A cancellation ends the attempt; resume only when requested. If recovery depends on the user, state the needed action and stop.
