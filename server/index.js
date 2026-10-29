const http = require('http');
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const pty = require('node-pty');
const { WebSocketServer } = require('ws');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { StreamMessageReader, StreamMessageWriter } = require('vscode-jsonrpc/node');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Helper to call Gemini with automatic model fallback
const callGemini = async (contents, generationConfig = {}, customApiKey = null) => {
  const apiKey = (customApiKey && customApiKey.trim()) || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured on server or in settings');

  const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-pro'];
  let lastError = null;

  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, generationConfig })
      });
      const data = await res.json();
      if (data.error) {
        lastError = data.error.message;
        continue;
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text !== undefined) return text;
    } catch (e) {
      lastError = e.message;
    }
  }
  throw new Error(lastError || 'Failed to generate content with Gemini');
};

// ── REST: AI Configuration Status ──
app.get('/api/ai/config', (req, res) => {
  const hasKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
  const hint = hasKey ? ('...' + process.env.GEMINI_API_KEY.slice(-4)) : null;
  res.json({ hasGeminiKey: hasKey, geminiKeyHint: hint, model: 'gemini-2.5-flash' });
});

// ── REST: AI Ghost Text / Inline Autocomplete ──
app.post('/api/ai/autocomplete', async (req, res) => {
  try {
    const { prefix = '', suffix = '', language = '', filePath = '', apiKey = null } = req.body;
    const prompt = `You are a strict, ultra-fast inline code autocomplete engine for a code editor.
Language: ${language || 'code'}
File path: ${filePath || ''}

PREFIX (code before cursor):
${prefix}

SUFFIX (code after cursor):
${suffix}

TASK:
Output ONLY the exact code characters to insert directly at the cursor position between PREFIX and SUFFIX.
Do not repeat prefix or suffix. Return only the raw code to insert.
No markdown code blocks. No explanations.
If no completion is needed, output NOTHING.`;

    const text = await callGemini(
      [{ parts: [{ text: prompt }] }],
      { temperature: 0.1, maxOutputTokens: 256, stopSequences: ['\n\n\n'] },
      apiKey
    );

    let completion = (text || '').replace(/^```[\w]*\n?/i, '').replace(/\n?```$/i, '');
    if (completion.trim() === 'NOTHING') completion = '';
    res.json({ completion });
  } catch (err) {
    console.error('[API Autocomplete Error]:', err.message);
    res.json({ completion: '' });
  }
});

// ── REST: AI Chat Sidebar ──
app.post('/api/ai/chat', async (req, res) => {
  try {
    const { message, fileContext = '', selectedCode = '', activeFile = '', history = [], apiKey = null } = req.body;

    let systemContext = `You are an expert AI programming assistant inside a modern web code editor.\n`;
    if (activeFile) {
      systemContext += `Active file: ${activeFile}\n`;
    }
    if (selectedCode && selectedCode.trim()) {
      systemContext += `Highlighted/selected code:\n\`\`\`\n${selectedCode}\n\`\`\`\n`;
    }
    if (fileContext && fileContext.trim()) {
      systemContext += `Full file content:\n\`\`\`\n${fileContext.slice(0, 12000)}\n\`\`\`\n`;
    }
    systemContext += `\nBe concise, direct, helpful, and provide production-ready code examples where needed. Use Markdown formatting.`;

    const contents = [];
    if (Array.isArray(history) && history.length > 0) {
      for (const h of history.slice(-6)) {
        contents.push({
          role: h.role === 'user' ? 'user' : 'model',
          parts: [{ text: h.content }]
        });
      }
    }
    contents.push({
      role: 'user',
      parts: [{ text: `${systemContext}\n\nUser Question:\n${message}` }]
    });

    const reply = await callGemini(contents, { temperature: 0.4, maxOutputTokens: 2048 }, apiKey);
    res.json({ reply });
  } catch (err) {
    console.error('[API Chat Error]:', err.message);
    res.status(500).json({ error: err.message, reply: `AI Error: ${err.message}` });
  }
});

// Create a shared HTTP server to route multiple WebSocket endpoints
const server = http.createServer(app);
const wssApi = new WebSocketServer({ noServer: true });
const wssLsp = new WebSocketServer({ noServer: true });

const WORKSPACE_ROOT = '/workspace';

// Live file watcher on WORKSPACE_ROOT for auto-refreshing explorer
const fsWatchers = new Map();
function startWatcherForWs(ws) {
  try {
    if (!fsSync.existsSync(WORKSPACE_ROOT)) return;
    let debounceTimer = null;
    const watcher = fsSync.watch(WORKSPACE_ROOT, { recursive: true }, (eventType, filename) => {
      if (filename && (filename.startsWith('.') || filename.includes('node_modules') || filename.includes('.git'))) {
        return;
      }
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        try {
          if (ws.readyState === 1) { // WebSocket.OPEN
            ws.send(JSON.stringify({ event: 'fs-changed', data: { eventType, filename } }));
          }
        } catch (_) {}
      }, 250);
    });
    fsWatchers.set(ws, watcher);
  } catch (err) {
    console.error('[Backend] fs.watch error:', err.message);
  }
}

// ==========================================
// 1. MAIN API & TERMINAL WEBSOCKET (Route: /)
// ==========================================
wssApi.on('connection', function connection(ws) {
  let shellProcess = null;
  console.log('[Backend] Client connected to IDE API/Terminal');
  startWatcherForWs(ws);

  ws.on('close', () => {
    if (shellProcess) {
      try { shellProcess.kill(); } catch (_) {}
      shellProcess = null;
    }
    const watcher = fsWatchers.get(ws);
    if (watcher) {
      try { watcher.close(); } catch (_) {}
      fsWatchers.delete(ws);
    }
  });

  ws.on('message', async function message(rawData) {
    try {
      const { id, action, payload } = JSON.parse(rawData);
      let data = null;

      if (action === 'getStartupWorkspace') {
        data = WORKSPACE_ROOT;
      } 
      else if (action === 'readDirectory') {
        const targetPath = payload || WORKSPACE_ROOT;
        const entries = await fs.readdir(targetPath, { withFileTypes: true });
        
        data = entries.map(dirent => ({
          name: dirent.name,
          isDirectory: dirent.isDirectory(),
          path: path.join(targetPath, dirent.name)
        }));
      } 
      else if (action === 'getFileContents') {
        const targetPath = payload;
        const content = await fs.readFile(targetPath, 'utf-8');
        data = { success: true, content };
      }
      else if (action === 'saveFileContents') {
        const { path: targetPath, content } = payload;
        await fs.writeFile(targetPath, content, 'utf-8');
        data = { success: true };
      }
      else if (action === 'createFile') {
        const targetPath = payload;
        await fs.writeFile(targetPath, '', 'utf-8');
        data = { success: true };
      }
      else if (action === 'createFolder') {
        const targetPath = payload;
        await fs.mkdir(targetPath, { recursive: true });
        data = { success: true };
      }
      else if (action === 'deleteItem' || action === 'deleteItemPermanent') {
        const targetPath = typeof payload === 'string' ? payload : (payload.path || payload.targetPath);
        await fs.rm(targetPath, { recursive: true, force: true });
        data = { success: true };
      }
      else if (action === 'renameItem') {
        const { oldPath, newPath } = payload;
        await fs.rename(oldPath, newPath);
        data = { success: true };
      }
      else if (action === 'copyItem') {
        const { src, dest } = payload;
        await fs.cp(src, dest, { recursive: true });
        data = { success: true };
      }
      else if (action === 'createTerminal') {
        console.log('[Backend] Spawning interactive shell');
        if (shellProcess) {
          try { shellProcess.kill(); } catch (_) {}
          shellProcess = null;
        }
        
        shellProcess = pty.spawn('bash', [], {
          name: 'xterm-256color',
          cols: (payload && payload.cols) || 80,
          rows: (payload && payload.rows) || 24,
          cwd: '/workspace',
          env: process.env
        });

        const terminalId = (payload && payload.id) || ('term_' + Date.now());

        shellProcess.onData((terminalData) => {
          ws.send(JSON.stringify({ type: 'terminal-data', data: terminalData }));
        });

        shellProcess.onExit((code) => {
          try {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'terminal-exit', data: { exitCode: code } }));
            }
          } catch (_) {}
        });

        ws.send(JSON.stringify({ id, data: { success: true, terminalId } }));
        return;
      }
      else if (action === 'killTerminal') {
        console.log('[Backend] Killing terminal shell process');
        if (shellProcess) {
          try {
            shellProcess.kill();
          } catch (e) {
            console.error('[Backend] killTerminal error:', e.message);
          }
          shellProcess = null;
        }
        ws.send(JSON.stringify({ id, data: { success: true } }));
        return;
      }
      else if (action === 'sendTerminalData') {
        if (shellProcess) shellProcess.write(payload);
        return;
      }
      else if (action === 'resizeTerminal') {
        if (shellProcess && payload && payload.cols && payload.rows) {
          try {
            shellProcess.resize(Number(payload.cols), Number(payload.rows));
          } catch (_) {}
        }
        data = { success: true };
      }
      else if (action === 'getAiConfig') {
        const hasKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
        const hint = hasKey ? ('...' + process.env.GEMINI_API_KEY.slice(-4)) : null;
        data = { hasGeminiKey: hasKey, geminiKeyHint: hint, model: 'gemini-2.5-flash' };
      }
      else if (action === 'watchProject') {
        data = { success: true };
      }
      else if (action === 'runFile') {
        const targetPath = payload.filePath;
        if (!targetPath) {
          ws.send(JSON.stringify({ id, data: { success: false, error: 'No file path provided.' } }));
          return;
        }

        console.log(`[Backend] Executing file: ${targetPath}`);
        let execCmd = 'node';
        let execArgs = [targetPath];
        if (targetPath.endsWith('.py')) {
          execCmd = 'python3';
          execArgs = [targetPath];
        } else if (targetPath.endsWith('.go')) {
          execCmd = 'go';
          execArgs = ['run', targetPath];
        }

        const child = spawn(execCmd, execArgs);

        child.on('error', (err) => {
          ws.send(JSON.stringify({ type: 'execution-output', data: { stream: 'stderr', text: `Failed to start process: ${err.message}\n` } }));
          ws.send(JSON.stringify({ id, data: { success: false, exitCode: 1 } }));
        });

        child.stdout.on('data', (chunk) => {
          ws.send(JSON.stringify({ type: 'execution-output', data: { stream: 'stdout', text: chunk.toString() } }));
        });

        child.stderr.on('data', (chunk) => {
          ws.send(JSON.stringify({ type: 'execution-output', data: { stream: 'stderr', text: chunk.toString() } }));
        });

        child.on('close', (code) => {
          ws.send(JSON.stringify({ type: 'execution-output', data: { stream: 'system', text: `\n[Process exited with code ${code}]\n` } }));
          ws.send(JSON.stringify({ id, data: { success: true, exitCode: code } }));
        });

        return;
      }
      else if (action === 'getAiCompletion') {
        try {
          const promptText = typeof payload === 'string' ? payload : (payload.prompt || JSON.stringify(payload));
          const text = await callGemini([{ parts: [{ text: promptText }] }]);
          let completionText = (text || '').replace(/^```[\w]*\n/, '').replace(/\n```$/, '').trim();
          data = { success: true, items: [{ insertText: completionText }] };
        } catch (error) {
          console.error('[Backend] AI API Error:', error.message);
          data = { success: false, items: [] };
        }
      }

      // Send the resolved data back to the frontend
      ws.send(JSON.stringify({ id, data }));

    } catch (error) {
      console.error('Error processing action:', error.message);
      try {
        const parsed = JSON.parse(rawData);
        if (parsed.id) {
          ws.send(JSON.stringify({ id: parsed.id, data: { success: false, error: error.message } }));
        }
      } catch (_) {}
    }
  });
});

// ==========================================
// 2. LANGUAGE SERVER PROTOCOL (Route: /lsp)
// ==========================================
wssLsp.on('connection', (ws,request) => {
const lang = request.lang || 'javascript';
        console.log(`[Backend] LSP connected for language: ${lang}`);	
	console.log('[Backend] Frontend connected to LSP WebSocket');
	let command;
  let args = [];

  switch (lang) {
    case 'python':
      command = 'npx';
      args = ['pyright-langserver', '--stdio'];
      break;
    case 'cpp':
    case 'c':
      command = 'clangd';
      break;
    case 'go':
      command = 'gopls';
      args = ['serve'];
      break;
    case 'java':
      command = 'java';
      // JDTLS requires these exact paths to boot headless in Linux
      args = [
      '-Declipse.application=org.eclipse.jdt.ls.core.id1',
        '-Dosgi.bundles.defaultStartLevel=4',
        '-Declipse.product=org.eclipse.jdt.ls.core.product',
        '-Dlog.level=ALL',
        '-noverify',
        '-Xmx1G',
        '-jar', '/opt/jdtls/plugins/org.eclipse.equinox.launcher.jar',
        '-configuration', '/opt/jdtls/config_linux',
        '-data', '/workspace'
      ];
      break;
    case 'javascript':
    case 'typescript':
    default:
      command = 'npx';
      args = ['typescript-language-server', '--stdio'];
      break;
  }
  
  // Spawn a fresh language server process for this editor session
  const lspProcess = spawn(command, args);

  const reader = new StreamMessageReader(lspProcess.stdout);
  const writer = new StreamMessageWriter(lspProcess.stdin);

  // Pipe raw WebSocket messages from the frontend to the LSP's stdin
  ws.on('message', (message) => {
    try {
      const msgStr = message.toString();
      console.log(`[Frontend -> LSP]:`, msgStr.substring(0, 300));
      if (msgStr.startsWith('Content-Length:')) {
        if (lspProcess.stdin.writable) lspProcess.stdin.write(msgStr);
      } else {
        const json = JSON.parse(msgStr);
        writer.write(json);
      }
    } catch (err) {
      console.error('[Backend] Error writing to LSP stdin:', err.message);
    }
  });

  // Pipe raw LSP stdout payloads directly back to the frontend WebSocket
  reader.listen((jsonRpcMessage) => {
    console.log(`[LSP -> Frontend]:`, JSON.stringify(jsonRpcMessage).substring(0, 300));
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(jsonRpcMessage));
    }
  });

  lspProcess.stderr.on('data', (data) => {
    console.error(`[LSP ${lang} Error]:`, data.toString());
  });

  // Kill the child process when the editor tab/socket is closed
  ws.on('close', () => {
    console.log('[Backend] LSP WebSocket closed, terminating process');
    try {
      reader.dispose();
      writer.dispose();
      lspProcess.kill();
    } catch (e) {}
  });
});

// ==========================================
// 3. HTTP UPGRADE ROUTING
// ==========================================
server.on('upgrade', function upgrade(request, socket, head) {
  const reqUrl = new URL(request.url, `http://${request.headers.host}`);
  const pathname = reqUrl.pathname;

  if (pathname === '/lsp') {
    request.lang = reqUrl.searchParams.get('lang');
    wssLsp.handleUpgrade(request, socket, head, function done(ws) {
      wssLsp.emit('connection', ws, request);
    });
  } else {
    // Default to the main API/Terminal socket for any other path (or root '/')
    wssApi.handleUpgrade(request, socket, head, function done(ws) {
      wssApi.emit('connection', ws, request);
    });
  }
});

server.listen(3000, '0.0.0.0', () => {
  console.log('Headless IDE backend running on http://0.0.0.0:3000');
});
