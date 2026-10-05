# Vercel deployment

Import [michaelcrosato/g-zero](https://github.com/michaelcrosato/g-zero) into Vercel with the repository root as the project root. `vercel.json` supplies the build and output settings; no environment variables, npm packages, or server functions are required.

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Root directory | Repository root |
| Node.js | 24.x |
| Install command | Empty; skip installation |
| Build command | `npm run check && npm run build` |
| Output directory | `dist` |
| Production branch | `main` |

Once connected through Vercel's GitHub integration, pushes to `main` produce production deployments and other branches produce previews. The repository's verification workflow runs independently on GitHub.

## Hosted output

`dist/index.html` is the web entry. Its five engine and game payloads live under `/assets/`, with SHA-256-derived filenames. Unchanged files retain their URLs across builds. These files receive `Cache-Control: public, max-age=31536000, immutable`. HTML and `/build-info.json` receive `public, max-age=0, must-revalidate`, so visits pick up the latest asset references.

The entry is approximately 91 KB, compared with the complete offline file's 3.6 MB, before transport compression. The first visit still downloads all required engine data. Subsequent visits can reuse cached assets, and game changes do not invalidate unchanged engine files.

The build verifies the vendor SHA-256 values before creating artifacts. Startup fetches only same-origin hashed URLs and validates the payload versions and checksums before importing modules. A failed request shows `PKG-NET`; damaged bytes show `PKG-HASH`. The hosted CSP permits same-origin asset connections and keeps the existing Blob module and WebAssembly allowances. Offline HTML continues to use `connect-src 'none'`.

Only `dist/` is served. Source files, tests, the source ZIP, development server, and repository metadata are outside the public output. `/g-zero.html` is the complete standalone offline file. Save that file for offline use; saving the hosted entry alone is insufficient. All game and engine licenses remain embedded in both versions.

## Local verification

```sh
nvm use
npm run check
npm run build
npm run preview
```

Open `http://localhost:5173`. The preview serves `dist/` and applies the production cache and response headers. `PORT` changes the local port.

The optional browser smoke test uses an installed Chromium browser and Python Playwright through uv:

```sh
# Keep the preview running in another terminal.
uv run --with playwright python tests/browser_smoke.py \
  --chromium /usr/bin/google-chrome --url http://localhost:5173 \
  --output test-results/hosted

uv run --with playwright python tests/browser_smoke.py \
  --chromium /usr/bin/google-chrome --output test-results/offline
```

The browser checks boot stages, engine versions, the first frame, 101 racers, physics, magnetic lock, diagnostics, restart, mobile overflow, uncaught errors, and external requests. Graphics checks use Chromium's software WebGL2 renderer; they do not establish native GPU performance or coverage of all browsers.

Verification performed on 2026-10-04 with Node.js 24.21.0:

| Check | Result |
| --- | --- |
| Deterministic offline build and Node tests | 88 passed |
| Hosted HTTP build, software WebGL2 | 27 browser checks passed |
| Standalone `file://` HTML, network disabled | 27 browser checks passed |
| Uncaught browser errors and external requests | None in either browser run |
| Current official Vercel configuration schema | Valid |
| Public entry, download, manifest, and five assets | HTTP 200 with intended response headers |
| Source, vendor source paths, package metadata, ZIP | HTTP 404 in the hosted preview |

This evidence verifies the local production artifact and configuration. A live Vercel deployment has not been created as part of preparing this repository.

## Source archive

Imported from `g-zero-source.zip` on 2026-10-04. The archive is retained locally and ignored by Git and the Vercel upload. Its SHA-256 is:

```text
8ad626a7ab8bb8774580b566128cc79ee11f7803d94b22541225c788d0d18df9
```

## References

- [Vercel static configuration](https://vercel.com/docs/project-configuration/vercel-json)
- [Cache-Control on Vercel](https://vercel.com/docs/caching/cache-control-headers)
- [Vercel Git integration](https://vercel.com/docs/git)
