/** Normalized errors so the UI can show clear messages. */

export type GitHubErrorKind =
  | 'bad-token' // 401
  | 'forbidden' // 403: insufficient token permissions (or rate limit)
  | 'not-found' // 404: repo/branch missing or token has no access to it
  | 'empty-repo' // 409 on tree: repository has no commits
  | 'conflict' // ref update rejected (remote moved)
  | 'network' // offline / fetch failed
  | 'unknown'

export class GitHubError extends Error {
  readonly kind: GitHubErrorKind
  readonly status: number | undefined
  constructor(kind: GitHubErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'GitHubError'
    this.kind = kind
    this.status = status
  }
}

interface MaybeHttpError {
  status?: number
  response?: unknown
  message?: string
}

/** Convert an Octokit/fetch error into a GitHubError. */
export function toGitHubError(e: unknown): GitHubError {
  if (e instanceof GitHubError) return e
  const err = (e ?? {}) as MaybeHttpError
  const status = typeof err.status === 'number' ? err.status : undefined
  // Octokit reports fetch failures as status 500 without a response.
  if (status === undefined || (status === 500 && !err.response) || e instanceof TypeError) {
    return new GitHubError('network', 'Cannot reach GitHub. You appear to be offline.', status)
  }
  const msg = err.message ?? ''
  switch (status) {
    case 401:
      return new GitHubError('bad-token', 'The token is invalid or expired.', status)
    case 403:
      if (/rate limit/i.test(msg)) {
        return new GitHubError('forbidden', 'GitHub rate limit exceeded. Try again later.', status)
      }
      return new GitHubError(
        'forbidden',
        'The token lacks permission. It needs "Contents: Read and write" on this repository.',
        status,
      )
    case 404:
      return new GitHubError(
        'not-found',
        'Repository or branch not found, or the token has no access to it.',
        status,
      )
    case 409:
      return new GitHubError('empty-repo', 'The repository is empty.', status)
    case 422:
      if (/fast.forward/i.test(msg)) {
        return new GitHubError('conflict', 'The branch was updated elsewhere.', status)
      }
      return new GitHubError('unknown', `GitHub rejected the request: ${msg}`, status)
    default:
      return new GitHubError('unknown', `GitHub error ${status}: ${msg}`, status)
  }
}

export function isNetworkError(e: unknown): boolean {
  return toGitHubError(e).kind === 'network'
}
