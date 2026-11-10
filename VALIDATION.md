# Validation

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
