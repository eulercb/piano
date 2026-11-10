# First-slice validation

- TypeScript and Vite production build: passed.
- Vitest: 37 core/parser/project-validation tests passed.
- Production dependency audit: zero reported vulnerabilities at initial check.
- Independent code review found and fixed: invalid/unsorted project notes, suppressed finger labels on wider keyboards, stale-song MusicXML attachment, audio continuing after pause/reset, and selected-hand listen filtering.
- Corrected private Valsa project: 270 notes, 216 printed fingers, untouched MusicXML. Kept outside repository; not shipped or bound to app.
- Browser visual/interactive QA: blocked. This cloud browser cannot connect to the executor's local HTTP servers; no screenshot or browser pass claimed.
- Physical Casio/Android MIDI, installed PWA/offline refresh, real folder permission persistence and production Pages deployment: not yet tested.

Remaining first-release blockers include real-browser/device verification and synchronized notation editing. Current MusicXML is explicitly a source reference; playback edits do not rewrite engraving. Rhythm/recital scoring and long-term practice history remain backlog items.
