# Offline artifact audit (2026-11-11)

Scope: runtime sources at `d36e48b`, built with the existing lockfile; this change
only strengthens the release gate. No PWA runtime defect was confirmed, and no
real offline/install acceptance is claimed.

## What the build establishes

- The emitted manifest has `start_url: "/"`, `scope: "/"`, and
  `display: "standalone"`. The HTML links `/manifest.webmanifest`; both PNG icons
  exist with the advertised 192×192 and 512×512 dimensions. These are actual
  generated defaults, not assumptions from the abbreviated Vite configuration.
- This is a custom-domain root deployment (`piano.zen.dev.br`). It is not a
  supported `/piano/` subdirectory build. Changing deployment base requires
  coordinating manifest, icon, HTML, worker registration and fallback paths.
- Workbox emits 14 precache entries representing 12 distinct app files (the
  icons appear twice). They include initial JS/CSS, the registration client,
  lazy notation renderer, lazy authoring JS/CSS, score importer, HTML, icons and
  manifest. The reported precache size is 1994.51 KiB. The existing large notation
  chunk warning remains; it is below Workbox's current precache size limit.
- The worker registers an index.html navigation fallback, calls old-cache
  cleanup, and waits for a `SKIP_WAITING` message rather than invoking activation
  immediately or claiming existing pages automatically. Unknown/empty messages
  do not activate it. App code warns before requesting reload of dirty song or
  temporary history state, pauses playback and surfaces registration errors.
- There are no generated runtime data-cache routes or custom fetch handlers.
  User projects/imported score data are not precache entries. Local library and
  history persistence are separate from Workbox's app-shell cache. This is an
  artifact boundary check, not an audit of the contents of every emitted asset.

## Confirmed release-gate gaps and changes

The former checker accepted a synthetic `saved-song.json` precache entry and an
additional `registerRoute({})` call. The strengthened checker rejects those same
mutations. It now restricts entries to canonical relative app-shell paths and
rejects unexpected runtime routes, fetch handlers, root manifest/icon linkage,
activation changes and missing cleanup. Intentional changes to asset types or
routing must update this deliberately narrow deployment contract.

One production TypeScript/Vite build passed. All **23** artifact contracts passed,
including the original seven. This does not execute the real Workbox runtime in
a browser; its entry points are observed in a Node VM. No new dependencies or
runtime changes were made. The full app test suite was not rerun for this
scripts/documentation-only slice.

## What still needs real-browser acceptance

- **Install affordance:** valid manifest/icons are necessary artifact evidence,
  not proof of install eligibility. The missing install menu in the available
  browser does not distinguish browser policy/platform restrictions from served
  content, MIME/TLS, registration or engagement issues. No code/config defect
  explaining it was established. Check the deployed manifest and worker on an
  authorized install-capable browser and record browser/version and policy.
- **Cold versus warm offline:** an uncached first offline visit cannot work.
  After a completed online installation, verify worker control, close/reopen
  offline, navigation fallback and saved data. Open Studio, import an original
  score and open notation for the first time *after going offline*, rather than
  warming all lazy modules online first. Repeat installed Android launch.
- **Updates/stale versions:** verify two actual releases, cancel/accept with
  dirty work and temporary history, completed saved history, old-cache cleanup,
  and a second tab with a dirty draft. Gate assertions about cleanup and consent
  do not establish cross-tab behavior or persistence under quota/eviction.
- **Failed lazy fetch:** code retries imports without retaining a rejected
  application promise. Existing mock-based tests cover the recovery UI, not the
  browser module map/HTTP cache. Exercise an interrupted first download and retry
  without losing edits; also test an older open page during deployment.
- **Harness limits:** `scripts/browser-release.py` is optional and remains
  unrun here. It warms Studio before its offline reload, changes worker response
  bytes rather than real app chunks, and does not establish installation,
  never-opened lazy features offline, two-tab updates, or Android behavior.

This audit used build artifacts and automated tests. It did not perform real-browser
offline/install or storage-eviction testing, or process private scores. These artifact
checks do not replace the outstanding browser checks in
[the release checklist](release-checklist.md).
