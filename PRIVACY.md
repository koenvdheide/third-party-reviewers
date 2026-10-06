# Privacy policy

This policy covers the third-party-reviewers plugin for Claude Code. The plugin runs reviews of your work through the Codex or Antigravity CLI and keeps track of what happens to their findings.

## What goes over the network

Every review sends data over the network, through the reviewer CLI you have configured:

- Codex (`codex`) sends the review to OpenAI, or to whichever provider your Codex configuration names. It runs with live web search turned on, so it may also search the web.
- Antigravity (`agy`) sends the review to Google, or to whichever endpoint your Antigravity configuration names.

The review prompt holds what Claude puts in it: the question, instructions, any inline text, and the paths of the files to review. For Antigravity it also holds the full contents of those files. While it works, the reviewer can read any file its own permission settings allow, which may include files outside the project, and what it reads goes to its provider as well.

How a provider handles this data depends on your account with it and the terms that apply to that account. Their general privacy policies are a starting point: [OpenAI](https://openai.com/policies/privacy-policy/), [Google](https://policies.google.com/privacy). Each CLI may also send its own telemetry, depending on its settings.

Review results and your overrules go into your Claude conversation, so they reach Claude's model provider with the rest of the conversation and are kept with it under your Claude Code settings.

The plugin itself has no server, makes no other network requests and adds no telemetry. The author receives no data from it.

## What stays on your machine

- Each review's details, response and findings, and what was decided about them, are kept in Claude Code's plugin state and cleared when the session ends.
- To check the reviewer's citations, the plugin reads the cited files locally. It keeps only the result of the check.
- An Antigravity review runs in a temporary directory, which the plugin deletes when the review ends, is cancelled or fails to start. If the deletion fails, the plugin shows you the directory's path. A crash can also leave it behind, under `third-party-reviewers/` in your system temp folder.
- Codex runs with `--ephemeral`, so it doesn't save the session transcript. Both CLIs keep their own history, logs or cache according to their own settings, and the plugin doesn't delete those.

## Contact

Questions about this policy go to the [issue tracker](https://github.com/koenvdheide/third-party-reviewers/issues).
