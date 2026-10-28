import React, { useState, useRef, useEffect } from 'react'
import { Files, Search, Sparkles, Settings, ChevronRight } from 'lucide-react'
import { useAppStore } from '../store/appStore'

export function ActivityBar({ onOpenFile }) {
  const { activePanel, setActivePanel, isChatOpen, setIsChatOpen } = useAppStore()
  const [showSettingsMenu, setShowSettingsMenu] = useState(false)
  const settingsMenuRef = useRef(null)

  // Close settings menu on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target)) {
        setShowSettingsMenu(false)
      }
    }
    if (showSettingsMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showSettingsMenu])

  // Strictly: File Explorer, Search, and AI Chat
  const panels = [
    { id: 'explorer', icon: Files, title: 'Explorer' },
    { id: 'search', icon: Search, title: 'Search' },
    { id: 'chat', icon: Sparkles, title: 'AI Chat' }
  ]

  const handleSettingsAction = (action) => {
    setShowSettingsMenu(false)
    action()
  }

  const settingsMenuItems = [
    { label: 'Settings', shortcut: 'Ctrl+,', action: () => onOpenFile('settings:main', 'Settings') },
    { label: 'Keyboard Shortcuts', shortcut: 'Ctrl+K Ctrl+S', action: () => onOpenFile('settings:shortcuts', 'Keyboard Shortcuts') }
  ]

  return (
    <div className="activity-bar">
      <div className="activity-bar-top">
        {panels.map((panel) => {
          const Icon = panel.icon
          const isActive = panel.id === 'chat' ? isChatOpen : activePanel === panel.id

          return (
            <div
              key={panel.id}
              className={`activity-item ${isActive ? 'active' : ''}`}
              title={panel.title}
              onClick={() => {
                if (panel.id === 'chat') {
                  setIsChatOpen(!isChatOpen)
                } else {
                  setActivePanel(activePanel === panel.id ? null : panel.id)
                }
              }}
            >
              <Icon size={22} strokeWidth={isActive ? 2 : 1.5} />
            </div>
          )
        })}
      </div>

      <div className="activity-bar-bottom">
        <div style={{ position: 'relative' }} ref={settingsMenuRef}>
          <div
            className={`activity-item ${showSettingsMenu ? 'active' : ''}`}
            title="Settings"
            onClick={() => {
              if (onOpenFile) {
                onOpenFile('settings:main', 'Settings')
              } else {
                setShowSettingsMenu(!showSettingsMenu)
              }
            }}
          >
            <Settings size={22} strokeWidth={showSettingsMenu ? 2 : 1.5} />
          </div>
          {showSettingsMenu && (
            <div style={{
              position: 'absolute',
              bottom: '0',
              left: '52px',
              background: 'var(--bg-elevated, #202023)',
              border: '1px solid var(--border-base, #333)',
              borderRadius: '6px',
              padding: '6px 0',
              minWidth: '220px',
              zIndex: 9999,
              boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
              display: 'flex',
              flexDirection: 'column',
              whiteSpace: 'nowrap'
            }}>
              {settingsMenuItems.map((item, idx) => (
                <div
                  key={idx}
                  className="submenu-item"
                  style={{
                    padding: '6px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    fontSize: '12px',
                    color: 'var(--text-main, #eee)'
                  }}
                  onClick={() => handleSettingsAction(item.action)}
                >
                  <span>{item.label}</span>
                  {item.shortcut && (
                    <span style={{ opacity: 0.5, fontSize: '11px', marginLeft: 'auto' }}>
                      {item.shortcut}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
