const { spawn } = require('child_process');
const { StreamMessageReader, StreamMessageWriter } = require('vscode-jsonrpc/node');
const { WebSocketServer } = require('ws');
const fs = require('fs').promises;
const path = require('path');

// Spawn the real headless TypeScript Language Server
const lspProcess = spawn('npx', ['typescript-language-server', '--stdio']);
const reader = new StreamMessageReader(lspProcess.stdout);
const writer = new StreamMessageWriter(lspProcess.stdin);

let lspMessageId = 1;
const pendingLspRequests = new Map();

// 1. Handshake: Tell the LSP we are ready
writer.write({
  jsonrpc: '2.0',
  id: lspMessageId++,
  method: 'initialize',
  params: {
    processId: process.pid,
    rootUri: 'file:///workspace',
    capabilities: {}
  }
});

// 2. Listen to the real LSP's output and route data back to the frontend
reader.listen((message) => {
  if (message.method === 'window/logMessage') return; 

  // Complete the handshake
  if (message.result && message.result.capabilities) {
    writer.write({ jsonrpc: '2.0', method: 'initialized', params: {} });
    console.log(' Real TypeScript Language Server Initialized!');
    return;
  }

  // Intercept real code completions and route them back to the exact WebSocket that asked
  if (message.id && pendingLspRequests.has(message.id)) {
    const { ws, frontendMessageId } = pendingLspRequests.get(message.id);
    pendingLspRequests.delete(message.id);

    // Extract the REAL items from the TypeScript engine
    const items = message.result?.items || message.result || [];
    
    if (ws.readyState === 1) { 
      ws.send(JSON.stringify({ 
        id: frontendMessageId, 
        data: { success: true, items, isIncomplete: false } 
      }));
    }
  }
});

// handling the running of the code
const handleRunCode = async () => {
  // 1. Force the active file to save to the backend disk first
  await window.api.invoke('saveFileContents', { 
    path: activeFilePath, 
    content: monacoEditorValue // grab the current text from your editor state
  });

  // 2. Now execute it
  await window.api.runFile({ filePath: activeFilePath });
};




const wss = new WebSocketServer({ port: 3000 });
const WORKSPACE_ROOT = '/workspace'; // This matches the volume mount in docker-compose.yml

wss.on('connection', function connection(ws) {
	let shellProcess = null;
  console.log('Client connected to IDE backend');

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
        
        // Force the shell to act like a real interactive terminal
        shellProcess = spawn('sh', ['-l', '-i'], { 
          cwd: '/workspace',
          env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
        });

        shellProcess.stdout.on('data', (chunk) => {
		const text = chunk.toString().replace(/\r?\n/g, '\r\n');
          ws.send(JSON.stringify({ type: 'terminal-data', data: text }));
        });

        shellProcess.stderr.on('data', (chunk) => {
	const text = chunk.toString().replace(/\r?\n/g, '\r\n');
          ws.send(JSON.stringify({ type: 'terminal-data', data: text }));
        });

        // Push an empty command to force the prompt to render immediately
        setTimeout(() => {
          if (shellProcess && shellProcess.stdin) shellProcess.stdin.write('\n');
        }, 300);

        ws.send(JSON.stringify({ id, data: { success: true } }));
        return;
      }
	    // terminal data feeding,resizing
	   
      else if (action === 'sendTerminalData') {
        // When you type a key in the frontend, write it directly to the shell's stdin
        if (shellProcess && shellProcess.stdin) {
	const safePayload = payload.replace(/\r/g, '\n');
          shellProcess.stdin.write(safePayload);
        //  shellProcess.stdin.write(payload);
		ws.send(JSON.stringify({ type: 'terminal-data', data: payload }));
        }

        // Return early—we don't need a success response for every single keystroke
        return; 
      }
      
      else if (action === 'resizeTerminal') {
        // We will just return success for now to keep Xterm.js happy
        data = { success: true };
      }

	    else if (action === 'runFile') {
        const targetPath = payload.filePath;

        // 1. Instantly reject if the frontend forgot to send a file path
        if (!targetPath) {
          ws.send(JSON.stringify({ id, data: { success: false, error: 'No file path provided.' } }));
          return;
        }

        console.log(`[Backend] Executing file: ${targetPath}`);

        // 2. Spawn a fresh Node process to execute the dynamic file
        const child = spawn('node', [targetPath]);

        // 3. Catch OS-level execution errors (e.g., file deleted, bad permissions)
        child.on('error', (err) => {
          ws.send(JSON.stringify({
            type: 'execution-output',
            data: { stream: 'stderr', text: `Failed to start process: ${err.message}\n` }
          }));
          ws.send(JSON.stringify({ id, data: { success: false, exitCode: 1 } }));
        });

        // 4. Stream standard output to the frontend instantly
        child.stdout.on('data', (chunk) => {
          ws.send(JSON.stringify({
            type: 'execution-output',
            data: { stream: 'stdout', text: chunk.toString() }
          }));
        });

        // 5. Stream runtime errors (e.g., syntax errors)
        child.stderr.on('data', (chunk) => {
          ws.send(JSON.stringify({
            type: 'execution-output',
            data: { stream: 'stderr', text: chunk.toString() }
          }));
        });

        // 6. Notify the frontend when the execution finishes
        child.on('close', (code) => {
          ws.send(JSON.stringify({
            type: 'execution-output',
            data: { stream: 'system', text: `\n[Process exited with code ${code}]\n` }
          }));

          ws.send(JSON.stringify({ id, data: { success: true, exitCode: code } }));
        });

        return;
      }
      
      // REAL METHOD: Tell the LSP engine exactly what you just typed so it understands the code
// REAL METHOD: Tell the LSP engine exactly what you just typed
      else if (action === 'lsp:document-change') {
        // Fallback to test.js if the frontend payload is missing the file path
        const filePath = (payload && payload.filePath) ? payload.filePath : '/workspace/test.js';
        writer.write({
          jsonrpc: '2.0',
          method: 'textDocument/didChange',
          params: {
            textDocument: { uri: `file://${filePath}`, version: Date.now() },
            contentChanges: [{ text: payload.text || '' }]
          }
        });
        data = { success: true };
      }
// REAL METHOD: Ask the LSP engine for actual syntax suggestions
      else if (action === 'sendLspMessage') {
        // CRITICAL FIX: The frontend bundle is bugged and sending the string "javascript" 
        // instead of the required { line, column, filePath } object. 
        // We must return instantly to prevent Monaco from cancelling the request and crashing the UI.
        if (typeof payload === 'string') {
          ws.send(JSON.stringify({ 
            id, 
            data: { success: true, items: [], isIncomplete: false } 
          }));
          return;
        }

        const currentLspId = lspMessageId++;
        pendingLspRequests.set(currentLspId, { ws, frontendMessageId: id });

        const filePath = payload.filePath || '/workspace/test.js';
        const line = payload.line !== undefined ? payload.line : 0;
        const character = payload.column !== undefined ? payload.column : 0;

        writer.write({
          jsonrpc: '2.0',
          id: currentLspId,
          method: 'textDocument/completion',
          params: {
            textDocument: { uri: `file://${filePath}` },
            position: { line, character },
            context: { triggerKind: 1 } 
          }
        });
        
        return; 
      }
      // REAL METHOD: Ask the LSP engine for actual syntax suggestions
      else if (action === 'getAiCompletion') {
        console.log('[Backend] Real AI Completion requested');
        
        try {
          const promptText = typeof payload === 'string' ? payload : (payload.prompt || JSON.stringify(payload));
          const apiKey = process.env.GEMINI_API_KEY;
          
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: promptText }] }]
            })
          });

          const aiData = await response.json();
          
          let completionText = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
          completionText = completionText.replace(/^```[\w]*\n/, '').replace(/\n```$/, '').trim();

          data = {
            success: true,
            items: [
              { insertText: completionText }
            ] 
          };
        } catch (error) {
          console.error('[Backend] AI API Error:', error.message);
          data = { success: false, items: [] };
        }
      }

      // Send the resolved data back to the exact frontend promise that requested it
      ws.send(JSON.stringify({ id, data }));

    } catch (error) {
      console.error('Error processing action:', error.message);
    }
  });
});

console.log('Headless IDE backend running on ws://0.0.0.0:3000');
