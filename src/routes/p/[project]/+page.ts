// The demo gets a real page (p/demo.html); other projects use the SPA fallback.
export const prerender = 'auto';
// Rendered on the server (only ever at build time, for the demo) the page is a
// splash with the project's name, so phones paint at once; the workbench
// replaces it in the browser.
export const ssr = true;

export function entries() {
	return [{ project: 'demo' }];
}
