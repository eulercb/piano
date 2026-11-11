# Desktop browser extension checks: 2026-11-11

This partial follow-up to the [earlier browser record](browser-acceptance-2026-11-11.md)
covers original synthetic fixtures in [Piano Studio](https://piano.zen.dev.br/).
It does not close the [remaining release gates](release-checklist.md).

## Initial runtime and evidence limits

- Linux desktop Chromium, browser-tab mode. Exact browser version was not recorded.
- Explicit **Reload update** changed the observed entry from
  `assets/index-D_DsCXPt.js` to `assets/index-FCbg-NpY.js`; the stylesheet was
  `assets/index-83uFIGAZ.css`. The latter entry filename matches the #35 retention
  build at main `3aabeb2`. Deployed bytes were not independently hashed;
  filenames do not establish byte or commit identity.
- Eight existing library pieces and three bookmarks remained after the update.
  Five existing completed history entries were retained through the practice
  checks below. No original entry was deleted or overwritten.
- Inputs were purpose-written synthetic scores/projects. No private score,
  recording or project was used. Practice was muted and used on-screen/typing
  input, not physical MIDI or audible timing.

## Notation editing and a confirmed trim defect

A pickup/tie/tuplet fixture imported as 14 notes at 90 BPM over 8.666667 seconds,
with readable notation. Editing a tied D4 to pitch 63 and finger 3 updated both
written tied pitches. Tied and tuplet selections disabled unsupported structural
controls with explanatory guidance. No disabled operation was forced.

Selecting a non-leading tone of a simple three-tone chord and applying a duration
of two beats changed all three tones together and consumed the adjacent rest.
The actual project export retained other-voice and later-note positions. Saving
and exporting the full edited project and MusicXML succeeded.

Trimming only interior measure 2 produced six playable notes at 90 BPM over
2.666667 seconds, but the reading view failed. Actual exports retained the
inherited tempo, both-hand starts, triplet durations and removal of crossing tie
markers. Those correct playback values did not make the reading failure a pass.

A first corrected-file import stopped the render error but produced an empty
staff and no playback cursor. A second corrected-file import displayed all six
notes across both staves and a visible cursor. At muted 25% Listen speed, the
cursor moved as playback advanced; the exported reimport project retained the
expected tempo, duration, pitches and hand assignments. This verifies import of
that corrected file only, **not the deployed trim operation**. The later deployed retest is recorded separately below.

## Deployed trim correction retest

After #38's successful Pages deployment, the observed entry was
`assets/index-YtRwykXm.js`, with stylesheet `assets/index-83uFIGAZ.css`.
The complete original-fixture workflow was repeated:
tied pitch/finger edits, whole-chord resizing, interior measure trimming, saving,
actual MusicXML and project export, and actual reimport of both formats.
The trimmed view and both reimported states each displayed six noteheads and a
usable cursor. Musical data retained 90 BPM, 2.666667 seconds, six notes and the
expected hands and timing. During muted playback the cursor moved from 95.3248
to 174.922 pixels at a playback position of 0.9268 seconds.

This passes the previously failing deployed interior-trim workflow for the
synthetic fixture; the historical failed attempts above remain part of the record.
A boundary trim covering the pickup and tie onset also passed: four notes over
3.333333 seconds, finger 3 retained, crossing tie tags removed and a usable
two-measure cursor.

These checks do not establish arbitrary notation support or audible/device timing.

## Additional practice observations

- Melody count-in paused when Setup opened and resumed from its retained count.
  Restart reset a partial chord; unfinished Results did not claim completion.
  Mid-pass resume retained progress. Completing a pass started the repeated
  count-in and added exactly one Melody history record.
- Piano paused a Rhythm count-in. A note pressed during count-in did not change
  timing or extra-note counts. Mid-pass pause/resume did not restart count-in.
  Completion started the repeated count-in and added exactly one Rhythm record.
- Recital Results withheld grades during count-in and an incomplete pass.
  After completion and repeat, results were explicitly labelled as the previous
  completed pass. Choosing the slower next step selected Both hands, 95%,
  Recital at the beginning, paused; reopening Results did not relabel old grades
  as the new attempt's results.
- After a second completed Recital at 95%, the explicit left-hand next step
  selected Left, 50%, Melody at the beginning, paused.
- The actual history export contained nine records: the original five plus one
  Melody, one Rhythm and two Recital completions. Interrupted attempts did not
  create additional completed records in this sequence.

## MIDI retention and guarded export observations

After another explicit update, the observed entry was `assets/index-BVno-vdv.js`,
matching the #37 build filename. The same byte-identity caveat applies. Original
synthetic inputs exercised the following paths without removing existing data:

- A three-note MIDI imported with three tempo changes. Saving and exporting
  retained the map. Trimming 0.25–1.75 seconds produced a 1.5-second passage with
  rebased changes at 0, 0.25 and 1.25 seconds. Actual project reimport preserved
  the musical fields; actual MIDI reimport retained three notes and tempo events.
  The observed maximum timing error was 7.63 microseconds **for this fixture**,
  not a general error guarantee or an audible-timing measurement.
- A mapped project with unrepresentable note timing refused two MIDI export
  attempts with an explicit no-file/unchanged-song notice. An unsaved finger edit
  remained, and an actual project recovery export retained that edit, exact note
  timing and tempo map.
- A legacy map-less project with nested same-hand/pitch notes refused export
  because pairing would change individual durations. Actual project recovery
  retained both note durations and the unsaved finger edit.
- A positive control with simultaneous same-hand/pitch starts and one- and
  three-second durations exported and reimported successfully with both durations
  preserved. A prior refusal did not prevent a subsequent supported export.

These refusal observations use the UI, retained drafts and downloaded recovery
projects; they do not claim independent instrumentation of every download event.
The existing library, bookmarks and original history records were preserved.

## Native folder blocker and remaining acceptance

**Open song folder** immediately displayed “Could not read that folder…” without
opening a chooser, including one inspected native-button retry. Only a generated
synthetic cloud directory had been prepared; no path was entered, permission
granted or user folder accessed. The underlying exception is unknown, so this
record does not assign the failure to a specific browser limitation or app cause.
Native folder selection is blocked in this tested environment; reconnect and
refresh remain unrun. These observations also do not establish audible metronome phase or timing,
Android/Casio input, native folder permissions, offline/install lifecycle,
screen-reader accessibility or general-score recognition accuracy. The separate
experimental desktop OMR adapter and its private-score isolation limits are
unchanged.
