# Security Policy

SatGlobe is a local-first fork of KeepTrack. The browser runtime is designed to make no external network requests, load only the bundled catalog, and run without accounts — most classic web attack surface is intentionally absent, and the offline contract is enforced by configuration, CSP, and an end-to-end test.

## Reporting a vulnerability

Please do not report security vulnerabilities through public GitHub issues.

- **Preferred**: use GitHub's private vulnerability reporting on this repository — [Security → Report a vulnerability](https://github.com/jtn0123/SatGlobe/security/advisories/new).
- Include steps to reproduce, the potential impact, and any known mitigations.

If the issue lives in the inherited KeepTrack engine (anything outside `src/satglobe`, `configs/satglobe`, and `scripts/satglobe`), please also report it upstream to the KeepTrack maintainers at [admin@keeptrack.space](mailto:admin@keeptrack.space) so the fix can land at the source.

## What to expect

1. Acknowledgement of your report.
2. An investigation and severity assessment.
3. A fix or documented mitigation, and credit if you'd like it.

## Scope notes

- The catalog refresh pipeline (`scripts/satglobe/catalog-refresh.ts`) runs only as a manual local Node command, never in the browser.
- Saved-view JSON import is schema-validated (`.strict()` zod schemas); reports of validation bypasses are very welcome.
- The Docker image serves static files through nginx with the CSP in `configs/satglobe/nginx.conf`.
