# comπle Web

A containerized, browser-based code editor built on React, Monaco Editor, and Node.js with native Google Gemini integration for inline ghost text completions and contextual code assistance.

---

## Overview

comπle Web is a lightweight development environment designed to run inside any modern web browser. The project originated as an Electron desktop application and was re-engineered into a decoupled client-server web architecture using Docker. This shift eliminates platform-specific desktop installations while maintaining low-latency code editing, language server support, interactive shell access, and AI assistance.

---

## Architectural Migration: From Electron to Web

### The Original Desktop Architecture

In the initial Electron setup:
- The **Electron Main Process** held privileged access to the local host operating system, spawning native processes (`node-pty`, compiler toolchains) and directly interacting with the filesystem via Node's `fs` module.
- The **Renderer Process** (React and Monaco Editor) communicated with the main process across Electron's asynchronous and synchronous IPC channels (`ipcRenderer.invoke` -> `ipcMain.handle`), exposed through a `preload.js` script on the `window.api` global object.
- File and directory pickers relied on native OS window dialogs (`dialog.showOpenDialog`) to select host directories.

```
+--------------------------------------------------------+
|  Electron Desktop Application                          |
|                                                        |
|  Renderer (React + Monaco Editor UI)                   |
|       |                                                |
|       | (IPC via contextBridge / preload.js)           |
|       v                                                |
|  Main Process (Node.js, local fs, node-pty, toolchains)|
|       |                                                |
|       v                                                |
|  Host Operating System (Windows / macOS / Linux)       |
+--------------------------------------------------------+
```

### Challenges of Migrating to the Browser

Transitioning this application to run in a web browser presented several technical constraints:

1. **Absence of Host Filesystem Access**: Modern browsers execute in a strict sandbox. Client-side JavaScript cannot directly access the host machine's filesystem or invoke compilers like `g++` and `clangd`.
2. **Terminal and Process Spawning**: Web applications cannot spawn POSIX pseudo-terminals (`node-pty`) on the client; terminal execution requires a server-side shell environment piped over a duplex transport.
3. **Browser Keybinding Collisions**: Crucial code editor shortcuts (such as `Ctrl+O` for opening files, `Ctrl+S` for saving, and `Ctrl+P` for navigation) are intercepted by default browser behaviors, causing tabs to navigate away or print page dialogs to open.
4. **Codebase Coupling**: The frontend codebase contained hundreds of references to `window.api.<method>()`. Rewriting all component calls to disparate HTTP endpoints would introduce significant regression risk.

---

## How Docker Enabled the Migration

Docker provided the isolation and runtime environment necessary to transform the monolithic Electron app into a decoupled, reproducible client-server system.

```
                               Web Browser Client
                            (http://localhost:8000)
                                       |
                    +------------------+------------------+
                    | HTTP (Static Assets)   HTTP /api/*  |
                    v                                     v
+--------------------------------------+  +--------------------------------------+
|       Frontend Container (Nginx)     |  |       Backend Container (Node.js)    |
|  - Multi-stage Vite build            |  |  - Express REST & WebSocket server   |
|  - Serves React + Monaco bundle      |  |  - Interactive PTY (node-pty + bash) |
|  - Reverse-proxies /api/ to backend  |  |  - Embedded LSPs (clangd, gopls, etc)|
|  - Cache-busting headers for index   |  |  - Real-time fs.watch event emitter  |
+--------------------------------------+  +--------------------------------------+
                                                             |
                                                  Mounted Workspace Volume
                                               ./test-workspace -> /workspace
```

### 1. Headless Containerized Backend (`compile-backend`)

The backend container replaces the Electron Main Process:
- **Base Environment**: Built on `node:20-bookworm-slim` with build essentials (`make`, `g++`, `python3`) required to compile native addons like `node-pty`.
- **Language Server Toolchains**: Packages `clangd` (C/C++), `golang` and `gopls` (Go), `default-jdk` and `Eclipse JDTLS` (Java), and `pyright` (Python).
- **Interactive Pseudo-Terminal**: Spawns real `bash` PTY instances (`node-pty`) and streams bidirectional input/output over WebSockets to `xterm.js` in the browser.
- **Filesystem Watcher**: Runs a recursive in-container watcher (`fs.watch`) on `/workspace`. When files or directories are created, modified, or removed via terminal commands (`mkdir`, `touch`, `rm`, `git checkout`), debounced change events are pushed over WebSockets so the frontend Explorer updates immediately without manual browser refreshes.
- **Sandboxed Workspace**: Mounts the host directory (`./test-workspace`) to `/workspace` in the container, providing an isolated development environment without exposing the host system.

### 2. Static Frontend & Reverse Proxy (`compile-frontend`)

The frontend container is configured with a two-stage build:
- **Builder Stage**: Uses Node 20 Alpine to compile the React and Monaco Editor application with Vite, resolving web workers and dependencies into optimized bundles.
- **Runner Stage**: Uses Alpine Nginx to serve the compiled static assets. Nginx also serves as a reverse proxy, forwarding requests from `/api/*` to the backend container (`http://backend:3000/api/`) over Docker's internal network.

### 3. Virtual IPC Bridge (`window.api` Polyfill)

To maintain compatibility with existing Electron-oriented React components, [`main.jsx`](client/src/renderer/src/main.jsx) implements a lightweight bridge:
- Re-exposes the `window.api` interface expected by the UI.
- Directs file operations (`getFileContents`, `saveFileContents`, `deleteItem`, `renameItem`) and terminal actions (`createTerminal`, `killTerminal`, `sendTerminalData`) across a WebSocket connection using JSON-RPC patterns (`wsInvoke`).
- Implements web-compatible file and directory importers (`input[type="file"]`, `webkitdirectory`) and global drag-and-drop event listeners that transfer files directly into the container's `/workspace`.
- Blocks browser default actions on keyboard events (<kbd>Ctrl</kbd> + <kbd>O</kbd>, <kbd>Ctrl</kbd> + <kbd>S</kbd>, <kbd>Ctrl</kbd> + <kbd>P</kbd>) so shortcut chords function as expected inside the IDE.

---

## Core Features

- **Monaco Code Editor**: Code editing with syntax highlighting, line numbers, multi-cursor, bracket matching, and word wrap.
- **AI Ghost Text (Inline Completions)**: Native `inlineCompletionsProvider` integrating with Google Gemini to display debounced suggestions inline, accepted with <kbd>Tab</kbd>.
- **Contextual AI Chat Sidebar**: Right-hand chat panel with full active file context and cursor-highlighted text tracking for code explanation and refactoring.
- **Interactive Terminal**: Full ANSI color terminal running `bash` via `node-pty` and `xterm.js`.
- **Live Workspace Sync**: Automatic explorer updates on terminal file operations via backend recursive filesystem monitoring.
- **Flexible Key Configuration**: Works out-of-the-box using the server `.env` Gemini API key, with client-side override options in settings.

---

## Getting Started

### Prerequisites

- Docker (v20.10 or higher)
- Docker Compose (v2.0 or higher)
- A Google Gemini API Key

### Setup Instructions

1. Clone the repository:
   ```bash
   git clone https://github.com/iamkartik0704/compile-web.git
   cd compile-web
   ```

2. Create an environment file:
   ```bash
   cp .env.example .env
   ```
   Add your Gemini API key to `.env`:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

3. Build and run the containers:
   ```bash
   docker compose up --build -d
   ```

4. Open the application:
   Navigate to `http://localhost:8000` in your web browser.

---

## Project Structure

```
compile-web/
|-- client/                     # Frontend React + Monaco web application
|   |-- src/
|   |   |-- renderer/src/
|   |   |   |-- components/     # UI Components (Sidebar, CodeEditor, Terminal, AI Chat)
|   |   |   |-- store/          # Zustand State Stores (Shortcuts, Settings)
|   |   |   |-- main.jsx        # Virtual IPC Bridge (window.api polyfill)
|   |   |   `-- App.jsx         # Layout, keyboard router, status bar
|   |   `-- index.html
|   |-- nginx.conf              # Reverse proxy configuration
|   `-- Dockerfile              # Multi-stage Vite builder and Nginx runner
|
|-- server/                     # Backend execution service
|   |-- index.js                # Express API, WebSocket RPC gateway, and PTY manager
|   |-- package.json
|   `-- Dockerfile              # Linux container with node-pty, clangd, gopls, jdtls
|
|-- test-workspace/             # Host directory mounted to /workspace
|-- docker-compose.yml          # Container configuration
|-- .env.example                # Environment variable template
`-- README.md                   # Documentation
```

---

## Technology Stack

- **Frontend**: React 18, Monaco Editor (`@monaco-editor/react`), `xterm.js`, Zustand, Lucide Icons, React Markdown
- **Web Server**: Nginx (Alpine Linux)
- **Backend**: Node.js (v20), Express, `ws` (WebSockets), `node-pty`
- **Language Servers**: `clangd` (C/C++), `gopls` (Go), `jdtls` (Java), `pyright` (Python)
- **AI Integration**: Google Gemini API (`gemini-2.5-flash`)
- **Containerization**: Docker, Docker Compose

---

## License

This repository does not currently include an explicit root license file. The package metadata in `client/package.json` references the MIT license. Please check with the repository owner for formal licensing terms before commercial use or redistribution.
