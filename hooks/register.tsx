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

/**
 * The reviewer is asked first because the effort vocabularies differ: Codex takes a
 * reasoning-effort level, Antigravity takes a suffix on the model id. `$.ui.ask` allows
 * 2-4 options and offers free text as Other, so each list stays short and anything the
 * CLI accepts can still be typed.
 */
/**
 * Every answer is checked against a closed set. A dismissed `$.ui.ask` does not return
 * an empty answer, it returns a marker string, so a truthiness test lets it through and
 * the instruction goes out with the marker interpolated into it. Membership is the only
 * safe test. `accepts` is wider than `offer` because `$.ui.ask` shows at most four
 * options while Codex documents five levels, so the fifth arrives through Other.
 */
const REVIEWER = {
  // Named in words, not as a slash command: `$.prompt.submit` refuses text beginning
  // with `/`, since that would run a command as the person. The skills' own triggers
  // pick them up from the name.
  // Codex documents low..max; the four most useful for a review, the rest via Other.
  Codex: {
    skill: 'the codex skill',
    offer: ['high', 'xhigh', 'max', 'medium'],
    accepts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  // Antigravity effort is a model-id suffix, and the Pro line omits -medium.
  Gemini: {
    skill: 'the antigravity skill with Gemini',
    offer: ['high', 'medium', 'low'],
    accepts: ['low', 'medium', 'high'],
  },
} as const

function instruction(skill: string, depth: string, effort: string): string {
  // Deliberately not diff-bound: the target is whatever is salient in the session,
  // which may be a spec, a plan, a file or a decision rather than a diff.
  const target = 'whatever we are working on'
  return depth === 'To convergence'
    ? `Use ${skill} to review ${target} at ${effort} effort, carrying prior findings forward each round, until no actionable findings remain; stop and report any blocker needing my input or evidence you cannot reach.`
    : `Use ${skill} to review ${target} at ${effort} effort, one round.`
}

export const register: Register = on => {
  on('ui.press', { element: BUTTON }, async ($, e) => {
    const answered = { element: e.element }

    const who = await $.ui.ask('Which reviewer?', {
      header: 'Reviewer',
      options: ['Codex', 'Gemini', 'Cancel'],
    })
    // Compared directly rather than with `in`, which matches inherited properties:
    // free text of `toString` or `__proto__` would pass and then have no `offer`.
    if (who !== 'Codex' && who !== 'Gemini') {
      if (who && who !== 'Cancel') {
        await $.ui.toast(`No reviewer called ${who}; pick Codex or Gemini.`)
      }
      return answered
    }

    const reviewer = REVIEWER[who]

    const depth = await $.ui.ask('How far should it go?', {
      header: 'Depth',
      options: ['To convergence', 'One round', 'Cancel'],
    })
    if (depth !== 'To convergence' && depth !== 'One round') {
      return answered
    }

    // Effort is orthogonal to depth, so both paths ask for it.
    const effort = await $.ui.ask('Which effort?', {
      header: 'Effort',
      options: [...reviewer.offer],
    })
    const chosen = effort.trim().toLowerCase()
    if (!reviewer.accepts.includes(chosen)) {
      if (chosen && chosen !== 'cancel') {
        await $.ui.toast(`${who} takes ${reviewer.accepts.join(', ')}; ${effort.trim()} is not one.`)
      }
      return answered
    }

    const skill = reviewer.skill
    // asUser so the transcript reads as the instruction it is, not as a plugin message.
    await $.prompt.submit({ text: instruction(skill, depth, chosen), asUser: true })

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
