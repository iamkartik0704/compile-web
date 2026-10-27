const http = require('http');
const { spawn } = require('child_process');
const pty = require('node-pty');
const { WebSocketServer } = require('ws');
const fs = require('fs').promises;
const path = require('path');
const { StreamMessageReader, StreamMessageWriter } = require('vscode-jsonrpc/node');

// handling the running of the code (Note: window.api is an Electron frontend concept, it won't work in pure Node)
const handleRunCode = async () => {
  // await window.api.invoke('saveFileContents', { ... });
  // await window.api.runFile({ filePath: activeFilePath });
};

// Create a shared HTTP server to route multiple WebSocket endpoints
const server = http.createServer();
const wssApi = new WebSocketServer({ noServer: true });
const wssLsp = new WebSocketServer({ noServer: true });

const WORKSPACE_ROOT = '/workspace';

// ==========================================
// 1. MAIN API & TERMINAL WEBSOCKET (Route: /)
// ==========================================
wssApi.on('connection', function connection(ws) {
  let shellProcess = null;
  console.log('[Backend] Client connected to IDE API/Terminal');

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
      else if (action === 'createTerminal') {
        console.log('[Backend] Spawning interactive shell');
        
        shellProcess = pty.spawn('bash', [], {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: '/workspace',
          env: process.env
        });

        shellProcess.onData((terminalData) => {
          ws.send(JSON.stringify({ type: 'terminal-data', data: terminalData }));
        });

        ws.send(JSON.stringify({ id, data: { success: true } }));
        return;
      }
      else if (action === 'sendTerminalData') {
        if (shellProcess) shellProcess.write(payload);
        return;
      }
      else if (action === 'resizeTerminal') {
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
        console.log('[Backend] Real AI Completion requested');
        try {
          const promptText = typeof payload === 'string' ? payload : (payload.prompt || JSON.stringify(payload));
          const apiKey = process.env.GEMINI_API_KEY;
          
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
          });

          const aiData = await response.json();
          let completionText = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
          completionText = completionText.replace(/^```[\w]*\n/, '').replace(/\n```$/, '').trim();

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
