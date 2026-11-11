# Piano Studio

A local-first browser piano practice workspace. Roadmap: [issue #8](https://github.com/eulercb/piano/issues/8).

## Develop

Node 22+; `npm ci`, `npm run dev`. Validate with `npm test` and `npm run build`.

The app supports MIDI preparation, a local song library, listening, wait-for-note melody practice, beginner rhythm feedback and a reading score. No account or server-side music storage. Browser MIDI access is optional and requested on click; use Chrome/Edge where Web MIDI is supported. Touch keys and A–; are a demo fallback, not full piano input.

## Scope and limits

- MIDI 0/1 import: tempo maps, note pairs, running status and sustain. Hands are a pitch heuristic except for projects with explicit assignments. Review the result in Studio.
- Studio: trim seconds non-destructively, transpose, edit note pitch/hand/finger, save locally and export MIDI or a versioned Piano project. MIDI export does not preserve fingerings; project export does.
- Melody waits for the next note/chord. Listen mode plays the selected hand(s). Rhythm mode keeps moving and grades the selected hand(s) by pitch and onset timing, with the other hand as accompaniment.
- Optional count-in gives four quarter-note beats at the piece’s starting tempo and selected speed before each pass. It is a plain beat count, not a claimed measure; meter and tempo changes are not inferred for the count-in.
- Rhythm feedback is deliberately beginner-focused: correct pitches within 100 ms are on time, up to 300 ms early/late receive timing feedback, and unanswered targets become missed. These are real-time windows at every speed. Chords and doubled unisons are supported. Note length, pedal, expression, and device/audio latency are not graded or calibrated.
- Pause/resume retains the attempt and any partial count-in. Restart, seeking, changing hand/mode, or changing the count-in setting starts fresh; seeking excludes earlier notes from the attempt. Repeat shows the previous pass summary and resets the new pass. Completed passes are saved in local practice history; recital grading remains backlog work.
- Backgrounding the app or an animation scheduling gap over 250 ms pauses practice rather than catching up with a burst of missed notes or accompaniment. Press Play to resume.
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

- Open **Setup** for hands, tempo, count-in, repeat and **Melody practice · wait for notes**. Opening Setup, Results or Piano pauses at the current position. Closing a panel does not resume automatically: press Play when ready.
- **Reading score** replaces the falling-note surface rather than stacking a long score above it. Matching MusicXML has the existing cursor and opt-in **Follow score while playing**. A project without notation explains how to add a score. Return with **Falling notes**; the transport stays in place.
- **Fingers** toggles saved/printed finger hints on falling notes. These are suggestions, not fingers detected or graded by MIDI. Printed notation fingerings remain visible in score view.
- **Piano** opens connection and input selection. The connection stays mounted and listening when the panel closes or when moving between pages. Setup links to **Prepare a song** and **Practice history**. Rhythm feedback stays compact during the pass; **Results** opens the detailed summary.
- The room uses dynamic viewport height, safe-area insets and internally scrolling dialogs/score panes. Synthetic DOM and stylesheet tests cover these contracts; actual Android/Casio and rendered mobile layout still need device verification.

## Android and a USB-C piano

Target: current Chrome on Android, with a class-compliant USB MIDI Casio and suitable USB-C/OTG adapter. This hardware path is not yet physically tested. Open **Piano**, then tap **Connect piano** after opening the HTTPS app, then allow MIDI access. A sole connected input is selected automatically; if several are present, choose your Casio under **Piano input**. Only that input affects practice. Play a key and check the last-note/activity indicator before starting a passage. No microphone recognition or sysex is requested.

The input list updates as devices are plugged in or removed. If the selected piano disconnects, the app keeps its selection and reconnects only that same input ID; it never silently switches to another device. If the browser assigns a different ID, select the piano again. **Disconnect** stops MIDI input, and **Reconnect piano** retries the connection. Denied permission, missing browser support, missing inputs and input-open failures have separate guidance. Touch and typing keys remain available. Device choices and activity are session-only, not saved in browser storage.

Losing an active selected MIDI input pauses Melody and Rhythm immediately, including a count-in, and silences accompaniment. The current position, partial matches and timing results stay intact; no missed notes or history completion are added while paused. A compact notice stays visible outside the Piano panel with cable/reconnect guidance. Reconnection never resumes practice automatically: press **Play** when ready. Listen mode is not interrupted. To continue without MIDI, choose **Touch/typing keys (no MIDI)** under Piano input or **Disconnect**, then press **Play**; this clears the reconnect reminder without changing saved songs or Studio drafts.

Library → **Open song folder** progressively uses `showDirectoryPicker` when available; otherwise select multiple files via **Import song**. The first slice copies files into local app storage and requires explicit re-opening to refresh, rather than promising permanent background folder access. MusicXML and compressed .mxl import as new playable scores. Save/export a Piano project to retain score and fingerings.

## Score-linked Studio

Import `.musicxml`, `.xml` or compressed `.mxl` directly to create playable notes and readable notation together. Supported partwise piano scores preserve staff-to-hand assignment, printed fingers, chords, tuplets expressed via duration, and ties. Structural playback features that are not supported must fail clearly rather than silently play the wrong sequence. Grace-note approximation is disclosed on import.

For these imported scores, Studio pitch/finger edits and transposition rewrite the MusicXML and re-derive playback. Trim by whole measures (including a pickup) to keep notation and sound aligned; inherited attributes and crossing ties are repaired. Export MusicXML or a Piano project. Editing MIDI-only songs retains the simpler seconds-based editor.

This remains incremental: no freehand note insertion/duration editor or full notation-authoring application yet.

## Practice history and score following

Completed listen, melody and rhythm passes are stored locally with hand, speed range and passage context. Open History for gentle next-step suggestions, JSON backups and explicit delete/clear controls. Storage is bounded; export backups before clearing browser data. Modern Web Locks serialize changes across tabs; without that API, use one app tab to avoid simultaneous-write conflicts.

The score cursor requires unchanged correspondence between MusicXML and playable notes. Written grace positions share the principal note; performed grace timing remains approximate. Follow scrolling is opt-in and stays inside the score pane.

Compressed scores are read locally with strict size, path, integrity and decompression limits. External images and resource links are rejected; no archive resources are fetched. Original imported files are not overwritten.
