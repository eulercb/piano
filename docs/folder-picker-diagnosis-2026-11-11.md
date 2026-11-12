# Folder picker diagnosis: 2026-11-11

The [public browser observation](browser-extensions-2026-11-11.md#native-folder-blocker-and-remaining-acceptance)
remains an unexplained native chooser failure. No underlying exception was captured,
and this change does not establish a successful native picker, permission or
reconnect test. Verification used original synthetic fixtures, not private scores.

## Findings and bounded correction

- Confirmed implementation defect: after restoring a saved shortcut, **Open song
  folder** attempted to call a missing picker rather than offering ordinary file
  import. Availability now checks for a callable picker and distinguishes opening
  a new folder from explicitly refreshing the saved one. Reconnect still works
  without a picker when an existing handle is available.
- Preserve the Window receiver explicitly when invoking the picker, synchronously
  from the click before any `await`. This is defensive host compatibility, **not a
  proven diagnosis** of the observed failure. [Web IDL operation bindings](https://webidl.spec.whatwg.org/#es-operations)
  substitute the realm global object for a null/undefined receiver; extracting a
  same-realm Window method alone therefore does not establish illegal invocation.
  A synthetic receiver-sensitive host regression verifies the explicit receiver
  and synchronous invocation, not native activation or browser binding behavior.
- [File System Access](https://wicg.github.io/file-system-access/#api-showdirectorypicker)
  and [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)
  describe transient activation/origin restrictions, and AbortError can mean
  cancellation, a rejected sensitive directory or permission not granted. The UI
  therefore does not label every abort as a deliberate user cancellation.
- Failures now distinguish chooser opening, browser access restrictions, permission
  refusal, reconnect and interrupted refresh. Notices use fixed text and never
  interpolate the native outer exception message or local path. An interrupted
  scan says already saved songs are kept rather than falsely promising that no
  earlier successful import in the same scan changed the library.
- No automatic picker retries, permission grants, background scans, write access,
  saved-song removal, draft replacement or storage migrations are introduced.
  A stale operation cannot replace the current notice. Permission queries can
  still outlive browser activation on reconnect; a resulting rejection now has
  safe guidance, rather than bypassing browser restrictions or requesting access
  on app startup.

## Verification boundary

Focused synthetic tests cover receiver-sensitive hosts, immediate invocation,
missing/non-callable picker fallback with a restored shortcut, real App file-import
fallback, explicit saved-handle reconnect, AbortError/SecurityError/NotAllowedError
and unknown failures, safe messages, retry, unsaved draft retention, stale rejection,
vanished directories, existing refresh/dedup/changed-copy behavior and MIDI recovery.
They do not prove native chooser behavior. A permitted deployed native retry is
still needed, followed by original synthetic directory selection and refresh if
supported. Until then the production native failure's root cause remains unknown.
