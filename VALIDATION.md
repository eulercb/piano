# Validation

## Gentle next steps after completed practice

- Final aggregate gate: all **568 tests pass** across 33 files. TypeScript and the Vite/PWA production build pass; whitespace checks pass. No dependencies or private scores were added. The existing large lazy notation chunk warning remains.
- Twenty-nine additional regressions cover explicit listening-to-melody progression, five-point speed steps and bounds, only available hand choices, slower wait-for-notes for new hand combinations, no autoplay, repeated/canceled Results panels and focus-return wiring, count-in/repeat preservation, completed loops versus unfinished attempts, seeking/restart/navigation/settings invalidation, accurate history after changed tempo, and preservation of unsaved Studio fingers, saved songs and source tempo.
- Independent review found no actionable correctness issue. Five retained adversarial tests exercise corrupt stored history, temporary-history close protection, mode/count-in/seek changes, and a 50–75% pass followed by a deliberately selected 80% step. Quota failures and a seeked partial pass are also covered in app regressions.
- Validation uses synthetic DOM, clocks, audio, modal and storage behavior plus authored CSS contracts. Actual portrait/landscape rendering, native modal focus, Android/Casio USB-C, real audio and installed/offline PWA acceptance remain unverified. No browser upload, merge or deployment was performed.
- Device acceptance when available: finish a short listening pass, open Results and choose one-hand wait-for-notes; confirm the panel closes and playback waits for Play. Finish a melody/rhythm pass, try a five-point speed change or both hands, and check displayed hand/mode/speed, count-in, touch targets and paused transport. Export private project backups before device testing.

## Landscape keyboard and falling-note geometry

- All 539 automated tests pass; TypeScript and Vite/PWA production build pass. Dependencies are unchanged. The existing large lazy notation chunk warning remains.
- White keys now tile the full shared guide width; black keys overlay white-key boundaries rather than consuming flex space. Lanes and notes use the same percentage coordinates in Practice and Studio. Accidental range endpoints expand to adjacent white keys without exceeding MIDI 0–127. Black-key hit targets remain above white-key focus indicators.
- Practice fills the horizontal safe area without extra guide gutters. The existing portrait/short-landscape grid and transport budgets remain. Note onset is at the roll/keyboard seam, and note travel and duration use the same responsive-height scale, with an 8px minimum visual height for very short notes.
- Twenty-six new deterministic regressions cover contiguous white keys, accidentals and full-range endpoints, several surface sizes, onset/duration scaling, focused-key stacking, safe-area/CSS contracts, shared real-App geometry across Practice/Studio/score toggles, and audio-start/onset wiring at 50% and 100% speed. Pause/resume, restart, seeking and wrong/correct melody inputs retain the same boundary.
- Independent review passed. Five retained adversarial regressions cover all 8,256 inclusive MIDI ranges, full-range hand changes, and onset crossings at 25%, 75% and 125% speed.
- These are coordinate, authored-style and synthetic DOM/audio tests, not rendered-browser, Android/Casio, audio-latency or installed-PWA validation. No browser uploads, mobile emulation, publication or deployment were performed. On-device acceptance remains: check portrait/landscape rotation, safe-area edges, contiguous white keys and overlaid accidentals, notes touching the keyboard when sound starts, and the always-visible transport. Test both with and without browser bars after exporting project backups.

## Browser audio interruption safety

- Final integrated gate: all 508 tests pass, TypeScript/Vite/PWA build passes and diff checks are clean. Independent review passed after fixing pending-start tempo changes; five additional adversarial cases are retained.
- Input highlight timers are owned per pitch and canceled on unmount; repeated notes keep their newest highlight. Save tests await the actual close-guard effect. The prior unmount-timer and save-effect timing failures are addressed by this lifecycle fix; three regressions and 20 focused repetitions passed.
- The audio-only intermediate branch had a known save-effect assertion failure; the final integrated full run passed cleanly. Existing large lazy notation chunk warning remains.

- Thirty-nine real-App synthetic regressions cover visible audio suspension/interruption/closure, queued frames and input before statechange, partial count-ins/chords and prior grades, running-state-only Play, rejected/thrown/still-suspended resume, cancelable pending starts, stale attempts, Studio tempo changes during pending starts, navigation/settings/visibility/unmount, muted fallback, MIDI loss during audio start, and preserved saved history and dirty Studio drafts.
- Audio voices never queue on a stopped audio clock. Per-App context ownership removes state listeners, stops voices and closes audio on unmount. Existing audio doubles now explicitly model running state and statechange listeners.
- These checks use controlled AudioContext, animation, MIDI and storage; they do not establish browser audio quality, rendered layout, Android/Casio hardware or installed-PWA behavior. No browser upload, publication or deployment is included.

## Combined focused-practice reliability

- Final combined gate: all 466 tests pass, TypeScript/Vite/PWA build passes, and diff checks are clean. Independent MIDI and score-following reviews found no remaining actionable issues.
- Four retained adversarial MIDI tests cover partial chords in both modes, replaced same-ID inputs with delayed/repeated loss, and replug after deliberate touch resume.
- Seven dynamic-geometry score regressions ensure oversized cursors stay anchored on both axes without oscillation, while preserving manual scrolling, loop/system transitions, reveal and exact-fit behavior. These are not Android rendering checks.
- Earlier concurrent lane runs encountered one storage-effect timing assertion and one post-teardown keyboard timer error. Clean lane reruns and the final combined run passed; the storage assertion also passed 20 repeated probes. No persistent production defect was established by those transient failures.
- Browser upload approval and physical Android/Casio acceptance remain pending. No new-branch browser visual or hardware validation is claimed.

## MIDI connection-loss pause

- All 455 automated tests pass; TypeScript and Vite/PWA production build pass. Dependencies are unchanged. The existing lazy notation chunk remains large (about 398 KiB gzip).
- Ten additional real-App regressions cover immediate rhythm pause despite an already-queued frame, silenced audio, retained grades and partial Melody/Rhythm count-ins, delayed reopen, closed/pending ports, failed reconnect, deliberate input switching, explicit touch/typing fallback, unchanged listening, and saved songs/history plus a dirty Studio draft. The existing unplug/replug melody test now checks no automatic resume and no note grading while paused.
- Two additional controller regressions cover a previously open port entering pending and clearing an unplugged input without automatically selecting it on return. Existing failed-close/reopen and stale-event tests still pass. A stylesheet regression checks wrapping recovery text and the touch-sized action inside the bounded notice area; this is not rendered mobile verification.
- Permission, MIDI ports, audio, clock and dialogs are synthetic. No browser upload, hardware connection, mobile emulation, publication or deployment was performed for this change. Real Android/Casio USB-C behavior, native modal/screen-reader behavior and rendered narrow-screen layout remain unverified.
- Device acceptance when available: start Melody/Rhythm (including a count-in), unplug the selected Casio and check immediate pause, visible guidance and no accumulated misses. Replug and check that only the same selected ID reconnects and that playback waits for Play. Try another-device unplug, input-open failure, explicit touch/typing selection and Listen mode; confirm Studio edits and saved history remain intact. Export private project backups before testing.

## Library and Studio data safety

- Five additional real-app synthetic MIDI tests cover delayed permission, cancellation/retry, selected-device unplug/replug, stale events, repeated panels/reconnect and error recovery. No production MIDI changes were needed; physical hardware remains untested.
- Live desktop Chromium smoke of merged #15 verified the app-update prompt, focused guide, right-hand wrong/correct-note waiting, setup pause/focus and retained history. This does not validate the new data-safety code or Android/Casio.

- All 442 automated tests pass; TypeScript and Vite/PWA production build pass. Dependencies are unchanged. The existing lazy notation chunk remains large (about 398 KiB gzip).
- Thirty new synthetic regressions cover stale-tab saves, same-piece conflicts, corrupt/ambiguous storage preservation, quota/lock failures, storage-event refresh, delayed file/folder imports, canceled replacement, batch-import stopping, pending saves and edits, dirty trimming, built-in demo copies, and temporary-history reload/close protection.
- Existing real parser/import/edit/trim/save/reload/export integration tests still pass. The dirty trim path now explicitly confirms replacing the full-piece draft. Independent review prompted additional regressions for reopened drafts during pending saves, saved-demo identity, and playback reset on demo-copy saves.
- These are automated storage and DOM checks, with file readers, browser dialogs, Web Locks, animation/audio and download dispatch simulated where needed. Native browser close/confirmation behavior, simultaneous real tabs, actual browser file upload, Android/Casio MIDI and installed-PWA behavior are not device-verified by this change. No private music, publication or deployment is included.

## Focused mounted-phone practice

- All 407 automated tests pass; TypeScript and Vite/PWA production build pass. The existing lazy notation chunk remains large (about 398 KiB gzip). Dependencies are unchanged.
- Practice now owns one dynamic viewport with safe-area padding, persistent transport, compact setup summary, proportional falling notes, a replacement score view, finger-hint toggle and on-demand Setup/Results/Piano panels. Studio, Library and History remain separate.
- Synthetic DOM tests cover repeated panel open/close and cancellation, focus-return wiring, pause/resume without losing position, score mounting/unmounting, missing-score explanation, finger toggles, wait-for-note melody, retained mode/hand/speed and a single persistent MIDI component across navigation. Native modal focus trapping and Android Back behavior are not simulated by those tests.
- A real parser/import/edit/session integration test imports synthetic compressed MusicXML, edits pitch and finger, enters the focused room, shows its compact score, checks wrong/correct melody input and returns to Studio with the edits intact. Engraving drawing/audio/clock are test doubles; private user files are not used.
- Authored CSS tests check dynamic viewport sizing, safe-area insets, contained score/dialog scrolling, 44px transport targets and a source-derived 568×320 landscape height budget with bounded notices. These are not browser layout measurements.
- Independent review identified and addressed an unnamed landscape score toggle, modal demo-key shortcuts and narrow-landscape guide starvation. Actual rendered portrait/landscape, browser text zoom, screen-reader/native-modal behavior, Android Chrome installed-PWA and Casio USB MIDI remain unverified. No publication or deployment is included in this worktree.


## End-to-end usability gate

- Six permanent synthetic app tests cover real MusicXML and compressed .mxl import, finger edits, measure trimming with the original preserved, save/reload, project export/reimport, count-in, selected-hand melody/rhythm and rejected-import data preservation. Engraving/audio/animation/download dispatch are simulated; this is not browser or Casio verification.
- Keyboard/assistive clicks activate piano keys without duplicate pointer notes. Browser modifier shortcuts and editable fields are preserved; current page/hand/mode/speed states are exposed to assistive technology.
- Contrast, focus, general touch targets and narrow-screen CSS have regression checks. Actual mobile rendering remains unverified. Piano keys retain their narrow musical geometry; reduced motion does not suppress pedagogical falling notes.
- Live merged #14 demo playback recorded a correctly labeled listening pass and retained it after reload. Actual browser file import/score editing/cursor remains blocked on pending upload approval; physical Android/Casio testing remains outstanding.


## Combined practice, import and reading tools

- All 351 automated tests pass, including folder rejection reporting; TypeScript/Vite/PWA build passes. Production dependency audit: zero vulnerabilities. CI runs the full test suite and build for PRs.

- Parallel lanes were independently reviewed, including fixes for stale-tab history writes, invalid completion metadata, malformed DEFLATE streams, and OSMD cursor replacement during resize.
- Synthetic tests cover strict compressed MusicXML import, app/folder import wiring, completed-pass history and persistence, and the real installed OSMD iterator. These do not replace rendered browser validation.
- No private scores are bundled or uploaded. Browser upload approval remains pending. Actual Android/Casio USB MIDI, mobile engraving and new UI visual checks remain unverified.
- A desktop live-site update from the earlier cached app to merged #13 showed the explicit update prompt and preserved library entries and a saved fingering. This verifies that deployed update cycle, not the new branch UI.


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

Recital scoring, latency calibration and freehand note insertion/duration editing remain backlog work. Rhythm feedback assesses pitch/onset only, with fixed real-time beginner windows; it does not grade holds, releases, pedal or expression. Grace notes use a disclosed timing approximation. Expression/pedal/articulations are not reproduced from MusicXML. Written trailing rests are preserved for passage-loop timing. Trimming into a grace-note opening can be rejected explicitly rather than changing the rhythm silently. Older MIDI projects with attached scores retain reference-only engraving. Keep exported project backups because browser storage can be cleared.
