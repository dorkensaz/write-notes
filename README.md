# Write Notes (VA Tools PH)

Floating desktop sticky notes for Windows. Each note is its own small frameless window you can drag anywhere, resize, and pin above other apps. Free forever, works offline, nothing leaves your machine.

## Install (end users)

Run the installer in `dist/` (Write Notes Setup 1.0.0.exe). One click, no options, no dependencies. The app starts with a welcome note and a system tray icon.

## Using it

- **Tray icon**: right-click for New note, Show all notes, the hub, More tools, and Quit. Left-click opens the hub.
- **Hub window**: create notes, see every note (steel square = on your desktop, maroon square = tucked away, click to reopen), the single "More tools" link, and Quit.
- **Each note**: drag by the top bar, resize by any edge, pin above other apps with the pin button. Bold/italic/underline/strikethrough live in the bottom bar (matching where Microsoft's Sticky Notes puts its formatting buttons), applied to your selection or to whatever you type next. Highlight text to bring up a floating toolbar above it for uppercase, lowercase, offline dictionary lookup, and grammar fix. The quick inserts (divider, em dash, arrow, peso sign) and the microphone live in the top bar. Hover anything for a plain-language tooltip.
- **Dictation**: the microphone button in a note's top bar starts and stops speech to text. It turns red while it is listening, and your words land on the note as you talk.
- **Notes and their screen positions** are saved automatically and restore on the next launch. Data lives in `%APPDATA%\Write Notes\notes.json`.

## Dictation

Click the microphone button in a note's top bar to start dictating, click it again to stop. The button turns red while it is listening and the words appear on the note in real time. Words the recognizer is still guessing at show in a muted grey; once it settles on the phrase, that text commits and reads like anything else you typed.

It runs on .NET `System.Speech` (the Microsoft Speech Recognizer 8.0 desktop recognizer), which already ships with Windows. The app drives it through a bundled PowerShell helper, `dictate.ps1`, that streams one JSON object per line back to the note. So dictation is fully offline: no API key, no cloud service, no audio ever leaving the machine, no extra download, and nothing added to the installer beyond a small text script. Grammar checking is still the only feature that ever touches the internet.

Be realistic about accuracy. This is the recognizer built into Windows, not Whisper. It is good for fast free-form word vomit that you tidy up afterwards, and it does not add punctuation for you. Treat it as capture, not as verbatim transcription.

Self-check, run from the app folder:

```
powershell -NoProfile -ExecutionPolicy Bypass -File test-dictate.ps1
```

It synthesizes a spoken sentence to a WAV, feeds that back through the recognizer, and asserts real words come out.

## Grammar checking

Notes try a local LanguageTool server at `http://127.0.0.1:8081` first and fall back to the free public LanguageTool API (the only feature that ever touches the internet). Fully offline setup, optional:

```
winget install -e --id EclipseAdoptium.Temurin.21.JRE
```

then download and unzip https://languagetool.org/download/LanguageTool-stable.zip and run, from the unzipped folder:

```
java -cp languagetool-server.jar org.languagetool.server.HTTPServer --port 8081 --allow-origin "*"
```

## Development

- `npm install` then `npm start` to run from source.
- `npm run dist` builds the Windows installer into `dist/`.

## Why Electron and other decisions

1. **Electron over Tauri**: Tauri would give a smaller download, but it needs the Rust + MSVC toolchain, which is not on this machine. Electron runs on the Node that is already here, its frameless/tray/always-on-top APIs are mature, and electron-builder produces a one-click NSIS installer. Reliability of the build beat download size.
2. **Dictionary bundled**: the offline Webster's 1913 JSON (22 MB) ships inside the installer, so dictionary lookups work with zero setup and no first-run download.
3. **Storage**: plain JSON in the per-user app-data folder, written atomically. Notes, positions, sizes, and pin states all live there.
4. **Window shape**: notes are opaque frameless windows. Windows 11 rounds the actual window frame uniformly; the VA Tools PH asymmetric top-left signature is drawn as a steel corner accent inside each note and as real border-radius on inner cards (hub items, definition panel, the About portrait).
5. **Closing a note hides it, deleting removes it**: the X tucks a note away (it stays in the hub list); only the maroon trash button deletes.
6. **More apps links**: point to the live VA Tools PH catalog (Record & Transcribe, File Invoices, Manage Prompts, plus Write Notes itself so the page works as a shareable catalog on its own).
7. **Rich text storage**: each note's content is stored as HTML (`html` field in `notes.json`) instead of plain text, so bold/italic/underline/strikethrough survive a restart. Older plain-text notes migrate automatically on first load after this update.
8. **Bold/italic/underline/strikethrough** use the browser's built-in `execCommand`, deprecated but still functional in Chromium; the note stays a single block of inline text and `<br>` line breaks (Enter is intercepted to insert a line break, not a new paragraph) so the uppercase/lowercase/grammar tools only ever have to deal with one flat run of text, not nested paragraphs.
9. **Selection-dependent tools float, format toggles stay put**: uppercase, lowercase, dictionary, and grammar-fix only make sense with text already highlighted, so they live in a floating toolbar that appears above the selection (like Word or Notion) instead of sitting always-visible and inert. Bold/italic/underline/strikethrough stay in the persistent bottom bar since, like in Microsoft's Sticky Notes, they can also toggle formatting for whatever you type next, not just an existing selection.
10. **Icon tool crash workaround**: electron-builder's bundled PNG-to-ICO converter kept crashing on this machine under memory pressure. The Windows icon now ships as a hand-built `build/icon.ico` (a raw PNG wrapped in a standard ICO container) so the build never calls that external converter.
11. **The browser's Web Speech API does not work in Electron**: this was tested, not assumed, so nobody should burn a day re-testing it. `webkitSpeechRecognition` fails with a `network` error because Electron ships no Google speech key, and Chromium's newer on-device speech path is not bound in Electron at all (reaching for it kills the renderer process with "No binder found for interface media.mojom.OnDeviceSpeechRecognition"). Windows' own Win+H voice typing was ruled out too: it makes the user accept an online-speech privacy consent flow that is not accepted on a fresh machine, so it fails the "works immediately" bar, and it sends audio to Microsoft.
12. **Dictation runs on .NET `System.Speech` via a bundled PowerShell script**: the Microsoft Speech Recognizer 8.0 desktop recognizer is already part of Windows, so `dictate.ps1` drives it and streams one JSON object per line (partial guesses and committed phrases) back to the note. That keeps dictation fully offline with no API key, no cloud call, and no model download, and it adds only a small text script to the installer. The trade is accuracy: this recognizer is built for capture you clean up, not for verbatim transcription. The one-JSON-object-per-line protocol is deliberately dumb so a better engine can be swapped in behind it later without the app changing.
