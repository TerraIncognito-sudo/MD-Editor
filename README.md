# MD Editor

A local-only, lightweight markdown editor for Windows. Browse a folder of
markdown notes in a sidebar and edit them in a live, Word-like preview where
formatting renders as you type — headings look like headings, **bold** looks
bold, and so on.

Built as a trustworthy, offline alternative to heavier note apps: it only ever
touches the folder you open, makes no network requests, and stores nothing
beyond a small local config remembering your last-opened folder.

## Features

- **File browser** — pick any folder; the sidebar shows its subfolders and
  markdown files (`.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx`).
- **Live preview editing** — a WYSIWYG markdown editor (Milkdown) renders
  formatting inline while keeping the file as plain markdown on disk.
- **Save with `Ctrl+S`** — writes straight back to the original file.
- **New note** — the `+` button creates a markdown file in the current folder.
- **Session restore** — reopens your last folder and note on launch.
- **Local only** — no accounts, no telemetry, no network access.

## Requirements

- Windows 10/11 (uses the built-in WebView via Electron)
- [Node.js](https://nodejs.org/) 18+ and npm (for building from source)

## Development

```bash
npm install      # install dependencies
npm run dev      # launch the app with hot reload
```

## Building the Windows installer

```bash
npm run build:win
```

The installer is written to `dist/` as `MD Editor-<version>-setup.exe`. Run it to
install the app; it creates Start Menu and desktop shortcuts and can be removed
from **Add or remove programs**.

## Project layout

```
src/
  main/      Electron main process — window + file-system access (IPC)
  preload/   Secure bridge exposing a minimal `window.api` to the UI
  renderer/  React UI — sidebar file tree + Milkdown editor
```

## License

MIT
