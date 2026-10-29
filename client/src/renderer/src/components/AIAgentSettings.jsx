import React, { useState, useEffect } from 'react'

export function AIAgentSettings() {
  const [keyInfo, setKeyInfo] = useState({ exists: false, hint: '', source: 'none' })
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [keySaving, setKeySaving] = useState(false)
  const [keyMessage, setKeyMessage] = useState('')
  const [autoCompleteEnabled, setAutoCompleteEnabled] = useState(
    localStorage.getItem('editor-inlineSuggest') !== 'false'
  )
  const [autoCompleteDelay, setAutoCompleteDelay] = useState(
    Number(localStorage.getItem('editor-inlineSuggestDelay')) || 300
  )

  const fetchKeys = async () => {
    if (window.api && window.api.getAllKeys) {
      const keys = await window.api.getAllKeys() || {}
      if (keys.google && keys.google.exists) {
        setKeyInfo({
          exists: true,
          hint: keys.google.hint || '••••••••',
          source: keys.google.source || 'server'
        })
      } else {
        setKeyInfo({ exists: false, hint: '', source: 'none' })
      }
    }
  }

  useEffect(() => {
    fetchKeys()
    window.addEventListener('reload-ai-config', fetchKeys)
    return () => window.removeEventListener('reload-ai-config', fetchKeys)
  }, [])

  const handleSaveKey = async () => {
    if (!apiKeyInput.trim()) return
    setKeySaving(true)
    setKeyMessage('')
    try {
      const result = await window.api.saveApiKey('google', apiKeyInput.trim())
      if (result.success) {
        setApiKeyInput('')
        setKeyMessage('Gemini API key saved successfully!')
        window.dispatchEvent(new Event('reload-ai-config'))
      } else {
        setKeyMessage(`Error: ${result.error || 'Failed to save key'}`)
      }
    } catch (err) {
      setKeyMessage(`Error: ${err.message}`)
    }
    setKeySaving(false)
  }

  const handleResetToServerKey = async () => {
    try {
      await window.api.deleteApiKey('google')
      setApiKeyInput('')
      setKeyMessage('Reverted to server-configured environment key.')
      window.dispatchEvent(new Event('reload-ai-config'))
    } catch (err) {
      setKeyMessage(`Error: ${err.message}`)
    }
  }

  useEffect(() => {
    localStorage.setItem('editor-inlineSuggest', autoCompleteEnabled.toString())
    window.dispatchEvent(new Event('reload-ai-config'))
  }, [autoCompleteEnabled])

  useEffect(() => {
    localStorage.setItem('editor-inlineSuggestDelay', autoCompleteDelay.toString())
    window.dispatchEvent(new Event('reload-ai-config'))
  }, [autoCompleteDelay])

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '32px 40px', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', background: 'transparent' }}>
      <div style={{ maxWidth: '640px' }}>
        
        <div style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px' }}>
            AI Assistant & Intelligence Settings
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            comπle is powered natively by Google Gemini for real-time Ghost Text autocomplete and right-hand AI chat refactoring.
          </p>
        </div>

        {/* ── Active Provider Status Card ── */}
        <div style={{ marginBottom: '36px', padding: '16px 20px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-base)', borderRadius: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '15px', fontWeight: '600', color: 'var(--accent-color, #ebd79e)' }}>
                Google Gemini
              </span>
              <span style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '12px',
                fontWeight: '500',
                background: keyInfo.exists ? 'rgba(74, 222, 128, 0.15)' : 'rgba(244, 63, 94, 0.15)',
                color: keyInfo.exists ? '#4ade80' : '#f43f5e',
                border: `1px solid ${keyInfo.exists ? 'rgba(74, 222, 128, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`
              }}>
                {keyInfo.exists ? '● Active' : '○ Inactive'}
              </span>
            </div>

            {keyInfo.source === 'custom' && (
              <button
                onClick={handleResetToServerKey}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-base)',
                  borderRadius: '4px',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  padding: '4px 8px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                onMouseOver={(e) => { e.currentTarget.style.color = '#f43f5e'; e.currentTarget.style.borderColor = '#f43f5e'; }}
                onMouseOut={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-base)'; }}
                title="Remove custom key and fall back to backend .env"
              >
                Reset to Server Key
              </button>
            )}
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Configuration Source:</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>
                {keyInfo.source === 'custom' ? 'Custom API Key (Local)' : keyInfo.source === 'server' ? 'Server Environment (.env)' : 'Not Configured'}
              </span>
            </div>
            {keyInfo.hint && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Active Key Hint:</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{keyInfo.hint}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Custom Key Input ── */}
        <div style={{ marginBottom: '36px' }}>
          <div style={{ paddingBottom: '10px', borderBottom: '1px solid var(--border-base)', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Override / Provide Gemini API Key
            </h3>
          </div>

          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: '1.5' }}>
            By default, comπle uses the server-configured API key from the environment. You can enter your personal Google Gemini API key below to override it.
          </p>

          <div style={{ display: 'flex', gap: '8px', maxWidth: '480px' }}>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="AIzaSy..."
              disabled={keySaving}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: '13px',
                fontFamily: 'var(--font-mono)',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-base)',
                borderRadius: '4px',
                outline: 'none'
              }}
              onFocus={(e) => e.target.style.borderColor = 'var(--accent-color, #ebd79e)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--border-base)'}
            />
            <button
              onClick={handleSaveKey}
              disabled={keySaving || !apiKeyInput.trim()}
              style={{
                padding: '0 16px',
                fontSize: '12px',
                fontWeight: '500',
                background: 'var(--accent-color, #ebd79e)',
                color: '#121212',
                border: 'none',
                borderRadius: '4px',
                cursor: (keySaving || !apiKeyInput.trim()) ? 'not-allowed' : 'pointer',
                opacity: (keySaving || !apiKeyInput.trim()) ? 0.5 : 1
              }}
            >
              {keySaving ? 'Saving...' : 'Save Key'}
            </button>
          </div>

          {keyMessage && (
            <div style={{ marginTop: '10px', fontSize: '12px', color: keyMessage.includes('Error') ? '#f43f5e' : '#4ade80' }}>
              {keyMessage}
            </div>
          )}
        </div>

        {/* ── Editor Auto-Complete Settings ── */}
        <div style={{ marginBottom: '36px' }}>
          <div style={{ paddingBottom: '10px', borderBottom: '1px solid var(--border-base)', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Inline Autocomplete (Ghost Text)
            </h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={autoCompleteEnabled}
                onChange={e => setAutoCompleteEnabled(e.target.checked)}
                style={{ cursor: 'pointer', accentColor: 'var(--accent-color, #ebd79e)' }}
              />
              <span>Enable AI Ghost Text suggestions as you type</span>
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', opacity: autoCompleteEnabled ? 1 : 0.4, pointerEvents: autoCompleteEnabled ? 'auto' : 'none', maxWidth: '320px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)' }}>
                <span>Trigger Debounce Delay</span>
                <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{autoCompleteDelay}ms</span>
              </div>
              <input
                type="range"
                min="100"
                max="1500"
                step="50"
                value={autoCompleteDelay}
                onChange={e => setAutoCompleteDelay(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--accent-color, #ebd79e)' }}
              />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Higher delay prevents unnecessary API calls while typing rapidly.
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
