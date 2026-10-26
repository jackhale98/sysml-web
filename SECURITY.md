# Security

## Reporting a problem

Please report security problems privately, not in a public issue: use
**Report a vulnerability** on the repository's Security tab (GitHub's private
vulnerability reporting). Say what you found, how to reproduce it, and which
copy of Fairtide you used: the version, commit and build date are in Settings →
About.

You can expect an acknowledgement within a week, and a fix or a plan in the
release notes ([CHANGELOG.md](CHANGELOG.md)) once it is understood. Please
give us a reasonable time to fix it before telling others.

## Supported versions

Fixes go into the latest release and the site built from `main`. Older
releases are not patched; self-hosted copies should update to the latest
release.

## What Fairtide does to keep you safe

- **No server of its own.** Projects stay in your browser until you save them
  to GitHub, a folder or a file; nothing is sent anywhere else, and there is
  no telemetry.
- **GitHub tokens** stay in your browser and are sent to GitHub's API; with
  "Sign in with GitHub", the sign-in worker (`worker/`) trades the sign-in code
  or refresh token for them and stores nothing.
- **Model text is never run as code.** Names and documentation are escaped
  wherever they reach HTML, SVG or Markdown, and the site sets a
  Content-Security-Policy (`src/app.html`) that loads scripts only from the
  site itself, refuses evaluating strings as code, and allows no plugins.
- **Dependencies** are locked (`package-lock.json`, the engine by SHA-256 in
  `toolkit.json`), updated weekly by Dependabot, and CI fails on a high or
  critical advisory in any package the site ships
  (`scripts/audit-shipped.mjs`).
