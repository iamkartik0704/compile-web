import React, { useState, useEffect, useRef } from 'react'
import {
  Sparkles,
  Send,
  Trash2,
  Copy,
  Check,
  FileCode,
  Loader2,
  ArrowDownLeft,
  X,
  FileCheck,
  FilePlus,
  Scissors,
  Zap,
  HelpCircle,
  Bug,
  TestTube
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

const getApiBaseUrl = () => {
  if (typeof window !== 'undefined' && window.location.hostname) {
    return `http://${window.location.hostname}:3000`
  }
  return 'http://127.0.0.1:3000'
}

function CodeBlock({ language, value, activeFile, hasSelection }) {
  const [copied, setCopied] = useState(false)
  const [applied, setApplied] = useState(false)
  const [inserted, setInserted] = useState(false)
  const [newTabOpened, setNewTabOpened] = useState(false)

  // 1. Copy snippet to clipboard
  const handleCopy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // 2. Apply to File / Replace Selection (replaces cleanly with full undo history)
  const handleApply = () => {
    let appliedSuccessfully = false
    if (typeof window !== 'undefined' && window.monaco && window.monaco.editor) {
      const editors = window.monaco.editor.getEditors()
      const focused = editors.find(e => e.hasWidgetFocus() || e.hasTextFocus()) || editors[0]
      if (focused && focused.getModel()) {
        const model = focused.getModel()
        const sel = focused.getSelection()
        const isSelectionActive = sel && !sel.isEmpty()

        focused.pushUndoStop()
        focused.executeEdits('ai-apply', [{
          range: isSelectionActive ? sel : model.getFullModelRange(),
          text: value,
          forceMoveMarkers: true
        }])
        focused.pushUndoStop()
        focused.focus()
        appliedSuccessfully = true
      }
    }

    if (!appliedSuccessfully) {
      window.dispatchEvent(new CustomEvent('apply-code', { detail: { code: value, path: activeFile } }))
    }

    setApplied(true)
    window.dispatchEvent(new CustomEvent('show-toast', {
      detail: {
        message: hasSelection ? 'Replaced active selection (Ctrl+Z to Undo)' : 'Applied code to file (Ctrl+Z to Undo)',
        type: 'success'
      }
    }))
    setTimeout(() => setApplied(false), 2500)
  }

  // 3. Insert code at current cursor
  const handleInsert = () => {
    if (typeof window !== 'undefined' && window.monaco && window.monaco.editor) {
      const editors = window.monaco.editor.getEditors()
      const focused = editors.find(e => e.hasWidgetFocus() || e.hasTextFocus()) || editors[0]
      if (focused) {
        const sel = focused.getSelection()
        focused.pushUndoStop()
        focused.executeEdits('ai-insert-cursor', [{
          range: sel,
          text: value,
          forceMoveMarkers: true
        }])
        focused.pushUndoStop()
        focused.focus()
        setInserted(true)
        setTimeout(() => setInserted(false), 2000)
      }
    }
  }

  // 4. Open snippet in a new editor tab
  const handleNewFile = () => {
    window.dispatchEvent(new CustomEvent('ai-create-new-file', { detail: { content: value, language } }))
    setNewTabOpened(true)
    setTimeout(() => setNewTabOpened(false), 2000)
  }

  return (
    <div
      style={{
        position: 'relative',
        margin: '10px 0',
        borderRadius: '6px',
        overflow: 'hidden',
        border: '1px solid var(--border-base, #2a2a2a)',
        background: 'var(--bg-deep, #111111)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)'
      }}
    >
      {/* Code Block Toolbar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 10px',
          background: 'var(--bg-elevated, #222222)',
          borderBottom: '1px solid var(--border-base, #2a2a2a)',
          fontSize: '11px'
        }}
      >
        <span
          style={{
            fontFamily: 'monospace',
            color: 'var(--accent-color, #ebd79e)',
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}
        >
          {language || 'code'}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Apply / Replace button */}
          <button
            onClick={handleApply}
            style={{
              background: applied ? 'rgba(74, 222, 128, 0.15)' : 'transparent',
              border: `1px solid ${applied ? 'rgba(74, 222, 128, 0.4)' : 'transparent'}`,
              borderRadius: '4px',
              color: applied ? '#4ade80' : 'var(--text-primary, #e0e0e0)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              padding: '2px 7px',
              transition: 'all 0.15s ease'
            }}
            title={hasSelection ? 'Replace currently selected code in editor' : 'Replace entire active file content with this code'}
          >
            {applied ? <Check size={12} /> : hasSelection ? <Scissors size={12} style={{ color: 'var(--accent-color, #ebd79e)' }} /> : <FileCheck size={12} style={{ color: 'var(--accent-color, #ebd79e)' }} />}
            <span style={{ fontWeight: applied ? '600' : '500' }}>
              {applied ? 'Applied (Ctrl+Z)' : hasSelection ? 'Replace Selection' : 'Apply to File'}
            </span>
          </button>

          {/* Insert at cursor */}
          <button
            onClick={handleInsert}
            style={{
              background: inserted ? 'rgba(74, 222, 128, 0.15)' : 'transparent',
              border: `1px solid ${inserted ? 'rgba(74, 222, 128, 0.4)' : 'transparent'}`,
              borderRadius: '4px',
              color: inserted ? '#4ade80' : 'var(--text-muted, #858585)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              fontSize: '11px',
              padding: '2px 5px',
              transition: 'all 0.15s ease'
            }}
            title="Insert code at current cursor position"
          >
            {inserted ? <Check size={12} /> : <ArrowDownLeft size={12} />}
            <span>{inserted ? 'Inserted' : 'Insert'}</span>
          </button>

          {/* Open in new tab */}
          <button
            onClick={handleNewFile}
            style={{
              background: newTabOpened ? 'rgba(74, 222, 128, 0.15)' : 'transparent',
              border: 'none',
              borderRadius: '4px',
              color: newTabOpened ? '#4ade80' : 'var(--text-muted, #858585)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              fontSize: '11px',
              padding: '2px 5px'
            }}
            title="Open snippet in a new editor tab"
          >
            {newTabOpened ? <Check size={12} /> : <FilePlus size={12} />}
            <span>{newTabOpened ? 'Opened' : 'New Tab'}</span>
          </button>

          {/* Copy code */}
          <button
            onClick={handleCopy}
            style={{
              background: copied ? 'rgba(74, 222, 128, 0.15)' : 'transparent',
              border: 'none',
              borderRadius: '4px',
              color: copied ? '#4ade80' : 'var(--text-muted, #858585)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              fontSize: '11px',
              padding: '2px 5px'
            }}
            title="Copy code to clipboard"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* Syntax Highlighted Code */}
      <SyntaxHighlighter
        language={language || 'javascript'}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          padding: '10px 12px',
          background: 'var(--bg-deep, #111111)',
          fontSize: '12px',
          lineHeight: '1.45',
          fontFamily: 'monospace'
        }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  )
}

export function AiChatSidebar({ width, activeFile, onClose }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: '👋 Hi! I am your AI assistant. Ask me questions, request refactoring, or ask me to explain any selected code.'
    }
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [currentContext, setCurrentContext] = useState({ filePath: '', selectedText: '', content: '' })
  const messagesEndRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, isLoading])

  // Poll or check active editor selection periodically
  useEffect(() => {
    const updateContext = () => {
      let ctx = { filePath: activeFile || '', selectedText: '', content: '' }
      if (typeof window.getActiveEditorContext === 'function') {
        const winCtx = window.getActiveEditorContext()
        if (winCtx) {
          ctx = {
            filePath: winCtx.filePath || activeFile || '',
            selectedText: winCtx.selectedText || '',
            content: winCtx.content || ''
          }
        }
      } else if (typeof window.monaco !== 'undefined' && window.monaco.editor && window.monaco.editor.getEditors) {
        const editors = window.monaco.editor.getEditors()
        const focused = editors.find(e => e.hasWidgetFocus() || e.hasTextFocus()) || editors[0]
        if (focused) {
          const model = focused.getModel()
          const selection = focused.getSelection()
          if (model) {
            ctx.filePath = model.uri.path
            ctx.content = model.getValue()
            if (selection && !selection.isEmpty()) {
              ctx.selectedText = model.getValueInRange(selection)
            }
          }
        }
      }
      setCurrentContext(ctx)
    }

    updateContext()
    const timer = setInterval(updateContext, 800)
    return () => clearInterval(timer)
  }, [activeFile])

  const handleSend = async (overrideMessage = null) => {
    const messageToSend = overrideMessage || input
    if (!messageToSend || !messageToSend.trim() || isLoading) return

    // 1. Programmatically grab active file context and active selection
    let fileContent = currentContext.content || ''
    let selectedCode = currentContext.selectedText || ''
    let filePath = currentContext.filePath || activeFile || ''

    if (typeof window.getActiveEditorContext === 'function') {
      const editorCtx = window.getActiveEditorContext()
      if (editorCtx) {
        fileContent = editorCtx.content || fileContent
        selectedCode = editorCtx.selectedText || selectedCode
        filePath = editorCtx.filePath || filePath
      }
    }

    if (!fileContent && typeof window.monaco !== 'undefined' && window.monaco.editor && window.monaco.editor.getEditors) {
      const editors = window.monaco.editor.getEditors()
      const focused = editors.find(e => e.hasWidgetFocus() || e.hasTextFocus()) || editors[0]
      if (focused) {
        const model = focused.getModel()
        const selection = focused.getSelection()
        if (model) {
          fileContent = model.getValue()
          filePath = filePath || model.uri.path
          if (selection && !selection.isEmpty()) {
            selectedCode = model.getValueInRange(selection)
          }
        }
      }
    }

    const userMessage = {
      role: 'user',
      content: messageToSend,
      contextMeta: {
        file: filePath ? filePath.split(/[/\\]/).pop() : null,
        hasSelection: Boolean(selectedCode && selectedCode.trim())
      }
    }

    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput('')
    setIsLoading(true)

    try {
      // Build history for context
      const history = newMessages
        .slice(-6)
        .map(m => ({ role: m.role, content: m.content }))

      const payload = {
        message: messageToSend,
        fileContext: fileContent,
        selectedCode,
        activeFile: filePath,
        history
      }

      // Try via relative /api/ endpoint first (works via nginx on port 8000), fallback to direct backend
      let response
      try {
        response = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
      } catch (fetchErr) {
        response = await fetch(`${getApiBaseUrl()}/api/ai/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
      }

      const data = await response.json()
      if (data.error && !data.reply) {
        throw new Error(data.error)
      }

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply || 'No response returned from AI.'
        }
      ])
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ **Error calling AI backend:** ${err.message}`
        }
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClear = () => {
    setMessages([
      {
        role: 'assistant',
        content: 'Chat cleared. Ask me anything about your workspace or code!'
      }
    ])
  }

  const fileName = (currentContext.filePath || activeFile || '').split(/[/\\]/).pop()
  const hasSelection = Boolean(currentContext.selectedText && currentContext.selectedText.trim())

  return (
    <aside
      className="sidebar ai-chat-sidebar"
      style={{
        width: typeof width === 'number' ? `${width}px` : (width || '340px'),
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-sidebar, #151515)',
        borderLeft: '1px solid var(--border-base, #2a2a2a)',
        color: 'var(--text-primary, #e0e0e0)',
        userSelect: 'text'
      }}
    >
      {/* ── Chat Header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-base, #2a2a2a)',
          background: 'var(--bg-sidebar, #151515)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={16} style={{ color: 'var(--accent-color, #ebd79e)' }} />
          <span style={{ fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-primary, #e0e0e0)' }}>
            AI Assistant
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={handleClear}
            title="Clear chat"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted, #858585)',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              borderRadius: '4px'
            }}
          >
            <Trash2 size={14} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              title="Close AI Assistant"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted, #858585)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                borderRadius: '4px'
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── Active Context Badges ── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          background: 'var(--bg-surface, #111111)',
          borderBottom: '1px solid var(--border-base, #2a2a2a)',
          fontSize: '11px'
        }}
      >
        {fileName ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '2px 8px',
              borderRadius: '4px',
              background: 'var(--bg-elevated, #222222)',
              color: 'var(--text-primary, #e0e0e0)',
              border: '1px solid var(--border-base, #2a2a2a)'
            }}
          >
            <FileCode size={12} style={{ color: 'var(--accent-color, #ebd79e)' }} />
            <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: '500' }}>
              {fileName}
            </span>
          </div>
        ) : (
          <span style={{ color: 'var(--text-muted, #858585)' }}>No file open</span>
        )}

        {hasSelection && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '2px 8px',
              borderRadius: '4px',
              background: 'var(--bg-elevated, #222222)',
              color: 'var(--text-primary, #e0e0e0)',
              border: '1px solid var(--border-base, #2a2a2a)'
            }}
          >
            <Scissors size={12} style={{ color: 'var(--accent-color, #ebd79e)' }} />
            <span>Selection active</span>
          </div>
        )}
      </div>

      {/* ── Message List ── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}
      >
        {messages.map((msg, idx) => {
          const isUser = msg.role === 'user'

          return (
            <div
              key={idx}
              style={{
                alignSelf: isUser ? 'flex-end' : 'flex-start',
                maxWidth: isUser ? '88%' : '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}
            >
              {isUser && msg.contextMeta?.file && (
                <div style={{ fontSize: '10px', color: 'var(--text-muted, #858585)', alignSelf: 'flex-end', display: 'flex', gap: '4px' }}>
                  <span>attached: {msg.contextMeta.file}</span>
                  {msg.contextMeta.hasSelection && <span>(with selection)</span>}
                </div>
              )}

              <div
                style={{
                  padding: isUser ? '8px 12px' : '4px 0',
                  borderRadius: isUser ? '8px' : '0',
                  background: isUser ? 'var(--bg-elevated, #222222)' : 'transparent',
                  border: isUser ? '1px solid var(--border-base, #2a2a2a)' : 'none',
                  borderLeft: isUser ? '3px solid var(--accent-color, #ebd79e)' : 'none',
                  color: 'var(--text-primary, #e0e0e0)',
                  fontSize: '12.5px',
                  lineHeight: '1.55',
                  boxShadow: isUser ? '0 1px 4px rgba(0,0,0,0.15)' : 'none'
                }}
              >
                {isUser ? (
                  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</div>
                ) : (
                  <ReactMarkdown
                    components={{
                      code({ node, inline, className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '')
                        const codeText = String(children).replace(/\n$/, '')
                        const isBlock = !inline && (match || codeText.includes('\n'))

                        return isBlock ? (
                          <CodeBlock
                            language={match ? match[1] : ''}
                            value={codeText}
                            activeFile={activeFile}
                            hasSelection={hasSelection}
                          />
                        ) : (
                          <code
                            style={{
                              background: 'var(--bg-elevated, #222222)',
                              border: '1px solid var(--border-base, #2a2a2a)',
                              color: 'var(--accent-color, #ebd79e)',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              fontSize: '11.5px',
                              fontFamily: 'monospace'
                            }}
                            {...props}
                          >
                            {children}
                          </code>
                        )
                      },
                      p({ node, children }) {
                        return <p style={{ margin: '0 0 8px 0', lineHeight: '1.55', color: 'var(--text-primary, #e0e0e0)' }}>{children}</p>
                      },
                      h1({ node, children }) {
                        return <h3 style={{ margin: '12px 0 6px 0', fontSize: '14px', fontWeight: '600', color: 'var(--text-bright, #ffffff)' }}>{children}</h3>
                      },
                      h2({ node, children }) {
                        return <h4 style={{ margin: '10px 0 4px 0', fontSize: '13px', fontWeight: '600', color: 'var(--text-bright, #ffffff)' }}>{children}</h4>
                      },
                      h3({ node, children }) {
                        return <h5 style={{ margin: '8px 0 4px 0', fontSize: '12.5px', fontWeight: '600', color: 'var(--text-bright, #ffffff)' }}>{children}</h5>
                      },
                      ul({ node, children }) {
                        return <ul style={{ margin: '4px 0 8px 18px', padding: 0, color: 'var(--text-primary, #e0e0e0)' }}>{children}</ul>
                      },
                      ol({ node, children }) {
                        return <ol style={{ margin: '4px 0 8px 18px', padding: 0, color: 'var(--text-primary, #e0e0e0)' }}>{children}</ol>
                      },
                      li({ node, children }) {
                        return <li style={{ margin: '2px 0' }}>{children}</li>
                      },
                      strong({ node, children }) {
                        return <strong style={{ fontWeight: '600', color: 'var(--text-bright, #ffffff)' }}>{children}</strong>
                      },
                      blockquote({ node, children }) {
                        return (
                          <blockquote
                            style={{
                              borderLeft: '3px solid var(--accent-color, #ebd79e)',
                              paddingLeft: '8px',
                              margin: '6px 0',
                              color: 'var(--text-secondary, #858585)',
                              fontStyle: 'italic'
                            }}
                          >
                            {children}
                          </blockquote>
                        )
                      }
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                )}
              </div>
            </div>
          )
        })}

        {isLoading && (
          <div
            style={{
              alignSelf: 'flex-start',
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'var(--bg-elevated, #222222)',
              border: '1px solid var(--border-base, #2a2a2a)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              color: 'var(--text-muted, #858585)'
            }}
          >
            <Loader2 size={13} className="animate-spin" style={{ color: 'var(--accent-color, #ebd79e)' }} />
            <span>Thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Quick Prompt Pills (when conversation is short) ── */}
      {messages.length <= 2 && !isLoading && (
        <div style={{ padding: '0 12px 10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ fontSize: '10px', color: 'var(--text-muted, #858585)', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: '600' }}>
            Quick Prompts
          </div>
          <button
            onClick={() => handleSend('Explain this code and how it works step-by-step.')}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-color, #ebd79e)'
              e.currentTarget.style.color = 'var(--text-primary, #ffffff)'
              e.currentTarget.style.background = 'var(--bg-elevated, #222222)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-base, #2a2a2a)'
              e.currentTarget.style.color = 'var(--text-secondary, #858585)'
              e.currentTarget.style.background = 'var(--bg-surface, #111111)'
            }}
            style={{
              textAlign: 'left',
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'var(--bg-surface, #111111)',
              border: '1px solid var(--border-base, #2a2a2a)',
              color: 'var(--text-secondary, #858585)',
              fontSize: '11.5px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease'
            }}
          >
            <HelpCircle size={13} style={{ color: 'var(--accent-color, #ebd79e)', flexShrink: 0 }} />
            <span>Explain active code</span>
          </button>
          <button
            onClick={() => handleSend('Refactor and optimize this code for best performance and readability.')}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-color, #ebd79e)'
              e.currentTarget.style.color = 'var(--text-primary, #ffffff)'
              e.currentTarget.style.background = 'var(--bg-elevated, #222222)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-base, #2a2a2a)'
              e.currentTarget.style.color = 'var(--text-secondary, #858585)'
              e.currentTarget.style.background = 'var(--bg-surface, #111111)'
            }}
            style={{
              textAlign: 'left',
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'var(--bg-surface, #111111)',
              border: '1px solid var(--border-base, #2a2a2a)',
              color: 'var(--text-secondary, #858585)',
              fontSize: '11.5px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease'
            }}
          >
            <Zap size={13} style={{ color: 'var(--accent-color, #ebd79e)', flexShrink: 0 }} />
            <span>Optimize & refactor</span>
          </button>
          <button
            onClick={() => handleSend('Are there any bugs, logic errors, or edge cases in this code? Suggest fixes.')}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-color, #ebd79e)'
              e.currentTarget.style.color = 'var(--text-primary, #ffffff)'
              e.currentTarget.style.background = 'var(--bg-elevated, #222222)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-base, #2a2a2a)'
              e.currentTarget.style.color = 'var(--text-secondary, #858585)'
              e.currentTarget.style.background = 'var(--bg-surface, #111111)'
            }}
            style={{
              textAlign: 'left',
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'var(--bg-surface, #111111)',
              border: '1px solid var(--border-base, #2a2a2a)',
              color: 'var(--text-secondary, #858585)',
              fontSize: '11.5px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease'
            }}
          >
            <Bug size={13} style={{ color: 'var(--accent-color, #ebd79e)', flexShrink: 0 }} />
            <span>Find bugs & edge cases</span>
          </button>
          <button
            onClick={() => handleSend('Generate comprehensive unit tests for this code.')}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-color, #ebd79e)'
              e.currentTarget.style.color = 'var(--text-primary, #ffffff)'
              e.currentTarget.style.background = 'var(--bg-elevated, #222222)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-base, #2a2a2a)'
              e.currentTarget.style.color = 'var(--text-secondary, #858585)'
              e.currentTarget.style.background = 'var(--bg-surface, #111111)'
            }}
            style={{
              textAlign: 'left',
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'var(--bg-surface, #111111)',
              border: '1px solid var(--border-base, #2a2a2a)',
              color: 'var(--text-secondary, #858585)',
              fontSize: '11.5px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease'
            }}
          >
            <TestTube size={13} style={{ color: 'var(--accent-color, #ebd79e)', flexShrink: 0 }} />
            <span>Generate unit tests</span>
          </button>
        </div>
      )}

      {/* ── Input Box ── */}
      <div
        style={{
          padding: '10px 12px',
          borderTop: '1px solid var(--border-base, #2a2a2a)',
          background: 'var(--bg-surface, #111111)'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '8px',
            background: 'var(--bg-input, #222222)',
            border: '1px solid var(--border-base, #2a2a2a)',
            borderRadius: '6px',
            padding: '6px 10px'
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              hasSelection
                ? `Ask AI about selected code...`
                : fileName
                ? `Ask AI about ${fileName}...`
                : 'Ask AI anything...'
            }
            rows={2}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'none',
              color: 'var(--text-primary, #e0e0e0)',
              fontSize: '12px',
              lineHeight: '1.45',
              fontFamily: 'inherit'
            }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            style={{
              background: input.trim() && !isLoading ? 'var(--accent-color, #ebd79e)' : 'transparent',
              color: input.trim() && !isLoading ? 'var(--accent-text, #111111)' : 'var(--text-muted, #858585)',
              border: 'none',
              borderRadius: '4px',
              padding: '6px 8px',
              cursor: input.trim() && !isLoading ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease'
            }}
            title="Send (Enter, Shift+Enter for newline)"
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </aside>
  )
}
