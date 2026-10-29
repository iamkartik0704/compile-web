import React, { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { Sidebar } from './components/Sidebar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { CodeEditor } from './components/CodeEditor'
import UpdateModal from './components/UpdateModal'
import { TerminalPanel } from './components/TerminalPanel'
import { Resizer } from './components/Resizer'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { applyDiff, unescapeXml } from './diffUtils'
import { Plus, Play, Bug, Maximize2, Minimize2, Trash2, CheckCircle, Circle, RefreshCw, Command, ChevronRight, ChevronDown, ChevronUp, File, Code, Cpu, Activity, Info, ArrowRight, X, Search, Settings, LayoutGrid, PanelLeft, PanelBottom, PanelRight, Square, Minus, Terminal, Key, ShieldCheck, Sparkles, Folder, GitBranch, Download, Share2 } from 'lucide-react'
import { CodebaseVisualizer } from './components/CodebaseVisualizer'
import { DSAExplainer } from './components/DSAExplainer'
import { GitTimeline } from './components/GitTimeline'
import { ActivityBar } from './components/ActivityBar'

import { AiChatSidebar } from './components/AiChatSidebar'
import { useAppStore } from './store/appStore'
import * as monaco from 'monaco-editor'
import './assets/sidebar.css'
import './assets/editor.css'
import './assets/themes.css'
import { useShortcutStore, normalizeEventToKeys, defaultShortcuts } from './store/shortcutStore'
import { scanWorkspaceForDiagnostics } from './services/workspaceDiagnosticsScanner'
import { useDiagnosticsStore } from './store/diagnosticsStore'
import { useChatStore } from './store/chatStore'

function timeAgo(timestamp) {
  if (!timestamp) return '';
  const seconds = Math.floor((new Date() - timestamp) / 1000);
  let interval = seconds / 31536000;
  if (interval >= 1) return Math.floor(interval) + "y ago";
  interval = seconds / 2592000;
  if (interval >= 1) return Math.floor(interval) + "mo ago";
  interval = seconds / 86400;
  if (interval >= 1) return Math.floor(interval) + "d ago";
  interval = seconds / 3600;
  if (interval >= 1) return Math.floor(interval) + "h ago";
  interval = seconds / 60;
  if (interval >= 1) return Math.floor(interval) + "m ago";
  return "just now";
}

const renderMessageParts = (content, msg) => {
  // Strip the plan block from the main text body if it exists, so we don't render raw XML.
  if (msg && msg.plan) {
    content = content.replace(/<plan>([\s\S]*?)(?:<\/plan>|$)/i, '')
  }
  const parts = []
  // Matches <edit_file path="xyz"> ... </edit_file>
  // using [\s\S]*? to match across newlines
  const regex = /<edit_file\s+path="([^"]+)">([\s\S]*?)<\/edit_file>/g
  let lastIndex = 0
  let match
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: content.slice(lastIndex, match.index) })
    }
    parts.push({ type: 'edit', path: match[1], body: match[2], full: match[0] })
    lastIndex = regex.lastIndex
  }
  if (lastIndex < content.length) {
    parts.push({ type: 'text', content: content.slice(lastIndex) })
  }
  return parts
}

// ============================================================
// PROVIDER REGISTRY — Known API providers with detection patterns
// ============================================================
const PROVIDERS = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    emoji: '🤖',
    color: '#10a37f',
    prefixes: ['sk-proj-', 'sk-'],
    placeholder: 'sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx'
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    emoji: '🧠',
    color: '#d4a574',
    prefixes: ['sk-ant-'],
    placeholder: 'sk-ant-api03-xxxxxxxxxxxxxxxx'
  },
  google: {
    id: 'google',
    name: 'Google',
    emoji: '✦',
    color: '#4285f4',
    prefixes: ['AIza'],
    placeholder: 'AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxx'
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    emoji: '🔍',
    color: '#5b6ee1',
    prefixes: [],
    placeholder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx'
  },
  qwen: {
    id: 'qwen',
    name: 'Qwen',
    emoji: '☁️',
    color: '#6c5ce7',
    prefixes: [],
    placeholder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx'
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    emoji: '⚡',
    color: '#f55036',
    prefixes: ['gsk_'],
    placeholder: 'gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    emoji: '🔌',
    color: '#8e44ad',
    prefixes: [],
    placeholder: 'your-custom-api-key'
  },
  meta: {
    id: 'meta',
    name: 'Meta',
    emoji: '∞',
    color: '#0668e1',
    prefixes: [],
    placeholder: 'your-api-key-here'
  },
  oss: {
    id: 'oss',
    name: 'Open Source',
    emoji: '🔓',
    color: '#f97316',
    prefixes: [],
    placeholder: 'your-api-key-here'
  }
}

const PROVIDER_LIST = Object.values(PROVIDERS)

/**
 * Auto-detect provider from key prefix.
 * Checks most specific prefixes first (sk-ant- before sk-).
 * Returns provider id or null if ambiguous.
 */
function detectProviderFromKey(key) {
  if (!key || key.length < 3) return null
  if (key.startsWith('sk-ant-')) return 'anthropic'
  if (key.startsWith('AIza')) return 'google'
  if (key.startsWith('gsk_')) return 'groq'
  if (key.startsWith('sk-proj-')) return 'openai'
  if (key.startsWith('hf_')) return 'huggingface'
  if (key.startsWith('nvapi-')) return 'nvidia'
  return null
}

// ============================================================
// MODEL REGISTRY — Categorized by capability tier
// ============================================================
const MODEL_GROUPS = [
  {
    label: 'Auto',
    models: [
      { id: 'auto', name: 'Auto Mode', badge: 'DEFAULT' }
    ]
  },
  {
    label: 'Google Gemini',
    models: [
      { id: 'gemini-flash', name: 'Gemini 3.7 Flash', provider: 'google' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'google' },
      { id: 'gemini-pro', name: 'Gemini 3.1 Pro (Requires Paid Key)', provider: 'google' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (Requires Paid Key)', provider: 'google' }
    ]
  },
  {
    label: 'Anthropic',
    models: [
      { id: 'claude-sonnet', name: 'Claude Sonnet', provider: 'anthropic' },
      { id: 'claude-opus', name: 'Claude Opus', provider: 'anthropic' }
    ]
  },
  {
    label: 'DeepSeek',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek', provider: 'deepseek' },
      { id: 'deepseek-r1', name: 'DeepSeek R1', provider: 'deepseek' }
    ]
  },
  {
    label: 'Qwen',
    models: [
      { id: 'qwen-plus', name: 'Qwen Plus', provider: 'qwen' },
      { id: 'qwen-max', name: 'Qwen Max', provider: 'qwen' },
      { id: 'qwen-turbo', name: 'Qwen Turbo', provider: 'qwen' }
    ]
  },
  {
    label: 'Mistral',
    models: [
      { id: 'mistral-large', name: 'Mistral Large', provider: 'mistral' },
      { id: 'mistral-small', name: 'Mistral Small', provider: 'mistral' }
    ]
  },
  {
    label: 'NVIDIA',
    models: [
      { id: 'nvidia-llama-3.1-70b', name: 'Llama 3.1 70B (NVIDIA)', provider: 'nvidia' },
      { id: 'nvidia-nemotron-4-340b', name: 'Nemotron 4 340B', provider: 'nvidia' }
    ]
  },
  {
    label: 'Hugging Face',
    models: [
      { id: 'hf-llama-3.1-70b', name: 'Llama 3.1 70B (HF)', provider: 'huggingface' }
    ]
  },
  {
    label: 'Open Source',
    models: [
      { id: 'gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'oss' },
      { id: 'llama-4', name: 'Llama 4', provider: 'meta' }
    ]
  },
  {
    label: 'Custom',
    models: [
      { id: 'custom', name: 'Custom Model', provider: 'custom' }
    ]
  }
]

// Flat lookup for display names
const MODEL_MAP = {}
MODEL_GROUPS.forEach((g) => g.models.forEach((m) => (MODEL_MAP[m.id] = m)))

// ── Command Registry ──
const COMMAND_REGISTRY = [
  { id: 'explain', trigger: 'explain', label: 'Explain Code', desc: 'Explain selection or active file' },
  { id: 'clear', trigger: 'clear', label: 'Clear Chat', desc: 'Clear the current conversation' },
  { id: 'model', trigger: 'model', label: 'Switch Model', desc: 'Quick select a different model' }
]

// ── CopyButton Component ──
function CopyButton({ textToCopy, className, style, title = "Copy to Clipboard" }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(textToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      className={className}
      title={copied ? "Copied!" : title}
      onClick={handleCopy}
      style={{ ...style, position: 'relative' }}
      onMouseEnter={(e) => { 
        if (!copied && (!className || !className.includes('copy-code-btn'))) {
          e.currentTarget.style.color = 'var(--text-primary)'; 
          e.currentTarget.style.background = 'var(--bg-hover)'; 
        }
      }}
      onMouseLeave={(e) => { 
        if (!className || !className.includes('copy-code-btn')) {
          e.currentTarget.style.color = 'var(--text-muted)'; 
          e.currentTarget.style.background = 'transparent'; 
        }
      }}
    >
      {copied ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-green, #34d399)" strokeWidth="2" width="14" height="14">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      )}
      {copied && (
        <span style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: '6px',
          background: 'var(--bg-elevated)',
          color: 'var(--text-bright)',
          fontSize: '11px',
          padding: '4px 8px',
          borderRadius: '4px',
          border: '1px solid var(--border-base)',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
          zIndex: 100,
          fontFamily: 'var(--font-sans)',
          fontWeight: 500
        }}>
          Copied!
          <span style={{
            position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
            borderWidth: '4px', borderStyle: 'solid', borderColor: 'var(--border-base) transparent transparent transparent'
          }}></span>
          <span style={{
            position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: '-1px',
            borderWidth: '4px', borderStyle: 'solid', borderColor: 'var(--bg-elevated) transparent transparent transparent'
          }}></span>
        </span>
      )}
    </button>
  )
}

function App() {
  // ── Chat State ──

  const chatSessions = useChatStore(state => state.sessions)
  const activeChatId = useChatStore(state => state.activeSessionId)
  const createChat = useChatStore(state => state.createSession)
  const deleteChat = useChatStore(state => state.deleteSession)
  const setActiveChat = useChatStore(state => state.setActiveSession)
  const updateChatMessages = useChatStore(state => state.updateMessages)
  const chatHydrated = useChatStore(state => state._hasHydrated)

  const activeSession = chatSessions.find(s => s.id === activeChatId)
  const messages = activeSession?.messages || []

  const formatChatAsMarkdown = (session) => {
    if (!session || !session.messages || session.messages.length === 0) return null

    let markdown = `# ${session.title}\n\n`
    session.messages.forEach(msg => {
      const roleName = msg.role === 'user' ? 'User' : 'Assistant'
      markdown += `### ${roleName}\n\n`
      
      if (msg.files && msg.files.length > 0) {
        markdown += `*Attached Files:* ${msg.files.map(f => `\`${f.name}\``).join(', ')}\n\n`
      }
      if (msg.images && msg.images.length > 0) {
        markdown += `*Attached Images:* ${msg.images.length} image(s)\n\n`
      }

      markdown += `${msg.content}\n\n---\n\n`
    })
    return markdown
  }

  const exportChatAsMarkdown = async () => {
    const markdown = formatChatAsMarkdown(activeSession)
    if (!markdown) return

    const defaultFilename = `${activeSession.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.md`
    if (window.api && window.api.exportChat) {
      await window.api.exportChat(defaultFilename, markdown)
    }
  }

  const [shareLoading, setShareLoading] = useState(false)
  const [shareModal, setShareModal] = useState({ isOpen: false, mode: '', data: null, error: null })
  const [isEditsExpanded, setIsEditsExpanded] = useState(true)

  const handleOpenShare = () => {
    if (!activeSession) return
    let storedObj = null
    try {
      storedObj = JSON.parse(localStorage.getItem(`share_info_${activeChatId}`))
    } catch(e) {}

    // Cleanup old bugged token from previous version
    if (!storedObj && localStorage.getItem(`share_token_${activeChatId}`)) {
      localStorage.removeItem(`share_token_${activeChatId}`)
    }

    if (storedObj) {
      setShareModal({ isOpen: true, mode: 'confirm-revoke', data: storedObj, error: null })
    } else {
      setShareModal({ isOpen: true, mode: 'confirm-share', data: null, error: null })
    }
  }

  const handleConfirmShare = async () => {
    setShareModal(prev => ({ ...prev, error: "Cloud sharing is disabled in local mode." }))
  }

  const handleConfirmRevoke = async () => {
    localStorage.removeItem(`share_info_${activeChatId}`)
    setShareModal({ isOpen: false, mode: '', data: null, error: null })
  }

  const closeShareModal = () => setShareModal({ isOpen: false, mode: '', data: null, error: null })

  const streamingSessionIdRef = useRef(null)

  useEffect(() => {
    if (!chatHydrated) return;
    if (!activeChatId && chatSessions.length === 0) {
      createChat()
    } else if (!activeChatId && chatSessions.length > 0) {
      setActiveChat(chatSessions[0].id)
    }
  }, [chatHydrated, activeChatId, chatSessions, createChat, setActiveChat])
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState([])
  const [fileAttachments, setFileAttachments] = useState([])
  const [contextMentions, setContextMentions] = useState([])

  const [popoverState, setPopoverState] = useState({
    isOpen: false,
    type: null,
    query: '',
    x: 0,
    y: 0,
    selectedIndex: 0,
    options: []
  })
  const [isStreaming, setIsStreaming] = useState(false)
  const [selectedModel, setSelectedModel] = useState('auto')
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [modelMenuRect, setModelMenuRect] = useState(null)
  const modelMenuBtnRef = useRef(null)
  const [resolvedModel, setResolvedModel] = useState(null)
  const [appVersion, setAppVersion] = useState('')

  // ── Multi-Provider API Key State ──
  const [providerKeys, setProviderKeys] = useState({})
  const [autoDetectedProvider, setAutoDetectedProvider] = useState(null)
  const [isDetecting, setIsDetecting] = useState(false)

  // System status
  const [systemInfo, setSystemInfo] = useState({ os: '', electron: '', chrome: '', node: '', arch: '' })

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.meta-model-selector') && !e.target.closest('.model-menu-popover')) {
        setIsModelMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const [selectedProvider, setSelectedProvider] = useState('openai')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [keySaving, setKeySaving] = useState(false)
  const [keyMessage, setKeyMessage] = useState(null)

  // ── File Explorer State ──
  const [projectRoot, setProjectRoot] = useState(null)
  const [deletingProvider, setDeletingProvider] = useState(null) // which provider is pending delete confirmation

  useEffect(() => {
    const fetchWorkspace = window.api ? window.api.getStartupWorkspace() : Promise.resolve('/workspace');

fetchWorkspace.then(workspace => {
      if (workspace) {
        setProjectRoot(workspace)
      }
    })
  }, [])

  useEffect(() => {
    if (projectRoot) {
      try {
        const stored = localStorage.getItem('recent-projects')
        let recents = stored ? JSON.parse(stored) : []

        // Remove if it already exists to move it to the top
        recents = recents.filter(p => p.path !== projectRoot)

        const name = projectRoot.split(/[/\\]/).pop() || projectRoot
        recents.unshift({ name, path: projectRoot, timestamp: Date.now() })

        // Keep only top 15
        recents = recents.slice(0, 15)
        localStorage.setItem('recent-projects', JSON.stringify(recents))
      } catch (e) {
        console.error('Failed to save recent project:', e)
      }
    }
  }, [projectRoot])

  // ── Kick off the workspace diagnostics scanner whenever the
  //    project root changes. This is what populates the "3" / "!"
  //    badges next to filenames in the sidebar without requiring
  //    the user to open every file first. The scanner drops all
  //    previous counts and rebuilds them from scratch, so switching
  //    between projects always gives a clean, correct view.
  useEffect(() => {
    if (!projectRoot) {
      useDiagnosticsStore.getState().clearAll()
      return
    }
    // Small delay so the LSP processes have time to spawn if the
    // user just landed in a fresh project.
    const timer = setTimeout(() => {
      scanWorkspaceForDiagnostics(projectRoot).catch((err) => {
        console.error('Workspace diagnostics scan failed:', err)
      })
    }, 500)
    return () => clearTimeout(timer)
  }, [projectRoot])

  // ── UI State ──
  const [showExplorer, setShowExplorer] = useState(true)
  const [showVisualizer, setShowVisualizer] = useState(false)
  const [dsaExplainer, setDsaExplainer] = useState(null) // null | { code, language }
  const [toast, setToast] = useState(null)
  const [missingToolchain, setMissingToolchain] = useState(null)
  const [toolchainDownload, setToolchainDownload] = useState(null)
  const [activeMenu, setActiveMenu] = useState(null)
  const [activeSubmenu, setActiveSubmenu] = useState(null)

  useEffect(() => {
    const handleClickOutside = () => {
      setActiveMenu(null)
      setActiveSubmenu(null)
    }
    if (activeMenu) {
      window.addEventListener('click', handleClickOutside)
    }
    return () => window.removeEventListener('click', handleClickOutside)
  }, [activeMenu])

  useEffect(() => {
    const handleShowToast = (e) => {
      setToast({ message: e.detail.message, type: e.detail.type || 'info' })
      setTimeout(() => setToast(null), 3000)
    }
    window.addEventListener('show-toast', handleShowToast)
    return () => window.removeEventListener('show-toast', handleShowToast)
  }, [])

  // Create and open new file from AI Chat snippet
  useEffect(() => {
    const handleAiNewFile = (e) => {
      const { content = '', language = 'txt' } = e.detail || {}
      const extMap = { cpp: 'cpp', c: 'c', js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts', py: 'py', python: 'py', html: 'html', css: 'css', json: 'json', md: 'md', sql: 'sql' }
      const ext = extMap[(language || '').toLowerCase()] || 'txt'
      const id = `untitled:Untitled-${Date.now()}.${ext}`
      const name = `Untitled.${ext}`
      setOpenFiles(prev => [...prev, { name, path: id, content }])
      setActiveFile(id)
      setToast({ message: `Opened code in ${name}`, type: 'success' })
      setTimeout(() => setToast(null), 3000)
    }
    window.addEventListener('ai-create-new-file', handleAiNewFile)
    return () => window.removeEventListener('ai-create-new-file', handleAiNewFile)
  }, [])

  // Open DSA Explainer prepopulated from the editor context menu.
  useEffect(() => {
    const handleOpenDsa = (e) => {
      const { code = '', language = 'javascript' } = e.detail || {}
      setDsaExplainer({ code, language })
    }
    window.addEventListener('open-dsa-explainer', handleOpenDsa)
    return () => window.removeEventListener('open-dsa-explainer', handleOpenDsa)
  }, [])

  // Fetch API keys and app version on mount
  useEffect(() => {
    if (window.api && window.api.getApiKeys) {
      window.api.getApiKeys().then(keys => {
        setProviderKeys(keys)
      }).catch(err => console.error('Failed to load keys', err))
    }
    if (window.api && window.api.getAppVersion) {
      window.api.getAppVersion().then(v => setAppVersion(v)).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (window.api && window.api.onShowMissingToolchainModal) {
      window.api.onShowMissingToolchainModal((validation) => {
        setMissingToolchain(validation)
      })
    }
    if (window.api && window.api.onToolchainDownloadProgress) {
      window.api.onToolchainDownloadProgress((data) => {
        setToolchainDownload(data)
        if (data.stage === 'complete') {
          setTimeout(() => setToolchainDownload(null), 5000)
        }
      })
    }
    if (window.api && window.api.onToolchainDownloadError) {
      window.api.onToolchainDownloadError((data) => {
        setToolchainDownload({ error: data.error })
        setTimeout(() => setToolchainDownload(null), 5000)
      })
    }
  }, [])

  // ── Live Server State ──
  const [isLiveServerRunning, setIsLiveServerRunning] = useState(false)
  const [liveServerUrl, setLiveServerUrl] = useState(null)
  const [showGitTimeline, setShowGitTimeline] = useState(false)

  const handleToggleLiveServer = async () => {
    let openPath = ''
    if (activeFile && activeFile.startsWith(projectRoot)) {
      openPath = activeFile.substring(projectRoot.length).replace(/^[\\/]/, '')
    }

    if (isLiveServerRunning && liveServerUrl) {
      const targetUrl = openPath ? `${liveServerUrl}/${openPath.replace(/\\/g, '/')}` : liveServerUrl
      window.api.openUrl(targetUrl)
    } else {
      if (!projectRoot) return
      const res = await window.api.startLiveServer(projectRoot, openPath)
      if (res.success) {
        setIsLiveServerRunning(true)
        setLiveServerUrl(res.baseUrl || res.url)
      } else {
        console.error('Failed to start Live Server:', res.error)
      }
    }
  }

  const handleStopLiveServer = async (e) => {
    e.stopPropagation()
    if (isLiveServerRunning) {
      await window.api.stopLiveServer()
      setIsLiveServerRunning(false)
      setLiveServerUrl(null)
    }
  }

  // Custom Provider State
  const [customBaseUrl, setCustomBaseUrl] = useState('https://openrouter.ai/api/v1')
  const [customModelId, setCustomModelId] = useState('qwen/qwen-2.5-coder-32b-instruct')
  const [customName, setCustomName] = useState('')
  const [customConfigLoaded, setCustomConfigLoaded] = useState(false)

  useEffect(() => {
    if (!window.api) return
    window.api.getCustomConfig().then(config => {
      if (config) {
        if (config.customBaseUrl) setCustomBaseUrl(config.customBaseUrl)
        if (config.customModelId) setCustomModelId(config.customModelId)
        if (config.customName !== undefined) setCustomName(config.customName)
      }
      setCustomConfigLoaded(true)
    })
  }, [])

  useEffect(() => {
    if (customConfigLoaded && window.api) {
      window.api.saveCustomConfig({ customBaseUrl, customModelId, customName })
    }
  }, [customBaseUrl, customModelId, customName, customConfigLoaded])

  // Refs
  const chatEndRef = useRef(null)

  // ── Editor State ──
  const [editorGroups, setEditorGroups] = useState([
    { id: 'group-1', openFiles: [], activeFile: null, closedFiles: [] }
  ])
  const [activeEditorGroupId, setActiveEditorGroupId] = useState('group-1')

  // Backward compatibility getters for AI Debugger, Live Server, etc.
  const activeGroup = editorGroups.find(g => g.id === activeEditorGroupId) || editorGroups[0]
  const openFiles = activeGroup.openFiles
  const activeFile = activeGroup.activeFile

  // Backward compatibility setters (operates on active group)
  const setOpenFiles = (updater) => {
    setEditorGroups(prev => {
      const idx = prev.findIndex(g => g.id === activeEditorGroupId)
      if (idx === -1) return prev
      const newGroups = [...prev]
      const next = typeof updater === 'function' ? updater(prev[idx].openFiles) : updater
      newGroups[idx] = { ...prev[idx], openFiles: next }
      return newGroups
    })
  }

  const setActiveFile = (updater) => {
    setEditorGroups(prev => {
      const idx = prev.findIndex(g => g.id === activeEditorGroupId)
      if (idx === -1) return prev
      const newGroups = [...prev]
      const next = typeof updater === 'function' ? updater(prev[idx].activeFile) : updater
      newGroups[idx] = { ...prev[idx], activeFile: next }
      return newGroups
    })
  }

  // ── Terminal State ──
  const [showTerminal, setShowTerminal] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(250)

  const terminalPanelRefs = useRef({})
  const [terminals, setTerminals] = useState([{ id: 'default', name: 'bash' }])
  const [activeTerminalId, setActiveTerminalId] = useState('default')

  const handleAddTerminal = () => {
    const newId = 'term-' + Date.now()
    setTerminals(prev => {
      let maxNum = 0
      prev.forEach(t => {
        const match = t.name.match(/bash (\d+)/)
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10))
      })
      return [...prev, { id: newId, name: `bash ${maxNum + 1}` }]
    })
    setActiveTerminalId(newId)
  }

  const handleKillTerminal = (id, e) => {
    e.stopPropagation()
    window.api.killTerminal(id)
    setTerminals(prev => {
      const filtered = prev.filter(t => t.id !== id)
      if (activeTerminalId === id) {
        setTimeout(() => {
          setActiveTerminalId(filtered.length > 0 ? filtered[filtered.length - 1].id : null)
        }, 0)
      }
      return filtered
    })
  }

  // ── Layout State ──
  const streamRef = useRef('')

  const [autoCompleteEnabled, setAutoCompleteEnabled] = useState(localStorage.getItem('editor-inlineSuggest') !== 'false')
  const [autoCompleteDelay, setAutoCompleteDelay] = useState(500)

  useEffect(() => {
    const handleSettingsChanged = (e) => {
      if (e.detail.key === 'editor-inlineSuggest') {
        setAutoCompleteEnabled(e.detail.value)
      }
    }
    window.addEventListener('settings-changed', handleSettingsChanged)
    return () => window.removeEventListener('settings-changed', handleSettingsChanged)
  }, [])

  const saveActiveFile = async () => {
    if (!activeFile) return
    const cleanPath = activeFile.replace(/\r/g , '');

      if (typeof window.getEditorValue === 'function') {
      const content = window.getEditorValue()

      if (cleanPath.startsWith('untitled:')) {
        if (window.api.showSaveDialog) {
          const newPath = await window.api.showSaveDialog({
            title: 'Save Untitled File',
            defaultPath: 'Untitled.txt'
          });
          if (newPath) {
            await window.api.saveFileContents(newPath, content);
            setOpenFiles(prev => prev.map(f => {
              if (f.path === activeFile) {
                return { ...f, path: newPath, name: newPath.split(/[/\\]/).pop(), isDirty: false };
              }
              return f;
            }));
            setActiveFile(newPath);
          }
        }
        return;
      }

      await window.api.saveFileContents(cleanPath, content)
      markFileClean(cleanPath)
    }
  }

  const handleRunFile = async () => {
    if (!activeFile) return
    const cleanPath = activeFile.replace(/\r/g,'');
	  // Auto-save the file before running so the terminal executes the latest code
    if (typeof window.getEditorValue === 'function') {
      const content = window.getEditorValue()
	    // save using the cleanPath
      await window.api.saveFileContents(cleanPath, content)
      markFileClean(activeFile)
    }

    let cmd = ''

    const isWindows = navigator.userAgent.toLowerCase().includes('win')

    if (cleanPath.endsWith('.js') || cleanPath.endsWith('.ts')) cmd = `node "${cleanPath}"`
    else if (cleanPath.endsWith('.py')) cmd = `python "${cleanPath}"`
    else if (cleanPath.endsWith('.go')) cmd = `go run "${cleanPath}"`
    else if (cleanPath.endsWith('.java')) cmd = `java "${cleanPath}"`
    else if (cleanPath.endsWith('.cpp') || cleanPath.endsWith('.c++') || cleanPath.endsWith('.c')) {
      cmd = isWindows
        ? `g++ "${cleanPath}" -o out.exe && out.exe`
        : `g++ "${cleanPath}" -o out && ./out`
    } else if (cleanPath.endsWith('.toad')) {
      const isToadCodeEnabled = useAppStore.getState().extensions.some(e => e.id === 'ext-lang-toadcode' && e.enabled)
      if (isToadCodeEnabled) {
        cmd = `toadcode "${cleanPath}"`
      } else {
        console.log('ToadCode extension is not enabled')
        return
      }
    } else {
      console.log('Unsupported file type for running')
      return
    }

    setShowTerminal(true)
    setTimeout(() => {
      const activeTerminal = terminalPanelRefs.current[activeTerminalId]
      if (activeTerminal) {
        activeTerminal.executeCommand(cmd)
      }
    }, 100)
  }

  const runFileRef = useRef(handleRunFile)
  useEffect(() => {
    runFileRef.current = handleRunFile
  })

  // Global Run File event listener
  useEffect(() => {
    const handleGlobalRun = () => runFileRef.current()
    window.addEventListener('global-run-file', handleGlobalRun)
    return () => {
      window.removeEventListener('global-run-file', handleGlobalRun)
    }
  }, [])
  // Handle agentic edit events from CodeEditor
  useEffect(() => {
    const handleEditSuccess = (e) => {
      const { id, ids } = e.detail;
      const targetIds = ids || [id];
      updateChatMessages(useChatStore.getState().activeSessionId, prev => {
        if (!prev) return prev
        return prev.map(msg => {
          if (msg.proposedEdits) {
            const updatedEdits = msg.proposedEdits.map(edit => targetIds.includes(edit.id) ? { ...edit, status: 'approved', error: null } : edit)
            return { ...msg, proposedEdits: updatedEdits }
          }
          return msg
        })
      })
    }
    const handleEditError = (e) => {
      const { id, ids, error, isReject } = e.detail;
      const targetIds = ids || [id];
      updateChatMessages(useChatStore.getState().activeSessionId, prev => {
        if (!prev) return prev
        return prev.map(msg => {
          if (msg.proposedEdits) {
            const updatedEdits = msg.proposedEdits.map(edit => targetIds.includes(edit.id) ? { ...edit, status: isReject ? 'rejected' : 'pending', error } : edit)
            return { ...msg, proposedEdits: updatedEdits }
          }
          return msg
        })
      })
    }
    window.addEventListener('agentic-edit-success', handleEditSuccess)
    window.addEventListener('agentic-edit-error', handleEditError)
    return () => {
       window.removeEventListener('agentic-edit-success', handleEditSuccess)
       window.removeEventListener('agentic-edit-error', handleEditError)
    }
  }, [])

  // File Explorer Context Menu Global Sync (Rename / Delete)
  useEffect(() => {
    const handleFileRenamed = (e) => {
      const { oldPath, newPath } = e.detail

      // Move any diagnostic entries the store already knows about so the
      // badge follows the file. Covers directory renames too because
      // renamePath rewrites every key with the old prefix.
      useDiagnosticsStore.getState().renamePath(oldPath, newPath)

      setEditorGroups(prevGroups => {
        return prevGroups.map(group => {
          let updatedOpenFiles = [...group.openFiles]
          let updatedActiveFile = group.activeFile
          let modified = false

          const isAffected = (p) => p && (p === oldPath || p.startsWith(oldPath + '/') || p.startsWith(oldPath + '\\'))
          const getNewPath = (p) => p === oldPath ? newPath : newPath + p.substring(oldPath.length)

          updatedOpenFiles = updatedOpenFiles.map(f => {
            if (isAffected(f.path)) {
              modified = true
              const newFilePath = getNewPath(f.path)
              const newFileName = newFilePath.split(/[/\\]/).pop()

              // Handle Monaco model sync without visually closing tab
              try {
                const oldUri = monaco.Uri.file(f.path)
                let model = monaco.editor.getModel(oldUri)

                if (model) {
                  const content = model.getValue()
                  const lang = model.getLanguageId()
                  model.dispose()

                  const newUri = monaco.Uri.file(newFilePath)
                  monaco.editor.createModel(content, lang, newUri)
                }
              } catch (err) {
                console.error('Failed to sync monaco model on rename', err)
              }

              return { ...f, path: newFilePath, name: newFileName }
            }
            return f
          })

          if (isAffected(updatedActiveFile)) {
            updatedActiveFile = getNewPath(updatedActiveFile)
          }

          if (modified) {
            return { ...group, openFiles: updatedOpenFiles, activeFile: updatedActiveFile }
          }
          return group
        })
      })
    }

    const handleFileDeleted = (e) => {
      const { path } = e.detail

      // Purge diagnostics for the deleted path (clearForPath handles
      // descendants too — a folder delete drops every child badge).
      useDiagnosticsStore.getState().clearForPath(path)

      setEditorGroups(prevGroups => {
        return prevGroups.map(group => {
          const isAffected = (p) => p && (p === path || p.startsWith(path + '/') || p.startsWith(path + '\\'))
          const stillOpen = group.openFiles.filter(f => !isAffected(f.path))

          if (stillOpen.length !== group.openFiles.length) {
            const closedFiles = group.openFiles.filter(f => isAffected(f.path))
            closedFiles.forEach(f => {
              try {
                const uri = monaco.Uri.file(f.path)
                const model = monaco.editor.getModel(uri)
                if (model) model.dispose()
              } catch (err) { }
            })

            let newActive = group.activeFile
            if (isAffected(group.activeFile)) {
              newActive = stillOpen.length > 0 ? stillOpen[stillOpen.length - 1].path : null
            }
            return { ...group, openFiles: stillOpen, activeFile: newActive }
          }
          return group
        })
      })
    }

    window.addEventListener('file-renamed', handleFileRenamed)
    window.addEventListener('file-deleted', handleFileDeleted)
    return () => {
      window.removeEventListener('file-renamed', handleFileRenamed)
      window.removeEventListener('file-deleted', handleFileDeleted)
    }
  }, [])



  const [sidebarWidth, setSidebarWidth] = useState(260)
  const { activePanel, setActivePanel, activeTheme, extensions, autoSave, setAutoSave, isChatOpen, setIsChatOpen, toggleChat, chatWidth, setChatWidth } = useAppStore()
  const isLiveServerEnabled = extensions?.find(e => e.id === 'ext-prod-liveserver')?.enabled

  // Initialize active theme
  useEffect(() => {
    document.body.style.backgroundColor = '' // Clear inline script fallback
    document.body.className = `theme-${activeTheme}`
  }, [activeTheme])

  const handleOpenFile = async (path, name, options = {}) => {
    let gitOriginal = null
    if (options.diff) {
      let relPath = options.relPath
      if (!relPath && path.startsWith(projectRoot)) {
        relPath = path.substring(projectRoot.length).replace(/^[\\/]/, '')
      }
      const res = await window.api.gitAction(projectRoot, 'show-head', relPath || path)
      if (res && res.stdout) {
        gitOriginal = res.stdout
      }
    }

    setOpenFiles((prev) => {
      const existing = prev.find(f => f.path === path)
      if (!existing) {
        return [...prev, { path, name, isDirty: false, gitOriginal }]
      } else if (gitOriginal !== null) {
        // Update existing with git diff if requested again
        return prev.map(f => f.path === path ? { ...f, gitOriginal } : f)
      }
      return prev
    })
    setActiveFile(path)
  }

  const closeFile = (path) => {
    setEditorGroups(prev => {
      const idx = prev.findIndex(g => g.id === activeEditorGroupId)
      if (idx === -1) return prev
      const newGroups = [...prev]

      const fileToClose = newGroups[idx].openFiles.find(f => f.path === path)
      if (!fileToClose) return prev

      const newFiles = newGroups[idx].openFiles.filter(f => f.path !== path)
      let newActive = newGroups[idx].activeFile
      if (newActive === path) {
        newActive = newFiles.length > 0 ? newFiles[newFiles.length - 1].path : null
      }

      const newClosedFiles = [...(newGroups[idx].closedFiles || []), fileToClose].filter(Boolean)

      newGroups[idx] = {
        ...newGroups[idx],
        openFiles: newFiles,
        activeFile: newActive,
        closedFiles: newClosedFiles
      }
      return newGroups
    })
  }

  const markFileDirty = (path) => setOpenFiles(prev => prev.map(f => f.path === path ? { ...f, isDirty: true } : f))
  const markFileClean = (path) => setOpenFiles(prev => prev.map(f => f.path === path ? { ...f, isDirty: false } : f))

  // ── Load all saved keys on mount ──
  useEffect(() => {
    const fetchKeys = window.api && window.api.getAllKeys ? window.api.getAllKeys() : Promise.resolve({});

fetchKeys.then((result) => {
      setProviderKeys(result)
      const count = Object.keys(result).length
      if (count > 0) {
        console.log(`Loaded ${count} API key(s):`, Object.keys(result).join(', '))
      }
    })
  }, [])

  // ── Subscribe to AI stream chunks ──
  useEffect(() => {
    if (window.api && window.api.onAIStream) {
	    window.api.onAIStream((event, data) => {
      if (chunk === undefined) return
      streamRef.current += chunk
      const targetSessionId = streamingSessionIdRef.current || useChatStore.getState().activeSessionId;
      if (targetSessionId) {
        useChatStore.getState().updateMessages(targetSessionId, (prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last && last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: streamRef.current || '' }
          }
          return updated
        })
      }
    });
    }


  }, [])

  // ── Subscribe to model resolution ──
  useEffect(() => {
    if (window.api && window.api.onModelResolved) {
	  window.api.onModelResolved((model) => {
      setResolvedModel(model)
      const targetSessionId = streamingSessionIdRef.current || useChatStore.getState().activeSessionId;
      if (targetSessionId) {
        useChatStore.getState().updateMessages(targetSessionId, (prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last && last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, resolvedModel: model }
          }
          return updated
        })
      }
    })
    }
  }, [])

  const pendingChordRef = useRef([])
  const [currentChordDisplay, setCurrentChordDisplay] = useState('')

  const executeGlobalAction = (id) => {
    switch (id) {
      case 'general.commandPalette':
        window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.quickCommand' }))
        return true
      case 'general.terminal':
        setShowTerminal(true)
        handleAddTerminal()
        return true
      case 'general.splitTerminal':
        setShowTerminal(true)
        handleAddTerminal()
        return true
      case 'general.sidebar':
        setActivePanel(useAppStore.getState().activePanel === 'explorer' ? null : 'explorer')
        return true
      case 'general.zen':
        setActivePanel(null)
        setShowTerminal(false)
        return true
      case 'general.fullscreen':
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(err => console.error(err))
        } else {
          document.exitFullscreen().catch(err => console.error(err))
        }
        return true
      case 'view.zoomIn':
        window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.fontZoomIn' }))
        return true
      case 'view.zoomOut':
        window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.fontZoomOut' }))
        return true
      case 'view.zoomReset':
        window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.fontZoomReset' }))
        return true
      case 'general.closeWindow':
        window.close()
        return true
      case 'file.openFolder':
        if (window.api && window.api.selectFolder) {
          window.api.selectFolder().then(p => {
            if (p) {
              setProjectRoot(p)
              setActivePanel('explorer')
              window.dispatchEvent(new CustomEvent('refresh-sidebar'))
            }
          })
        } else {
          setActivePanel('explorer')
        }
        return true
      case 'general.shortcuts':
        handleOpenFile('settings:shortcuts', 'Keyboard Shortcuts')
        return true
      case 'file.saveAll':
        saveActiveFile()
        return true
      case 'file.closeFolder':
        return true
        setProjectRoot(null)
        return true
      case 'general.run':
      case 'debug.run':
        window.dispatchEvent(new Event('global-run-file'))
        return true
      case 'file.new':
        const newId = `untitled:Untitled-${Date.now()}`
        setOpenFiles(prev => [...prev, { name: 'Untitled', path: newId }])
        setActiveFile(newId)
        return true
      case 'file.newWindow':
        if (window.api.newWindow) window.api.newWindow()
        return true
      case 'file.closeAll':
        setOpenFiles([])
        setActiveFile(null)
        return true
      case 'file.open':
        if (window.api.selectFile) {
          window.api.selectFile().then(p => {
            if (p) {
              const recents = JSON.parse(localStorage.getItem('recentFiles') || '[]')
              if (!recents.includes(p)) localStorage.setItem('recentFiles', JSON.stringify([p, ...recents].slice(0, 5)))
              handleOpenFile(p, p.split(/[/\\]/).pop())
            }
          })
        }
        return true
      case 'file.saveAs':
      case 'file.save':
        saveActiveFile()
        return true
      case 'file.close':
        if (activeFile) closeFile(activeFile)
        return true
      case 'general.settings':
        handleOpenFile('settings:main', 'Settings')
        return true

      // Mapped unimplemented global features
      case 'general.split': {
        const newId = 'group-' + Date.now()
        setEditorGroups(prev => {
          const activeGroup = prev.find(g => g.id === activeEditorGroupId) || prev[0]
          return [...prev, { id: newId, openFiles: [...activeGroup.openFiles], activeFile: activeGroup.activeFile, closedFiles: [] }]
        })
        setActiveEditorGroupId(newId)
        return true
      }
      case 'file.reopen': {
        setEditorGroups(prev => {
          const idx = prev.findIndex(g => g.id === activeEditorGroupId)
          if (idx === -1) return prev
          const activeGroup = prev[idx]
          if (!activeGroup.closedFiles || activeGroup.closedFiles.length === 0) return prev

          const newClosed = [...activeGroup.closedFiles]
          const toRestore = newClosed.pop()
          if (!toRestore) return prev

          const newGroups = [...prev]
          const isAlreadyOpen = activeGroup.openFiles.some(f => f.path === toRestore.path)

          if (isAlreadyOpen) {
            newGroups[idx] = { ...activeGroup, activeFile: toRestore.path, closedFiles: newClosed }
          } else {
            newGroups[idx] = {
              ...activeGroup,
              openFiles: [...activeGroup.openFiles, toRestore],
              activeFile: toRestore.path,
              closedFiles: newClosed
            }
          }
          return newGroups
        })
        return true
      }
      case 'nav.switchTab': {
        setEditorGroups(prev => {
          const idx = prev.findIndex(g => g.id === activeEditorGroupId)
          if (idx === -1) return prev
          const activeGroup = prev[idx]
          if (activeGroup.openFiles.length <= 1) return prev // no-op for 0 or 1 file

          const currentFileIdx = activeGroup.openFiles.findIndex(f => f.path === activeGroup.activeFile)
          const nextFileIdx = (currentFileIdx + 1) % activeGroup.openFiles.length
          const newGroups = [...prev]
          newGroups[idx] = { ...activeGroup, activeFile: activeGroup.openFiles[nextFileIdx].path }
          return newGroups
        })
        return true
      }
      case 'nav.focusExplorer':
        setActivePanel('explorer')
        return true
      case 'nav.focusTerminal':
        setShowTerminal(prev => !prev)
        return true
      case 'edit.findInFiles':
        setActivePanel('search')
        return true
      case 'ai.chat':
        setIsChatOpen(prev => !prev)
        return true

      case 'debug.start':
      case 'debug.breakpoint':
      case 'debug.stepOver':
      case 'debug.stepInto':
      case 'debug.stepOut':
      case 'debug.stop':
        window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: `Debugging requires a language-specific DAP backend.`, type: 'info' } }))
        return true

      case 'nav.goBack':
      case 'nav.goForward':
        window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: `Feature '${id}' is not yet implemented in this preview.`, type: 'info' } }))
        return true
      case 'nav.goToFile':
        window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.quickCommand' }))
        return true

      case 'ai.autocomplete': {
        const currentState = localStorage.getItem('editor-inlineSuggest') !== 'false';
        const newState = !currentState;
        localStorage.setItem('editor-inlineSuggest', newState.toString());
        window.dispatchEvent(new CustomEvent('settings-changed', { detail: { key: 'editor-inlineSuggest', value: newState } }));
        window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: `AI Autocomplete is now ${newState ? 'ON' : 'OFF'}`, type: 'info' } }));
        return true;
      }

      default:
        if (id.startsWith('edit.') || id.startsWith('ai.') || id.startsWith('nav.')) {
          const activeEl = document.activeElement;
          
          if (activeEl && activeEl.closest) {
            // Ignore if we are inside special views or the AI chat panel (right-pane)
            if (activeEl.closest('.postman-view') || activeEl.closest('.dsa-explainer-overlay') || activeEl.closest('.right-pane')) {
              return false;
            }
          }

          // Global fallback: if the user has text selected outside of Monaco/Terminal and hits copy/cut,
          // let the browser handle it natively so they can copy text from the UI.
          if ((id === 'edit.copy' || id === 'edit.cut') && window.getSelection().toString() !== '') {
            if (activeEl && !activeEl.classList.contains('inputarea') && !activeEl.classList.contains('xterm-helper-textarea')) {
              return false;
            }
          }

          // Let the terminal handle its own shortcuts natively (e.g. Ctrl+C for copy/SIGINT, Ctrl+V for paste)
          if (activeEl && activeEl.classList.contains('xterm-helper-textarea') && id.startsWith('edit.')) {
            return false;
          }

          window.dispatchEvent(new CustomEvent('editor-action', { detail: id }))
          return true
        }
        return false
    }
  }

  const executeGlobalActionRef = useRef(executeGlobalAction);
  executeGlobalActionRef.current = executeGlobalAction;

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (useShortcutStore.getState().isEditing) return;
      if (e.repeat) return;

      // DEBUG: log Ctrl key combos to diagnose zoom issue
      if (e.ctrlKey && (e.key === '-' || e.key === '=' || e.key === '+' || e.key === '0' || e.key === 'Subtract' || e.key === 'Add')) {
        console.log('[ZOOM DEBUG] e.key:', JSON.stringify(e.key), 'e.code:', e.code, 'e.keyCode:', e.keyCode)
      }

      // Focus guard: ignore if typing in an input/textarea (unless it's the Monaco editor or xterm)
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        if (!activeEl.classList.contains('inputarea') && !activeEl.classList.contains('xterm-helper-textarea')) {
          return;
        }
      }



      // Ignore pure modifier presses (wait for the actual key)
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        return;
      }

      // Intercept and prevent Chrome browser default actions that hijack the web IDE (Ctrl+O, Ctrl+S, Ctrl+P)
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const lowerKey = e.key.toLowerCase();
        if (['o', 's', 'p'].includes(lowerKey)) {
          e.preventDefault();
        }
      }

      // If a shortcut chord is active (e.g. Ctrl+K was pressed), prevent browser handling of subsequent keys
      if (pendingChordRef.current.length > 0) {
        e.preventDefault();
      }

      const currentKeys = normalizeEventToKeys(e);

      const keysToMatch = [...pendingChordRef.current, ...currentKeys];
      const shortcuts = useShortcutStore.getState().shortcuts;

      let matchFound = null;
      let partialMatch = false;

      for (const group of shortcuts) {
        for (const item of group.items) {
          const itemKeysStr = item.keys.join('+').toLowerCase();
          const matchStr = keysToMatch.join('+').toLowerCase();

          if (itemKeysStr === matchStr) {
            matchFound = item;
            break;
          }
          if (itemKeysStr.startsWith(matchStr + '+')) {
            partialMatch = true;
          }
        }
        if (matchFound) break;
      }

      if (matchFound) {
        if (matchFound.id.startsWith('custom.')) {
          e.preventDefault()
          e.stopPropagation()
          const cmd = matchFound.command
          if (cmd) {
            let targetTerminal = terminalPanelRefs.current[activeTerminalId]

            // If active isn't ready/spawned, try to find any recently used one
            if (!targetTerminal || !targetTerminal.executeCommand) {
              const availableKeys = Object.keys(terminalPanelRefs.current).reverse()
              for (const k of availableKeys) {
                if (terminalPanelRefs.current[k] && terminalPanelRefs.current[k].executeCommand) {
                  targetTerminal = terminalPanelRefs.current[k]
                  setActiveTerminalId(k)
                  break
                }
              }
            }

            setShowTerminal(true)

            if (targetTerminal && targetTerminal.executeCommand) {
              targetTerminal.executeCommand(cmd)
            } else {
              // No terminal exists at all, create one
              handleAddTerminal()
              // Wait for it to spawn before executing
              const checkReady = setInterval(() => {
                const newTerm = terminalPanelRefs.current[activeTerminalId]
                // Note: activeTerminalId might not be updated immediately in this closure, 
                // so we scan the refs for the newly added one.
                const allKeys = Object.keys(terminalPanelRefs.current)
                const latestTerm = terminalPanelRefs.current[allKeys[allKeys.length - 1]]

                if (latestTerm && latestTerm.executeCommand) {
                  clearInterval(checkReady)
                  latestTerm.executeCommand(cmd)
                }
              }, 100)
              // Clear interval after 5 seconds to prevent memory leaks if spawn fails
              setTimeout(() => clearInterval(checkReady), 5000)
            }
          }
          return
        }

        // Only prevent default and stop propagation if it's a GLOBAL action handled by App.jsx.
        // Editor actions are natively handled by Monaco's keybinding registry.
        const handled = executeGlobalActionRef.current(matchFound.id);

        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }

        pendingChordRef.current = [];
        setCurrentChordDisplay('');
      } else if (partialMatch) {
        e.preventDefault();
        e.stopPropagation();
        pendingChordRef.current = keysToMatch;
        setCurrentChordDisplay(keysToMatch.join(' '));

        // Use a unique symbol or counter to avoid clearing the wrong chord if they keep typing
        const currentRef = pendingChordRef.current;
        setTimeout(() => {
          if (pendingChordRef.current === currentRef) {
            pendingChordRef.current = [];
            setCurrentChordDisplay('');
          }
        }, 3000);
      } else {
        // Dynamically suppress old default keybindings that the user has remapped.
        // Build a set of all default keybinding strings, then subtract the current ones.
        // Any default key combo that's no longer assigned to anything should be blocked
        // so Monaco doesn't fire its built-in action for it.
        const matchStr = keysToMatch.join('+').toLowerCase();
        const currentKeySet = new Set();
        for (const group of shortcuts) {
          for (const item of group.items) {
            currentKeySet.add(item.keys.join('+').toLowerCase());
          }
        }
        const defaultKeySet = new Set();
        for (const group of defaultShortcuts) {
          for (const item of group.items) {
            defaultKeySet.add(item.keys.join('+').toLowerCase());
          }
        }
        // "Orphaned" = was a default but is no longer assigned to any shortcut
        if (defaultKeySet.has(matchStr) && !currentKeySet.has(matchStr)) {
          e.preventDefault();
          e.stopPropagation();
        }

        pendingChordRef.current = [];
        setCurrentChordDisplay('');
      }
    }

    const handleDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleDrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

      const files = Array.from(e.dataTransfer.files);
      let lastOpened = null;
      for (const file of files) {
        try {
          const text = await file.text();
          const targetPath = `/workspace/${file.name}`;
          await window.api.saveFileContents(targetPath, text);
          lastOpened = { path: targetPath, name: file.name };
        } catch (err) {
          console.error('[Web IDE] Drag-drop file import error:', err);
        }
      }
      window.dispatchEvent(new CustomEvent('refresh-sidebar'));
      if (lastOpened) {
        handleOpenFile(lastOpened.path, lastOpened.name);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, { capture: true })
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('drop', handleDrop)

    const handleExecuteGlobalAction = (e) => {
      executeGlobalActionRef.current(e.detail)
    }
    window.addEventListener('execute-global-action', handleExecuteGlobalAction)

    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true })
      window.removeEventListener('execute-global-action', handleExecuteGlobalAction)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('drop', handleDrop)
    }
  }, [])

  // ── Auto-detect provider from key input ──
  useEffect(() => {
    const detected = detectProviderFromKey(apiKeyInput)
    setAutoDetectedProvider(detected)
    if (detected) {
      setSelectedProvider(detected)
    }
  }, [apiKeyInput])

  // ── Send Prompt ──
  const handleSend = async (directPromptOverride = null) => {
    try {
      const isDirectOverride = typeof directPromptOverride === 'string'
      const trimmed = isDirectOverride ? directPromptOverride.trim() : prompt.trim()
      if (!trimmed || isStreaming) return

      // Intercept Commands
      if (!isDirectOverride && trimmed.startsWith('/')) {
        const parts = trimmed.split(' ')
        const cmd = parts[0].substring(1).toLowerCase()
        
        if (cmd === 'clear') {
          createChat() // Start a new chat session
          setPrompt('')
          setAttachments([])
          setContextMentions([])
          return
        }
        
        // Handle other commands later...
      }

      // Reset stream accumulator
      streamRef.current = ''
      setResolvedModel(null)

      // Capture the session we are starting a stream for
      let currentChatId = activeChatId
      if (!currentChatId) {
        currentChatId = createChat()
      }
      streamingSessionIdRef.current = currentChatId

      // Add user message + empty assistant placeholder
      const currentAttachments = [...attachments]
      const currentFileAttachments = [...fileAttachments]
      updateChatMessages(currentChatId, (prev) => [
        ...(prev || []),
        { role: 'user', content: trimmed, images: isDirectOverride ? [] : currentAttachments, files: isDirectOverride ? [] : currentFileAttachments },
        { role: 'assistant', content: '', modelId: selectedModel }
      ])

      if (!isDirectOverride) {
        setPrompt('')
        setAttachments([])
        setFileAttachments([])
        setContextMentions([])
      }

      setIsStreaming(true)

      try {
        let finalPrompt = trimmed
        let contextBlocks = []

        // Add attached files context
        if (!isDirectOverride && currentFileAttachments.length > 0) {
          currentFileAttachments.forEach(file => {
            contextBlocks.push(`[ATTACHED FILE: ${file.name}]\n${file.text}\n[END FILE]`)
          })
        }

        if (projectRoot) {
          contextBlocks.push(`Workspace Root: ${projectRoot}\nIf you need to create a new file or edit a background file, construct an absolute path using this root directory.`)
        }

        const diffInstructions = `If you want to modify a file or create a new file, DO NOT output a standard markdown code block. Instead, output an edit block using this EXACT XML format:
<edit_file path="ABSOLUTE_PATH_TO_FILE">
<search>
the exact old code to be replaced
</search>
<replace>
the new code
</replace>
</edit_file>
You can output multiple <search>/<replace> blocks if needed.
CRITICAL RULE: Before outputting ANY <edit_file> blocks, you MUST first output an implementation plan wrapped in <plan>...</plan> tags explaining your reasoning. This is required even for simple single-file changes.
CRITICAL RULE: If the file is empty, or you are creating a new file from scratch, or you want to entirely replace the file contents, you MUST leave the <search> block completely empty (i.e., <search></search>).`

        contextBlocks.push(diffInstructions)

        if (activeFile) {
          try {
            const fileContent = await window.api.getFileContents(activeFile)

            let fileText = fileContent.content || fileContent
            if (typeof window.getEditorValue === 'function') {
              fileText = window.getEditorValue()
            }

            let diagnosticsText = ""
            if (typeof window.getEditorDiagnostics === 'function') {
              const markers = window.getEditorDiagnostics()
              if (markers && markers.length > 0) {
                const severityMap = { 1: 'Hint', 2: 'Info', 4: 'Warning', 8: 'Error' }
                diagnosticsText = "\n\nLSP Diagnostics (Compiler/Linter feedback for the active file):\n" + markers.map(m => `[Line ${m.startLineNumber}, Col ${m.startColumn}] ${severityMap[m.severity] || 'Error'}: ${m.message}`).join('\n')
              }
            }

            contextBlocks.push(`The user is currently working on this active file: ${activeFile}\n\nFile Content:\n\`\`\`\n${fileText}\n\`\`\`${diagnosticsText}\n\nYou should default to editing this file unless requested otherwise.\n\nCRITICAL: If you modify this file, you MUST use the <edit_file path="${activeFile.replace(/\\/g, '/')}"> XML format as instructed above. DO NOT output standard markdown code blocks for file modifications.`)
          } catch (e) {
            console.warn("Could not load active file context:", e)
          }
        }

        if (contextBlocks.length > 0) {
          finalPrompt = `[SYSTEM CONTEXT]\n${contextBlocks.join('\n\n')}\n[END SYSTEM CONTEXT]\n\n${trimmed}`
        }

        const res = await window.api.sendAIPrompt(finalPrompt, {
          model: selectedModel,
          images: currentAttachments,
          customConfig: selectedModel === 'custom' ? {
            baseURL: customBaseUrl.trim(),
            modelId: customModelId.trim()
          } : undefined
        })

        // Stream is now fully finished
        setIsStreaming(false)
        const finalMsg = streamRef.current
        
        // Extract robustly: handles unclosed tags if stream was cut off
        const planRegex = /<plan>([\s\S]*?)(?:<\/plan>|$)/i
        const planMatch = planRegex.exec(finalMsg)
        const planText = planMatch ? planMatch[1].trim() : null

        const regex = /<edit_file\s+path="([^"]+)">([\s\S]*?)<\/edit_file>/g
        let match
        const edits = []
        while ((match = regex.exec(finalMsg)) !== null) {
          edits.push({
            id: Date.now().toString() + Math.random().toString(),
            path: match[1],
            body: match[2],
            status: 'pending' // 'pending' | 'approved' | 'rejected' | 'error'
          })
        }

        if (edits.length > 0 || planText) {
          updateChatMessages(streamingSessionIdRef.current, (prev) => {
            if (!prev || prev.length === 0) return prev
            const newMsgs = [...prev]
            const lastMsg = newMsgs[newMsgs.length - 1]
            return [
              ...newMsgs.slice(0, -1),
              { ...lastMsg, proposedEdits: edits, plan: planText }
            ]
          })

          if (planText) {
            const newId = `untitled:Implementation-Plan-${Date.now()}.md`
            setOpenFiles(prev => [...prev, { name: 'Implementation Plan.md', path: newId, initialContent: planText }])
            setActiveFile(newId)
          }
        }
      } catch (err) {
        console.error('Send error:', err)
        if (streamingSessionIdRef.current) {
          updateChatMessages(streamingSessionIdRef.current, (prev) => [
            ...(prev || []).slice(0, -1),
            { role: 'assistant', content: `// Error: ${err.message}` }
          ])
        }
        setIsStreaming(false)
      }
    } catch (globalErr) {
      alert("GLOBAL HANDLE SEND ERROR: " + globalErr.message)
    }
  }

  // ── Autocomplete / Popover Logic ──
  const textareaRef = useRef(null)

  const getCaretCoordinates = (element, position) => {
    // Simple mirror div approach for caret positioning
    const div = document.createElement('div');
    const style = div.style;
    const computed = window.getComputedStyle(element);
    
    style.whiteSpace = 'pre-wrap';
    style.wordWrap = 'break-word';
    style.position = 'absolute';
    style.visibility = 'hidden';
    
    ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'width'].forEach(prop => {
      style[prop] = computed[prop];
    });
    
    div.textContent = element.value.substring(0, position);
    
    const span = document.createElement('span');
    span.textContent = element.value.substring(position) || '.';
    div.appendChild(span);
    
    document.body.appendChild(div);
    const coordinates = {
      top: span.offsetTop + parseInt(computed.borderTopWidth),
      left: span.offsetLeft + parseInt(computed.borderLeftWidth)
    };
    document.body.removeChild(div);
    return coordinates;
  }

  const handlePromptChange = (e) => {
    const val = e.target.value
    setPrompt(val)

    const caretPos = e.target.selectionStart
    const textBeforeCaret = val.slice(0, caretPos)
    
    // Strict trigger regex: Must be preceded by space or start of line
    const match = textBeforeCaret.match(/(?:^|\s)(@|\/)([\w\-./]*)$/)

    if (match) {
      const type = match[1]
      const query = match[2].toLowerCase()
      
      let options = []
      if (type === '/') {
        options = COMMAND_REGISTRY.filter(c => c.trigger.includes(query))
      } else if (type === '@') {
        // V1: Just map open files (and projectRoot files if we had them loaded, for now just openFiles)
        const allFiles = editorGroups.flatMap(g => g.openFiles.map(f => f.path))
        // Deduplicate and map
        const uniqueFiles = [...new Set(allFiles)].map(path => ({
          id: path,
          label: path.split(/[/\\]/).pop(),
          desc: path
        }))
        // Add hardcoded context providers
        options = [
          { id: '@selection', label: 'Selection', desc: 'Active editor selection' },
          { id: '@problems', label: 'Problems', desc: 'Current file diagnostics' },
          ...uniqueFiles
        ].filter(opt => opt.label.toLowerCase().includes(query) || opt.id.toLowerCase().includes(query))
      }

      if (options.length > 0) {
        const coords = getCaretCoordinates(e.target, caretPos)
        setPopoverState({
          isOpen: true,
          type,
          query,
          x: coords.left,
          // Shift up above the input box roughly
          y: coords.top - (options.length * 30) - 20, 
          selectedIndex: 0,
          options
        })
        return
      }
    }
    
    setPopoverState(prev => prev.isOpen ? { ...prev, isOpen: false } : prev)
  }

  const applyPopoverSelection = (option) => {
    if (!option) return
    
    const caretPos = textareaRef.current.selectionStart
    const textBeforeCaret = prompt.slice(0, caretPos)
    const textAfterCaret = prompt.slice(caretPos)
    
    // Find where the trigger started
    const match = textBeforeCaret.match(/(?:^|\s)(@|\/)([\w\-./]*)$/)
    if (match) {
      const triggerIndex = textBeforeCaret.lastIndexOf(match[0]) + (match[0].startsWith(' ') ? 1 : 0)
      
      if (popoverState.type === '@') {
        // Remove the typed @query and add to contextMentions
        const newTextBefore = textBeforeCaret.slice(0, triggerIndex)
        setPrompt(newTextBefore + textAfterCaret)
        setContextMentions(prev => {
          if (!prev.find(m => m.id === option.id)) {
            return [...prev, option]
          }
          return prev
        })
      } else if (popoverState.type === '/') {
        // Replace the /query with the full command
        const newTextBefore = textBeforeCaret.slice(0, triggerIndex) + '/' + option.trigger + ' '
        setPrompt(newTextBefore + textAfterCaret)
      }
    }
    setPopoverState(prev => ({ ...prev, isOpen: false }))
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e) => {
    if (popoverState.isOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setPopoverState(prev => ({ ...prev, selectedIndex: (prev.selectedIndex + 1) % prev.options.length }))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setPopoverState(prev => ({ ...prev, selectedIndex: (prev.selectedIndex - 1 + prev.options.length) % prev.options.length }))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        applyPopoverSelection(popoverState.options[popoverState.selectedIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setPopoverState(prev => ({ ...prev, isOpen: false }))
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }



  // ── Handle Image Attachment ──
  const fileInputRef = useRef(null)
  const handleFileChange = (e) => {
    const files = Array.from(e.target.files)
    files.forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = (event) => {
          setAttachments(prev => [...prev, event.target.result])
        }
        reader.readAsDataURL(file)
      }
    })
    e.target.value = null // reset input
  }
  const removeAttachment = (idx) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Handle Paste Events ──
  const handleAttachClick = async () => {
    try {
      if (window.api && window.api.selectFilesForChat && window.api.extractFileText && window.api.readImageBase64) {
        const result = await window.api.selectFilesForChat()
        if (!result.canceled && result.files && result.files.length > 0) {
          const newFiles = []
          const newImages = []
          for (const filePath of result.files) {
            try {
              const ext = filePath.split('.').pop().toLowerCase()
              const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']
              
              if (imageExts.includes(ext)) {
                const imgData = await window.api.readImageBase64(filePath)
                if (imgData.error) {
                  alert(`Image read error: ${imgData.error}`)
                } else {
                  newImages.push(imgData.dataURL)
                }
              } else {
                const extracted = await window.api.extractFileText(filePath)
                if (extracted.error) {
                  alert(`Extraction error: ${extracted.error}`)
                } else {
                  newFiles.push(extracted)
                }
              }
            } catch (err) {
              alert(`IPC error extracting file: ${err.message}`)
            }
          }
          if (newFiles.length > 0) {
            setFileAttachments(prev => [...prev, ...newFiles])
          }
          if (newImages.length > 0) {
            setAttachments(prev => [...prev, ...newImages])
          }
          if (newFiles.length > 0 || newImages.length > 0) {
            setTimeout(() => {
              textareaRef.current?.focus()
            }, 100)
          }
        }
      } else {
        alert("window.api methods are missing. Please RESTART the app completely (close window, then open it again).")
      }
    } catch (err) {
      alert(`Dialog error: ${err.message}`)
    }
  }

  const handlePaste = (e) => {
    const items = Array.from(e.clipboardData.items)
    let pastedImage = false

    items.forEach(item => {
      if (item.type.indexOf('image/') !== -1) {
        pastedImage = true
        const file = item.getAsFile()
        const reader = new FileReader()
        reader.onload = (event) => {
          setAttachments(prev => [...prev, event.target.result])
        }
        reader.readAsDataURL(file)
      }
    })

    // Optional: if we only pasted an image (no text), we can prevent default
    // to avoid weird behaviors, but usually pasting an image into textarea does nothing anyway.
  }

  // ── Save API Key for selected provider ──
  const handleSaveKey = async () => {
    if (!apiKeyInput.trim()) return
    setKeySaving(true)
    setKeyMessage('')

    try {
      const result = await window.api.saveApiKey(selectedProvider, apiKeyInput.trim())
      if (result.success) {
        setProviderKeys((prev) => ({
          ...prev,
          [result.provider]: { exists: true, hint: result.hint }
        }))
        setApiKeyInput('')
        setAutoDetectedProvider(null)
        setKeyMessage(`${PROVIDERS[selectedProvider]?.name || selectedProvider} key encrypted and saved securely ✓`)
      } else {
        setKeyMessage(`Error: ${result.error}`)
      }
    } catch (err) {
      setKeyMessage(`Error: ${err.message}`)
    }
    setKeySaving(false)
  }

  // ── Delete API Key ──
  const handleDeleteKey = async (provider) => {
    try {
      const result = await window.api.deleteApiKey(provider)
      if (result.success) {
        setProviderKeys((prev) => {
          const updated = { ...prev }
          delete updated[provider]
          return updated
        })
        setDeletingProvider(null)
        setKeyMessage(`${PROVIDERS[provider]?.name || provider} key deleted successfully ✓`)
      } else {
        setKeyMessage(`Error: ${result.error}`)
      }
    } catch (err) {
      setKeyMessage(`Error: ${err.message}`)
    }
  }

  // ── Get display name for model ──
  const getModelName = (id) => id === 'custom' ? (customName || 'Custom Model') : (MODEL_MAP[id]?.name || id)

  // ── Extension handler ──
  const handleOpenExtension = (extId) => {
    // We'll prefix with 'ext:' so CodeEditor knows it's an extension
    handleOpenFile('ext:' + extId, 'Extension: ' + extId)
  }

  // ── Check if a model's provider has a key ──
  const hasKeyForModel = (modelId) => {
    const model = MODEL_MAP[modelId]
    if (!model || modelId === 'auto') return null // auto doesn't need a specific key
    return providerKeys[model.provider]?.exists || false
  }

  // ── Count configured keys ──
  const keyCount = Object.values(providerKeys).filter((k) => k.exists).length

  // ── Get providers that already have keys ──
  const configuredProviders = Object.entries(providerKeys)
    .filter(([, v]) => v.exists)
    .map(([provider, data]) => ({ ...PROVIDERS[provider], ...data, id: provider }))


  useEffect(() => {
    const handleReload = async () => {
      if (window.api && window.api.getAllKeys) {
        const keys = await window.api.getAllKeys()
        setProviderKeys(keys || {})
      }
      if (window.api && window.api.getCustomConfig) {
        const config = await window.api.getCustomConfig()
        if (config) {
          if (config.customBaseUrl) setCustomBaseUrl(config.customBaseUrl)
          if (config.customModelId) setCustomModelId(config.customModelId)
          if (config.customName) setCustomName(config.customName)
        }
      }
      setAutoCompleteEnabled(localStorage.getItem('editor-inlineSuggest') !== 'false')
    }
    handleReload()
    window.addEventListener('reload-ai-config', handleReload)
    return () => window.removeEventListener('reload-ai-config', handleReload)
  }, [])



  // Reactive subscription so menu shortcuts re-render when user edits bindings.
  const customShortcuts = useShortcutStore(state => state.shortcuts)
  const formatShortcutById = (id, fallback) => {
    if (!id) return fallback
    for (const group of customShortcuts) {
      const item = group.items.find(i => i.id === id)
      if (item && item.keys && item.keys.length) {
        let joined = item.keys.join('+')
        if (joined === 'Ctrl+Shift+~') return 'Ctrl+Shift+`'
        return joined
      }
    }
    return fallback
  }

  // ── Workspace Search ──
  const [searchQuery, setSearchQuery] = useState('')
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false)
  const [searchWholeWord, setSearchWholeWord] = useState(false)
  const [searchRegex, setSearchRegex] = useState(false)
  const [searchIncludeGlob, setSearchIncludeGlob] = useState('')
  const [searchExcludeGlob, setSearchExcludeGlob] = useState('')
  const [searchResults, setSearchResults] = useState([]) // [{ path, matches: [{ line, column, preview, matchLength }] }]
  const [searchStatus, setSearchStatus] = useState('idle') // 'idle' | 'searching' | 'done' | 'error'
  const [searchError, setSearchError] = useState(null)
  const [collapsedSearchFiles, setCollapsedSearchFiles] = useState({})
  const searchRunIdRef = useRef(0)

  // Simple glob → regex (supports *, **, ?). Empty string means "no filter".
  const globToRegex = (glob) => {
    if (!glob) return null
    // Split on commas so users can enter multiple patterns.
    const parts = glob.split(',').map(p => p.trim()).filter(Boolean)
    if (!parts.length) return null
    const escaped = parts.map(p => {
      let re = ''
      for (let i = 0; i < p.length; i++) {
        const c = p[i]
        if (c === '*') {
          if (p[i + 1] === '*') { re += '.*'; i++ } else { re += '[^/\\\\]*' }
        } else if (c === '?') { re += '[^/\\\\]' }
        else if ('.+^$(){}|[]\\'.includes(c)) { re += '\\' + c }
        else { re += c }
      }
      return re
    })
    // Match anywhere in the path.
    return new RegExp('(?:' + escaped.join('|') + ')', 'i')
  }

  const runWorkspaceSearch = async (query, opts) => {
    const runId = ++searchRunIdRef.current
    setSearchStatus('searching')
    setSearchError(null)
    setSearchResults([])
    setCollapsedSearchFiles({})

    if (!query) {
      setSearchStatus('idle')
      return
    }
    if (!projectRoot) {
      setSearchError('Open a folder to search in.')
      setSearchStatus('error')
      return
    }

    let pattern
    try {
      let source = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (opts.wholeWord) source = `\\b${source}\\b`
      pattern = new RegExp(source, opts.caseSensitive ? 'g' : 'gi')
    } catch (err) {
      setSearchError(`Invalid regex: ${err.message}`)
      setSearchStatus('error')
      return
    }

    let includeRe, excludeRe
    try {
      includeRe = globToRegex(opts.includeGlob)
      excludeRe = globToRegex(opts.excludeGlob)
    } catch (err) {
      setSearchError(`Invalid glob: ${err.message}`)
      setSearchStatus('error')
      return
    }

    // Default excludes so we don't waste cycles on node_modules and binaries.
    const defaultExcludes = /(?:^|[/\\])(?:node_modules|\.git|dist|out|build)(?:[/\\]|$)/
    const binaryExt = /\.(png|jpg|jpeg|gif|bmp|ico|svg|pdf|zip|tar|gz|rar|7z|exe|dll|so|dylib|class|jar|woff2?|ttf|eot|mp3|mp4|mov|avi|webm|wasm)$/i

    try {
      const allFiles = await window.api.getProjectTree(projectRoot)
      if (runId !== searchRunIdRef.current) return

      const filtered = (allFiles || []).filter(fp => {
        if (defaultExcludes.test(fp)) return false
        if (binaryExt.test(fp)) return false
        if (includeRe && !includeRe.test(fp)) return false
        if (excludeRe && excludeRe.test(fp)) return false
        return true
      })

      // Cap total files scanned so a huge repo doesn't lock up the renderer.
      const MAX_FILES = 2000
      const MAX_MATCHES_PER_FILE = 100
      const MAX_TOTAL_MATCHES = 5000
      const files = filtered.slice(0, MAX_FILES)

      const results = []
      let totalMatches = 0

      // Process in small chunks and yield to the event loop so the UI stays responsive.
      const CHUNK = 25
      for (let i = 0; i < files.length && totalMatches < MAX_TOTAL_MATCHES; i += CHUNK) {
        if (runId !== searchRunIdRef.current) return
        const slice = files.slice(i, i + CHUNK)
        const readResults = await Promise.all(slice.map(async (fp) => {
          try {
            const res = await window.api.getFileContents(fp)
            if (!res || !res.success || typeof res.content !== 'string') return null
            // Skip files that look binary (contain NUL bytes in the first chunk).
            if (res.content.indexOf('\u0000') !== -1) return null
            return { path: fp, content: res.content }
          } catch { return null }
        }))
        if (runId !== searchRunIdRef.current) return

        for (const r of readResults) {
          if (!r) continue
          const lines = r.content.split(/\r?\n/)
          const matches = []
          for (let ln = 0; ln < lines.length && matches.length < MAX_MATCHES_PER_FILE; ln++) {
            const line = lines[ln]
            pattern.lastIndex = 0
            let m
            while ((m = pattern.exec(line)) !== null) {
              if (m[0].length === 0) { pattern.lastIndex++; continue }
              matches.push({
                line: ln + 1,
                column: m.index + 1,
                matchLength: m[0].length,
                preview: line.length > 400 ? line.slice(0, 400) + '…' : line
              })
              if (matches.length >= MAX_MATCHES_PER_FILE) break
            }
          }
          if (matches.length) {
            results.push({ path: r.path, matches })
            totalMatches += matches.length
          }
        }
        // Stream partial results so the user sees hits as they arrive.
        setSearchResults([...results])
        // Yield to the event loop.
        await new Promise(res => setTimeout(res, 0))
      }

      if (runId !== searchRunIdRef.current) return
      setSearchStatus('done')
    } catch (err) {
      if (runId !== searchRunIdRef.current) return
      setSearchError(err.message || String(err))
      setSearchStatus('error')
    }
  }

  // Debounce searches while the user types.
  useEffect(() => {
    const q = searchQuery
    const opts = {
      caseSensitive: searchCaseSensitive,
      wholeWord: searchWholeWord,
      regex: searchRegex,
      includeGlob: searchIncludeGlob,
      excludeGlob: searchExcludeGlob
    }
    const handle = setTimeout(() => runWorkspaceSearch(q, opts), 300)
    return () => clearTimeout(handle)
  }, [searchQuery, searchCaseSensitive, searchWholeWord, searchRegex, searchIncludeGlob, searchExcludeGlob, projectRoot])

  const openSearchMatch = (path, match) => {
    const name = path.split(/[/\\]/).pop() || path
    handleOpenFile(path, name)
    // Give the editor a moment to mount / load content before revealing the line.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('jump-to-line', {
        detail: { path, line: match.line, column: match.column, matchLength: match.matchLength }
      }))
    }, 60)
  }

  const totalSearchMatches = searchResults.reduce((n, r) => n + r.matches.length, 0)

  return (
    <div className="ide-root" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-deep)', color: 'var(--text-primary)' }}>
      {/* ── Global Header ── */}
      <header className="global-title-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: '40px', background: 'var(--bg-activity)', borderBottom: '1px solid var(--border-base)', flexShrink: 0, userSelect: 'none', WebkitAppRegion: 'drag' }}>

        {/* Left Section */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '24px', WebkitAppRegion: 'no-drag', paddingLeft: navigator.userAgent.toLowerCase().includes('mac') ? '72px' : '0' }}>
          <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--accent-color, #8b5cf6)', letterSpacing: '0.5px' }}>comπle</span>
          <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--text-muted)' }}>
            {[
              {
                name: 'File', items: [
                  {
                    label: 'New Text File', shortcutId: 'file.new', shortcut: 'Ctrl+N', action: () => {
                      const id = `untitled:Untitled-${Date.now()}`;
                      const name = `Untitled`;
                      setOpenFiles(prev => [...prev, { name, path: id }]);
                      setActiveFile(id);
                    }
                  },
                  { label: 'New File...', shortcut: 'Ctrl+Alt+N', action: () => window.dispatchEvent(new CustomEvent('create-new-file')) },
                  { label: 'Open File...', shortcutId: 'file.open', shortcut: 'Ctrl+O', action: () => executeGlobalActionRef.current('file.open') },
                  { label: 'Open Folder...', shortcutId: 'file.openFolder', shortcut: 'Ctrl+K Ctrl+O', action: () => executeGlobalActionRef.current('file.openFolder') },
                  { label: 'New Window', shortcutId: 'file.newWindow', shortcut: 'Ctrl+Shift+N', action: () => window.open(window.location.origin, '_blank') },
                  { type: 'separator' },
                  { label: 'Save', shortcutId: 'file.save', shortcut: 'Ctrl+S', action: () => saveActiveFile() },
                  { label: 'Save All', shortcutId: 'file.saveAll', shortcut: 'Ctrl+K S', action: () => saveActiveFile() },
                  { label: `Auto Save ${autoSave ? '✓' : ''}`, action: () => setAutoSave(!autoSave) },
                  { type: 'separator' },
                  { label: 'Close Editor', shortcutId: 'file.close', shortcut: 'Ctrl+W', action: () => activeFile ? closeFile(activeFile) : null }
                ]
              },
              {
                name: 'Edit', items: [
                  { label: 'Undo', shortcutId: 'edit.undo', shortcut: 'Ctrl+Z', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'edit.undo' })) },
                  { label: 'Redo', shortcutId: 'edit.redo', shortcut: 'Ctrl+Y', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'edit.redo' })) },
                  { type: 'separator' },
                  { label: 'Cut', shortcutId: 'edit.cut', shortcut: 'Ctrl+X', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'edit.cut' })) },
                  { label: 'Copy', shortcutId: 'edit.copy', shortcut: 'Ctrl+C', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'edit.copy' })) },
                  { label: 'Paste', shortcutId: 'edit.paste', shortcut: 'Ctrl+V', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'edit.paste' })) },
                  { type: 'separator' },
                  { label: 'Find', shortcutId: 'edit.find', shortcut: 'Ctrl+F', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'actions.find' })) },
                  { label: 'Replace', shortcutId: 'edit.replace', shortcut: 'Ctrl+H', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.startFindReplaceAction' })) },
                  { label: 'Find in Files', shortcutId: 'edit.findInFiles', shortcut: 'Ctrl+Shift+F', action: () => setActivePanel('search') },
                  { type: 'separator' },
                  { label: 'Toggle Line Comment', shortcutId: 'edit.commentLine', shortcut: 'Ctrl+/', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.commentLine' })) },
                  { label: 'Toggle Block Comment', shortcut: 'Shift+Alt+A', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.blockComment' })) }
                ]
              },
              {
                name: 'Selection', items: [
                  { label: 'Select All', shortcutId: 'edit.selectAll', shortcut: 'Ctrl+A', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.selectAll' })) },
                  { label: 'Expand Selection', shortcut: 'Shift+Alt+RightArrow', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.smartSelect.expand' })) },
                  { label: 'Shrink Selection', shortcut: 'Shift+Alt+LeftArrow', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.smartSelect.shrink' })) },
                  { type: 'separator' },
                  { label: 'Copy Line Up', shortcut: 'Shift+Alt+UpArrow', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.copyLinesUpAction' })) },
                  { label: 'Copy Line Down', shortcut: 'Shift+Alt+DownArrow', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.copyLinesDownAction' })) },
                  { label: 'Move Line Up', shortcutId: 'edit.moveLineUp', shortcut: 'Alt+UpArrow', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.moveLinesUpAction' })) },
                  { label: 'Move Line Down', shortcutId: 'edit.moveLineDown', shortcut: 'Alt+DownArrow', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.moveLinesDownAction' })) },
                  { type: 'separator' },
                  { label: 'Add Next Occurrence', shortcutId: 'editor.action.addSelectionToNextFindMatch', shortcut: 'Ctrl+D', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.addSelectionToNextFindMatch' })) },
                  { label: 'Select All Occurrences', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.selectHighlights' })) }
                ]
              },
              {
                name: 'View', items: [
                  { label: 'Command Palette...', shortcutId: 'general.commandPalette', shortcut: 'Ctrl+Shift+P', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.quickCommand' })) },
                  { type: 'separator' },
                  { label: 'Explorer', shortcutId: 'nav.focusExplorer', shortcut: 'Ctrl+Shift+E', action: () => setActivePanel(activePanel === 'explorer' ? null : 'explorer') },
                  { label: 'Search', shortcut: 'Ctrl+Shift+F', action: () => setActivePanel(activePanel === 'search' ? null : 'search') },
                  { label: 'AI Chat', shortcut: 'Ctrl+L', action: () => setIsChatOpen(prev => !prev) },
                  { label: 'Terminal', shortcutId: 'nav.focusTerminal', shortcut: 'Ctrl+`', action: () => setShowTerminal(prev => !prev) },
                  { type: 'separator' },
                  { label: 'Word Wrap', shortcut: 'Alt+Z', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.toggleWordWrap' })) },
                  { label: 'Zoom In', shortcutId: 'view.zoomIn', shortcut: 'Ctrl+=', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.fontZoomIn' })) },
                  { label: 'Zoom Out', shortcutId: 'view.zoomOut', shortcut: 'Ctrl+-', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.fontZoomOut' })) },
                  { label: 'Reset Zoom', shortcutId: 'view.zoomReset', shortcut: 'Ctrl+0', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.fontZoomReset' })) },
                  { type: 'separator' },
                  { label: 'Full Screen', shortcutId: 'general.fullscreen', shortcut: 'F11', action: () => { if (!document.fullscreenElement) { document.documentElement.requestFullscreen().catch(() => { }); } else { document.exitFullscreen(); } } }
                ]
              },
              {
                name: 'Go', items: [
                  { label: 'Go to File...', shortcutId: 'nav.goToFile', shortcut: 'Ctrl+P', action: () => setActivePanel('search') },
                  { label: 'Go to Line/Column...', shortcutId: 'nav.goToLine', shortcut: 'Ctrl+G', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.gotoLine' })) },
                  { type: 'separator' },
                  { label: 'Go to Definition', shortcutId: 'nav.goToDef', shortcut: 'F12', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.revealDefinition' })) },
                  { label: 'Go to Type Definition', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.goToTypeDefinition' })) },
                  { label: 'Go to References', shortcutId: 'nav.goToRef', shortcut: 'Shift+F12', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.referenceSearch.trigger' })) },
                  { label: 'Go to Bracket', shortcut: 'Ctrl+Shift+\\', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.jumpToBracket' })) }
                ]
              },
              {
                name: 'Run', items: [
                  { label: 'Run Active File', shortcut: 'Ctrl+F5', action: () => runFileRef.current && runFileRef.current() }
                ]
              },
              {
                name: 'Terminal', items: [
                  { label: 'New Terminal', shortcutId: 'general.terminal', shortcut: 'Ctrl+Shift+`', action: () => { setShowTerminal(true); handleAddTerminal(); } },
                  { label: 'Toggle Terminal', shortcut: 'Ctrl+`', action: () => setShowTerminal(prev => !prev) },
                  { label: 'Clear Terminal', action: () => {
                    const term = terminalPanelRefs.current[activeTerminalId];
                    if (term) term.executeCommand('clear\r');
                  } },
                  { type: 'separator' },
                  {
                    label: 'Sync Dependencies (npm install)', action: () => {
                      setShowTerminal(true);
                      const term = terminalPanelRefs.current[activeTerminalId];
                      if (term) term.executeCommand('npm install\r');
                    }
                  },
                  {
                    label: 'Start Dev Server (npm run dev)', action: () => {
                      setShowTerminal(true);
                      const term = terminalPanelRefs.current[activeTerminalId];
                      if (term) term.executeCommand('npm run dev\r');
                    }
                  }
                ]
              },
              {
                name: 'Help', items: [
                  { label: 'Settings', shortcut: 'Ctrl+,', action: () => handleOpenFile('settings:main', 'Settings') },
                  { label: 'Keyboard Shortcuts', shortcut: 'Ctrl+K Ctrl+S', action: () => handleOpenFile('settings:shortcuts', 'Keyboard Shortcuts') },
                  { type: 'separator' },
                  { label: 'About comπle', action: () => window.open('https://github.com/iamkartik0704/compile-web', '_blank') }
                ]
              }
            ].map((menu) => (
              <div key={menu.name} style={{ position: 'relative' }}>
                <span
                  style={{ cursor: 'pointer', WebkitAppRegion: 'no-drag', color: activeMenu === menu.name ? 'var(--text-primary)' : 'inherit' }}
                  className="menu-item"
                  onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === menu.name ? null : menu.name) }}
                >
                  {menu.name}
                </span>
                {activeMenu === menu.name && (
                  <div style={{
                    position: 'absolute', top: '24px', left: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border-base)',
                    borderRadius: '6px', padding: '6px 0', minWidth: '300px', zIndex: 9999, boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                    display: 'flex', flexDirection: 'column', whiteSpace: 'nowrap'
                  }} onClick={(e) => e.stopPropagation()}>
                    {menu.items.map((item, idx) => (
                      item.type === 'separator' ? (
                        <div key={idx} onMouseEnter={() => setActiveSubmenu(null)} style={{ height: '1px', background: 'var(--border-base)', margin: '4px 0' }} />
                      ) : (
                        <div key={idx} className="submenu-item"
                          style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px' }}
                          onMouseEnter={() => { if (item.hasSubmenu) setActiveSubmenu(idx); else setActiveSubmenu(null); }}
                          onClick={() => { if (!item.hasSubmenu) { setActiveMenu(null); setActiveSubmenu(null); if (item.action) item.action() } }}
                        >
                          <span>{item.label}</span>
                          {(item.shortcutId || item.shortcut) && <span style={{ opacity: 0.5, fontSize: '11px', letterSpacing: '0.2px', marginLeft: 'auto' }}>{formatShortcutById(item.shortcutId, item.shortcut)}</span>}
                          {item.hasSubmenu && <ChevronRight size={14} style={{ opacity: 0.6, marginLeft: 'auto' }} />}

                          {item.hasSubmenu && activeSubmenu === idx && (
                            <div style={{
                              position: 'absolute', top: '-6px', left: '100%', marginLeft: '4px', background: 'var(--bg-elevated)',
                              border: '1px solid var(--border-base)', borderRadius: '6px', padding: '6px 0', minWidth: '200px',
                              zIndex: 10000, boxShadow: '0 8px 24px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column'
                            }} onClick={(e) => e.stopPropagation()}>
                              {item.submenu.map((sub, subIdx) => (
                                sub.type === 'separator' ? (
                                  <div key={subIdx} style={{ height: '1px', background: 'var(--border-base)', margin: '4px 0' }} />
                                ) : (
                                  <div key={subIdx} className="submenu-item"
                                    onClick={() => { setActiveSubmenu(null); setActiveMenu(null); if (sub.action) sub.action() }}
                                  >
                                    <span>{sub.label}</span>
                                    {(sub.shortcutId || sub.shortcut) && <span style={{ opacity: 0.6, fontSize: '11px', letterSpacing: '0.2px' }}>{formatShortcutById(sub.shortcutId, sub.shortcut)}</span>}
                                  </div>
                                )
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Center Section */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', WebkitAppRegion: 'no-drag' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {activeFile ? activeFile.split(/[/\\]/).pop() : (projectRoot ? projectRoot.split(/[/\\]/).pop() : 'comπle')}
          </span>
        </div>

        {/* Right Section */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px', WebkitAppRegion: 'no-drag' }}>
          <div style={{ display: 'flex', gap: '4px', color: 'var(--text-muted)', marginRight: '8px' }}>
            <div onClick={() => setActivePanel(activePanel === 'explorer' ? null : 'explorer')} style={{ padding: '4px', borderRadius: '4px', cursor: 'pointer', display: 'flex', background: activePanel === 'explorer' ? 'var(--bg-dark)' : 'transparent' }} title="Toggle Sidebar"><PanelLeft size={14} /></div>
            <div onClick={() => setShowTerminal(!showTerminal)} style={{ padding: '4px', borderRadius: '4px', cursor: 'pointer', display: 'flex', background: showTerminal ? 'var(--bg-dark)' : 'transparent' }} title="Toggle Terminal"><PanelBottom size={14} /></div>
            <div onClick={() => setIsChatOpen(!isChatOpen)} style={{ padding: '4px', borderRadius: '4px', cursor: 'pointer', display: 'flex', background: isChatOpen ? 'var(--bg-dark)' : 'transparent' }} title="Toggle AI Chat"><Sparkles size={14} /></div>
          </div>
          <div className="model-selector-wrapper" style={{ marginRight: '8px' }}>
            <select
              id="model-selector"
              className="model-selector"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isStreaming}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '11px', outline: 'none', cursor: 'pointer', maxWidth: '120px', textOverflow: 'ellipsis' }}
              title="Select Model"
            >
              {MODEL_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.models.map((m) => (
                    <option
                      key={m.id}
                      value={m.id}
                      disabled={m.provider && !providerKeys[m.provider]?.exists}
                    >
                      {m.id === 'custom' ? (customName || 'Custom') : m.name}
                      {m.badge ? ` (${m.badge})` : ''}
                      {m.provider && !providerKeys[m.provider]?.exists ? ' (Missing Key)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '16px', color: 'var(--text-muted)', alignItems: 'center' }}>
            <Settings size={16} style={{ cursor: 'pointer' }} onClick={() => { window.dispatchEvent(new CustomEvent('open-settings', { detail: 'ai-agent' })); handleOpenFile('settings:main', 'Settings'); }} title="Settings" />
          </div>

          <button
            onClick={() => setIsChatOpen(!isChatOpen)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: isChatOpen ? 'var(--bg-elevated, #222)' : 'transparent',
              color: isChatOpen ? 'var(--text-primary, #e0e0e0)' : 'var(--text-muted, #858585)',
              border: `1px solid ${isChatOpen ? 'var(--accent-color, #ebd79e)' : 'var(--border-base, #2a2a2a)'}`,
              padding: '4px 10px', borderRadius: '6px', fontSize: '11px',
              fontWeight: '500', cursor: 'pointer', WebkitAppRegion: 'no-drag',
              transition: 'all 0.15s ease'
            }}
            title="Toggle AI Chat (Ctrl+L)"
          >
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: isChatOpen ? 'var(--accent-color, #ebd79e)' : 'var(--text-muted, #858585)' }} />
            AI Chat
          </button>

          {navigator.userAgent.toLowerCase().includes('mac') ? null : (
            <div style={{ display: 'flex', gap: '12px', color: 'var(--text-muted)', alignItems: 'center', marginLeft: '12px', WebkitAppRegion: 'no-drag' }}>
              <div style={{ padding: '4px 8px', cursor: 'pointer', display: 'flex', borderRadius: '4px', transition: 'all 0.1s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(128, 128, 128, 0.2)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'} onClick={() => window.api?.minimizeWindow?.()} title="Minimize"><Minus size={16} /></div>
              <div style={{ padding: '4px 8px', cursor: 'pointer', display: 'flex', borderRadius: '4px', transition: 'all 0.1s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(128, 128, 128, 0.2)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'} onClick={() => window.api?.maximizeWindow?.()} title="Maximize"><Square size={14} /></div>
              <div style={{ padding: '4px 8px', cursor: 'pointer', display: 'flex', borderRadius: '4px', transition: 'all 0.1s', color: 'inherit' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#e81123'; e.currentTarget.style.color = '#fff' }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'inherit' }} onClick={() => window.api?.closeWindow?.()} title="Close"><X size={16} /></div>
            </div>
          )}
        </div>
      </header>

      <div className="ide-layout" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Activity Bar (VS Code style) ── */}
        <ActivityBar
          onOpenFile={handleOpenFile}
        />

        {/* ── Left Sidebar (File Explorer / Search) ── */}
        <div style={{ display: 'flex', height: '100%', borderRight: '1px solid var(--border-base)' }}>
          {activePanel === 'explorer' && (
            <Sidebar
              projectRoot={projectRoot}
              setProjectRoot={setProjectRoot}
              onOpenFile={handleOpenFile}
              width={sidebarWidth}
              setShowVisualizer={setShowVisualizer}
            />
          )}

          {activePanel === 'search' && (
            <aside className="sidebar search-panel" style={{ width: sidebarWidth, display: 'flex', flexDirection: 'column' }}>
              <div className="sidebar-header">
                <h2>SEARCH</h2>
              </div>
              <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px', borderBottom: '1px solid var(--border-base)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div className="search-input-wrapper" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-dark)', border: '1px solid var(--border-base)', borderRadius: '4px', padding: '4px 6px' }}>
                    <Search size={14} className="search-icon" style={{ opacity: 0.6 }} />
                    <input
                      type="text"
                      autoFocus
                      placeholder="Search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '13px' }}
                    />
                    {searchQuery && (
                      <X size={14} style={{ cursor: 'pointer', opacity: 0.6 }} onClick={() => setSearchQuery('')} title="Clear" />
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => setSearchCaseSensitive(v => !v)}
                    title="Match Case"
                    style={{ background: searchCaseSensitive ? 'var(--accent-active, #094771)' : 'transparent', border: '1px solid var(--border-base)', borderRadius: '3px', color: 'var(--text-primary)', padding: '2px 6px', cursor: 'pointer', fontSize: '11px', fontFamily: 'monospace' }}
                  >Aa</button>
                  <button
                    onClick={() => setSearchWholeWord(v => !v)}
                    title="Match Whole Word"
                    style={{ background: searchWholeWord ? 'var(--accent-active, #094771)' : 'transparent', border: '1px solid var(--border-base)', borderRadius: '3px', color: 'var(--text-primary)', padding: '2px 6px', cursor: 'pointer', fontSize: '11px', fontFamily: 'monospace' }}
                  >\b</button>
                  <button
                    onClick={() => setSearchRegex(v => !v)}
                    title="Use Regular Expression"
                    style={{ background: searchRegex ? 'var(--accent-active, #094771)' : 'transparent', border: '1px solid var(--border-base)', borderRadius: '3px', color: 'var(--text-primary)', padding: '2px 6px', cursor: 'pointer', fontSize: '11px', fontFamily: 'monospace' }}
                  >.*</button>
                </div>
                <input
                  type="text"
                  placeholder="files to include (e.g. *.js, src/**)"
                  value={searchIncludeGlob}
                  onChange={(e) => setSearchIncludeGlob(e.target.value)}
                  style={{ background: 'var(--bg-dark)', border: '1px solid var(--border-base)', borderRadius: '4px', padding: '4px 6px', color: 'var(--text-primary)', fontSize: '12px', outline: 'none' }}
                />
                <input
                  type="text"
                  placeholder="files to exclude"
                  value={searchExcludeGlob}
                  onChange={(e) => setSearchExcludeGlob(e.target.value)}
                  style={{ background: 'var(--bg-dark)', border: '1px solid var(--border-base)', borderRadius: '4px', padding: '4px 6px', color: 'var(--text-primary)', fontSize: '12px', outline: 'none' }}
                />
              </div>

              <div style={{ padding: '6px 12px', fontSize: '11px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-base)', minHeight: '22px' }}>
                {!projectRoot && 'Open a folder to search.'}
                {projectRoot && searchStatus === 'idle' && !searchQuery && 'Type to search across the workspace.'}
                {projectRoot && searchStatus === 'searching' && `Searching… ${totalSearchMatches} matches so far`}
                {projectRoot && searchStatus === 'done' && (
                  totalSearchMatches === 0
                    ? 'No results.'
                    : `${totalSearchMatches} result${totalSearchMatches === 1 ? '' : 's'} in ${searchResults.length} file${searchResults.length === 1 ? '' : 's'}`
                )}
                {searchStatus === 'error' && (
                  <span style={{ color: 'var(--error, #f48771)' }}>{searchError}</span>
                )}
              </div>

              <div className="sidebar-content" style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
                {searchResults.map(fileResult => {
                  const collapsed = !!collapsedSearchFiles[fileResult.path]
                  const parts = fileResult.path.split(/[/\\]/)
                  const name = parts[parts.length - 1] || fileResult.path
                  let dir = ''
                  if (projectRoot && fileResult.path.startsWith(projectRoot)) {
                    const rel = fileResult.path.substring(projectRoot.length).replace(/^[/\\]/, '')
                    const relParts = rel.split(/[/\\]/)
                    relParts.pop()
                    dir = relParts.join('/')
                  }
                  return (
                    <div key={fileResult.path}>
                      <div
                        onClick={() => setCollapsedSearchFiles(prev => ({ ...prev, [fileResult.path]: !collapsed }))}
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 12px', cursor: 'pointer', userSelect: 'none' }}
                        title={fileResult.path}
                      >
                        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        <File size={12} style={{ opacity: 0.7 }} />
                        <span style={{ fontSize: '13px' }}>{name}</span>
                        {dir && <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dir}</span>}
                        <span style={{ marginLeft: 'auto', fontSize: '11px', background: 'var(--bg-dark)', borderRadius: '10px', padding: '0 6px', color: 'var(--text-muted)' }}>{fileResult.matches.length}</span>
                      </div>
                      {!collapsed && fileResult.matches.map((m, idx) => {
                        const before = m.preview.substring(0, m.column - 1)
                        const hit = m.preview.substring(m.column - 1, m.column - 1 + m.matchLength)
                        const after = m.preview.substring(m.column - 1 + m.matchLength)
                        return (
                          <div
                            key={idx}
                            onClick={() => openSearchMatch(fileResult.path, m)}
                            className="search-match-row"
                            style={{ padding: '2px 12px 2px 32px', cursor: 'pointer', fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-muted)' }}
                            title={`Line ${m.line}, col ${m.column}`}
                          >
                            <span style={{ opacity: 0.5, marginRight: '6px' }}>{m.line}:</span>
                            <span>{before}</span>
                            <span style={{ background: 'var(--accent-search, #613214)', color: 'var(--text-primary)', borderRadius: '2px' }}>{hit}</span>
                            <span>{after}</span>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </aside>
          )}



          {activePanel && (
            <Resizer
              orientation="vertical"
              onResize={(x) => setSidebarWidth(Math.max(150, Math.min(x - 48, 600)))}
            />
          )}
        </div>

        {/* ── Main Area ── */}
        <div className="main-area">

          {/* ── Content Split Area ── */}
          <div className="content-split">
            <div className="editor-pane" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
                {editorGroups.map((group, index) => {
                  const scopedSetOpenFiles = (updater) => {
                    setEditorGroups(prev => {
                      const idx = prev.findIndex(g => g.id === group.id)
                      if (idx === -1) return prev
                      const newGroups = [...prev]
                      const next = typeof updater === 'function' ? updater(prev[idx].openFiles) : updater
                      newGroups[idx] = { ...prev[idx], openFiles: next }
                      return newGroups
                    })
                  }
                  const scopedSetActiveFile = (updater) => {
                    setEditorGroups(prev => {
                      const idx = prev.findIndex(g => g.id === group.id)
                      if (idx === -1) return prev
                      const newGroups = [...prev]
                      const next = typeof updater === 'function' ? updater(prev[idx].activeFile) : updater
                      newGroups[idx] = { ...prev[idx], activeFile: next }
                      return newGroups
                    })
                  }
                  const scopedCloseFile = (path) => {
                    setEditorGroups(prev => {
                      const idx = prev.findIndex(g => g.id === group.id)
                      if (idx === -1) return prev
                      const newGroups = [...prev]

                      const fileToClose = newGroups[idx].openFiles.find(f => f.path === path)
                      const newFiles = newGroups[idx].openFiles.filter(f => f.path !== path)
                      let newActive = newGroups[idx].activeFile
                      if (newActive === path) {
                        newActive = newFiles.length > 0 ? newFiles[newFiles.length - 1].path : null
                      }

                      const newClosedFiles = [...(newGroups[idx].closedFiles || []), fileToClose].filter(Boolean)

                      newGroups[idx] = {
                        ...newGroups[idx],
                        openFiles: newFiles,
                        activeFile: newActive,
                        closedFiles: newClosedFiles
                      }
                      return newGroups
                    })
                  }
                  const scopedMarkFileDirty = (path) => {
                    setEditorGroups(prev => {
                      const idx = prev.findIndex(g => g.id === group.id)
                      if (idx === -1) return prev
                      const newGroups = [...prev]
                      newGroups[idx].openFiles = newGroups[idx].openFiles.map(f => f.path === path ? { ...f, isDirty: true } : f)
                      return newGroups
                    })
                  }
                  const scopedMarkFileClean = (path) => {
                    setEditorGroups(prev => {
                      const idx = prev.findIndex(g => g.id === group.id)
                      if (idx === -1) return prev
                      const newGroups = [...prev]
                      newGroups[idx].openFiles = newGroups[idx].openFiles.map(f => f.path === path ? { ...f, isDirty: false } : f)
                      return newGroups
                    })
                  }

                  const handleSplitRight = () => {
                    const newId = 'group-' + Date.now()
                    setEditorGroups(prev => [
                      ...prev,
                      { id: newId, openFiles: [...group.openFiles], activeFile: group.activeFile }
                    ])
                    setActiveEditorGroupId(newId)
                  }

                  const handleCloseGroup = () => {
                    setEditorGroups(prev => {
                      const filtered = prev.filter(g => g.id !== group.id)
                      if (filtered.length === 0) return prev // keep at least one
                      if (activeEditorGroupId === group.id) {
                        setActiveEditorGroupId(filtered[0].id)
                      }
                      return filtered
                    })
                  }

                  return (
                    <React.Fragment key={group.id}>
                      {index > 0 && <div style={{ width: '1px', background: 'var(--border-base)', zIndex: 10 }} />}
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          position: 'relative',
                          display: 'flex',
                          flexDirection: 'column',
                          border: activeEditorGroupId === group.id && editorGroups.length > 1 ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent'
                        }}
                        onMouseDownCapture={() => setActiveEditorGroupId(group.id)}
                      >
                        <ErrorBoundary>
                          <CodeEditor
                            groupId={group.id}
                            openFiles={group.openFiles}
                            setOpenFiles={scopedSetOpenFiles}
                            activeFile={group.activeFile}
                            setActiveFile={scopedSetActiveFile}
                            closeFile={scopedCloseFile}
                            markFileDirty={scopedMarkFileDirty}
                            markFileClean={scopedMarkFileClean}
                            projectRoot={projectRoot}
                            aiConfig={{
                              model: selectedModel,
                              customConfig: { baseURL: customBaseUrl, modelId: customModelId },
                              autoCompleteEnabled,
                              autoCompleteDelay
                            }}
                            onRun={handleRunFile}
                            onSplitRight={handleSplitRight}
                            onCloseGroup={editorGroups.length > 1 ? handleCloseGroup : undefined}
                          />
                        </ErrorBoundary>
                      </div>
                    </React.Fragment>
                  )
                })}
              </div>
              {showTerminal && (
                <div className="bottom-panel" style={{ height: terminalHeight, display: 'flex', flexDirection: 'column', background: 'var(--bg-deep)', borderTop: '1px solid var(--border-base)', position: 'relative', boxShadow: '0 -4px 15px rgba(0,0,0,0.1)' }}>
                  <div style={{ position: 'absolute', top: -3, left: 0, right: 0, zIndex: 10, display: 'flex', justifyContent: 'center' }}>
                    <div style={{ position: 'absolute', width: '100%', height: '100%' }}>
                      <Resizer
                        orientation="horizontal"
                        onResize={(_, y) => setTerminalHeight(Math.max(100, Math.min(window.innerHeight - y - 24, window.innerHeight - 150)))}
                      />
                    </div>
                    <div style={{ width: '40px', height: '4px', background: 'rgba(255,255,255,0.2)', borderRadius: '2px', marginTop: '-2px', pointerEvents: 'none', zIndex: 11 }} />
                  </div>

                  <div className="bottom-tabs" style={{ display: 'flex', padding: '0 16px', background: 'var(--bg-activity)', borderBottom: '1px solid var(--border-base)', alignItems: 'center', height: '35px', gap: '8px', overflowX: 'auto' }}>
                    <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '6px' }}>
                      {terminals.map(term => (
                        <div
                          key={term.id}
                          onClick={() => setActiveTerminalId(term.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            background: activeTerminalId === term.id ? 'var(--bg-surface)' : 'transparent',
                            color: activeTerminalId === term.id ? 'var(--text-primary)' : 'var(--text-muted)',
                            padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: '500'
                          }}
                        >
                          {term.name}
                          {terminals.length > 1 && (
                            <X size={12} onClick={(e) => handleKillTerminal(term.id, e)} style={{ opacity: 0.6, cursor: 'pointer' }} />
                          )}
                        </div>
                      ))}
                      <button
                        onClick={handleAddTerminal}
                        style={{ background: 'transparent', color: 'var(--text-muted)', border: 'none', padding: '4px 8px', cursor: 'pointer', fontSize: '14px' }}
                      >
                        +
                      </button>
                    </div>
                    <div style={{ flex: 1 }}></div>
                    <button
                      onClick={() => setShowTerminal(false)}
                      title="Close Terminal"
                      style={{ background: 'transparent', color: 'var(--text-muted)', border: 'none', padding: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', borderRadius: '4px' }}
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                    {terminals.map(term => {
                      const isVisible = activeTerminalId === term.id
                      return (
                        <div key={term.id} style={{ position: 'absolute', inset: 0, opacity: isVisible ? 1 : 0, pointerEvents: isVisible ? 'auto' : 'none', zIndex: isVisible ? 1 : 0 }}>
                          <TerminalPanel ref={el => terminalPanelRefs.current[term.id] = el} height={terminalHeight - 36} cwd={projectRoot} hideHeader={true} />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

          </div>



          {/* ── Status Bar ── */}
          <footer className="status-bar">
            <div className="status-left">
              {toolchainDownload && (
                <div className="status-item" style={{ color: toolchainDownload.error ? 'var(--accent-rose, #ef4444)' : 'var(--accent-color)', fontWeight: 'bold' }}>
                  {toolchainDownload.error ? (
                    <span>Download Failed: {toolchainDownload.error}</span>
                  ) : toolchainDownload.stage === 'complete' ? (
                    <span>C++ Toolchain Ready</span>
                  ) : (
                    <span>
                      Downloading C++ Toolchain: {toolchainDownload.progress}% ({toolchainDownload.stage})
                      <span
                        style={{ marginLeft: '12px', cursor: 'pointer', textDecoration: 'underline', fontWeight: 'normal', opacity: 0.8 }}
                        onClick={() => {
                           window.api.cancelToolchainDownload();
                           setToolchainDownload({ error: 'Canceled' });
                           setTimeout(() => setToolchainDownload(null), 3000);
                        }}
                      >
                        Cancel
                      </span>
                    </span>
                  )}
                </div>
              )}
              {currentChordDisplay && (
                <div className="status-item" style={{ color: 'var(--accent-color)', fontWeight: 'bold' }}>
                  {currentChordDisplay}
                </div>
              )}
              <span className="status-item">
                <span className={`status-dot-sm ${isStreaming ? 'streaming' : 'ready'}`}></span>
                {isStreaming ? 'Streaming' : 'Ready'}
              </span>
              <span className="status-item status-model">
                {getModelName(selectedModel)}
                {selectedModel === 'auto' && resolvedModel && (
                  <span className="status-resolved"> → {getModelName(resolvedModel)}</span>
                )}
              </span>
            </div>
            <div className="status-right">
              <span
                className="status-item clickable"
                onClick={() => {
                  const newState = !autoCompleteEnabled;
                  localStorage.setItem('editor-inlineSuggest', newState.toString());
                  window.dispatchEvent(new CustomEvent('settings-changed', { detail: { key: 'editor-inlineSuggest', value: newState } }));
                  window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: `AI Autocomplete is now ${newState ? 'ON' : 'OFF'}`, type: 'info' } }));
                }}
                title="Toggle AI Autocomplete"
              >
                <Sparkles size={12} /> πlot Autocomplete: {autoCompleteEnabled ? <span style={{ color: 'var(--accent-color)' }}>On</span> : <span>Off</span>}
              </span>
              <span
                className="status-item clickable"
                onClick={() => setShowTerminal(!showTerminal)}
                title="Toggle Terminal (Ctrl+Shift+`)"
              >
                <Terminal size={12} /> Terminal
              </span>
              {isLiveServerEnabled && (
                <span style={{ display: 'flex', alignItems: 'center' }}>
                  <span
                    className="status-item clickable"
                    style={{ color: isLiveServerRunning ? '#10a37f' : 'inherit' }}
                    onClick={handleToggleLiveServer}
                    title={isLiveServerRunning ? `Server running at ${liveServerUrl}. Click to open active file in browser.` : "Start Live Server and open active file"}
                  >
                    {isLiveServerRunning ? <><CheckCircle size={12} /> Port 3000</> : <><RefreshCw size={12} /> Go Live</>}
                  </span>
                  {isLiveServerRunning && (
                    <span
                      className="status-item clickable"
                      style={{ color: 'var(--error-color)', padding: '0 4px', margin: '0' }}
                      onClick={handleStopLiveServer}
                      title="Stop Live Server"
                    >
                      <X size={14} />
                    </span>
                  )}
                </span>
              )}
              <span className="status-item" style={{ cursor: 'pointer' }} onClick={() => setShowSettings(true)} title="AI Settings">
                {providerKeys.google?.exists ? (
                  <span className="status-key-ok" style={{ color: 'var(--accent-color, #ebd79e)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Key size={12} /> Gemini: Active
                  </span>
                ) : (
                  <span className="status-key-none"><Key size={12} /> No Keys</span>
                )}
              </span>
            </div>
          </footer>
        </div>

        {/* ── Native AI Chat Window (Right Side of Screen) ── */}
        {isChatOpen && (
          <div style={{ display: 'flex', height: '100%', position: 'relative', zIndex: 10 }}>
            <Resizer
              orientation="vertical"
              onResize={(x) => setChatWidth(Math.max(260, Math.min(window.innerWidth - x, 800)))}
            />
            <AiChatSidebar
              width={chatWidth}
              activeFile={activeFile}
              onClose={() => setIsChatOpen(false)}
            />
          </div>
        )}

        {showVisualizer && (
          <CodebaseVisualizer
            projectRoot={projectRoot}
            onClose={() => setShowVisualizer(false)}
            onFileSelect={(path, name) => {
              setShowVisualizer(false)
              handleOpenFile(path, name)
            }}
          />
        )}

        {showGitTimeline && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 9999, background: 'var(--bg-deep)' }}>
            <GitTimeline 
              projectRoot={projectRoot} 
              onClose={() => setShowGitTimeline(false)} 
            />
          </div>
        )}

        {dsaExplainer && (
          <DSAExplainer
            initialCode={dsaExplainer.code}
            initialLanguage={dsaExplainer.language}
            aiConfig={{
              model: selectedModel,
              customConfig: selectedModel === 'custom'
                ? { baseURL: customBaseUrl.trim(), modelId: customModelId.trim() }
                : undefined
            }}
            onClose={() => setDsaExplainer(null)}
          />
        )}

        {toast && (
          <div style={{
            position: 'fixed',
            bottom: '40px',
            right: '20px',
            padding: '12px 24px',
            backgroundColor: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            borderLeft: `4px solid ${toast.type === 'error' ? 'var(--accent-rose, #ef4444)' : toast.type === 'warning' ? '#eab308' : 'var(--accent-color)'}`,
            borderRadius: 'var(--radius-sm)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 9999,
            animation: 'slideIn 0.3s ease-out forwards'
          }}>
            {toast.message}
          </div>
        )}

        {missingToolchain && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10000,
            display: 'flex', justifyContent: 'center', alignItems: 'center'
          }}>
            <div style={{
              backgroundColor: 'var(--bg-elevated)', padding: '24px', borderRadius: '8px',
              maxWidth: '500px', border: '1px solid var(--border-subtle)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
            }}>
              <h2 style={{ margin: '0 0 16px 0', color: 'var(--accent-rose, #ef4444)' }}>
                {missingToolchain.reason === 'outdated_compiler' ? 'Outdated Compiler Detected' : 'Toolchain Missing'}
              </h2>
              <p style={{ margin: '0 0 16px 0', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                {missingToolchain.error}
              </p>
              <div style={{ backgroundColor: 'var(--bg-inset)', padding: '12px', borderRadius: '4px', marginBottom: '16px', fontFamily: 'monospace' }}>
                {missingToolchain.remediationCommand}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  onClick={() => setMissingToolchain(null)}
                  style={{ padding: '8px 16px', backgroundColor: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '4px', cursor: 'pointer' }}
                >
                  Dismiss
                </button>
                <button
                  onClick={async () => {
                    const res = await window.api.recheckToolchainStatus('cpp')
                    if (res.success) {
                      setMissingToolchain(null)
                      window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: 'Toolchain verified successfully! C++ features are now active.', type: 'success' } }))
                    } else {
                      window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: 'Toolchain still not found. Please run the command.', type: 'error' } }))
                    }
                  }}
                  style={{ padding: '8px 16px', backgroundColor: 'var(--accent-color)', border: 'none', color: 'var(--accent-text)', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  Retry / Re-check Toolchain
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Share Modal */}
      {shareModal.isOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, animation: 'fadeIn 0.2s ease-out' }}>
          <div style={{ backgroundColor: 'var(--bg-surface, #1e1e1e)', border: '1px solid var(--border-base, #333)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '400px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ margin: '0 0 16px 0', color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: '600' }}>
              {shareModal.mode === 'confirm-share' ? 'Live Share Chat' : shareModal.mode === 'confirm-revoke' ? 'Revoke Public Link' : 'Chat Shared!'}
            </h2>
            
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: '1.5', marginBottom: '24px' }}>
              {shareModal.mode === 'confirm-share' && "This chat will be publicly visible to anyone with the link. Continue?"}
              {shareModal.mode === 'confirm-revoke' && "This chat is currently shared. Do you want to revoke the public link?"}
              {shareModal.mode === 'shared-success' && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', background: 'var(--bg-input)', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-base)' }}>
                  <input type="text" readOnly value={`https://ideweb-eta.vercel.app/share/${shareModal.data.id}`} style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-main)', outline: 'none', fontSize: '0.9rem' }} />
                  <CopyButton textToCopy={`https://ideweb-eta.vercel.app/share/${shareModal.data.id}`} />
                </div>
              )}
              {shareModal.error && <div style={{ color: 'var(--accent-red, #f87171)', marginTop: '12px', fontSize: '0.85rem' }}>{shareModal.error}</div>}
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              {shareModal.mode !== 'shared-success' && (
                <button onClick={closeShareModal} style={{ padding: '8px 16px', borderRadius: '6px', fontSize: '0.9rem', fontWeight: '500', cursor: 'pointer', border: '1px solid var(--border-base)', backgroundColor: 'transparent', color: 'var(--text-secondary)' }}>
                  Cancel
                </button>
              )}
              {shareModal.mode === 'confirm-share' && (
                <button onClick={handleConfirmShare} disabled={shareLoading} style={{ padding: '8px 16px', borderRadius: '6px', fontSize: '0.9rem', fontWeight: '500', cursor: shareLoading ? 'wait' : 'pointer', border: 'none', backgroundColor: 'var(--accent-color, #007acc)', color: 'var(--accent-text, #fff)', opacity: shareLoading ? 0.7 : 1 }}>
                  {shareLoading ? 'Sharing...' : 'Share Chat'}
                </button>
              )}
              {shareModal.mode === 'confirm-revoke' && (
                <button onClick={handleConfirmRevoke} disabled={shareLoading} style={{ padding: '8px 16px', borderRadius: '6px', fontSize: '0.9rem', fontWeight: '500', cursor: shareLoading ? 'wait' : 'pointer', border: 'none', backgroundColor: 'var(--accent-red, #e11d48)', color: '#fff', opacity: shareLoading ? 0.7 : 1 }}>
                  {shareLoading ? 'Revoking...' : 'Revoke'}
                </button>
              )}
              {shareModal.mode === 'shared-success' && (
                <button onClick={closeShareModal} style={{ padding: '8px 16px', borderRadius: '6px', fontSize: '0.9rem', fontWeight: '500', cursor: 'pointer', border: 'none', backgroundColor: 'var(--accent-color, #007acc)', color: 'var(--accent-text, #fff)' }}>
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <UpdateModal />
    </div>
  )
}

export default App
