# One-time folder snapshot import

This is a separate Library option, not a replacement for native folder shortcuts
or ordinary multi-file import. The button is available when the browser exposes
`HTMLInputElement.webkitdirectory`. Feature detection is not proof that a specific
Android browser or file provider can complete its chooser.

## Platform evidence

[Chromium's Android implementation change](https://chromium.googlesource.com/chromium/src/+/518de271af7db783b4f627f30443743620e01814)
records directory selection support and repairs to Android content-URI filenames
and relative paths. [Google's directory-opening guide](https://web.dev/articles/files/open-a-directory)
describes the directory-file input as the classic alternative to directory handles.
These establish a reasonable progressive-enhancement path, not compatibility
acceptance on the user's device. No native chooser or Android test was performed
for this local implementation, and it does not diagnose the previously observed
native-picker failure.

## Exact scope

- The user explicitly chooses **Import folder once**. There is no automatic
  retry or fallback after a native permission/security error.
- The browser returns a snapshot of files. Piano validates the complete metadata
  selection before reading content: one root, nonempty relative paths, matching
  basenames, no duplicate paths, empty segments, traversal or absolute paths.
  Missing/ambiguous paths are not treated as ordinary files or flattened.
- The metadata guard rejects more than 5,000 entries or paths over 4,096
  characters. This limits app processing, not the browser's earlier enumeration.
- Nested entries and unsupported formats are skipped. The supported top-level
  names are sorted and the first 50 attempts selected. Entries beyond that cap,
  plus selected files over 10 MiB, are never read. The byte limit is checked again
  after a read, before import.
- Each eligible file becomes an in-memory copy containing its bytes, basename
  and MIME type. Relative paths are not persisted, and native read errors use
  fixed guidance instead of exposing private paths.
- The ordinary import pipeline validates the MIDI, MusicXML/MXL or Piano project
  and makes a new library copy. No source is written. Existing songs and fingerings
  are not overwritten. Repeating a selection makes additional copies; this is not
  the content-deduplicated native folder refresh workflow.
- No handle is obtained, permission method called, folder ID fabricated or
  connection record written. An existing remembered shortcut stays unchanged.
- The existing dirty-draft confirmation and import-generation cancellation apply.
  Canceling the chooser retains the draft. Navigation or a newer import prevents
  a delayed selection/read from replacing current work. If saving fails partway
  through, earlier saved copies stay, the failing import remains unsaved with the
  existing recovery notice, and the remainder is not read.

## Validation and acceptance boundary

Synthetic tests cover paths and caps, skipped reads, safe copies, native error
redaction, existing shortcut preservation, repeated imports, ordinary fallback,
dirty cancellation, stale operations and partial storage failure. They do not
exercise a real native picker or grant permission to personal files.

Before claiming target-device support, use an original disposable fixture folder
on Android Chromium. Confirm top-level supported files import, nested/unsupported
files are skipped, cancel retains an unsaved draft, the same folder can be selected
again, and no shortcut/refresh promise appears. Also check the Library controls in
portrait and landscape, large-folder reporting and the ordinary multi-file fallback.
Keep the user's private score out of fixtures and published artifacts.

Real-browser acceptance remains incomplete because preview access was denied.
Keep this feature unreleased until the browser gate is completed. No native
Android compatibility or resolution of the earlier chooser failure is claimed.
