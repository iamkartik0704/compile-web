# comπle Web: Containerized Browser-Based IDE with AI Intelligence

> A high-performance, containerized web code editor featuring Monaco Editor, real-time bash pseudo-terminals, language servers, and native Google Gemini AI integration (inline Ghost Text completions & contextual chat).

---

## 📖 Overview

**comπle Web** is an extensible, browser-accessible Integrated Development Environment (IDE). Originally conceived as an Electron-based desktop application, this project was systematically re-engineered and containerized using **Docker** into a client-server architecture capable of running inside any modern web browser while preserving low-latency editor performance, real interactive shell execution, and intelligent code assistance.

---

## 🏗️ Architectural Evolution: From Electron to Dockerized Web IDE

### The Starting Point: Desktop Electron Architecture
In its original Electron architecture:
- The **Electron Main Process** held direct access to host OS resources: Node.js `fs`, native `child_process`, and binary addons like `node-pty`.
- The **Renderer Process** (React + Monaco Editor) interfaced through Electron's synchronous/asynchronous IPC channels (`ipcRenderer.invoke` -> `ipcMain.handle`) exposed via `preload.js` on `window.api`.
- Operating system file dialogs (`dialog.showOpenDialog`) accessed arbitrary host directory paths directly.

```
[ Electron Desktop App ]
┌────────────────────────────────────────────────────────┐
│  Renderer (React + Monaco UI)                         │
│       │ (Preload ContextBridge)                        │
│       ▼                                                │
│  Main Process (Node.js, local fs, pty, compilers)      │
│       │                                                │
│  Host Operating System (Windows / macOS / Linux)       │
└────────────────────────────────────────────────────────┘
```

### The Web Migration Challenge
Migrating a desktop IDE to a standard web browser introduces critical hurdles:
1. **Browser Sandbox Restrictions**: Web browsers cannot execute arbitrary shell processes, spawn system compilers (`g++`, `clangd`), or directly write to the host file system.
2. **Browser Shortcut Collisions**: Crucial IDE keybindings (<kbd>Ctrl</kbd> + <kbd>O</kbd>, <kbd>Ctrl</kbd> + <kbd>S</kbd>, <kbd>Ctrl</kbd> + <kbd>P</kbd>) are hijacked by Chrome/browser default actions (e.g. Chrome navigating away to open raw local files).
3. **Massive Codebase Coupling**: Hundreds of UI components relied on `window.api.<method>()` desktop semantics. Completely rewriting every frontend component would introduce regressions and high maintenance overhead.

---

## 🐳 How Docker Transformed the Architecture

Docker served as the foundational pillar to bridge the desktop-to-web paradigm, containerizing the runtime environment into two decoupled microservices:

```
                                [ Modern Web Browser ]
                             http://localhost:8000
                                       │
                    ┌──────────────────┴──────────────────┐
                    │ HTTP (Static SPA)      HTTP /api/*  │
                    ▼                                     ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐
│       Frontend Container (Nginx)     │  │       Backend Container (Node.js)    │
│  - Multi-stage Vite build            │  │  - Headless Execution Engine         │
│  - Serves React + Monaco bundle      │  │  - WebSocket API & JSON-RPC Gateway  │
│  - Reverse-proxies /api/ to backend  │  │  - Interactive PTY (node-pty + bash) │
│  - SPA routing fallback              │  │  - Language Servers (clangd, gopls)  │
└──────────────────────────────────────┘  │  - Recursive File Watcher (fs.watch) │
                                          └──────────────────┬───────────────────┘
                                                             │
                                                  Mounted Volume Storage
                                                  ./test-workspace ➔ /workspace
```

### 1. The Headless Backend Execution Engine (`compile-backend`)
- **Docker Base**: Built on `node:20-bookworm-slim` to support compiling native C++ addons (`node-pty` built against POSIX pseudo-terminals).
- **Embedded Toolchains**: Pre-installs `g++`, `clangd` (C/C++), `golang` & `gopls` (Go), `default-jdk` & `Eclipse JDTLS` (Java), and `pyright` (Python).
- **Terminal Streaming**: Spawns real interactive `bash` pseudo-terminals over WebSockets, piping ANSI terminal data back and forth between the backend container and `xterm.js` in the browser.
- **Real-Time File System Watcher**: Runs a recursive in-container `fs.watch` debounced broadcast on `/workspace`. Whenever commands like `mkdir`, `touch`, `rm`, or `git checkout` run in the terminal, the sidebar file tree auto-refreshes in real time without manual browser reload.
- **Isolated Workspace Volume**: Mounts a host directory (`./test-workspace`) to `/workspace` inside the container, granting users safe, sandboxed file execution without exposing their root filesystem.

### 2. Multi-Stage Production Web Frontend (`compile-frontend`)
- **Stage 1 (Builder)**: Compiles the React + Monaco Editor application using Vite, bundling web workers (`editor.worker`, `ts.worker`, `html.worker`) and vendor chunks.
- **Stage 2 (Runner)**: Serves static assets through a lightweight Alpine Nginx container. Nginx acts as a reverse proxy, forwarding `/api/*` REST traffic directly to the backend container over Docker's internal network bridge (`http://backend:3000`).

### 3. Virtual IPC Bridge (Polyfilling `window.api`)
Rather than refactoring thousands of lines of UI code across the application, the web frontend implements an elegant **WebSocket & REST Virtual IPC Bridge** in [`main.jsx`](client/src/renderer/src/main.jsx):
- Polyfills `window.api` with asynchronous remote procedure calls (`wsInvoke`) that mirror the Electron desktop API signatures.
- Automatically routes file CRUD operations, shell sessions, language server protocol (LSP) payloads, and AI generation calls across the network.
- Implements web-native file pickers (`input[type="file"]`, `webkitdirectory`) and global **Drag-and-Drop** listeners: dropping files or folders from Windows/macOS into the browser instantly uploads them into the container's `/workspace` and opens them in Monaco.

---

## ⚡ Key Features

- **Monaco Code Editor**: Full VS Code-style editing experience with syntax highlighting, multi-cursor, bracket matching, diff viewers, and minimap.
- **AI Ghost Text (Inline Autocomplete)**: Non-intrusive AI ghost text suggestions generated via Google Gemini 2.5 Flash as you type, accepted with <kbd>Tab</kbd> and dismissable with <kbd>Esc</kbd>.
- **Contextual AI Chat Sidebar**: Right-docked AI assistant that automatically incorporates active file contents and cursor-highlighted code snippets into prompt contexts for instant explanations, refactoring, and code generation.
- **Real Interactive Bash Terminal**: Full `xterm.js` terminal connected to a live `bash` process inside the Linux container, supporting standard UNIX utilities, Git, package managers, and script execution.
- **Live File Synchronizer**: In-container filesystem watcher automatically keeps the file tree in sync with terminal commands.
- **Dual AI Key Support**: Seamless fallback to server-configured `.env` API keys, with optional client-side local storage overrides for personal keys.
- **Browser Conflict Guards**: Built-in keyboard interceptors block standard browser actions (<kbd>Ctrl</kbd> + <kbd>O</kbd>, <kbd>Ctrl</kbd> + <kbd>S</kbd>, <kbd>Ctrl</kbd> + <kbd>P</kbd>) from breaking IDE navigation.

---

## 🚀 Quick Start Guide

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/) (v2.0+)
- Google Gemini API Key ([Google AI Studio](https://aistudio.google.com/))

### Installation & Launch

1. **Clone the repository**:
   ```bash
   git clone https://github.com/iamkartik0704/compile-web.git
   cd compile-web
   ```

2. **Configure your Environment**:
   Create a `.env` file in the root directory (or copy from `.env.example`):
   ```bash
   cp .env.example .env
   ```
   Add your Gemini API key:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

3. **Build and Launch via Docker Compose**:
   ```bash
   docker compose up --build -d
   ```

4. **Access the IDE**:
   Open your browser and navigate to:
   ```
   http://localhost:8000
   ```

---

## 📁 Repository Structure

```
compile-web/
├── client/                     # Frontend SPA (React + Vite + Monaco)
│   ├── src/
│   │   ├── renderer/src/
│   │   │   ├── components/     # UI Components (Sidebar, CodeEditor, Terminal, AI Chat)
│   │   │   ├── store/          # Zustand State Stores (Shortcuts, Settings, UI)
│   │   │   ├── main.jsx        # Virtual IPC Bridge (Polyfill over WebSockets)
│   │   │   └── App.jsx         # Global Layout, Keybinding Router, Status Bar
│   │   └── index.html
│   ├── nginx.conf              # Nginx reverse proxy configuration
│   └── Dockerfile              # Multi-stage Vite builder & Alpine runner
│
├── server/                     # Backend Headless Execution Service
│   ├── index.js                # Express REST, WebSocket RPC server & PTY manager
│   ├── package.json
│   └── Dockerfile              # Debian container with node-pty, clangd, gopls, jdtls
│
├── test-workspace/             # Host directory mounted to /workspace in container
├── docker-compose.yml          # Container orchestration service definitions
├── .env.example                # Example environment variables template
└── README.md                   # Project documentation
```

---

## 🛠️ Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend UI** | React 18, Monaco Editor (`@monaco-editor/react`), `xterm.js`, Zustand, Lucide Icons, React Markdown |
| **Frontend Server** | Nginx Alpine (Reverse Proxy, Static Asset Serving, Cache Busting) |
| **Backend Core** | Node.js (v20), Express, `ws` (WebSockets), `node-pty` (POSIX PTY) |
| **Language Toolchains** | `clangd` (C/C++), `gopls` (Go), `jdtls` (Java), `pyright` (Python), `typescript-language-server` |
| **AI Integration** | Google Gemini API (`gemini-2.5-flash`, `gemini-2.0-flash` fallback cascade) |
| **DevOps & Containers** | Docker, Docker Compose, Multi-stage Builds |

---

## 🔒 Security & Sandboxing

- **Workplace Isolation**: User execution is confined strictly to the `/workspace` volume mount inside Docker. Host directories outside the project root cannot be accessed by code execution or terminal commands.
- **Credential Storage**: API keys can either be managed securely on the server via `.env` or stored locally in browser `localStorage` without persisting to database instances.
- **Process Isolation**: Terminal tabs execute within a restricted container Linux user environment.

---

## 📄 License

This project is open-source under the [MIT License](LICENSE).
