# Reading-score loading

The reading-score component requests OpenSheetMusicDisplay only when it has
MusicXML. An empty or MIDI-only song does not import or evaluate the engraving
module. Loading is announced with a status message and `aria-busy`; failures
retain MIDI practice and offer a Retry score button.

Each request owns a separate rendering container. OSMD 2.3.0 exposes no abort
method for `load()`, so cleanup invalidates the request and detaches its
container rather than claiming to cancel the underlying work. Late imports
cannot construct a renderer, and late loads cannot render into a newer score.
Cleanup calls the documented `dispose()` and `clear()` methods to remove
listeners and release sheet state, including a second cleanup when an already
pending load settles. Automatic resizing starts only after successful rendering.

## Production bundle comparison

Measured on 2026-11-10 against main `9e7a872bb59305d2a25c36086abb93ae256cc344`,
using `npm run build` for both versions with the same installed production
dependencies. Gzip sizes use Node's `zlib.gzipSync` on the emitted files.

| Asset | Before, bytes | After, bytes | Before gzip, bytes | After gzip, bytes |
| --- | ---: | ---: | ---: | ---: |
| Main entry JavaScript | 1,860,339 | 375,062 | 522,081 | 123,255 |
| Async OSMD chunk | Included in entry | 1,478,099 | Included in entry | 397,680 |
| Async Workbox window helper | 5,748 | 5,748 | 2,358 | 2,358 |

The main entry is 79.8% smaller, or 76.4% smaller gzipped. The generated HTML
references only the entry script and does not preload OSMD. This measures bytes,
not page-load time or device responsiveness. Vite still reports a large async
OSMD chunk.

The service worker still precaches all JavaScript, including the OSMD chunk.
It can download that chunk during installation even before a score is opened.
This change defers main-page parsing/evaluation; it does not promise to avoid the
renderer download or reduce total offline storage. Generated precache totals
were 1,840.20 KiB before and 1,833.19 KiB after. Offline operation still depends
on successful service-worker installation and is not verified by these builds.

## Automated validation and remaining checks

- `npm test`: 135 tests pass, including 15 new component/loader tests.
- `npm run build`: TypeScript and production/PWA build pass.
- Tests cover absent XML, delayed module and score loading, import/load/render
  failures and retry, changed/removed XML, stale success/failure, unmount, resize
  listener cleanup, and React Strict Mode setup/cleanup.
- Component tests use jsdom and a simulated OSMD lifecycle, not actual engraving.
- Browser engraving/layout, real chunk failure followed by reconnect/retry,
  installed PWA/offline behavior, and physical/mobile devices remain unverified.
- No private score assets are included.
