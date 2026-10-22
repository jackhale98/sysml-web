/**
 * The GitHub account this browser is connected to, kept only in this
 * browser's local storage and sent only to GitHub (and, to refresh a
 * sign-in, to the sign-in worker). Either:
 *
 * - a personal access token the person made and pasted (`via: 'token'`), or
 * - a "Sign in with GitHub" session (`via: 'app'`): a GitHub App user token
 *   that expires after 8 hours and is refreshed before then.
 *
 * Accounts stored before sign-in existed (`{ token, user, connectedAt }`)
 * read as access tokens.
 */
import { GitHubProvider } from './github.ts';
import type { GitProvider, GitUser } from './types.ts';
import { GitError, type Access } from './errors.ts';
import {
	isoTime,
	needsRefresh,
	refreshExpired,
	refreshTokens,
	SIGN_IN_EXPIRED,
	type SignInConfig,
	type TokenSet
} from './oauth.ts';
import { SIGN_IN } from './signin-config.ts';

export const ACCOUNT_KEY = 'sysml-web:github';
const LOCK = 'sysml-web:github-refresh';

export interface StoredAccount {
	/** The access token (personal, or from signing in). */
	token: string;
	user: GitUser;
	connectedAt: string;
	/** Missing in accounts stored before sign-in existed: those are access tokens. */
	via?: Access;
	refreshToken?: string | null;
	/** When `token` expires (ms since 1970). */
	expiresAt?: number | null;
	/** When `refreshToken` expires. */
	refreshExpiresAt?: number | null;
}

/** The stored account in today's shape, or null if there is none (or it is unreadable). */
export function readAccount(raw: string | null): (StoredAccount & { via: Access }) | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as StoredAccount | null;
		if (!parsed?.token || typeof parsed.token !== 'string' || !parsed.user?.login) return null;
		const via: Access = parsed.via === 'app' ? 'app' : 'token';
		return {
			...parsed,
			via,
			connectedAt: parsed.connectedAt ?? isoTime(0),
			...(via === 'app'
				? {
						refreshToken: parsed.refreshToken ?? null,
						expiresAt: parsed.expiresAt ?? null,
						refreshExpiresAt: parsed.refreshExpiresAt ?? null
					}
				: {})
		};
	} catch {
		return null;
	}
}

function storage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

function load(): (StoredAccount & { via: Access }) | null {
	try {
		return readAccount(storage()?.getItem(ACCOUNT_KEY) ?? null);
	} catch {
		return null;
	}
}

/** Run `task` while no other tab of this site refreshes the sign-in. */
async function exclusively<T>(task: () => Promise<T>): Promise<T> {
	const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
	if (!locks?.request) return task();
	return locks.request(LOCK, task) as Promise<T>;
}

export class Accounts {
	/** The connected GitHub account (without its tokens). */
	github = $state.raw<{ user: GitUser; connectedAt: string; via: Access } | null>(null);
	private stored: (StoredAccount & { via: Access }) | null = null;
	private loaded = false;
	private refreshing: Promise<string> | null = null;
	/** Swappable for tests. */
	fetch: typeof fetch | undefined;
	/** This build's sign-in settings; swappable for tests. */
	signIn: SignInConfig | null = SIGN_IN;
	/** Swappable for tests. */
	now: () => number = Date.now;

	/** Read the stored account (once), and follow sign-ins and sign-outs in other tabs. */
	init() {
		if (this.loaded || !storage()) return;
		this.loaded = true;
		this.adopt(load());
		if (typeof window !== 'undefined')
			window.addEventListener('storage', (event) => {
				if (event.key === ACCOUNT_KEY || event.key === null) this.adopt(load());
			});
	}

	private adopt(account: (StoredAccount & { via: Access }) | null) {
		this.stored = account;
		this.github = account
			? { user: account.user, connectedAt: account.connectedAt, via: account.via }
			: null;
	}

	private save(account: StoredAccount & { via: Access }) {
		try {
			storage()?.setItem(ACCOUNT_KEY, JSON.stringify(account));
		} catch {
			// Private mode: connected for this visit only.
		}
		this.loaded = true;
		this.adopt(account);
	}

	get connected(): boolean {
		this.init();
		return this.github !== null;
	}

	/** Check a personal access token with GitHub and remember it. Throws a friendly GitError if refused. */
	async connect(token: string): Promise<GitUser> {
		const clean = token.trim();
		if (!clean) throw new GitError('auth', 'Paste a token first.');
		if (/\s/.test(clean))
			throw new GitError('auth', 'That doesn’t look like a token: it has spaces.');
		const user = await new GitHubProvider(clean, { fetch: this.fetch }).currentUser();
		this.save({
			token: clean,
			user,
			connectedAt: isoTime(this.now()),
			via: 'token'
		});
		return user;
	}

	/** Remember the tokens from "Sign in with GitHub", once GitHub says who they belong to. */
	async signInWith(tokens: TokenSet): Promise<GitUser> {
		const user = await new GitHubProvider(
			{ token: () => tokens.accessToken, access: 'app' },
			{ fetch: this.fetch }
		).currentUser();
		this.save({
			token: tokens.accessToken,
			user,
			connectedAt: isoTime(this.now()),
			via: 'app',
			refreshToken: tokens.refreshToken,
			expiresAt: tokens.expiresAt,
			refreshExpiresAt: tokens.refreshExpiresAt
		});
		return user;
	}

	/** Forget the account in this browser. (Revoke it on GitHub to disable it everywhere.) */
	signOut() {
		try {
			storage()?.removeItem(ACCOUNT_KEY);
		} catch {
			// Nothing stored.
		}
		this.stored = null;
		this.github = null;
	}

	/** The token to use now: a sign-in about to expire is refreshed first. */
	async token(): Promise<string> {
		this.init();
		const account = this.stored;
		if (!account)
			throw new GitError('auth', 'Connect your GitHub account first (Settings → Accounts).');
		if (account.via === 'app' && needsRefresh(account, this.now()))
			return this.refresh(account.token);
		return account.token;
	}

	/**
	 * Refresh the sign-in, once even if several requests ask together (and,
	 * where the browser allows, once across tabs: GitHub accepts each refresh
	 * token only once). `rejected` is the token that failed or is expiring;
	 * if another tab already replaced it, that tab's token is used.
	 */
	refresh(rejected: string): Promise<string> {
		this.refreshing ??= exclusively(async () => {
			const latest = load() ?? this.stored;
			if (!latest || latest.via !== 'app')
				throw new GitError('auth', 'Connect your GitHub account first (Settings → Accounts).');
			if (latest.token !== rejected && !needsRefresh(latest, this.now())) {
				this.adopt(latest);
				return latest.token;
			}
			if (!latest.refreshToken || !this.signIn || refreshExpired(latest, this.now()))
				throw new GitError('auth', SIGN_IN_EXPIRED);
			const tokens = await refreshTokens(
				this.signIn,
				latest.refreshToken,
				this.fetchFn(),
				this.now
			);
			this.save({
				...latest,
				token: tokens.accessToken,
				refreshToken: tokens.refreshToken,
				expiresAt: tokens.expiresAt,
				refreshExpiresAt: tokens.refreshExpiresAt ?? latest.refreshExpiresAt ?? null
			});
			return tokens.accessToken;
		}).finally(() => (this.refreshing = null));
		return this.refreshing;
	}

	private fetchFn(): typeof fetch {
		return this.fetch ?? ((...args) => globalThis.fetch(...args));
	}

	/** The GitHub API as the connected account; throws when not connected. */
	provider(): GitProvider {
		this.init();
		const account = this.stored;
		if (!account)
			throw new GitError('auth', 'Connect your GitHub account first (Settings → Accounts).');
		if (account.via === 'token') return new GitHubProvider(account.token, { fetch: this.fetch });
		return new GitHubProvider(
			{
				access: 'app',
				token: () => this.token(),
				renew: async (rejected) => {
					try {
						return await this.refresh(rejected);
					} catch (error) {
						// Can't refresh: let GitHub's 401 explain (it asks to sign in again).
						if (error instanceof GitError && error.kind === 'auth') return null;
						throw error;
					}
				}
			},
			{ fetch: this.fetch }
		);
	}
}

export const accounts = new Accounts();
