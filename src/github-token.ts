import * as core from '@actions/core'

/** Authenticate this action; persist a token only when explicitly requested. */
export function setupGitHubToken(): void {
  const githubToken = core.getInput('github_token')
  const actionToken = process.env.MISE_GITHUB_TOKEN || githubToken
  const persist = core.getInput('persist_github_token')
  const persistedToken = /^true$/i.test(persist)
    ? actionToken
    : !persist || /^false$/i.test(persist)
      ? ''
      : persist

  if (actionToken) {
    core.setSecret(actionToken)
    // Children inherit this, but later workflow steps do not.
    process.env.MISE_GITHUB_TOKEN = actionToken
  } else {
    core.warning(
      'No MISE_GITHUB_TOKEN provided. You may hit GitHub API rate limits when installing tools from GitHub.'
    )
  }

  if (persistedToken) {
    core.setSecret(persistedToken)
    core.info('Persisting MISE_GITHUB_TOKEN for subsequent steps')
    const previousToken = process.env.MISE_GITHUB_TOKEN
    try {
      core.exportVariable('MISE_GITHUB_TOKEN', persistedToken)
    } finally {
      // exportVariable also changes this process. Keep using the action's
      // credential when a different token was supplied for later steps.
      if (previousToken === undefined) delete process.env.MISE_GITHUB_TOKEN
      else process.env.MISE_GITHUB_TOKEN = previousToken
    }
  }
}
