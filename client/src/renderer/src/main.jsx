import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/main.css'

// Initialize WebSocket connection to the backend
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsHost = window.location.hostname || '127.0.0.1';
// In web container port 8000 routes / to the frontend, backend ws is direct on 3000 or via proxy
const wsUrl = `${wsProtocol}//${wsHost}:3000`;
const ws = new WebSocket(wsUrl);
const pendingRequests = new Map();

let terminalCallback = null;
let terminalExitCallback = null;
let fsCallbacks = [];

// Listen for replies and streaming events from the server
ws.addEventListener('message', (event) => {
  try {
    const msg = JSON.parse(event.data);

    // Resolve RPC request-response
    if (msg.id && pendingRequests.has(msg.id)) {
      pendingRequests.get(msg.id)(msg.data);
      pendingRequests.delete(msg.id);
    }

    // Intercept continuous streams for terminal
    if ((msg.type === 'execution-output' || msg.type === 'terminal-data') && typeof terminalCallback === 'function') {
      const outputText = typeof msg.data === 'string' ? msg.data : (msg.data?.text || '');
      terminalCallback(outputText);
    }

    // Terminal process exited
    if (msg.type === 'terminal-exit' && typeof terminalExitCallback === 'function') {
      terminalExitCallback(msg.data);
    }

    // Live file system changes (e.g. terminal mkdir/touch/rm)
    if (msg.event === 'fs-changed') {
      fsCallbacks.forEach(cb => {
        try { cb(msg.data); } catch (_) {}
      });
      window.dispatchEvent(new CustomEvent('refresh-sidebar'));
    }
  } catch (err) {
    console.error('[WS Parse Error]:', err);
  }
});

// Helper function to send requests and wait for the specific reply
function wsInvoke(action, payload) {
  return new Promise((resolve) => {
    const id = Date.now().toString() + Math.random().toString();
    pendingRequests.set(id, (data) => {
      resolve(data);
    });
    const msg = JSON.stringify({ id, action, payload });

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    } else {
      ws.addEventListener('open', () => ws.send(msg), { once: true });
    }
  });
}

// Polyfill the Electron / Native API for the Web environment
if (typeof window !== 'undefined' && !window.api) {
  window.api = {
    // ── Workspace & Filesystem ──
    getStartupWorkspace: () => wsInvoke('getStartupWorkspace'),
    readDirectory: (path) => wsInvoke('readDirectory', path),
    getFileContents: (path) => wsInvoke('getFileContents', path),
    saveFileContents: (path, content) => wsInvoke('saveFileContents', { path, content }),
    createFile: (path) => wsInvoke('createFile', path),
    createFolder: (path) => wsInvoke('createFolder', path),
    deleteItem: (itemPath) => wsInvoke('deleteItem', itemPath),
    deleteItemPermanent: (itemPath) => wsInvoke('deleteItemPermanent', itemPath),
    renameItem: (oldPath, newPath) => wsInvoke('renameItem', { oldPath, newPath }),
    copyItem: (src, dest) => wsInvoke('copyItem', { src, dest }),
    selectFolder: () => Promise.resolve('/workspace'),
    selectFile: () => Promise.resolve(null),

    // ── Live File Watcher ──
    watchProject: (path) => wsInvoke('watchProject', path),
    onFsChanged: (cb) => {
      fsCallbacks.push(cb);
      return () => {
        fsCallbacks = fsCallbacks.filter(c => c !== cb);
      };
    },

    // ── Terminal & Shell ──
    createTerminal: async (options) => {
      const res = await wsInvoke('createTerminal', options);
      return (res && res.terminalId) || 'term_1';
    },
    killTerminal: (id) => wsInvoke('killTerminal', { id }),
    resizeTerminal: (...args) => {
      let cols = 80, rows = 24;
      if (typeof args[0] === 'object' && args[0] !== null) {
        cols = args[0].cols || cols;
        rows = args[0].rows || rows;
      } else if (args.length >= 3) {
        cols = args[1];
        rows = args[2];
      } else if (args.length === 2) {
        cols = args[0];
        rows = args[1];
      }
      return wsInvoke('resizeTerminal', { cols, rows });
    },
    sendTerminalData: (...args) => {
      const payload = args[args.length - 1];
      if (typeof payload === 'string' && ws.readyState === WebSocket.OPEN) {
        const msg = JSON.stringify({ id: Date.now().toString(), action: 'sendTerminalData', payload });
        ws.send(msg);
      }
    },
    onTerminalData: (...args) => {
      const callback = args.find(arg => typeof arg === 'function');
      if (callback) {
        terminalCallback = (data) => callback(data);
      }
    },
    onTerminalExit: (...args) => {
      const callback = args.find(arg => typeof arg === 'function');
      if (callback) {
        terminalExitCallback = callback;
      }
    },

    // ── AI Engine & Keys ──
    getApiKeys: async () => {
      const localKey = localStorage.getItem('user-gemini-api-key') || '';
      try {
        const config = await wsInvoke('getAiConfig');
        if (config?.hasGeminiKey || localKey) {
          const hint = localKey ? ('...' + localKey.slice(-4)) : config?.geminiKeyHint;
          return { google: { exists: true, hint, source: localKey ? 'custom' : 'server' } };
        }
      } catch (_) {}
      return localKey ? { google: { exists: true, hint: '...' + localKey.slice(-4), source: 'custom' } } : {};
    },
    getAllKeys: async () => window.api.getApiKeys(),
    saveApiKey: async (provider, key) => {
      localStorage.setItem('user-gemini-api-key', key);
      return { success: true, provider: 'google', hint: '...' + key.slice(-4) };
    },
    deleteApiKey: async () => {
      localStorage.removeItem('user-gemini-api-key');
      return { success: true, provider: 'google' };
    },
    getAiCompletion: async (payload) => {
      try {
        const customKey = localStorage.getItem('user-gemini-api-key');
        const res = await wsInvoke('getAiCompletion', { ...payload, apiKey: customKey || undefined });
        return res || { success: true, items: [] };
      } catch (error) {
        return { success: true, items: [] };
      }
    },

    // ── Custom Config & Settings ──
    getCustomConfig: () => {
      try {
        return Promise.resolve(JSON.parse(localStorage.getItem('ide-custom-config') || '{}'));
      } catch (_) {
        return Promise.resolve({});
      }
    },
    saveCustomConfig: (cfg) => {
      localStorage.setItem('ide-custom-config', JSON.stringify(cfg));
      return Promise.resolve(true);
    },

    // ── Clipboard & Utilities ──
    writeClipboardText: (text) => {
      if (navigator.clipboard) return navigator.clipboard.writeText(text);
      return Promise.resolve();
    },
    readClipboardText: async () => {
      if (navigator.clipboard) {
        try {
          const text = await navigator.clipboard.readText();
          return { success: true, text };
        } catch (_) {
          return { success: false, text: '' };
        }
      }
      return { success: false, text: '' };
    },
    pasteFromOsClipboard: () => Promise.resolve({ success: false }),
    openUrl: (url) => { window.open(url, '_blank'); },
    newWindow: () => { window.open(window.location.origin, '_blank'); },
    showSaveDialog: () => Promise.resolve(null),

    // ── LSP & Code Execution ──
    sendLspMessage: async (payload) => {
      try {
        const res = await wsInvoke('sendLspMessage', payload);
        return res || { success: true, items: [], isIncomplete: false };
      } catch (error) {
        return { success: true, items: [], isIncomplete: false };
      }
    },
    onLspMessage: () => {},
    onLspDiagnostics: () => {},
    removeLspDiagnostics: () => {},
    startLanguageServer: () => Promise.resolve({ success: true }),
    runFile: (filePath) => wsInvoke('runFile', { filePath }),
    runCommand: (cmd) => wsInvoke('runCommand', cmd),
    startLiveServer: () => Promise.resolve({ success: false, error: 'Live server is not supported in the web container' }),
    stopLiveServer: () => Promise.resolve({ success: true }),

    // ── Generic Fallbacks ──
    invoke: (channel, payload) => wsInvoke(channel, payload),
    send: (channel, data) => { console.log(`[mock send] ${channel}`, data); },
    on: () => () => {},
    gitStatus: () => Promise.resolve({ success: false, isRepo: false }),
    gitAction: () => Promise.resolve({ success: false })
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
