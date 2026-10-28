import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/main.css'





// Initialize WebSocket connection to the headless backend
const ws = new WebSocket('ws://127.0.0.1:3000');
const pendingRequests = new Map();

// Listen for replies from the server
ws.onmessage = (event) => {
  const { id, data } = JSON.parse(event.data);
  if (id && pendingRequests.has(id)) {
    pendingRequests.get(id)(data); // Resolve the promise
    pendingRequests.delete(id);
  }
};


let terminalCallback = null;

// Assuming 'ws' is your WebSocket instance created at the top of the file
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  // Intercept the continuous streams and pipe them to the UI callback
  	if ((msg.type === 'execution-output' || msg.type === 'terminal-data') && typeof terminalCallback === 'function') {
    const outputText = typeof msg.data === 'string' ? msg.data : msg.data.text;
	terminalCallback(outputText);
  }
});
// Helper function to send requests and wait for the specific reply
function wsInvoke(action, payload) {
console.log(`[WS Request Pending] -> ${action}`, payload);
	return new Promise((resolve) => {
    const id = Date.now().toString() + Math.random().toString();
pendingRequests.set(id, (data) => {
      console.log(`[WS Response Received] <- ${action}`, data); // <-- DEBUG RESPONSE
      resolve(data);
    });
    const msg = JSON.stringify({ id, action, payload });
    
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    } else {
      ws.addEventListener('open', () => ws.send(msg));
    }
  });
}

// Polyfill the Electron API to route through WebSockets
if (typeof window !== 'undefined' && !window.api) {
  window.api = {
    getStartupWorkspace: () => wsInvoke('getStartupWorkspace'),
    readDirectory: (path) => wsInvoke('readDirectory', path),
    getFileContents: (path) => wsInvoke('getFileContents', path),
    // 1. Forward generic invoke calls directly to our WebSocket helper
  invoke: (channel, payload) => wsInvoke(channel, payload),

  // 2. Provide a safe fallback for the terminal creation call to prevent crashes
    createTerminal: async () => {
    return await wsInvoke('createTerminal');
  },
    
    // Keep configurations local for now to prevent unnecessary crashes
    getCustomConfig: () => Promise.resolve({}),
    saveCustomConfig: () => Promise.resolve(true),
    saveFileContents: (path, content) => wsInvoke('saveFileContents', { path, content }),
    createFile: (path) => wsInvoke('createFile', path),
    createFolder: (path) => wsInvoke('createFolder', path),
    deleteItem: (itemPath) => wsInvoke('deleteItem', itemPath),
    deleteItemPermanent: (itemPath) => wsInvoke('deleteItemPermanent', itemPath),
    renameItem: (oldPath, newPath) => wsInvoke('renameItem', { oldPath, newPath }),
    copyItem: (src, dest) => wsInvoke('copyItem', { src, dest }),
    writeClipboardText: (text) => {
      if (navigator.clipboard) return navigator.clipboard.writeText(text);
      return Promise.resolve();
    },
    readClipboardText: async () => {
      if (navigator.clipboard) {
        try {
          const text = await navigator.clipboard.readText();
          return { success: true, text };
        } catch (e) {
          return { success: false, text: '' };
        }
      }
      return { success: false, text: '' };
    },
    pasteFromOsClipboard: () => Promise.resolve({ success: false }),
    selectFolder: () => Promise.resolve('/workspace'),
	  send:(channel,data)=>{console.log(`[mock send] ${channel}`,data)},




// No more mocks. Send everything directly to the real Node.js backend.
// Send real requests to the backend, but safely handle network cancellations
    onLspMessage: () => {}, 
    
    sendLspMessage: async (payload) => {
      try {
        const res = await wsInvoke('sendLspMessage', payload);
        // If the LSP takes too long or network drops, provide the strict structure to prevent crashes
        return res || { success: true, items: [], isIncomplete: false }; 
      } catch (error) {
        // Handle canceled strokes gracefully
        return { success: true, items: [], isIncomplete: false };
      }
    },
    
    getAiCompletion: async (payload) => {
      try {
        const res = await wsInvoke('getAiCompletion', payload);
        return res || { success: true, items: [] };
      } catch (error) {
        return { success: true, items: [] };
      }
    },
	sendTerminalData: (...args) => {
    // The keystroke payload is almost always the last argument passed by React
    const payload = args[args.length - 1];
    console.log('[Frontend -> Backend] Keystroke:', JSON.stringify(payload));
    
    if (typeof payload === 'string') {
      const msg = JSON.stringify({ id: Date.now().toString(), action: 'sendTerminalData', payload });
      ws.send(msg);
    }
  },
	
	onTerminalExit:(callback)=>{


	},
  onTerminalData: (...args) => {
    // Find the callback function, no matter where React placed it in the arguments
    const callback = args.find(arg => typeof arg === 'function');
    if (callback) {
      // Electron callbacks expect (event, data). We pass an empty object {} to safely mock the event.
      terminalCallback = (data) => {
        console.log('[Backend -> Frontend] Terminal Output:', JSON.stringify(data));
        callback( data); 
      };
    }
  }
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
