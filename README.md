# Piano Studio

A local-first browser piano practice workspace. Roadmap: [issue #8](https://github.com/eulercb/piano/issues/8).

## Develop

Node 22+; `npm ci`, `npm run dev`. Validate with `npm test` and `npm run build`.

The first slice supports MIDI preparation, a local song library, listening, wait-for-note melody practice and a reading-score reference. No account or server-side music storage. Browser MIDI access is optional and requested on click; use Chrome/Edge where Web MIDI is supported. Touch keys and A–; are a demo fallback, not full piano input.

## Scope and limits

- MIDI 0/1 import: tempo maps, note pairs, running status and sustain. Hands are a pitch heuristic except for projects with explicit assignments. Review the result in Studio.
- Studio: trim seconds non-destructively, transpose, edit note pitch/hand/finger, save locally and export MIDI or a versioned Piano project. MIDI export does not preserve fingerings; project export does.
- Melody waits for the next note/chord. Listen mode plays the selected piece. Rhythm/recital scoring, count-in, progress history and advanced editing remain backlog work.
- MusicXML embedded in a Piano project renders as the original reading score. Edits and trimming currently change playback only, not that reference score. It is explicitly labelled and not automatically synchronized/highlighted.
- Original demo "Morning Light" is supplied. User-owned Valsa do Adeus project assets must be imported privately; no photographed score or third-party arrangement is published in this repository.
- Synthesized triangle tones are a lightweight preview, not a sampled grand piano. Physical MIDI and mobile installation require real-device verification.
- Local browser storage may be cleared by the browser. Export a project backup.

## GitHub Pages

The workflow tests and builds PRs, then deploys successful main pushes through GitHub Pages. Set repository Settings → Pages → Source to **GitHub Actions**, custom domain `piano.zen.dev.br`, and enable HTTPS when GitHub provisions its certificate. The custom domain is included in `public/CNAME`. DNS must point to this repository's GitHub Pages host. Workflow configuration alone is not proof of a live deployment.

## Android and a USB-C piano

Target: current Chrome on Android, with a class-compliant USB MIDI Casio and suitable USB-C/OTG adapter. This hardware path is not yet physically tested. Tap **Connect piano** after opening the HTTPS app, allow access, then play. No microphone recognition or sysex is requested.

Library → **Open song folder** progressively uses `showDirectoryPicker` when available; otherwise select multiple files via **Import song**. The first slice copies files into local app storage and requires explicit re-opening to refresh, rather than promising permanent background folder access. MusicXML can be attached as a score reference to the current song; it does not replace MIDI playback. Save/export a Piano project to retain score and fingerings.
