# Validation

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

Rhythm/recital scoring, count-in, practice history and freehand note insertion/duration editing remain backlog work. Grace notes use a disclosed timing approximation. Expression/pedal/articulations are not reproduced from MusicXML. Written trailing rests are preserved for passage-loop timing. Trimming into a grace-note opening can be rejected explicitly rather than changing the rhythm silently. Older MIDI projects with attached scores retain reference-only engraving. Keep exported project backups because browser storage can be cleared.
