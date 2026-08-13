import { useCallback, useEffect, useRef, useState } from 'react'
import type { FolderResult, TreeNode } from '../../preload/index'
import { FileTree } from './components/FileTree'
import { Editor, type EditorHandle, type SelectionState, type StyleCommand } from './components/Editor'
import { StyleBar } from './components/StyleBar'
import { TabBar, type TabInfo } from './components/TabBar'

type Theme = 'light' | 'dark'

const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
const ZOOM_STEP = 0.1

function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

function App(): JSX.Element {
  const [folder, setFolder] = useState<FolderResult | null>(null)
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')
  const [theme, setTheme] = useState<Theme>('dark')
  const [zoom, setZoom] = useState<number>(1)
  const [selection, setSelection] = useState<SelectionState | null>(null)

  // Latest markdown per open file, so switching tabs preserves unsaved edits.
  const latestByPath = useRef<Map<string, string>>(new Map())
  // Mirror of activePath for use inside stable editor callbacks.
  const activePathRef = useRef<string | null>(null)
  activePathRef.current = activePath
  const editorRef = useRef<EditorHandle>(null)

  const openFolder = useCallback(async () => {
    const result = await window.api.openFolder()
    if (result) setFolder(result)
  }, [])

  const refreshTree = useCallback(async () => {
    if (!folder) return
    const result = await window.api.readTree(folder.rootPath)
    if (result) setFolder(result)
  }, [folder])

  const activate = useCallback((path: string | null) => {
    setActivePath(path)
    void window.api.setLastFile(path)
  }, [])

  const openTab = useCallback(
    async (filePath: string, name: string) => {
      // Already open? Just focus its tab.
      if (latestByPath.current.has(filePath)) {
        activate(filePath)
        return
      }
      const content = await window.api.readFile(filePath)
      latestByPath.current.set(filePath, content)
      setTabs((prev) => [...prev, { path: filePath, name, dirty: false }])
      activate(filePath)
      setStatus('')
    },
    [activate]
  )

  const openFileByPath = useCallback(
    async (node: TreeNode) => {
      if (node.type !== 'file') return
      try {
        await openTab(node.path, node.name)
      } catch (err) {
        setStatus(`Could not open file: ${(err as Error).message}`)
      }
    },
    [openTab]
  )

  const closeTab = useCallback(
    (path: string) => {
      const tab = tabs.find((t) => t.path === path)
      if (tab?.dirty) {
        const discard = window.confirm(`"${tab.name}" has unsaved changes. Discard them?`)
        if (!discard) return
      }
      const idx = tabs.findIndex((t) => t.path === path)
      const nextTabs = tabs.filter((t) => t.path !== path)
      latestByPath.current.delete(path)
      setTabs(nextTabs)
      if (activePathRef.current === path) {
        const neighbor = nextTabs[idx] ?? nextTabs[idx - 1] ?? null
        activate(neighbor ? neighbor.path : null)
        if (!neighbor) setSelection(null)
      }
    },
    [tabs, activate]
  )

  const save = useCallback(async () => {
    const path = activePathRef.current
    if (!path) return
    const content = latestByPath.current.get(path) ?? ''
    const name = baseName(path)
    try {
      await window.api.writeFile(path, content)
      setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, dirty: false } : t)))
      setStatus(`Saved ${name}`)
      window.setTimeout(() => setStatus(''), 2000)
    } catch (err) {
      setStatus(`Save failed: ${(err as Error).message}`)
    }
  }, [])

  // Milkdown fires this for every content change, including load-time
  // normalization, so it only captures content — it does not flag unsaved edits.
  const handleChange = useCallback((markdown: string) => {
    const path = activePathRef.current
    if (path) latestByPath.current.set(path, markdown)
  }, [])

  // Fired only on genuine user input, so this is what marks a tab dirty.
  const handleUserEdit = useCallback(() => {
    const path = activePathRef.current
    setTabs((prev) => {
      const tab = prev.find((t) => t.path === path)
      if (!tab || tab.dirty) return prev
      return prev.map((t) => (t.path === path ? { ...t, dirty: true } : t))
    })
  }, [])

  const handleSelectionChange = useCallback((s: SelectionState | null) => {
    setSelection(s)
  }, [])

  const runStyleCommand = useCallback((cmd: StyleCommand) => {
    editorRef.current?.runCommand(cmd)
  }, [])

  const createFile = useCallback(async () => {
    if (!folder) return
    const name = window.prompt('New note name:', 'Untitled')
    if (name === null) return
    const newPath = await window.api.createFile(folder.rootPath, name)
    await refreshTree()
    await openTab(newPath, baseName(newPath))
  }, [folder, refreshTree, openTab])

  // Restore the previous session (last folder + note) on first launch.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const session = await window.api.getLastSession()
      if (cancelled || !session) return
      setFolder({ rootPath: session.rootPath, rootName: session.rootName, tree: session.tree })
      if (session.lastFile) {
        try {
          await openTab(session.lastFile, baseName(session.lastFile))
        } catch {
          /* file vanished; ignore */
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [openTab])

  // Load saved UI preferences (theme + zoom) once on launch.
  useEffect(() => {
    void (async () => {
      const settings = await window.api.getSettings()
      setTheme(settings.theme)
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, settings.zoom))
      setZoom(z)
      window.api.applyZoom(z)
    })()
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark'
      void window.api.setTheme(next)
      return next
    })
  }, [])

  const applyZoom = useCallback((next: number) => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 100) / 100))
    setZoom(clamped)
    window.api.applyZoom(clamped)
    void window.api.setZoom(clamped)
  }, [])

  const zoomIn = useCallback(() => applyZoom(zoom + ZOOM_STEP), [zoom, applyZoom])
  const zoomOut = useCallback(() => applyZoom(zoom - ZOOM_STEP), [zoom, applyZoom])
  const zoomReset = useCallback(() => applyZoom(1), [applyZoom])

  // Global keyboard shortcuts: save, close tab, zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 's') {
        e.preventDefault()
        void save()
      } else if (key === 'w') {
        e.preventDefault()
        if (activePathRef.current) closeTab(activePathRef.current)
      } else if (key === '=' || key === '+') {
        e.preventDefault()
        zoomIn()
      } else if (key === '-' || key === '_') {
        e.preventDefault()
        zoomOut()
      } else if (key === '0') {
        e.preventDefault()
        zoomReset()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, closeTab, zoomIn, zoomOut, zoomReset])

  const activeContent = activePath ? latestByPath.current.get(activePath) ?? '' : ''

  return (
    <div className="app-shell">
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-header">
            <span className="sidebar-title">{folder ? folder.rootName : 'MD Editor'}</span>
            <div className="sidebar-actions">
              {folder && (
                <button className="icon-btn" title="New note" onClick={createFile}>
                  +
                </button>
              )}
              <button className="icon-btn" title="Open folder" onClick={openFolder}>
                ⌕
              </button>
            </div>
          </div>
          <div className="tree-scroll">
            {folder ? (
              folder.tree.length > 0 ? (
                <FileTree nodes={folder.tree} activePath={activePath} onSelect={openFileByPath} />
              ) : (
                <p className="empty-hint">This folder is empty.</p>
              )
            ) : (
              <div className="welcome">
                <p>Open a folder to browse your markdown notes.</p>
                <button className="primary-btn" onClick={openFolder}>
                  Open Folder
                </button>
              </div>
            )}
          </div>
        </aside>

        <main className="editor-pane">
          {tabs.length > 0 && activePath ? (
            <>
              <TabBar
                tabs={tabs}
                activePath={activePath}
                onSelect={activate}
                onClose={closeTab}
              />
              <StyleBar state={selection} onCommand={runStyleCommand} />
              <Editor
                key={activePath}
                ref={editorRef}
                initialValue={activeContent}
                onChange={handleChange}
                onUserEdit={handleUserEdit}
                onSelectionChange={handleSelectionChange}
              />
            </>
          ) : (
            <div className="editor-empty">
              <p>Select a note from the sidebar, or open a folder to get started.</p>
            </div>
          )}
        </main>
      </div>

      <footer className="statusbar">
        <button
          className="status-btn"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? '☀ Light' : '☾ Dark'}
        </button>

        <span className="status-message">{status}</span>

        <div className="zoom-controls">
          <button className="status-btn zoom-btn" onClick={zoomOut} title="Zoom out (Ctrl -)">
            −
          </button>
          <button className="status-btn zoom-level" onClick={zoomReset} title="Reset zoom (Ctrl 0)">
            {Math.round(zoom * 100)}%
          </button>
          <button className="status-btn zoom-btn" onClick={zoomIn} title="Zoom in (Ctrl +)">
            +
          </button>
        </div>
      </footer>
    </div>
  )
}

export default App
