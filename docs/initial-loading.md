# Initial application loading

The practice room does not evaluate the note-authoring UI/writer or the bounded MusicXML/`.mxl` file importer until they are needed. Entering Studio requests authoring; selecting a score file requests the importer and its DEFLATE dependency. The notation renderer remains a separate lazy chunk.

The saved-library reader, project validator, safe inline-XML validation and playable MusicXML parser remain in the initial graph. They are required to validate persisted data and preserve blocked legacy source recovery. This change does not defer or relax those checks.

## Loading and recovery

- Studio shows a loading status while note authoring arrives. Other controls, navigation, save and export remain available. A failed load exposes **Retry note authoring** without reloading or replacing the piece.
- An explicit retry moves focus to the persistent tools region before its button is disabled. Async completion never moves focus, so navigating or focusing another control while waiting is respected.
- Only a successfully loaded authoring module is retained. No song, draft props or rejected promise is cached by the loading boundary. Returning to Studio after success can render the module synchronously. Existing editor behavior is unchanged: apply form changes to make them part of the open song draft before navigating.
- Failed score-import loading keeps the current piece and library intact. Choose the same file again to request it again. A newer navigation, edit or import invalidates older pending imports before file reading and before persistence.
- Retry tests establish that the application calls its module loader again and retains the draft. They do not establish recovery from every browser's native failed-module/cache behavior. Repeated failure stays visible; there is no automatic reload that could lose unsaved edits.

## Reproducing the measurement

Run `npm run measure:bundle` after installing the existing lockfile. It performs one normal Vite/PWA production build with a build-only observer, prints final chunk byte/gzip sizes and runs four synthetic graph-check contracts. It does not download tools or change the production Vite/PWA configuration.

The observer walks the emitted entry's static JavaScript imports, including shared chunks and cycles. It fails if either authoring module, either note writer, the score-file importer or DEFLATE is statically reachable from the initial entry, or if saved-library/source/project validation is no longer eager. It uses module identities rather than guessing from hashed filenames. It does not emit source/module filesystem paths into the application.

`npm run build` remains the usual typecheck and production build used in CI. The optional measurement is not added as a second CI build. For a single-build local gate, use `npx tsc --noEmit`, `npm run measure:bundle` and then `npm run check:release`. The release check independently verifies all emitted JavaScript, CSS and other app assets are actually in the service worker's precache, including the new authoring CSS and both lazy chunks. Removing eager work does not remove offline assets or change explicit service-worker update consent.

## What the results mean

The pre-change main build (`777357cee34bd0f1f7c4a30c0e7f8514dec80a48`) had one 506,182-byte initial app chunk (165,116 bytes gzip). The baseline module graph identified the score importer/DEFLATE and authoring UI/writers as preparation-only code; the XML parser was deliberately left eager.

Compare the final emitted sizes in the validation record. These are production artifact measurements, not network-transfer, startup-time, memory or device-latency results. The service worker still downloads all chunks to support offline use, and splitting introduces a small aggregate code overhead. The initial-graph total excludes the service-worker registration/runtime, CSS, offline precache traffic and notation-renderer cost when opening a score. Actual browser failed-load recovery, rendered focus behavior, installed/offline PWA lifecycle, Android/Casio MIDI and latency remain unverified by these synthetic tests.
