/**
 * Errors from a git host, in words for people who don't know git, with what
 * to do next. `kind` lets the UI offer the right action (connect again, get
 * latest first, …).
 */

export type GitErrorKind =
	/** The token or sign-in is missing, expired or revoked (401). */
	| 'auth'
	/** The token or app can't do this (403). */
	| 'permission'
	/** Too many requests (403/429 with the limit used up). */
	| 'rate-limit'
	| 'not-found'
	/** The branch moved on the host since the base (409/422 non-fast-forward). */
	| 'behind'
	/** A branch with that name already exists. */
	| 'exists'
	/** The repository has no commits yet. */
	| 'empty'
	| 'invalid'
	| 'network'
	| 'other';

export class GitError extends Error {
	constructor(
		readonly kind: GitErrorKind,
		message: string,
		readonly status?: number,
		/** The host's own message, for the curious. */
		readonly detail?: string
	) {
		super(message);
		this.name = 'GitError';
	}
}

interface HostResponse {
	status: number;
	headers: { get(name: string): string | null };
}

/**
 * How the account connected: with an access token the person made, or by
 * signing in (a GitHub App, which can use only the repositories chosen for it).
 */
export type Access = 'token' | 'app';

/** A friendly error for a failed host response. `what` names the thing asked for. */
export function errorFor(
	response: HostResponse,
	detail: string,
	host: string,
	what = 'that',
	access: Access = 'token'
): GitError {
	const { status } = response;
	const lower = detail.toLowerCase();
	if (status === 401)
		return new GitError(
			'auth',
			access === 'app'
				? `Your ${host} sign-in has expired or was revoked. Sign in again to carry on (your work here is kept).`
				: `${host} didn't accept your access token. It may have expired or been revoked; connect again with a new token.`,
			status,
			detail
		);
	if (
		status === 429 ||
		(status === 403 &&
			(response.headers.get('x-ratelimit-remaining') === '0' || lower.includes('rate limit')))
	) {
		const reset = Number(response.headers.get('x-ratelimit-reset'));
		const when = reset
			? ` after ${new Date(reset * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
			: ' in a few minutes';
		return new GitError(
			'rate-limit',
			`${host} is limiting requests for now. Try again${when}.`,
			status,
			detail
		);
	}
	if (status === 403)
		return new GitError(
			'permission',
			access === 'app'
				? `${host} didn't allow ${what}. Check that Fairtide can use this repository (choose repositories on ${host}), and that your account can make changes to it.`
				: `Your token isn't allowed to do ${what}. Check that it covers this repository with “Contents: Read and write” (and “Pull requests: Read and write” to propose changes).`,
			status,
			detail
		);
	if (status === 404)
		return new GitError(
			'not-found',
			access === 'app'
				? `${host} couldn't find ${what}. Check the name, or that Fairtide can use this repository (choose repositories on ${host}).`
				: `${host} couldn't find ${what}. Check the name, or that your token includes this repository.`,
			status,
			detail
		);
	if (status === 409 && lower.includes('empty'))
		return new GitError(
			'empty',
			'This repository has no files yet. Add a first file (such as a README) on the website, then try again.',
			status,
			detail
		);
	if (status === 409 || (status === 422 && lower.includes('fast forward')))
		return new GitError(
			'behind',
			`Someone saved newer changes to this branch on ${host}. Get the latest first, then save again.`,
			status,
			detail
		);
	if (status === 422 && lower.includes('already exists'))
		return new GitError('exists', `That name is already taken on ${host}.`, status, detail);
	if (status === 422)
		return new GitError(
			'invalid',
			`${host} refused ${what}: ${detail || 'the request was not valid'}.`,
			status,
			detail
		);
	return new GitError(
		'other',
		`${host} had a problem (${status}). Try again in a moment.`,
		status,
		detail
	);
}

export function networkError(host: string, cause: unknown): GitError {
	return new GitError(
		'network',
		`Couldn't reach ${host}. Check your internet connection and try again.`,
		undefined,
		cause instanceof Error ? cause.message : String(cause)
	);
}

/** A message for any error, preferring a GitError's friendly one. */
export function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
