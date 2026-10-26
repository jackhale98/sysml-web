/**
 * The GitHub accounts this browser is connected to, kept only in this
 * browser's local storage and sent only to GitHub (and, to refresh a
 * sign-in, to the sign-in worker). Each is either:
 *
 * - a personal access token the person made and pasted (`via: 'token'`), or
 * - a "Sign in with GitHub" session (`via: 'app'`): a GitHub App user token
 *   that expires after 8 hours and is refreshed before then.
 *
 * Several accounts can be kept (one per GitHub login). One of them is the
 * *default*: the one the repository picker opens with and that new projects
 * use. A project opened from GitHub remembers the account that opened it
 * (`GitRecord.account`) and keeps using that account's token.
 *
 * Stored shapes, all still read:
 * - today: `sysml-web:github-accounts` = `{ active, accounts: [...] }`;
 * - one account (before several were kept): `sysml-web:github` = an account;
 * - before sign-in existed: `{ token, user, connectedAt }`, an access token.
 * The older key is read until the first change, then replaced.
 */
import { GITHUB_API, GitHubProvider } from './github.ts';
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

/** Where one account was kept before several could be. */
export const ACCOUNT_KEY = 'sysml-web:github';
/** Where the accounts are kept. */
export const ACCOUNTS_KEY = 'sysml-web:github-accounts';
const LOCK = 'sysml-web:github-refresh';

export interface StoredAccount {
	/** The access token (personal, or from signing in). */
	token: string;
	user: GitUser;
	connectedAt: string;
	/** Missing in accounts stored before sign-in existed: those are access tokens. */
	via?: Access;
	/** The GitHub API it belongs to, when not github.com's (GitHub Enterprise Server); tokens only. */
	api?: string;
	refreshToken?: string | null;
	/** When `token` expires (ms since 1970). */
	expiresAt?: number | null;
	/** When `refreshToken` expires. */
	refreshExpiresAt?: number | null;
}

export type Account = StoredAccount & { via: Access };

/** What the app shows of an account (never its tokens). */
export interface AccountInfo {
	user: GitUser;
	connectedAt: string;
	via: Access;
}

export interface StoredAccounts {
	/** The default account's login. */
	active: string | null;
	accounts: Account[];
}

const EMPTY: StoredAccounts = { active: null, accounts: [] };

/** Logins are compared without case, as GitHub does. */
export const sameLogin = (a: string | null | undefined, b: string | null | undefined): boolean =>
	!!a && !!b && a.toLowerCase() === b.toLowerCase();

/** One stored account in today's shape, or null if it is unreadable. */
function normalize(parsed: StoredAccount | null | undefined): Account | null {
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
}

/** The single stored account (the older key) in today's shape, or null. */
export function readAccount(raw: string | null): Account | null {
	if (!raw) return null;
	try {
		return normalize(JSON.parse(raw) as StoredAccount | null);
	} catch {
		return null;
	}
}

/**
 * The stored accounts: from today's key when it is there, else the single
 * account kept before several could be (which becomes the default).
 */
export function readAccounts(raw: string | null, legacy: string | null = null): StoredAccounts {
	if (raw) {
		try {
			const parsed = JSON.parse(raw) as Partial<StoredAccounts> | null;
			const accounts: Account[] = [];
			for (const entry of Array.isArray(parsed?.accounts) ? parsed.accounts : []) {
				const account = normalize(entry);
				if (account && !accounts.some((a) => sameLogin(a.user.login, account.user.login)))
					accounts.push(account);
			}
			const active =
				accounts.find((a) => sameLogin(a.user.login, parsed?.active))?.user.login ??
				accounts[0]?.user.login ??
				null;
			return { active, accounts };
		} catch {
			// Unreadable: fall back to the older key.
		}
	}
	const single = readAccount(legacy);
	return single ? { active: single.user.login, accounts: [single] } : EMPTY;
}

function storage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

function load(): StoredAccounts {
	try {
		const store = storage();
		return readAccounts(store?.getItem(ACCOUNTS_KEY) ?? null, store?.getItem(ACCOUNT_KEY) ?? null);
	} catch {
		return EMPTY;
	}
}

/** Run `task` while no other tab of this site refreshes this account's sign-in. */
async function exclusively<T>(login: string, task: () => Promise<T>): Promise<T> {
	const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
	if (!locks?.request) return task();
	return locks.request(`${LOCK}:${login.toLowerCase()}`, task) as Promise<T>;
}

const info = (account: Account): AccountInfo => ({
	user: account.user,
	connectedAt: account.connectedAt,
	via: account.via
});

const notConnected = () =>
	new GitError('auth', 'Connect your GitHub account first (Settings → Accounts).');

/** A project's account isn't kept here (signed out, or another device). */
export function missingAccount(login: string): GitError {
	return new GitError(
		'auth',
		`This project uses the GitHub account @${login}, which isn't signed in here. Sign in as @${login} (Settings → Accounts), or choose another account for this project.`
	);
}

export class Accounts {
	/** Every connected account (without tokens), in the order they were added. */
	list = $state.raw<AccountInfo[]>([]);
	/** The default account's login. */
	active = $state<string | null>(null);
	/**
	 * The latest account added on this page: whether it was new here. GitHub
	 * signs in whoever is signed in on github.com, so "adding another" can
	 * bring back an account that was already here.
	 */
	lastAdded = $state.raw<{ login: string; existed: boolean } | null>(null);

	private stored: StoredAccounts = EMPTY;
	private loaded = false;
	// Bookkeeping, deliberately not reactive.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private refreshing = new Map<string, Promise<string>>();
	/** Swappable for tests. */
	fetch: typeof fetch | undefined;
	/** This build's sign-in settings; swappable for tests. */
	signIn: SignInConfig | null = SIGN_IN;
	/** Swappable for tests. */
	now: () => number = Date.now;
	/**
	 * Called before a second (or later) account is added, with the default
	 * account until then: projects that don't yet say which account they use
	 * are given that one, so adding an account never changes theirs.
	 */
	beforeAdding: ((previous: string) => Promise<void>) | null = null;

	constructor() {
		// In the browser, read them at once: never for the first time while a page is rendering.
		if (typeof window !== 'undefined') this.init();
	}

	/** Read the stored accounts (once), and follow sign-ins and sign-outs in other tabs. */
	init() {
		if (this.loaded || !storage()) return;
		this.loaded = true;
		this.adopt(load());
		if (typeof window !== 'undefined')
			window.addEventListener('storage', (event) => {
				if (event.key === ACCOUNTS_KEY || event.key === ACCOUNT_KEY || event.key === null)
					this.adopt(load());
			});
	}

	private adopt(stored: StoredAccounts) {
		this.stored = stored;
		this.list = stored.accounts.map(info);
		this.active = stored.active;
	}

	/** The accounts as stored now (another tab may have changed them), or as known here when storage is blocked. */
	private latest(): StoredAccounts {
		return storage() ? load() : this.stored;
	}

	private persist(next: StoredAccounts) {
		try {
			const store = storage();
			if (next.accounts.length) store?.setItem(ACCOUNTS_KEY, JSON.stringify(next));
			else store?.removeItem(ACCOUNTS_KEY);
			store?.removeItem(ACCOUNT_KEY);
		} catch {
			// Private mode: connected for this visit only.
		}
		this.loaded = true;
		this.adopt(next);
	}

	/** The default account (the one the repository picker opens with). */
	get github(): AccountInfo | null {
		this.init();
		return this.find(this.active);
	}

	get connected(): boolean {
		this.init();
		return this.list.length > 0;
	}

	/** The account with this login, if it is kept here. */
	find(login: string | null | undefined): AccountInfo | null {
		this.init();
		return this.list.find((a) => sameLogin(a.user.login, login)) ?? null;
	}

	/**
	 * The account to use for a project that remembers `login`: that one, or
	 * the default for projects that don't say. Null when it isn't kept here.
	 */
	accountFor(login: string | null | undefined): AccountInfo | null {
		return login ? this.find(login) : this.github;
	}

	/** Make this account the default. */
	use(login: string) {
		this.init();
		const account = this.stored.accounts.find((a) => sameLogin(a.user.login, login));
		if (!account || sameLogin(this.stored.active, login)) return;
		this.persist({ ...this.stored, active: account.user.login });
	}

	/** Keep an account (replacing the one with the same login) and make it the default. */
	private async add(account: Account) {
		this.init();
		const latest = this.latest();
		const existed = latest.accounts.some((a) => sameLogin(a.user.login, account.user.login));
		if (!existed && latest.active && this.beforeAdding)
			await this.beforeAdding(latest.active).catch(() => undefined);
		const accounts = existed
			? latest.accounts.map((a) => (sameLogin(a.user.login, account.user.login) ? account : a))
			: [...latest.accounts, account];
		this.persist({ active: account.user.login, accounts });
		this.lastAdded = { login: account.user.login, existed };
	}

	/**
	 * Check a personal access token with GitHub (or the GitHub Enterprise
	 * Server whose API is `api`) and remember it, with that server: the token
	 * is only ever sent there. Throws a friendly GitError if refused.
	 */
	async connect(token: string, api: string = GITHUB_API): Promise<GitUser> {
		const clean = token.trim();
		if (!clean) throw new GitError('auth', 'Paste a token first.');
		if (/\s/.test(clean))
			throw new GitError('auth', 'That doesn’t look like a token: it has spaces.');
		const user = await new GitHubProvider(clean, { fetch: this.fetch, api }).currentUser();
		await this.add({
			token: clean,
			user,
			connectedAt: isoTime(this.now()),
			via: 'token',
			...(api === GITHUB_API ? {} : { api })
		});
		return user;
	}

	/** Remember the tokens from "Sign in with GitHub", once GitHub says who they belong to. */
	async signInWith(tokens: TokenSet): Promise<GitUser> {
		const user = await new GitHubProvider(
			{ token: () => tokens.accessToken, access: 'app' },
			{ fetch: this.fetch }
		).currentUser();
		await this.add({
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

	/**
	 * Forget an account in this browser (the default one when no login is
	 * given). Revoke it on GitHub to disable it everywhere. Another account,
	 * if any, becomes the default.
	 */
	signOut(login?: string | null) {
		this.init();
		const latest = this.latest();
		const gone = login ?? latest.active;
		const accounts = latest.accounts.filter((a) => !sameLogin(a.user.login, gone));
		const active = sameLogin(latest.active, gone)
			? (accounts[0]?.user.login ?? null)
			: latest.active;
		this.persist({ active, accounts });
	}

	private account(login: string | null | undefined): Account {
		this.init();
		if (login) {
			const found = this.stored.accounts.find((a) => sameLogin(a.user.login, login));
			if (!found) throw missingAccount(login);
			return found;
		}
		const fallback =
			this.stored.accounts.find((a) => sameLogin(a.user.login, this.stored.active)) ??
			this.stored.accounts[0];
		if (!fallback) throw notConnected();
		return fallback;
	}

	/** The token to use now (for `login`, else the default account): a sign-in about to expire is refreshed first. */
	async token(login?: string | null): Promise<string> {
		const account = this.account(login);
		if (account.via === 'app' && needsRefresh(account, this.now()))
			return this.refresh(account.token, account.user.login);
		return account.token;
	}

	/**
	 * Refresh a sign-in, once even if several requests ask together (and,
	 * where the browser allows, once across tabs: GitHub accepts each refresh
	 * token only once). `rejected` is the token that failed or is expiring;
	 * if another tab already replaced it, that tab's token is used.
	 */
	refresh(rejected: string, login?: string | null): Promise<string> {
		const who = login ?? this.account(null).user.login;
		const key = who.toLowerCase();
		const running = this.refreshing.get(key);
		if (running) return running;
		const task = exclusively(who, async () => {
			const find = (stored: StoredAccounts) =>
				stored.accounts.find((a) => sameLogin(a.user.login, who));
			const latest = find(load()) ?? find(this.stored);
			if (!latest) throw login ? missingAccount(login) : notConnected();
			if (latest.via !== 'app') throw notConnected();
			if (latest.token !== rejected && !needsRefresh(latest, this.now())) {
				this.adopt(this.latest());
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
			const renewed: Account = {
				...latest,
				token: tokens.accessToken,
				refreshToken: tokens.refreshToken,
				expiresAt: tokens.expiresAt,
				refreshExpiresAt: tokens.refreshExpiresAt ?? latest.refreshExpiresAt ?? null
			};
			// Written over the latest accounts: another tab may have added or removed one meanwhile.
			const current = this.latest();
			const kept = current.accounts.some((a) => sameLogin(a.user.login, who));
			this.persist({
				active: current.active ?? who,
				accounts: kept
					? current.accounts.map((a) => (sameLogin(a.user.login, who) ? renewed : a))
					: [...current.accounts, renewed]
			});
			return tokens.accessToken;
		}).finally(() => this.refreshing.delete(key));
		this.refreshing.set(key, task);
		return task;
	}

	private fetchFn(): typeof fetch {
		return this.fetch ?? ((...args) => globalThis.fetch(...args));
	}

	/**
	 * The GitHub API as an account: `login` (a project's own account), else
	 * the default one. Throws when that account isn't connected.
	 */
	provider(login?: string | null): GitProvider {
		const account = this.account(login);
		const who = account.user.login;
		if (account.via === 'token')
			return new GitHubProvider(account.token, { fetch: this.fetch, api: account.api });
		return new GitHubProvider(
			{
				access: 'app',
				token: () => this.token(who),
				renew: async (rejected) => {
					try {
						return await this.refresh(rejected, who);
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

// Projects that don't yet say which account they use keep the one they used until now:
// the open one first (it saves its own record), then every other stored project.
accounts.beforeAdding = async (previous) => {
	const [{ leaving }, store] = await Promise.all([
		import('#lib/project/leaving.svelte.ts'),
		import('#lib/project/store.ts')
	]);
	await leaving.session?.git.claim(previous);
	await store.claimProjects(previous);
};
