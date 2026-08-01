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

It runs on Whisper, locally, through the `faster-whisper` library. The app drives it with a bundled helper, `dictate.py`, that streams one JSON object per line back to the note.

Two model tiers do the work, because no single model is both instant and accurate. `tiny.en` repaints the greyed live text while you are still talking, and `base.en` re-transcribes the finished phrase and commits the accurate version. That is why text appears fast and still ends up right. Phrases are cut apart by an energy-based voice activity detector: a pause of a little under half a second ends a phrase and commits it.

It is tuned to hear you rather than to be safe. The gate sits just above the room's own noise floor, a rolling pre-roll keeps the attack of your first word (which a gate always clips), quiet audio is gain-normalized before it reaches Whisper, and Whisper's own internal voice filter is switched off, since it is a second gate that throws away quiet speech this app already decided was speech. The self-check proves this by running the same sentence again at a fraction of its volume.

Transcription runs on its own thread, so it can never stall audio capture, and only the newest live repaint is kept when the transcriber falls behind. Whisper pads every call out to a fixed window, so a phrase costs about the same to transcribe whether it was short or long. `base.en` commits in roughly two thirds of a second against a bit over two seconds for `small.en`, which is why the faster one is the default. Set `WN_MODEL=small.en` to trade that back for accuracy on harder audio (strong accents, background noise, mumbling); `WN_FAST_MODEL` swaps the live tier the same way.

Dictation is offline. No API key, no cloud service, and no audio ever leaves your machine. The one honest nuance: the Whisper model files themselves download once from HuggingFace the first time they are needed and are then cached on disk, after which dictation works with no network at all. Grammar checking is still the only feature that ever sends anything you write out to the internet.

You do not need Python installed. For end users the helper is packaged into a standalone executable that ships with the app.

Accuracy is why this engine was chosen. Windows' own built-in SAPI recognizer was wired up first and tested with real speech, and it failed badly: the spoken sentence "Hi. My name is Ken, and I am saying the exact same thing that I am saying to Claude." came back as "Scandals that I'm saying the exact since then that I and lazy gotten sought". Local Whisper, on that same audio, returned the sentence correctly, name included, with punctuation and capitalization. That is the whole reason for the switch, written down so nobody puts the old engine back.

Self-check for developers, run from the app folder:

```
python test-dictate.py
```

It speaks a known sentence into a WAV, replays that audio through the real voice-detection and transcription pipeline, and asserts the committed text matches. It needs no microphone.

## Grammar checking

Notes try a local LanguageTool server at `http://127.0.0.1:8081` first and fall back to the free public LanguageTool API (the only feature that ever sends your text off the machine). Fully offline setup, optional:

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
- Dictation from source needs a Python environment with `faster-whisper`, `numpy`, and `pyaudiowpatch`. End users never see this: the packaged app ships the helper as a standalone executable instead.

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
11. **Three speech engines were tried and rejected before Whisper**: all tested, not assumed, so nobody burns a day re-testing them. (a) The browser's Web Speech API does not work in Electron at all. `webkitSpeechRecognition` fails with a `network` error because Electron ships no Google speech key, and Chromium's newer on-device speech path is not bound in Electron either (reaching for it kills the renderer process with "No binder found for interface media.mojom.OnDeviceSpeechRecognition"). (b) Windows' own Win+H voice typing makes the user accept an online-speech privacy consent flow that is not accepted on a fresh machine, so it fails the "works immediately" bar, and it sends audio to Microsoft. (c) Windows' built-in SAPI recognizer ran, but its accuracy was unusable on real speech: "Hi. My name is Ken, and I am saying the exact same thing that I am saying to Claude." transcribed as "Scandals that I'm saying the exact since then that I and lazy gotten sought". Local Whisper was the remaining option that is both accurate and private.
12. **Dictation runs on local Whisper via a bundled Python helper**: `dictate.py` uses `faster-whisper` and streams one JSON object per line (partial guesses and committed phrases) back to the note, and it is shipped to end users as a standalone executable so nobody has to install Python. Two model tiers are used on purpose, since no single model is both instant and accurate: `tiny.en` keeps the greyed live text moving while you talk, `base.en` re-transcribes each finished phrase and commits the accurate version (`WN_MODEL` swaps it for `small.en` if you want accuracy over speed). Phrase boundaries come from an energy-based voice activity detector, with a pause of a little under half a second ending a phrase. Transcription runs on a worker thread so it can never stall audio capture, and the gate is deliberately tuned towards false positives: pre-roll, gain normalization, and Whisper's own voice filter disabled, so quiet speech is not silently dropped. Audio still never leaves the machine; only the model files are fetched once, on first use, and cached. The one-JSON-object-per-line protocol is deliberately dumb so the engine behind it can be swapped without the app changing, which is exactly what happened when the Windows recognizer was replaced.
