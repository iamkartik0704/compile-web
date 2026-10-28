import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { EXTENSIONS } from '../utils/extensionRegistry'

export const useAppStore = create(
  persist(
    (set) => ({
      activePanel: 'explorer', // 'explorer', 'search'
      isChatOpen: true,
      chatWidth: 340,
      activeTheme: 'compile-dark', // 'compile-dark', 'dark-plus', 'light-modern', 'dracula'
      extensions: EXTENSIONS,
      autoSave: true,
      breakpoints: {}, // { [filePath]: number[] }
      
      setActivePanel: (panel) => set({ activePanel: panel }),
      setIsChatOpen: (open) => set((state) => ({ isChatOpen: typeof open === 'function' ? open(state.isChatOpen) : open })),
      toggleChat: () => set((state) => ({ isChatOpen: !state.isChatOpen })),
      setChatWidth: (width) => set({ chatWidth: width }),
      setActiveTheme: (theme) => set({ activeTheme: theme }),
      setAutoSave: (val) => set({ autoSave: val }),
      setBreakpoints: (file, bps) => set((state) => ({ breakpoints: { ...state.breakpoints, [file]: bps } })),
      
      toggleExtension: (id, category) => set((state) => ({
        extensions: state.extensions.map(ext => {
          if (ext.id === id) {
            const newEnabled = !ext.enabled
            return { ...ext, enabled: newEnabled, installed: newEnabled ? true : ext.installed }
          }
          if (category === 'theme' && ext.category === 'theme') {
            return { ...ext, enabled: false }
          }
          return ext
        })
      }))
    }),
    {
      name: 'app-storage',
      partialize: (state) => ({
        activeTheme: state.activeTheme,
        autoSave: state.autoSave,
        isChatOpen: state.isChatOpen,
        chatWidth: state.chatWidth,
        enabledExtensions: state.extensions.filter(e => e.enabled).map(e => e.id)
      }),
      merge: (persistedState, currentState) => {
        const mergedExtensions = currentState.extensions.map(ext => {
          // If enabledExtensions is undefined, we use the default ext.enabled
          const isEnabled = persistedState.enabledExtensions 
            ? persistedState.enabledExtensions.includes(ext.id) 
            : ext.enabled
            
          return {
            ...ext,
            enabled: isEnabled,
            installed: isEnabled ? true : ext.installed
          }
        })
        return {
          ...currentState,
          activeTheme: persistedState.activeTheme || currentState.activeTheme,
          autoSave: persistedState.autoSave ?? currentState.autoSave,
          isChatOpen: persistedState.isChatOpen !== undefined ? persistedState.isChatOpen : currentState.isChatOpen,
          chatWidth: persistedState.chatWidth || currentState.chatWidth,
          extensions: mergedExtensions
        }
      }
    }
  )
)
