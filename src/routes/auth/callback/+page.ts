// GitHub sends people back here after signing in. A real page (auth/callback/index.html)
// at the URL registered with the GitHub App, trailing slash included, so it loads
// directly on GitHub Pages and in the installed app; it runs in the browser.
export const prerender = true;
export const trailingSlash = 'always';
