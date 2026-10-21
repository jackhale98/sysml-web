// The demo gets a real page (p/demo.html); other projects use the SPA fallback.
export const prerender = 'auto';

export function entries() {
	return [{ project: 'demo' }];
}
