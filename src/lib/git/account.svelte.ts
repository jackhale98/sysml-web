/**
 * The GitHub account this browser is connected to: a personal access token,
 * kept only in this browser's local storage and sent only to GitHub.
 */
import { GitHubProvider } from './github.ts';
import type { GitProvider, GitUser } from './types.ts';
import { GitError } from './errors.ts';

const KEY = 'sysml-web:github';

interface StoredAccount {
	token: string;
	user: GitUser;
	connectedAt: string;
}

function read(): StoredAccount | null {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as StoredAccount;
		return parsed?.token && parsed.user?.login ? parsed : null;
	} catch {
		return null;
	}
}

class Accounts {
	/** The connected GitHub account (without the token). */
	github = $state.raw<{ user: GitUser; connectedAt: string } | null>(null);
	private token: string | null = null;
	private loaded = false;
	/** Swappable for tests. */
	fetch: typeof fetch | undefined;

	/** Read the stored account (once). */
	init() {
		if (this.loaded || typeof localStorage === 'undefined') return;
		this.loaded = true;
		const stored = read();
		if (stored) {
			this.token = stored.token;
			this.github = { user: stored.user, connectedAt: stored.connectedAt };
		}
	}

	get connected(): boolean {
		this.init();
		return this.github !== null;
	}

	/** Check the token with GitHub and remember it. Throws a friendly GitError if refused. */
	async connect(token: string): Promise<GitUser> {
		const clean = token.trim();
		if (!clean) throw new GitError('auth', 'Paste a token first.');
		if (/\s/.test(clean))
			throw new GitError('auth', 'That doesn’t look like a token: it has spaces.');
		const user = await new GitHubProvider(clean, { fetch: this.fetch }).currentUser();
		const account: StoredAccount = { token: clean, user, connectedAt: new Date().toISOString() };
		try {
			localStorage.setItem(KEY, JSON.stringify(account));
		} catch {
			// Private mode: connected for this visit only.
		}
		this.loaded = true;
		this.token = clean;
		this.github = { user, connectedAt: account.connectedAt };
		return user;
	}

	/** Forget the token in this browser. (Revoke it on GitHub to disable it everywhere.) */
	signOut() {
		try {
			localStorage.removeItem(KEY);
		} catch {
			// Nothing stored.
		}
		this.token = null;
		this.github = null;
	}

	/** The GitHub API as the connected account; throws when not connected. */
	provider(): GitProvider {
		this.init();
		if (!this.token)
			throw new GitError('auth', 'Connect your GitHub account first (Settings → Accounts).');
		return new GitHubProvider(this.token, { fetch: this.fetch });
	}
}

export const accounts = new Accounts();
