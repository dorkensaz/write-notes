# Write Notes (VA Tools PH)

Floating desktop sticky notes for Windows. Each note is its own small frameless window you can drag anywhere, resize, and pin above other apps. Free forever, works offline, nothing leaves your machine.

## Install (end users)

Run the installer in `dist/` (Write Notes Setup 1.0.0.exe). One click, no options, no dependencies. The app starts with a welcome note and a system tray icon.

## Using it

- **Tray icon**: right-click for New note, Show all notes, the hub, More tools, and Quit. Left-click opens the hub.
- **Hub window**: create notes, see every note (steel square = on your desktop, maroon square = tucked away, click to reopen), the single "More tools" link, and Quit.
- **Each note**: drag by the top bar, resize by any edge, pin above other apps with the pin button, and use the toolbar: uppercase, lowercase, offline dictionary lookup, grammar fix, divider insert, em dash insert, random ice-breaker. Hover anything for a plain-language tooltip.
- **Notes and their screen positions** are saved automatically and restore on the next launch. Data lives in `%APPDATA%\Write Notes\notes.json`.

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
6. **More apps links**: Record & Transcribe, File Invoices, and Manage Prompts point to placeholder vatools.ph URLs until the real ones exist.
