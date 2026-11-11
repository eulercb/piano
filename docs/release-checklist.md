# Release checks and support boundaries

This checklist distinguishes implemented behavior, automated evidence and actual
acceptance. An issue is not device-accepted merely because its unit tests pass.
Use only the original **Morning Light** demo or purpose-written fixtures for
public QA artifacts. Never publish private scores, MIDI, recordings or projects.

## Repeatable local gates

1. Use Node 22+ and the locked dependencies: `npm ci`.
2. Run `npm test` and `npm run build`.
3. Run `npm run check:release` **after the build**. CI runs this gate before
   uploading a Pages artifact. It checks the emitted manifest, real PNG sizes,
   root custom-domain deployment, local precache files and their revision hashes,
   complete offline assets (including lazy notation), navigation fallback, and
   explicit rather than immediate worker activation. Seven mutation/contract tests
   verify that missing icons, stale bytes, uncached assets, unregistered navigation
   fallback and unsafe activation fail the gate. This is artifact inspection, not proof of offline operation.
4. Optional, on a machine allowing a local HTTP server and Chromium: with Python
   Playwright and Chromium already installed, run
   `python scripts/browser-release.py --chromium /path/to/chromium`.
   The script serves `dist` on an ephemeral loopback port with a disposable
   browser context. It does not install software, use an existing browser profile,
   upload files, change build output, or contact a deployment.
5. Review `test-results/release/report.json` and its viewport screenshots. A
   failed run lists completed checks and the failure; remaining stages are not
   accepted. The optional harness itself needs its first successful browser run.

The browser harness checks worker control, four 390×844/844×390/360×640/640×360
viewports, visible keyboard/roll/transport bounds, no horizontal overflow, native
modal Tab/Escape and focus return, keyboard activation of a piano key, saving a
demo fingering, and an offline cached reload with identical saved library bytes.
It then serves a byte-different worker at the same origin: no automatic update,
dismiss the dirty-draft confirmation, then explicitly accept the update and
verify saved bytes survive. This is a worker lifecycle smoke check with identical
application assets, **not** cross-version schema migration testing. It does not
cover touchscreen feel, screen readers, native install UX, real audio or MIDI.

## Merged implementation status

Status at main `d06b94f5ec66adaf91f74d739866dc85cdaea4cb` (2026-11-11):

- [#21](https://github.com/eulercb/piano/pull/21): Recital, MIDI/project note
  authoring, folder refresh, bookmarks, steady metronome and release gates.
- [#22](https://github.com/eulercb/piano/pull/22): bounded written-note editing
  and preparation guidance, including the separate experimental desktop CLI
  from [#24](https://github.com/eulercb/piano/pull/24).
  [#23](https://github.com/eulercb/piano/pull/23) adds reading-score size controls.
- [#25](https://github.com/eulercb/piano/pull/25): written-part timing history;
  [#26](https://github.com/eulercb/piano/pull/26): self-contained score sources.
- [#27](https://github.com/eulercb/piano/pull/27): deferred preparation modules
  with explicit retry; [#28](https://github.com/eulercb/piano/pull/28): supported
  engraving positions and safe same-duration chord-tone additions/removals.

These merges establish implementation status, not deployment or browser/device
acceptance. Validation counts and bundle measurements belong to their recorded
trees in [VALIDATION.md](../VALIDATION.md), not automatically to this main commit.
The desktop CLI requires a separately supplied engine; no browser recognition,
bundled engine/models or automatic recognition downloads are implemented.

Draft [#29](https://github.com/eulercb/piano/pull/29), first published at `124498e`,
is pending separately from that main snapshot. Its additional original-fixture evidence
records **14/14 written events** for clean rhythm/accidentals and the same page
with one fixed skew/contrast transform. The chord/tie case failed with an invalid
`divisions=0` export; no accuracy score is assigned. These are synthetic cases,
not phone photos or general-score/private/offline acceptance.

## Historical release-gate evidence (#21)

- Base: `7be4d0a` (2026-11-11). Production TypeScript/Vite/PWA build passed.
- Emitted-artifact gate and all seven gate self-tests passed. Nine distinct assets
  were cached, including the lazy notation renderer and install manifest.
- Full baseline app tests: final rerun passed all **568 tests in 33 files**. An
  initial run hit a Studio timeout under concurrent load and a harness filename
  discovery error (fixed by keeping Node contracts outside Vitest test patterns).
  The final #21 tree passed **773 tests across 49 files**, production build
  and all seven gate contracts; see [VALIDATION.md](../VALIDATION.md).
- The optional Python browser harness parses/compiles, but its scenarios are
  **unrun**. A preliminary launch using installed `/usr/bin/chromium` and Python
  Playwright failed before any page loaded: Chromium's process-singleton socket
  returned `Operation not permitted`; Crashpad also reported missing database
  configuration. No restriction was bypassed and no browser acceptance is claimed.
- The existing large lazy notation chunk build warning remains. Do not equate
  bundle-byte measurements with device load performance or musical latency.
- No application/PWA defect was confirmed by this artifact-only audit. No
  dependencies, private score assets or app runtime changes were added.

## Support matrix

| Environment | Intended capability | Acceptance boundary |
| --- | --- | --- |
| Current desktop Chrome / Edge, HTTPS | App, Web MIDI where permitted, local storage, offline worker | Automated app contracts exist; rerun real browser checklist for each release. |
| Current Chrome on Android, HTTPS | Touch practice, installable PWA; class-compliant USB-C/OTG Casio target | Physical device, install, rotation/safe areas, permissions, interruptions and MIDI acceptance remain open. |
| Other modern browsers | App and touch/typing fallback where browser APIs permit | Do not promise Web MIDI, directory access, installed behavior or storage persistence. Test explicitly. |
| File System Access capable browser | Read-only directory selection, remembered shortcut and explicit refresh | Permission lifecycle, persisted handles and reconnect must be tested in an actual supported browser. |
| Browser without directory picker | Explicit multi-file import fallback | Verify accessible selection and accurate unsupported guidance; no background folder access claim. |
| Private browsing / full or denied storage | Temporary open song/export fallback where possible | Persistence is not promised. Export before closing; browser storage can be evicted. |

`localhost` is usable for worker testing, but production must use HTTPS. The
artifact gate intentionally targets the custom-domain root `/`, not repository
subpath hosting. Browser emulation is not Android/Casio hardware validation.

## Remaining acceptance by roadmap issue

| Issue | Baseline / implementation scope | Required remaining acceptance |
| --- | --- | --- |
| [#1 Foundation](https://github.com/eulercb/piano/issues/1) | Local library, original demo, offline-first practice vertical slice | Cold/warm load and cached offline restart on desktop and installed Android; navigation and saved work survive reload. |
| [#2 Prepare songs](https://github.com/eulercb/piano/issues/2) | MIDI/project import, transpose, trim, finger editing/export, structural editing and safe persistent folder refresh | Real-browser edit/export/reimport round trips; original source unchanged; permissions revoke/regrant and folder refresh conflicts; reject unsupported/corrupt files without destroying drafts. |
| [#3 Practice engine](https://github.com/eulercb/piano/issues/3) | Listen, melody, rhythm, end-only recital, count-in, optional steady metronome and safe interruption handling | Real keyboard and audio onset behavior; pause/resume and interruption during every mode/count-in; recital completion/history and audible metronome phase; never infer calibrated timing. |
| [#4 Connect instruments](https://github.com/eulercb/piano/issues/4) | Selected-input Web MIDI, disconnect/reconnect handling and touch/typing fallback | Physical Android + Casio + USB-C/OTG permission, notes/chords, unplug/replug, multiple devices and repeated reconnect; no automatic resume or wrong-device switch. |
| [#5 History and adaptive feedback](https://github.com/eulercb/piano/issues/5) | Local history/backup/deletion, written-part timing counts, explicit gentle next-step choices and content-checked practice bookmarks | Completed versus interrupted passes, speed/hand accuracy after next-step choices, reload/multi-tab persistence, backup round trip and quota failure; bookmark backup plus song-project restore under changed IDs. Written-part counts do not identify physical hands. |
| [#6 Score preparation](https://github.com/eulercb/piano/issues/6) | User-imported MusicXML/MXL, ties/fingers, score-linked edits, bounded fixed-slot, chord-tone and whole-chord-duration authoring, measure trimming, reading cursor/size and experimental desktop recognition | Interactive notation rendering, supported edit/save/export/reimport with aligned hands and preserved silence, source-linked pitch/finger changes, pickup/ties/tuplets after trim, zoom/resize/follow scrolling and unsupported notation rejection. Desktop recognition has narrow synthetic evidence, not general-score or private/offline acceptance. Built-in browser OMR is not implemented. Use original fixtures. |
| [#7 PWA quality](https://github.com/eulercb/piano/issues/7) | Prompt-only updates, storage guards, responsive practice room, accessibility contracts and deferred preparation loading | Real cached offline reload, clean/dirty/temporary-history updates, install/update across two releases, browser eviction/quota and recovery, native failed-module retry/cache behavior, keyboard/screen-reader/touch checks, Android background/foreground behavior. |

The separate Audiveris 5.11.0 baseline matched **16/16 quarter-note events** on
one original clean two-bar image and rejected a blank control; see
[the captured evidence](local-omr-evaluation.md). This is not a phone-photo
accuracy estimate. Network isolation/observation were denied and not bypassed;
private-score offline acceptance remains open. Written-note authoring supports
resizing a simple equal-duration chord as a group, using one immediately following
same-voice/staff rest to lengthen or inserting one rest to shorten. Ties, tuplets,
beams, unequal-duration/cross-staff chords and complex notation remain blocked;
import or playback support does not imply those structures can be authored safely.

Implementation and automated evidence in this table are not device acceptance.
Reconcile the final commit and remaining checks before closing an issue. Desktop update evidence recorded in
README/VALIDATION does not establish Android installed-PWA behavior.

## Manual release acceptance

- [ ] Record commit, browser/version, OS/device, viewport/orientation and installed
  versus browser-tab mode. Export backups before testing any real profile.
- [ ] Fresh online load: worker finishes installing; close/reopen, then disable
  network and launch the app. Demo, saved project, reading-score assets and core
  controls still work. Fresh uncached offline access is not promised.
- [ ] Portrait/landscape including browser bars, safe-area edges and short screens:
  keyboard and transport remain reachable; no accidental page-wide overflow;
  panel contents scroll and focus remains visible.
- [ ] Keyboard-only: open/close Setup, Piano and Results; Tab stays in modal;
  Escape returns focus; sliders/selects work; typing in inputs never sounds keys.
  Check screen-reader names/status announcements and large text/zoom separately.
- [ ] Update from previous release with saved songs, fingers and history. A waiting
  update must never reload by itself. Cancel with a dirty draft; save/export it;
  accept deliberately. Verify saved data, completed history and no automatic play.
  Repeat with temporary history and unavailable storage. Two-tab updates require
  explicit checking, especially a dirty draft in the other tab.
- [ ] Exercise quota/denied/corrupt storage in a disposable profile. Data is not
  silently replaced; temporary work can be exported. Do not clear a real profile.
- [ ] Actual Android install, launch offline, rotate, background/foreground, audio
  suspend/resume, USB-C Casio input and unplug/replug. Record unsupported paths
  separately rather than labelling them passes.
- [ ] Before publication, aggregate tests/build/artifact gate pass on the final
  combined commit; inspect requested changes and CI. Deployment, domain/TLS and
  physical device sign-off are separate gates, not implied by a local build.
