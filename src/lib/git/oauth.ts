/**
 * "Sign in with GitHub": OAuth 2 authorization code with PKCE, for a GitHub
 * App. The browser goes to GitHub, which sends it back to `/auth/callback/`
 * with a one-time code; that page trades the code for tokens through the
 * sign-in worker (`worker/`), which adds the client secret the browser must
 * never hold. Tokens are kept only in this browser. They expire after 8
 * hours and are refreshed through the worker the same way.
 *
 * Everything here takes its storage and `fetch` as arguments, so it can be
 * tested without a browser.
 */
import { GitError } from './errors.ts';

export interface SignInConfig {
	/** The GitHub App's client ID (public). */
	clientId: string;
	/** The sign-in worker's URL. */
	worker: string;
	/** The GitHub App's slug, for "Choose repositories on GitHub". */
	appSlug?: string;
}

export interface TokenSet {
	accessToken: string;
	refreshToken: string | null;
	/** When the access token expires (ms since 1970), if it does. */
	expiresAt: number | null;
	/** When the refresh token expires; signing in again is needed after that. */
	refreshExpiresAt: number | null;
}

/** What to reopen once back from GitHub. */
export type Resume = 'open-repository' | 'source-control' | 'settings';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PENDING_KEY = 'sysml-web:github-sign-in';
const INSTALL_KEY = 'sysml-web:github-install';
const RESUME_KEY = 'sysml-web:github-resume';
const AUTHORIZE = 'https://github.com/login/oauth/authorize';
/** A sign-in left unfinished for this long has expired. */
const PENDING_TTL = 30 * 60_000;
/** Refresh a token this long before it expires. */
export const REFRESH_MARGIN = 5 * 60_000;

/** Sign-in is offered only when the build has both the app's client ID and the worker. */
export function signInConfig(values: {
	clientId?: string | undefined;
	worker?: string | undefined;
	appSlug?: string | undefined;
}): SignInConfig | null {
	const clientId = values.clientId?.trim();
	const worker = values.worker?.trim().replace(/\/+$/, '');
	if (!clientId || !worker) return null;
	const appSlug = values.appSlug?.trim();
	return { clientId, worker, ...(appSlug ? { appSlug } : {}) };
}

/** Where people choose which repositories the app may use. */
export function installUrl(config: SignInConfig): string {
	return config.appSlug
		? `https://github.com/apps/${encodeURIComponent(config.appSlug)}/installations/new`
		: 'https://github.com/settings/installations';
}

function base64url(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A time as stored (ISO 8601). */
export const isoTime = (ms: number): string => new Date(ms).toISOString();

export function randomString(bytes = 32): string {
	return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** The PKCE S256 challenge for a verifier (RFC 7636). */
export async function challengeFor(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return base64url(new Uint8Array(digest));
}

/** GitHub's sign-in page for this app. */
export function authorizeUrl(
	clientId: string,
	redirectUri: string,
	state: string,
	challenge: string,
	options: { selectAccount?: boolean } = {}
): string {
	const url = new URL(AUTHORIZE);
	url.searchParams.set('client_id', clientId);
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('state', state);
	url.searchParams.set('code_challenge', challenge);
	url.searchParams.set('code_challenge_method', 'S256');
	// Adding another account: GitHub shows its account picker where it can
	// (when several accounts are signed in on github.com).
	if (options.selectAccount) url.searchParams.set('prompt', 'select_account');
	return url.toString();
}

interface Pending {
	state: string;
	verifier: string;
	redirectUri: string;
	returnTo: string;
	resume?: Resume;
	startedAt: number;
}

/**
 * Where a sign-in is remembered while the browser is at GitHub. The tab's
 * session storage survives the round trip (also on iOS and in the installed
 * app); local storage is the fallback for browsers that come back in a
 * different tab or window.
 */
export interface SignInStores {
	session: Store | null;
	local: Store | null;
}

function browserStore(kind: 'sessionStorage' | 'localStorage'): Store | null {
	try {
		return globalThis[kind] ?? null;
	} catch {
		return null; // Storage blocked.
	}
}

export const browserStores = (): SignInStores => ({
	session: browserStore('sessionStorage'),
	local: browserStore('localStorage')
});

function put(stores: SignInStores, key: string, value: string) {
	for (const store of [stores.session, stores.local])
		try {
			store?.setItem(key, value);
		} catch {
			// Full or blocked: the other store may still work.
		}
}

/** Read and forget a remembered value. */
function take(stores: SignInStores, key: string): string | null {
	let value: string | null = null;
	for (const store of [stores.session, stores.local])
		try {
			value ??= store?.getItem(key) ?? null;
			store?.removeItem(key);
		} catch {
			// Blocked.
		}
	return value;
}

function peek(stores: SignInStores, key: string): string | null {
	for (const store of [stores.session, stores.local])
		try {
			const value = store?.getItem(key);
			if (value) return value;
		} catch {
			// Blocked.
		}
	return null;
}

/** The sign-in started here and waiting for GitHub to send the browser back, if any. */
export function pendingSignIn(
	stores = browserStores()
): { returnTo: string; resume?: Resume } | null {
	try {
		const pending = JSON.parse(peek(stores, PENDING_KEY) ?? 'null') as Pending | null;
		return pending
			? { returnTo: pending.returnTo, ...(pending.resume ? { resume: pending.resume } : {}) }
			: null;
	} catch {
		return null;
	}
}

/**
 * Remember the sign-in and return GitHub's sign-in page to go to.
 * `returnTo` is the page to come back to (a path on this site).
 */
export async function startSignIn(
	config: SignInConfig,
	options: { redirectUri: string; returnTo: string; resume?: Resume; selectAccount?: boolean },
	stores = browserStores(),
	now = Date.now()
): Promise<string> {
	const pending: Pending = {
		state: randomString(16),
		verifier: randomString(48),
		redirectUri: options.redirectUri,
		returnTo: options.returnTo,
		...(options.resume ? { resume: options.resume } : {}),
		startedAt: now
	};
	if (!stores.session && !stores.local)
		throw new GitError(
			'invalid',
			'This browser is blocking site storage, which signing in needs. Allow it for this site, or use an access token instead.'
		);
	put(stores, PENDING_KEY, JSON.stringify(pending));
	return authorizeUrl(
		config.clientId,
		options.redirectUri,
		pending.state,
		await challengeFor(pending.verifier),
		{ selectAccount: options.selectAccount }
	);
}

interface TokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number | string;
	refresh_token_expires_in?: number | string;
	error?: string;
	error_description?: string;
}

const EXPIRED =
	'Your GitHub sign-in has expired. Sign in again to carry on (your work here is kept).';

/**
 * Tokens from GitHub's answer, passed on by the worker. GitHub answers in
 * JSON when asked, but can answer form-encoded; both are read.
 */
export function parseTokenResponse(text: string, status: number, now = Date.now()): TokenSet {
	let body: TokenResponse = {};
	try {
		body = JSON.parse(text) as TokenResponse;
	} catch {
		if (text.includes('=')) body = Object.fromEntries(new URLSearchParams(text)) as TokenResponse;
	}
	if (body.access_token && status >= 200 && status < 300) {
		const seconds = (value: number | string | undefined) => {
			const n = Number(value);
			return value !== undefined && value !== '' && Number.isFinite(n) && n > 0 ? n : null;
		};
		const expiresIn = seconds(body.expires_in);
		const refreshIn = seconds(body.refresh_token_expires_in);
		return {
			accessToken: body.access_token,
			refreshToken: body.refresh_token || null,
			expiresAt: expiresIn === null ? null : now + expiresIn * 1000,
			refreshExpiresAt: refreshIn === null ? null : now + refreshIn * 1000
		};
	}
	if (body.error === 'bad_refresh_token' || body.error === 'bad_verification_code')
		return fail('auth', body.error === 'bad_refresh_token' ? EXPIRED : CODE_USED, status, body);
	if (body.error === 'incorrect_client_credentials' || body.error === 'redirect_uri_mismatch')
		return fail(
			'other',
			'GitHub sign-in isn’t set up correctly for this site yet. Use an access token instead for now.',
			status,
			body
		);
	if (status === 501)
		return fail(
			'other',
			'GitHub sign-in isn’t set up on this site yet. Use an access token instead for now.',
			status,
			body,
			text
		);
	if (status === 403 && text.startsWith('Origin not allowed'))
		return fail(
			'other',
			'GitHub sign-in isn’t available at this address. Use an access token instead.',
			status,
			body,
			text
		);
	return fail(
		'other',
		'Couldn’t finish signing in to GitHub. Try again in a moment.',
		status,
		body,
		text
	);
}

const CODE_USED = 'That sign-in link was already used or has expired. Sign in again.';

function fail(
	kind: 'auth' | 'other',
	message: string,
	status: number,
	body: TokenResponse,
	text = ''
): never {
	throw new GitError(
		kind,
		message,
		status,
		[body.error, body.error_description].filter(Boolean).join(': ') || text.slice(0, 200)
	);
}

async function post(
	fetchFn: typeof fetch,
	url: string,
	body: Record<string, string>,
	now: () => number
): Promise<TokenSet> {
	let response: Response;
	try {
		response = await fetchFn(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify(body),
			cache: 'no-store'
		});
	} catch (error) {
		throw new GitError(
			'network',
			'Couldn’t reach GitHub to sign in. Check your internet connection and try again.',
			undefined,
			error instanceof Error ? error.message : String(error)
		);
	}
	return parseTokenResponse(await response.text(), response.status, now());
}

/**
 * Back from GitHub on the callback page: check that this browser started
 * the sign-in, then trade the code for tokens through the worker.
 */
export async function completeSignIn(
	params: URLSearchParams,
	config: SignInConfig,
	options: { stores?: SignInStores; fetch?: typeof fetch; now?: () => number } = {}
): Promise<{ tokens: TokenSet; returnTo: string; resume?: Resume }> {
	const stores = options.stores ?? browserStores();
	const now = options.now ?? Date.now;
	const raw = take(stores, PENDING_KEY);
	let pending: Pending | null;
	try {
		pending = raw ? (JSON.parse(raw) as Pending) : null;
	} catch {
		pending = null;
	}
	if (!pending || now() - pending.startedAt > PENDING_TTL)
		throw new GitError(
			'invalid',
			'This sign-in has expired or was started somewhere else. Start again from Fairtide.'
		);
	const denied = params.get('error');
	if (denied)
		throw new GitError(
			denied === 'access_denied' ? 'auth' : 'other',
			denied === 'access_denied'
				? 'Sign-in was cancelled on GitHub. Nothing was changed.'
				: `GitHub couldn’t sign you in: ${params.get('error_description') || denied}.`,
			undefined,
			denied
		);
	if (params.get('state') !== pending.state)
		throw new GitError(
			'invalid',
			'This sign-in doesn’t match the one started here, so it was stopped to keep your account safe. Start again from Fairtide.'
		);
	const code = params.get('code');
	if (!code) throw new GitError('invalid', 'GitHub didn’t send a sign-in code back. Try again.');
	const tokens = await post(
		options.fetch ?? ((...args) => globalThis.fetch(...args)),
		`${config.worker}/oauth/github/token`,
		{ code, code_verifier: pending.verifier, redirect_uri: pending.redirectUri },
		now
	);
	return {
		tokens,
		returnTo: pending.returnTo,
		...(pending.resume ? { resume: pending.resume } : {})
	};
}

/** Trade a refresh token for new tokens (GitHub replaces the refresh token too). */
export async function refreshTokens(
	config: SignInConfig,
	refreshToken: string,
	fetchFn: typeof fetch = (...args) => globalThis.fetch(...args),
	now: () => number = Date.now
): Promise<TokenSet> {
	const tokens = await post(
		fetchFn,
		`${config.worker}/oauth/github/refresh`,
		{ refresh_token: refreshToken },
		now
	);
	return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

/** Whether a token should be refreshed before it is used. */
export function needsRefresh(
	tokens: { expiresAt?: number | null; refreshToken?: string | null },
	now = Date.now(),
	margin = REFRESH_MARGIN
): boolean {
	return !!tokens.refreshToken && !!tokens.expiresAt && tokens.expiresAt - now < margin;
}

/** Whether the sign-in can no longer be refreshed (signing in again is needed). */
export function refreshExpired(
	tokens: { refreshExpiresAt?: number | null },
	now = Date.now()
): boolean {
	return !!tokens.refreshExpiresAt && tokens.refreshExpiresAt <= now;
}

export const SIGN_IN_EXPIRED = EXPIRED;

/** Remember where to come back to after choosing repositories on GitHub. */
export function rememberInstall(
	returnTo: string,
	resume: Resume | undefined,
	stores = browserStores(),
	now = Date.now()
) {
	put(stores, INSTALL_KEY, JSON.stringify({ returnTo, resume, startedAt: now }));
}

/** Back from choosing repositories on GitHub: where to go (once). */
export function takeInstall(
	stores = browserStores(),
	now = Date.now()
): { returnTo: string; resume?: Resume } | null {
	const raw = take(stores, INSTALL_KEY);
	if (!raw) return null;
	try {
		const value = JSON.parse(raw) as { returnTo: string; resume?: Resume; startedAt: number };
		if (now - value.startedAt > PENDING_TTL) return null;
		return { returnTo: value.returnTo, ...(value.resume ? { resume: value.resume } : {}) };
	} catch {
		return null;
	}
}

/** After signing in: what the page should reopen. */
export function setResume(resume: Resume | undefined, stores = browserStores(), now = Date.now()) {
	if (resume) {
		try {
			stores.session?.setItem(RESUME_KEY, JSON.stringify({ resume, at: now }));
		} catch {
			// Blocked: nothing reopens, which is fine.
		}
	}
}

/** Reopening is for the page loaded right after signing in, not for one much later. */
const RESUME_TTL = 2 * 60_000;

/** What the page should reopen after signing in, without forgetting it. */
export function signInResume(stores = browserStores(), now = Date.now()): Resume | null {
	try {
		const value = JSON.parse(stores.session?.getItem(RESUME_KEY) ?? 'null') as {
			resume: Resume;
			at: number;
		} | null;
		return value && now - value.at < RESUME_TTL ? value.resume : null;
	} catch {
		return null;
	}
}

/** True (once) when the page should reopen `kind` after signing in. */
export function takeResume(kind: Resume, stores = browserStores(), now = Date.now()): boolean {
	if (signInResume(stores, now) !== kind) return false;
	try {
		stores.session?.removeItem(RESUME_KEY);
	} catch {
		// Blocked.
	}
	return true;
}

/**
 * A page on this site to return to: a path under `base`, never another site.
 * Anything else becomes `fallback`.
 */
export function safeReturn(
	path: string | null | undefined,
	base: string,
	fallback: string
): string {
	if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
		return fallback;
	if (base && path !== base && !path.startsWith(`${base}/`) && !path.startsWith(`${base}?`))
		return fallback;
	return path;
}
