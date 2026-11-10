# AI-extension Agent Instructions

## Agent Quick Card

- **Official entry**: repository root `manifest.json` + `background-loader.js`; this is a Manifest V3 unpacked extension.
- **Build**: none. After editing, reload the unpacked extension from `chrome://extensions` or `edge://extensions`.
- **Tests**: run `node --test --test-concurrency=1 bookmarks/tests/classifier.test.js bookmarks/tests/page-inspector.test.js bookmarks/tests/worker-automation.test.js bookmarks/tests/browser-port-recovery.test.js bookmarks/tests/browser-render.test.js darkling/tests/dark-mode-regression.test.js translate/tests/page-format.e2e.test.js`.
- **Main areas**: `translate/` for translation, subtitles, summaries, settings, and model routing; `bookmarks/` for bookmark automation; `darkling/` for dark mode.
- **Generated/local**: `dist/`, `node_modules/`, browser profiles, screenshots, and test captures are not source.
- **Search skip**: `dist/`, `node_modules/`, `.git/`, and generated browser data.
- **Data boundary**: API keys and page text stay in browser storage or the configured model endpoint; never add secrets or captured user data to the repository.
- **UI verification**: reload the unpacked extension and verify the relevant extension page or injected page behavior; a unit test alone does not prove browser UI behavior.
- **Release**: bump `manifest.json`, run Tests, archive runtime entries only (`_locales/`, `background-loader.js`, `bookmarks/`, `darkling/`, `images/`, `launch.*`, `manifest.json`, `translate/`) as `AI-extension-vX.Y.Z.zip`, then create a GitHub Release with its SHA-256.

## Current boundaries

The project has no packaging step and no project-owned server. Preserve the existing permissions, model routing, bookmark preview-before-change behavior, and opt-in dark mode defaults.
