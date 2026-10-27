/// Tessera sign-in worker — stateless, no storage, no logging.
///
/// "Sign in with GitHub" ends with the browser holding a one-time code. Trading
/// it for tokens needs the GitHub App's client secret, which the browser must
/// never hold, so the app sends the code here; the worker adds the secret, asks
/// GitHub, and returns GitHub's answer unchanged. Refreshing an expired token
/// works the same way. Nothing else is served: the app talks to the GitHub API
/// directly.
///
///   POST /oauth/github/token   { code, code_verifier, redirect_uri }
///   POST /oauth/github/refresh { refresh_token }
///
/// Only requests from ALLOWED_ORIGINS are answered.

export interface Env {
	/** Comma-separated origins allowed to use the worker, e.g. `https://you.github.io`. */
	ALLOWED_ORIGINS: string;
	/** The GitHub App's client ID (a secret here only so both values live in one place). */
	GITHUB_CLIENT_ID?: string;
	/** The GitHub App's client secret. */
	GITHUB_CLIENT_SECRET?: string;
}

const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
/** Sign-in requests are a few hundred bytes; refuse anything much larger. */
const MAX_BODY = 16 * 1024;

function list(value: string | undefined): string[] {
	return (value ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

function cors(origin: string, extra: Record<string, string> = {}): Headers {
	return new Headers({
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Accept',
		'Access-Control-Max-Age': '86400',
		Vary: 'Origin',
		'Cache-Control': 'no-store',
		...extra
	});
}

const deny = (status: number, message: string, origin?: string) =>
	new Response(message, {
		status,
		headers: origin
			? cors(origin, { 'Content-Type': 'text/plain' })
			: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
	});

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const origin = request.headers.get('Origin');
		if (!origin || !list(env.ALLOWED_ORIGINS).includes(origin))
			return deny(403, 'Origin not allowed');
		if (request.method === 'OPTIONS')
			return new Response(null, { status: 204, headers: cors(origin) });
		if (url.pathname.startsWith('/oauth/')) return oauth(request, env, url, origin);
		return deny(404, 'Not found', origin);
	}
} satisfies { fetch(request: Request, env: Env): Promise<Response> };

async function oauth(request: Request, env: Env, url: URL, origin: string): Promise<Response> {
	const [, , provider, action, ...rest] = url.pathname.split('/');
	if (
		provider !== 'github' ||
		(action !== 'token' && action !== 'refresh') ||
		rest.length ||
		request.method !== 'POST'
	)
		return deny(404, 'Unknown OAuth endpoint', origin);

	const clientId = env.GITHUB_CLIENT_ID;
	const secret = env.GITHUB_CLIENT_SECRET;
	if (!clientId || !secret) {
		// Name what's missing (never the values) so a misplaced setting is easy to spot.
		const missing = [!clientId && 'GITHUB_CLIENT_ID', !secret && 'GITHUB_CLIENT_SECRET'].filter(
			Boolean
		);
		return deny(
			501,
			`github sign-in is not configured on this worker (missing at runtime: ${missing.join(', ')})`,
			origin
		);
	}

	if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY)
		return deny(413, 'Request too large', origin);
	let input: Record<string, unknown>;
	try {
		const text = await request.text();
		if (text.length > MAX_BODY) return deny(413, 'Request too large', origin);
		input = JSON.parse(text) as Record<string, unknown>;
		if (!input || typeof input !== 'object') throw new Error('not an object');
	} catch {
		return deny(400, 'Expected a JSON body', origin);
	}
	const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined);

	const form = new URLSearchParams();
	if (action === 'token') {
		const code = str('code');
		if (!code) return deny(400, 'Missing code', origin);
		form.set('grant_type', 'authorization_code');
		form.set('code', code);
		if (str('redirect_uri')) form.set('redirect_uri', str('redirect_uri')!);
		if (str('code_verifier')) form.set('code_verifier', str('code_verifier')!);
	} else {
		const refresh = str('refresh_token');
		if (!refresh) return deny(400, 'Missing refresh_token', origin);
		form.set('grant_type', 'refresh_token');
		form.set('refresh_token', refresh);
	}
	form.set('client_id', clientId);
	form.set('client_secret', secret);

	let upstream: Response;
	try {
		upstream = await fetch(GITHUB_TOKEN_URL, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/x-www-form-urlencoded',
				'User-Agent': 'sysml-web-sync'
			},
			body: form
		});
	} catch {
		return deny(502, 'Could not reach GitHub', origin);
	}
	return new Response(upstream.body, {
		status: upstream.status,
		headers: cors(origin, {
			'Content-Type': upstream.headers.get('content-type') ?? 'application/json'
		})
	});
}
