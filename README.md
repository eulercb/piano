# Piano Studio

A local-first browser piano practice workspace. Roadmap: [issue #8](https://github.com/eulercb/piano/issues/8).

## Develop

Node 22+; `npm ci`, `npm run dev`. Validate with `npm test`, `npm run build` and `npm run check:release`. The release gate inspects emitted PWA artifacts; it is not browser or hardware acceptance. See [the support matrix and release checklist](docs/release-checklist.md).

The app supports MIDI preparation, a local song library, listening, wait-for-note melody practice, beginner rhythm feedback, end-only recital assessment and a reading score. No account or server-side music storage. Browser MIDI access is optional and requested on click; use Chrome/Edge where Web MIDI is supported. Touch keys and A–; are a demo fallback, not full piano input.

## Scope and limits

- MIDI 0/1 import: tempo maps, note pairs, running status and sustain. Hands are a pitch heuristic except for projects with explicit assignments. Review the result in Studio.
- Studio: trim seconds non-destructively, transpose, edit note pitch/hand/finger, and insert/delete/retime MIDI or project notes. Save locally and export MIDI or a versioned Piano project. MIDI export does not preserve fingerings; project export does.
- Melody waits for the next note/chord. Listen mode plays the selected hand(s). Rhythm mode keeps moving and gives live pitch/onset feedback. Recital keeps moving and withholds pitch/onset results until the pass finishes. Rhythm and Recital assess the selected hand(s), with the other hand as accompaniment.
- Optional count-in gives four quarter-note beats at the piece’s starting tempo and selected speed before each pass. It is a plain beat count, not a claimed measure; meter and tempo changes are not inferred for the count-in.
- Optional **Steady metronome** continues quarter-note clicks after any count-in at the piece’s starting tempo × practice speed. It keeps ticking during Melody waits, does not follow score meter or tempo changes, and is silenced by Mute. Pause retains beat phase; restart, seek, repeat and changing the metronome setting start fresh. It is off by default.
- Rhythm feedback is deliberately beginner-focused: correct pitches within 100 ms are on time, up to 300 ms early/late receive timing feedback, and unanswered targets become missed. These are real-time windows at every speed. Chords and doubled unisons are supported. Note length, pedal, expression, and device/audio latency are not graded or calibrated.
- Pause/resume retains the attempt and any partial count-in. Restart, seeking, changing hand/mode, or changing the count-in setting starts fresh; seeking excludes earlier notes from the attempt. Repeat shows the previous pass summary and resets the new pass. Completed passes, including Recital, are saved in local practice history. Unfinished recital attempts do not expose grades or create completed history.
- Backgrounding the app or an animation scheduling gap over 250 ms pauses practice rather than catching up with a burst of missed notes or accompaniment. Press Play to resume.
- If browser audio is suspended, interrupted or closed, audible practice pauses immediately with its position, partial count-in and results intact. Play waits for audio to run before starting; pending starts can be canceled and never resume after navigation or a new selection. Muted practice remains available without audio. Unmuting unavailable audio pauses until you press Play or choose Mute again.
- Direct MusicXML imports support source-linked score edits and measure trimming. Older MIDI projects with an attached MusicXML retain an explicitly labelled reference score; edits to those projects do not change the reference. Matching MusicXML-origin scores show a playback cursor and measure position, with optional pane-only follow scrolling. Reference-only scores stay unsynchronized.
- Original demo "Morning Light" is supplied. User-owned Valsa do Adeus project assets must be imported privately; no photographed score or third-party arrangement is published in this repository.
- Synthesized triangle tones are a lightweight preview, not a sampled grand piano. Physical MIDI and mobile installation require real-device verification.
- Local browser storage may be cleared by the browser. Export a project backup.

## Keeping edits safe

Studio changes remain open when moving between Practice, Studio, Library and History. Switching pieces, importing a replacement or trimming an unsaved full-piece draft asks before discarding edits. Save or export the full piece before trimming if you want to retain edits outside the passage. Saving the built-in demo creates a separate library copy and resets its playback.

Library saves reread current storage and reject conflicting edits from another tab. Unreadable library data is not automatically replaced. If storage is full or unavailable, an imported piece stays open for project export and remaining files in that batch stop importing. Navigating, editing or starting another import cancels older pending imports. Web Locks coordinate saves on supported browsers; use one app tab where that API is unavailable.

Reload update also asks before discarding unsaved song changes or temporary practice history. A browser close warning is requested for these cases, but browsers, especially mobile app termination, may not show it. Export backups rather than relying on a close warning.

## GitHub Pages

The workflow tests and builds PRs, then deploys successful main pushes through GitHub Pages. Set repository Settings → Pages → Source to **GitHub Actions**, custom domain `piano.zen.dev.br`, and enable HTTPS when GitHub provisions its certificate. The custom domain is included in `public/CNAME`. DNS must point to this repository's GitHub Pages host. Workflow configuration alone is not proof of a live deployment. When a new version is waiting, the app offers **Reload update** with a save/export warning. It never reloads automatically to apply an update; existing local library data is not cleared. A deployed desktop browser update cycle preserved saved songs and fingerings; Android installed-PWA behavior remains unverified.

## Focused practice room

The Practice room is a viewport-contained piano guide, with a compact piece/hand/speed/mode header and permanent play, pause, restart, position and mute controls. Falling notes scale to the available height in portrait and landscape. Library, Studio preparation and history keep their own pages.

The keyboard and falling-note guide fill the usable screen width between safe-area insets. White keys are contiguous, with black keys overlaid at their boundaries; note lanes use the same pitch geometry. Falling notes reach the keyboard's top edge at their playback onset, and their travel and duration scale with the available guide height. This removes layout offsets; it does not calibrate browser, speaker or MIDI latency.

- Open **Setup** for hands, tempo, count-in, repeat and **Melody practice · wait for notes**. Opening Setup, Results or Piano pauses at the current position. Closing a panel does not resume automatically: press Play when ready.
- **Reading score** replaces the falling-note surface rather than stacking a long score above it. Matching MusicXML has the existing cursor and opt-in **Follow score while playing**. A project without notation explains how to add a score. Return with **Falling notes**; the transport stays in place.
- **Fingers** toggles saved/printed finger hints on falling notes. These are suggestions, not fingers detected or graded by MIDI. Printed notation fingerings remain visible in score view.
- **Piano** opens connection and input selection. The connection stays mounted and listening when the panel closes or when moving between pages. Setup links to **Prepare a song** and **Practice history**. Rhythm feedback stays compact during the pass; **Results** opens the detailed summary.
- The room uses dynamic viewport height, safe-area insets and internally scrolling dialogs/score panes. Synthetic DOM and stylesheet tests cover these contracts; actual Android/Casio and rendered mobile layout still need device verification.

### Choosing the next practice step

After a completed listening, melody, rhythm or recital pass, open **Results** for gentle next-step choices. Repeat from the beginning or try another approach. Melody, rhythm and recital passes also offer increasing or decreasing practice speed by 5 percentage points (within 25–125%). Listening leads to one-hand wait-for-notes practice. Exploring the other hand or combining both uses wait-for-notes at the current speed or 50%, whichever is slower; empty-hand options are omitted.

These are choices, not automatic progression or a claim of mastery. The exact hand, speed and mode are shown before selection. Choosing a step closes Results and resets to the beginning of the selected piece/prepared passage, leaving playback paused until **Play**. Count-in and repeat preferences stay in place. The song, source tempo, Studio draft and already recorded history are unchanged. **Choose a shorter passage in Studio** opens preparation without trimming or saving anything automatically.

During repeated playback Results refers to the last completed pass; opening it pauses the current attempt. Restart, seek, changing hand/mode/speed/count-in or navigation clears the next-step choices. History remains available separately. An unfinished attempt never earns a completion suggestion, and temporary history still supports next steps if browser storage fails.

## Android and a USB-C piano

Target: current Chrome on Android, with a class-compliant USB MIDI Casio and suitable USB-C/OTG adapter. This hardware path is not yet physically tested. Open **Piano**, then tap **Connect piano** after opening the HTTPS app, then allow MIDI access. A sole connected input is selected automatically; if several are present, choose your Casio under **Piano input**. Only that input affects practice. Play a key and check the last-note/activity indicator before starting a passage. No microphone recognition or sysex is requested.

The input list updates as devices are plugged in or removed. If the selected piano disconnects, the app keeps its selection and reconnects only that same input ID; it never silently switches to another device. If the browser assigns a different ID, select the piano again. **Disconnect** stops MIDI input, and **Reconnect piano** retries the connection. Denied permission, missing browser support, missing inputs and input-open failures have separate guidance. Touch and typing keys remain available. Device choices and activity are session-only, not saved in browser storage.

Losing an active selected MIDI input pauses Melody, Rhythm and Recital immediately, including a count-in, and silences accompaniment. The current position, partial matches and timing results stay intact; no missed notes or history completion are added while paused. A compact notice stays visible outside the Piano panel with cable/reconnect guidance. Reconnection never resumes practice automatically: press **Play** when ready. Listen mode is not interrupted. To continue without MIDI, choose **Touch/typing keys (no MIDI)** under Piano input or **Disconnect**, then press **Play**; this clears the reconnect reminder without changing saved songs or Studio drafts.

Library → **Open song folder** progressively uses read-only `showDirectoryPicker` when available; otherwise select multiple files via **Import song**. Supported browsers can remember a folder shortcut with IndexedDB. Opening the app only restores that shortcut: it does not scan files or ask for permission. **Refresh / reconnect folder** rechecks permission after your click and reads up to 50 supported files in the selected folder, without recursion or background scanning.

Content fingerprints skip unchanged sources even when you have edited their saved copies. A changed source is offered as a separate new copy; cancel keeps your existing work and lets you reconsider on the next refresh. Missing source files never remove saved songs, and no source file is written. An unavailable or damaged shortcut store leaves file import and session-only folder access available. Browser permissions and persisted handles still require actual browser acceptance. MusicXML and compressed .mxl import as playable scores. Save/export a Piano project to retain score and fingerings.

## Score-linked Studio

Import `.musicxml`, `.xml` or compressed `.mxl` directly to create playable notes and readable notation together. Supported partwise piano scores preserve staff-to-hand assignment, printed fingers, chords, tuplets expressed via duration, and ties. Structural playback features that are not supported must fail clearly rather than silently play the wrong sequence. Grace-note approximation is disclosed on import.

For these imported scores, Studio pitch/finger edits and transposition rewrite the MusicXML and re-derive playback. Trim by whole measures (including a pickup) to keep notation and sound aligned; inherited attributes and crossing ties are repaired. Export MusicXML or a Piano project. Editing MIDI-only songs retains the simpler seconds-based editor.

### MIDI and project note authoring

For MIDI/project notes, **Add, delete & retime notes** shares selection with the existing pitch/hand/finger controls. Insert a note with explicit pitch, start, duration, hand and optional finger; apply start/duration edits; or confirm deletion of the selected note. Notes remain chronological, other notes do not shift, and saved trailing silence is preserved. Apply changes, then save or export the project. Editing pauses and resets playback; save conflicts and quota failures retain the open draft for export.

### Written MusicXML note authoring

For source-linked MusicXML, **Add, delete & resize written notes** works within existing written slots. Select a plain explicit rest to insert a note, replace an independent note with an equal-duration rest, shorten a note and leave silence, or lengthen it into an immediately following plain rest in the same voice and staff. Durations are quarter-note beats, not seconds. Every operation rewrites notation and re-derives playback; it does not move later notes or the other hand. Save or export after applying changes. Saved originals and source files are untouched until you explicitly save the draft.

This is a bounded editor, not free notation layout. Chords, ties, grace/cue notes, beams, tuplets, complex attached notation and note-level attributes are refused. Simple fingerings and pitch spelling are preserved when resizing. Supported durations are whole through 64th notes, optionally single-dotted, and both the note and any remaining rest must fit these values, the score's divisions and available space. Keep at least one sounding note in the score. Existing pitch/hand/finger edits and whole-measure trimming remain available. Use a notation editor for unsupported changes. A project whose playback no longer matches its source is refused rather than silently replaced. An older MIDI/project with attached reference notation keeps that reference and explicitly warns that playback edits do not change it.

### Starting from a PDF or photo

The collapsed preparation guide beside **Import song** explains a separate local desktop recognition and correction workflow. Piano Studio does **not** recognize notes from PDFs/photos, install a recognizer or upload scans. Importing MusicXML is not OMR. The [OMR research and private preparation guide](docs/private-score-preparation.md) records candidate engines, license/runtime limits, safe handling and the verification needed before any recognition integration. Review converted notation against the original; successful import is not proof of musical accuracy.

### Experimental desktop recognition

An optional, separately invoked [Linux Audiveris CLI experiment](docs/local-omr-evaluation.md) now converts a chosen PNG to a new MusicXML file. It is not a browser/Android feature or a background service. The real engine matched all 16 musical events in one original clean two-bar fixture and rejected an original blank image; this is not a phone-photo accuracy estimate.

The adapter never downloads an engine, overwrites an output or changes the app library. Supply a trusted separately installed Audiveris executable and review every result. **Network isolation and observation were unavailable here, so private-score offline safety remains unverified. Use synthetic inputs until that acceptance is completed.** No recognizer, runtime or models are bundled. See the evaluation for exact versions, resource limits, warnings, artifacts and remaining tests.

## Practice history and score following

Completed listen, melody, rhythm and recital passes are stored locally with hand, speed range and passage context. Open History for gentle next-step suggestions, JSON backups and explicit delete/clear controls. Storage is bounded; export backups before clearing browser data. Modern Web Locks serialize changes across tabs; without that API, use one app tab to avoid simultaneous-write conflicts.

New completed **both-hand Rhythm and Recital** passes also show note-start counts for the written left and right parts. These follow the piece’s saved hand assignments, not which physical hand played; imported MIDI assignments may need review in Studio. Doubled unisons count in each written part, while extra presses stay in the overall count because their physical hand cannot be detected. Recital still reveals results only after completion. Seeking excludes earlier targets, and repeated passes retain their own counts before the next attempt starts. Older history backups remain readable without invented breakdowns; new backups preserve and validate the optional counts.

The score cursor requires unchanged correspondence between MusicXML and playable notes. Written grace positions share the principal note; performed grace timing remains approximate. Follow scrolling is opt-in and stays inside the score pane.

Compressed scores are read locally with strict size, path, integrity and decompression limits. External images and resource links are rejected; no archive resources are fetched. Original imported files are not overwritten.

### Reading score size

Use **Score size** to engrave at 75–200%, or **Reset size** to return to 100%. Larger sizes make notes and printed fingerings easier to read, but can require more scrolling. Both source-linked and reference scores have a keyboard-focusable, internally scrolling pane. Controls work in Studio and the compact Practice score view. In compact Practice, size and follow controls share a keyboard-focusable scrolling area capped at half the available score space so short landscape layouts retain a reading pane.

Changing size or resizing the pane keeps playback at its current time and rebuilds the reading cursor. Scrolling stays in the pane and remains opt-in while playing; paused or non-following views retain their scroll offsets. Size is a temporary preference for the mounted view, retained through score replacement/retry but not saved to projects or browser storage. Source notation, notes and fingerings are unchanged. Render failures retain the retry and MIDI practice paths. Automated DOM/lifecycle checks are covered; real mobile rendering and hardware remain unverified.

## Practice bookmarks

In Practice → **Setup**, name and save a bookmark for the built-in demo or a saved piece/prepared passage. Save Studio edits first. A bookmark stores hand, mode, speed, count-in and repeat choices; open it from Setup or Library to return to the beginning, paused. It does not capture a playback position or change the current metronome preference. Original songs, source tempo and history remain unchanged.

Bookmarks check a SHA-256 music-content revision, including notes, fingers and notation. A changed or missing piece is not silently substituted. If a restored project has a new library ID, a unique exact musical match can be opened only after confirmation; ambiguous matches are rejected. Unsaved drafts still require confirmation before replacement, and a newer navigation or edit cancels an older pending restore.

Export/import bookmark backups separately from song projects. Bookmarks contain names, titles, settings and revision hashes, not notes or scores. Restore the song project too if its library entry is missing. Storage is bounded to 50 bookmarks and 128 KiB; corrupt data, quota errors and conflicting imports do not silently overwrite existing data. Deletion and backup merges require explicit choices. Use one app tab where Web Locks are unavailable.
