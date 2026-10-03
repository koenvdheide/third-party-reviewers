import type { Register } from 'claude-code'

/**
 * The flow lives in a `ui.press` hook rather than in the Button's `onPress`, because
 * `onPress` is declared `(e) => void`: the engine does not await it, so an async chain
 * started there runs unawaited past the point the engine considers the press finished.
 * A hook is `($, e, next)` and is awaited, so `$.ui.ask` and `$.prompt.submit` are safe.
 * A press raises `ui.press` with `onPress` as its bottom, so a hook that answers for
 * itself (returning without `next`) keeps the stub from running.
 */
const BUTTON = 'external-review'

const REVIEWER = {
  Codex: 'the codex skill',
  Gemini: 'the antigravity skill with Gemini',
} as const

function instruction(skill: string, depth: string): string {
  // Deliberately not diff-bound: the target is whatever is salient in the session,
  // which may be a spec, a plan, a file or a decision rather than a diff.
  const target = 'whatever we are working on'
  return depth === 'To convergence'
    ? `Use ${skill} to review ${target}, carrying prior findings forward each round, until no actionable findings remain; stop and report any blocker needing my input or evidence you cannot reach.`
    : `Use ${skill} to review ${target}, one round.`
}

export const register: Register = on => {
  on('ui.press', { element: BUTTON }, async ($, e) => {
    const answered = { element: e.element }

    const who = await $.ui.ask('Which reviewer?', {
      header: 'Reviewer',
      options: ['Codex', 'Gemini', 'Cancel'],
    })
    // Compared directly rather than with `in`, which matches inherited properties:
    // free text of `toString` or `__proto__` would pass as a reviewer name.
    if (who !== 'Codex' && who !== 'Gemini') {
      if (who && who !== 'Cancel') {
        await $.ui.toast(`No reviewer called ${who}; pick Codex or Gemini.`)
      }
      return answered
    }

    const depth = await $.ui.ask('How far should it go?', {
      header: 'Depth',
      options: ['To convergence', 'One round', 'Cancel'],
    })
    if (depth !== 'To convergence' && depth !== 'One round') {
      return answered
    }

    // asUser so the transcript reads as the instruction it is, not as a plugin message.
    await $.prompt.submit({ text: instruction(REVIEWER[who], depth), asUser: true })

    return answered
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    // Yield the row while the engine has a survey in it.
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box>
        <Button key={BUTTON} label="External review" onPress={() => {}} />
      </Box>
    )
  })
}
