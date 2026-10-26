# Fairtide sign-in worker

A stateless Cloudflare Worker that completes **Sign in with GitHub** for
Fairtide. The app talks to the GitHub API directly from the browser; it needs
this worker only to trade a one-time sign-in code (or a refresh token) for tokens,
because that takes the GitHub App's client secret, which the browser must
never hold. The worker adds the secret, asks GitHub, and returns GitHub's
answer unchanged.

- `POST /oauth/github/token` with `{ code, code_verifier, redirect_uri }`
- `POST /oauth/github/refresh` with `{ refresh_token }`

Only requests from `ALLOWED_ORIGINS` (in `wrangler.jsonc`) are answered, with
CORS headers for them. Anything else gets 403 "Origin not allowed" or 404.
Without its secrets it answers 501 "github sign-in is not configured on this
worker (missing at runtime: …)", naming what's missing (never the values).

It has no storage bindings and logging is disabled. Tokens pass through in
memory for the duration of a request and are never written anywhere.

## Deploy

The worker talks to github.com only; GitHub Enterprise Server users connect
with an access token instead (Settings → Accounts in the app; see the
walkthrough's last section).

Full walkthrough, including registering the GitHub App and setting the site's
build variables: [docs/setup-github-sign-in.md](../docs/setup-github-sign-in.md).

In short: in the Cloudflare dashboard, **Workers & Pages → Create application
→ Import a repository**, pick this repository, name the project
`sysml-web-sync`, set the root directory to `worker`, the deploy command to
`npx wrangler@4 deploy` and the build watch path to `worker/*`. Or with
Wrangler, from this folder:

```sh
npx wrangler login
npx wrangler deploy
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

To deploy from GitHub Actions instead, add a `CLOUDFLARE_API_TOKEN` repository
secret (token template "Edit Cloudflare Workers") and run the **Deploy
worker** workflow.

## Develop

```sh
npm test            # from the repository root also runs these tests (npm test)
npx wrangler dev    # local worker on http://localhost:8787
```
