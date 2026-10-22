/**
 * The SysML v2 API servers this browser connects to, like the GitHub
 * accounts: kept only in this browser's local storage, and each token sent
 * only to its own server. Also which server project a local project was
 * opened from or saved to, so "Save to server" offers it again.
 */
import { LOCAL_KEY_PREFIX } from '#lib/project/store.ts';

export const SERVERS_KEY = `${LOCAL_KEY_PREFIX}api-servers`;
export const LINKS_KEY = `${LOCAL_KEY_PREFIX}api-links`;

export interface ServerConnection {
	/** The API's base URL (normalized). */
	url: string;
	/** A bearer token, if the server wants one. Never shown, never sent elsewhere. */
	token: string | null;
	addedAt: string;
	usedAt: string;
}

/** Where on a server a local project lives. */
export interface ServerLink {
	url: string;
	project: { id: string; name: string };
	branch: { id: string; name: string } | null;
	/** The commit last opened or saved. */
	commit: string | null;
	at: string;
}

function read<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

function write(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Storage full or blocked: the connection lasts for this visit.
	}
}

class ApiServers {
	list = $state<ServerConnection[]>([]);
	#loaded = false;

	init() {
		if (this.#loaded || typeof localStorage === 'undefined') return;
		this.#loaded = true;
		const stored = read<ServerConnection[]>(SERVERS_KEY, []);
		this.list = Array.isArray(stored) ? stored.filter((s) => typeof s?.url === 'string') : [];
	}

	/** Keep a connection (or refresh it), most recently used first. */
	remember(url: string, token: string | null) {
		this.init();
		const now = new Date().toISOString();
		const existing = this.list.find((s) => s.url === url);
		const entry: ServerConnection = {
			url,
			token: token || null,
			addedAt: existing?.addedAt ?? now,
			usedAt: now
		};
		this.list = [entry, ...this.list.filter((s) => s.url !== url)];
		write(SERVERS_KEY, this.list);
	}

	forget(url: string) {
		this.init();
		this.list = this.list.filter((s) => s.url !== url);
		write(SERVERS_KEY, this.list);
		const links = read<Record<string, ServerLink>>(LINKS_KEY, {});
		for (const [project, link] of Object.entries(links))
			if (link.url === url) delete links[project];
		write(LINKS_KEY, links);
	}

	get(url: string): ServerConnection | undefined {
		this.init();
		return this.list.find((s) => s.url === url);
	}

	linkOf(projectId: string): ServerLink | null {
		return read<Record<string, ServerLink>>(LINKS_KEY, {})[projectId] ?? null;
	}

	setLink(projectId: string, link: ServerLink) {
		const links = read<Record<string, ServerLink>>(LINKS_KEY, {});
		links[projectId] = link;
		write(LINKS_KEY, links);
	}
}

export const apiServers = new ApiServers();
