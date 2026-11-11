# Desktop browser acceptance: 2026-11-11

This record covers a limited desktop pass through [Piano Studio](https://piano.zen.dev.br/).
It supplements the [release checklist](release-checklist.md), rather than closing
its browser, accessibility, PWA or hardware gates. Later application changes need
their own acceptance.

## Tested runtime and scope

- Desktop Chrome on Linux, initially at **1180 × 757 CSS pixels** and 100%
  browser zoom, followed by the resized/zoomed desktop checks below. The exact
  browser version is unknown. No installed-app or mobile-device result is claimed.
- Observed entry: `assets/index-D_DsCXPt.js`; stylesheet:
  `assets/index-83uFIGAZ.css`. The authoring module
  `StudioNoteAuthoring-LrhgLBFy.js` also loaded during preparation.
- These observed asset URLs match a validated build whose runtime source matches
  main `821679c7262e1bb496238f14aec423172518e871`. The deployed bytes were **not
  independently hashed**, and the deployment commit was not independently
  established. Filenames alone are not proof of byte or commit identity.
- Musical inputs were original synthetic fixtures, alongside the original
  Morning Light demo. No private score, MIDI, recording or project was used.
  Original score-file bytes remained unchanged after editing and export.
- Practice observations below used muted playback and the on-screen/typing
  fallback. They do not validate audible timing, metronome phase, physical piano
  input or latency calibration.

## Observed preparation and reading results

| Flow | Observed result |
| --- | --- |
| Online load and navigation | Demo, library, keyboard, falling notes and transport appeared. The checked practice view had no page-wide horizontal overflow. Saved synthetic pieces remained available after reload. |
| MusicXML and compressed MXL | A 16-measure fixture imported as 64 notes over 32 seconds, with engraved notation and an accurate 120 BPM fallback notice for missing tempo. MXL import and deferred preparation tools also worked after reload. |
| Linked edits and round trips | Pitch and printed finger edits appeared in both project and MusicXML exports. Reimporting the actual exported files retained the edited pitch, finger and note count, with readable notation. |
| Chord, transpose and trim | Adding a simultaneous chord tone, transposing and trimming to two measures produced a separate nine-note, four-second passage. Its project export retained the two measures, simultaneous pitches and printed finger. Saved source pieces remained available. |
| MIDI round trip | Exporting that passage and reimporting the resulting MIDI retained nine notes and four seconds. The app correctly explained that hands were estimated and no reading score was included. |
| Invalid replacement | With an unsaved finger edit, confirming replacement with malformed XML produced an error while preserving the current piece and draft edit. |
| Score size and follow | Sizes of 100%, 200% and 125% worked. At 200%, the cursor advanced and opt-in follow scrolled the score pane without scrolling the outer page. Keyboard and transport stayed visible. |

These are acceptance results for the exercised fixtures, not exhaustive support
for arbitrary notation, structural edits or corrupt files.

## Observed practice results

The short mode checks used an original five-note, six-second fixture with a
two-note chord and notes assigned to both written hands.

| Flow | Observed result |
| --- | --- |
| Listen | Play advanced time and cursor; Pause held position; resume continued. Completing the longer fixture produced a non-scoring result. Opening Results before completion did not create a completed pass. |
| Melody | A wrong pitch did not advance. Playing only one chord tone left the other required tone pending; completing the chord and later notes completed the Both-hands pass. The result explicitly did not grade timing. |
| Panel interruption | Opening Setup paused practice. Typing in its bookmark name field did not play piano targets. Escape closed it without automatically resuming. |
| Count-in | Melody ignored notes during the count and retained the partial count on pause/resume, then waited for the first required note. Opening Piano during a Listen count-in left playback paused at zero. A Rhythm count-in key press left timing and extra-note counts at zero. |
| Seek and restart | Seeking to three seconds skipped earlier targets and waited for the later note at four seconds. Restart returned to zero, paused. |
| Rhythm | The pass completed with live feedback and a final summary of one late target, four missed targets and two extra notes, with the timing-calibration disclaimer visible. This is an observed feedback path, not a calibrated timing-accuracy result. |
| Recital | The live pass withheld grades. Completion exposed the final summary of one late target, four missed targets and one extra note. An interrupted new attempt withheld statistics rather than presenting a completed assessment. |
| Explicit next step | Choosing the uninterrupted-pass suggestion after Rhythm selected Both hands, 100% speed and Recital at the beginning, paused until Play. |
| Selected hand and repeat | Right-hand Melody excluded the left-hand target. On completing the pass with Repeat enabled, the new attempt returned to zero and waited for the first chord again. |

## Persistence and modal interaction

- Completed Listen, Melody, Rhythm and Recital passes appeared in history. The
  saved records distinguished Both- and Right-hand practice. Interrupted and
  count-in attempts did not add spurious completions in the checked sequence.
- A completed listening record survived reload. Exporting and reimporting its
  history backup skipped the duplicate instead of creating a second entry.
  A later five-pass backup restored one deliberately deleted, exercise-created
  record without duplicating the others; all five records survived reload.
- Rhythm and Recital history separated the written left- and right-hand targets,
  with wording that did not claim to detect the player's physical hands.
- A bookmark backup merged safely without duplicating its entry. Opening the
  saved bookmark restored Both hands, Listen, 50% speed and count-in, at position
  zero and paused.
- A deliberately constructed missing-song-ID bookmark retained its original
  musical content revision and settings. Opening it required explicit
  confirmation of an exact content match, then opened the correct saved piece
  at zero, paused, with Right hand, 100% speed and Melody. All three test
  bookmarks survived reload. This was not an actual cross-device transfer.
- Setup and Piano used native modal dialogs. Escape returned focus to their
  respective openers. Clicking a dimmed background navigation control did not
  change page or dismiss the modal. Tab and reverse Tab could enter browser
  chrome, then re-enter the expected dialog boundary control. Browser-chrome
  traversal is expected native behavior, not an application defect. This does not
  validate an automated focus predicate or full keyboard/screen-reader access.

## Resized desktop and browser zoom

These checks used the same deployed application in a desktop browser. Browser
page zoom and the app's reading-score size are separate controls. The conditions
below are **not Android, mobile-device emulation, touchscreen or operating-system
text-size acceptance**.

| Desktop condition | Actual CSS viewport | Observed result |
| --- | --- | --- |
| Narrow window, 100% browser zoom | 500 × 740 | The demo's full 41-key keyboard, practice controls and transport stayed visible. Setup scrolled internally while its heading and footer stayed available; the focused bookmark field scrolled into view with a visible focus outline. Piano content fit. |
| Same narrow window, 125% browser zoom | 400 × 592 | Compact navigation, the full synthetic keyboard and transport stayed visible. Setup retained its fixed heading/footer and scrollable body; focused text entry and Escape remained usable. Reading notation at 200% score size stayed within its own scroll pane. |
| Short landscape window, 100% browser zoom | 808 × 350 | Practice tools used a compact single row with labeled controls. All 36 synthetic keys and the transport fit; Enter visibly activated the first and last keys. Setup's body scrolled with fixed heading/footer and visible focused input. Piano content fit. |

No page-wide horizontal overflow was observed at these three viewports. Escape
closed the checked dialogs; Setup focus returned to its opener.

At 500 × 740 with 200% score size, the reading cursor advanced and opt-in follow
scrolled the score pane to 1,785 pixels while the outer page stayed at zero. At
808 × 350 with 100% score size, follow scrolled the 65-pixel-high score pane to
86 pixels, again without scrolling the outer page. Keyboard and transport stayed
visible in both cases. Internal horizontal scrolling at high score size is
expected; this is not a claim that a full score page fits in a short viewport.

The original window was restored to **1180 × 757 at 100% browser zoom**. The
observed entry asset was unchanged and all five completed history records remained.
No layout defect was confirmed in these desktop conditions.

## Remaining release gates

- **Android and Casio:** physical USB-C/OTG MIDI permission, note/chord input,
  selected-device behavior, unplug/replug, reconnect, touch interaction and audio
  timing. No MIDI permission or physical-device result is recorded here.
- **Offline and PWA lifecycle:** cached offline restart, installation, update
  acceptance across releases, service-worker failures and background/foreground
  recovery. This pass does not add evidence for those paths.
- **Folder access:** native directory selection, permission revoke/regrant,
  persisted handles, refresh conflicts and unsupported-picker fallback.
- **Accessibility and layout:** screen readers, actual mobile portrait/landscape
  behavior, browser bars, safe areas, operating-system text scaling, multitouch
  and broader keyboard-only operation. Resized/zoomed desktop checks do not
  establish those results or acceptance at untested dimensions.
- **Failure and storage recovery:** forced module-load failures and retry,
  quota/denied/corrupt storage, eviction, multi-tab conflicts and interrupted
  multi-file imports.
- **Broader music and practice coverage:** pickup/tie/tuplet trim cases, complex
  notation rejection, exhaustive per-mode/count-in interruptions, audible
  metronome phase, positive early/on-time hits and precise timing windows,
  count-in combined with repeat, altered-content or ambiguous bookmark matches,
  and actual cross-device recovery.

No roadmap issue is fully accepted by this record. Automated tests, build and
artifact gates remain separate evidence, as do exact deployment identification
and physical-device sign-off.
