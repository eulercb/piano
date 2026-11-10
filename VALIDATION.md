# Validation

## MIDI input selection slice

- All 160 automated tests pass (120 existing plus 40 synthetic MIDI regressions); TypeScript and Vite/PWA production build pass. Dependencies and package files are unchanged.
- Coverage: click-only access with sysex disabled, sole-input selection, explicit choice with several inputs, selected-input-only note delivery, velocity-zero/note-off filtering, empty/denied/unavailable/error states, repeated clicks, cancellation/disposal with pending permission requests, stale events, selection changes, and hotplug with a retained or replaced port object.
- Delayed port opens/closes are tested across cancellation, reconnect and rapid A → B → A selection. Independent review found an asynchronous close/reopen race; per-port operation serialization and three deferred-close regressions address it. Re-review passed with no remaining actionable findings.
- Connection status and labelled native input selection are separate from the non-live last-note/activity display. Controls are touch-sized and the indicator respects reduced-motion preferences. These are implementation checks, not rendered accessibility or mobile layout verification.
- No browser MIDI permission or physical hardware was used in tests. Android Chrome/Casio USB-C behavior, actual permission dialogs, rendered layout/screen readers and audio latency remain unverified. No publication or deployment is included.
- Hardware acceptance when available: connect a powered Casio using USB-C/OTG on HTTPS Chrome; choose the correct input and check activity; verify another input cannot advance melody/rhythm; unplug/replug the chosen piano; cancel/retry permission and reconnect repeatedly; confirm touch keys still work after disconnect. Export private project backups before device testing.
- The existing notation bundle warning remains (~524 KiB gzip on this base); score loading optimization belongs to a separate change.

## Beginner rhythm and count-in slice

- All 120 automated tests pass (the prior 82 plus 38 synthetic transport/rhythm regressions); TypeScript and Vite/PWA production build pass. Existing CI still runs the complete `npm test` suite and `npm run build` on every PR.
- Coverage: optional four-beat count-in at selected speed, early/on-time/late/missed/extra feedback, hand filtering, chords/doubled unisons, nearest repeated pitches, pause/resume, seek/restart, final-note late windows, count-in/pass resets, previous-pass summaries, preserved trailing rests, melody/listen behavior, scheduling interruptions, and mixed RAF/input timestamp ordering.
- Independent code review found two transport edges (a final late-window resume and regressing mixed timestamps). Both were fixed, regression-tested, and re-reviewed with no remaining findings.
- The PWA update banner uses the plugin’s explicit update hook, warns about unsaved edits, and reloads only after the user clicks. Browser/service-worker update lifecycle is not verified.
- Browser interaction, rendered layout, audio timing/quality, physical Casio/Android MIDI, and installed/offline PWA behavior remain unverified. The managed browser is blocked; automated state-machine tests are not browser or hardware validation.
- The existing notation bundle warning remains (~522 KiB gzip). No deployment is included in this slice.

## Score-linked Studio slice

- 82 automated tests pass; TypeScript and Vite production build pass.
- Synthetic coverage includes MusicXML voices/chords/ties, tempo inheritance, malformed/unsupported scores, source-linked fingering/pitch edits, namespace-aware measure trimming, project round-trip and melody matching.
- Private reference comparison matched 270 notes and 216 printed fingers against the corrected MIDI, with only MIDI tempo-rounding differences. No private score is shipped.
- Browser interaction and engraving QA of this new slice remain unverified: the managed browser cannot reach the local build server. Automated parser tests are not browser validation.
- Build warns about the large notation bundle (~518 KiB gzip); optimization remains pending.

## Deployed first slice

- First-slice 37 tests and production build passed before PR #9 merged.
- HTTPS Pages deployment confirmed. Independent desktop Chromium smoke passed playback/pause/restart, wrong/correct melody-note behavior, saving/reloading a finger, and project export.
- Physical Casio/Android MIDI, mobile layout, installed PWA/offline refresh, folder persistence and audio quality remain untested. Mobile emulation was unavailable.

## Remaining scope

Recital scoring, saved practice history, latency calibration and freehand note insertion/duration editing remain backlog work. Rhythm feedback assesses pitch/onset only, with fixed real-time beginner windows; it does not grade holds, releases, pedal or expression. Grace notes use a disclosed timing approximation. Expression/pedal/articulations are not reproduced from MusicXML. Written trailing rests are preserved for passage-loop timing. Trimming into a grace-note opening can be rejected explicitly rather than changing the rhythm silently. Older MIDI projects with attached scores retain reference-only engraving. Keep exported project backups because browser storage can be cleared.
