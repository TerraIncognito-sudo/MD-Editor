import { useCallback, useEffect, useRef, useState } from 'react'
import type { FolderResult, TreeNode } from '../../preload/index'
import { FileTree } from './components/FileTree'
import {
  Editor,
  type CountState,
  type EditorHandle,
  type SelectionState,
  type StyleCommand
} from './components/Editor'
import { StyleBar } from './components/StyleBar'
import { TabBar, type TabInfo } from './components/TabBar'
import { ContextMenu, type MenuItem } from './components/ContextMenu'
import { PromptDialog } from './components/PromptDialog'
import { ConfirmDialog } from './components/ConfirmDialog'

type Theme = 'light' | 'dark'
type ViewMode = 'page' | 'wide'

const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
const ZOOM_STEP = 0.1

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 560

function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

/** A file's display name without its markdown extension. */
function displayName(fileName: string): string {
  return fileName.replace(/\.(md|markdown|mdown|mkd|mdx)$/i, '')
}

/** Status-bar text for the word/character counts, e.g. "12 words · 60 characters selected". */
function formatCounts(c: CountState): string {
  const words = `${c.words.toLocaleString()} ${c.words === 1 ? 'word' : 'words'}`
  const chars = `${c.chars.toLocaleString()} ${c.chars === 1 ? 'character' : 'characters'}`
  return `${words} · ${chars}${c.selected ? ' selected' : ''}`
}

/** True if `p` is `base` itself or lives inside the `base` directory. */
function isUnderPath(p: string, base: string): boolean {
  return p === base || p.startsWith(base + '\\') || p.startsWith(base + '/')
}

function App(): JSX.Element {
  const [folder, setFolder] = useState<FolderResult | null>(null)
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')
  const [theme, setTheme] = useState<Theme>('dark')
  const [zoom, setZoom] = useState<number>(1)
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [counts, setCounts] = useState<CountState | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState<number>(260)
  const [viewMode, setViewMode] = useState<ViewMode>('page')
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode | null } | null>(null)
  const [prompt, setPrompt] = useState<{
    title: string
    value: string
    confirmLabel: string
    resolve: (v: string | null) => void
  } | null>(null)
  const [confirm, setConfirm] = useState<{
    message: string
    confirmLabel: string
    danger: boolean
    resolve: (ok: boolean) => void
  } | null>(null)

  // Latest markdown per open file, so switching tabs preserves unsaved edits.
  const latestByPath = useRef<Map<string, string>>(new Map())
  // Mirror of activePath for use inside stable editor callbacks.
  const activePathRef = useRef<string | null>(null)
  activePathRef.current = activePath
  const editorRef = useRef<EditorHandle>(null)
  // Set when a note must be printed as soon as its editor finishes rendering.
  const pendingPrintRef = useRef<string | null>(null)

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

  // In-app replacement for window.prompt (unsupported in Electron).
  const askPrompt = useCallback(
    (title: string, initial: string, confirmLabel = 'OK'): Promise<string | null> =>
      new Promise((resolve) => {
        setPrompt({ title, value: initial, confirmLabel, resolve })
      }),
    []
  )

  // In-app confirm, so dialogs match the app chrome (and are theme-aware).
  const askConfirm = useCallback(
    (message: string, confirmLabel = 'OK', danger = false): Promise<boolean> =>
      new Promise((resolve) => {
        setConfirm({ message, confirmLabel, danger, resolve })
      }),
    []
  )

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
    async (path: string) => {
      const tab = tabs.find((t) => t.path === path)
      if (tab?.dirty) {
        const discard = await askConfirm(
          `"${tab.name}" has unsaved changes. Discard them?`,
          'Discard',
          true
        )
        if (!discard) return
      }
      const idx = tabs.findIndex((t) => t.path === path)
      const nextTabs = tabs.filter((t) => t.path !== path)
      latestByPath.current.delete(path)
      setTabs(nextTabs)
      if (activePathRef.current === path) {
        const neighbor = nextTabs[idx] ?? nextTabs[idx - 1] ?? null
        activate(neighbor ? neighbor.path : null)
        if (!neighbor) {
          setSelection(null)
          setCounts(null)
        }
      }
    },
    [tabs, activate, askConfirm]
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

  const handleCountsChange = useCallback((c: CountState | null) => {
    setCounts(c)
  }, [])

  const runStyleCommand = useCallback((cmd: StyleCommand) => {
    editorRef.current?.runCommand(cmd)
  }, [])

  // Hands the rendered note to the system print dialog. The @media print rules
  // in base.css strip the app chrome and flow the note onto letter pages.
  const printActive = useCallback(() => {
    if (!activePathRef.current) return
    window.print()
  }, [])

  // A note asked to print before it was on screen prints once the editor renders.
  const handleEditorReady = useCallback(() => {
    if (pendingPrintRef.current && pendingPrintRef.current === activePathRef.current) {
      pendingPrintRef.current = null
      printActive()
    }
  }, [printActive])

  const printNode = useCallback(
    async (node: TreeNode) => {
      if (node.type !== 'file') return
      if (activePathRef.current === node.path) {
        printActive()
        return
      }
      // Not on screen yet: open it, and print when its editor reports ready.
      pendingPrintRef.current = node.path
      try {
        await openTab(node.path, node.name)
      } catch (err) {
        pendingPrintRef.current = null
        setStatus(`Could not open note: ${(err as Error).message}`)
      }
    },
    [openTab, printActive]
  )

  // ----- File-tree context-menu operations -----

  const newFileIn = useCallback(
    async (dirPath: string) => {
      const name = await askPrompt('New note name:', 'Untitled', 'Create')
      if (name === null) return
      try {
        const newPath = await window.api.createFile(dirPath, name)
        await refreshTree()
        await openTab(newPath, baseName(newPath))
      } catch (err) {
        setStatus(`Could not create note: ${(err as Error).message}`)
      }
    },
    [refreshTree, openTab, askPrompt]
  )

  const newFolderIn = useCallback(
    async (dirPath: string) => {
      const name = await askPrompt('New folder name:', 'New Folder', 'Create')
      if (name === null) return
      try {
        await window.api.createFolder(dirPath, name)
        await refreshTree()
      } catch (err) {
        setStatus(`Could not create folder: ${(err as Error).message}`)
      }
    },
    [refreshTree, askPrompt]
  )

  const renameNode = useCallback(
    async (node: TreeNode) => {
      const isFile = node.type === 'file'
      const current = isFile ? displayName(node.name) : node.name
      const input = await askPrompt(`Rename ${isFile ? 'note' : 'folder'}:`, current, 'Rename')
      if (input === null) return
      const trimmed = input.trim()
      if (trimmed.length === 0 || trimmed === current) return

      let newPath: string
      try {
        newPath = await window.api.rename(node.path, trimmed)
      } catch (err) {
        setStatus(`Rename failed: ${(err as Error).message}`)
        return
      }

      // Migrate any open tabs (and their unsaved content) under the old path.
      const oldPath = node.path
      const remap = (p: string): string => newPath + p.slice(oldPath.length)
      for (const [p, content] of Array.from(latestByPath.current.entries())) {
        if (isUnderPath(p, oldPath)) {
          latestByPath.current.delete(p)
          latestByPath.current.set(remap(p), content)
        }
      }
      setTabs((prev) =>
        prev.map((t) =>
          isUnderPath(t.path, oldPath)
            ? { ...t, path: remap(t.path), name: baseName(remap(t.path)) }
            : t
        )
      )
      if (activePathRef.current && isUnderPath(activePathRef.current, oldPath)) {
        activate(remap(activePathRef.current))
      }
      await refreshTree()
    },
    [activate, refreshTree, askPrompt]
  )

  const trashNode = useCallback(
    async (node: TreeNode) => {
      const isFile = node.type === 'file'
      const label = isFile ? 'note' : 'folder'
      const shown = isFile ? displayName(node.name) : node.name
      const ok = await askConfirm(
        `Move ${label} "${shown}" to the Recycle Bin?`,
        'Delete',
        true
      )
      if (!ok) return

      try {
        await window.api.trash(node.path)
      } catch (err) {
        setStatus(`Delete failed: ${(err as Error).message}`)
        return
      }

      // Close any open tabs that lived under the deleted path.
      setTabs((prev) => {
        const target = node.path
        const affected = prev.filter((t) => isUnderPath(t.path, target))
        if (affected.length === 0) return prev
        affected.forEach((t) => latestByPath.current.delete(t.path))
        const nextTabs = prev.filter((t) => !isUnderPath(t.path, target))
        if (activePathRef.current && isUnderPath(activePathRef.current, target)) {
          const idx = prev.findIndex((t) => t.path === activePathRef.current)
          const neighbor = nextTabs[idx] ?? nextTabs[idx - 1] ?? null
          activate(neighbor ? neighbor.path : null)
          if (!neighbor) {
            setSelection(null)
            setCounts(null)
          }
        }
        return nextTabs
      })
      await refreshTree()
      setStatus(`Moved "${shown}" to Recycle Bin`)
      window.setTimeout(() => setStatus(''), 2500)
    },
    [activate, refreshTree, askConfirm]
  )

  const openContextMenu = useCallback((node: TreeNode, e: React.MouseEvent) => {
    setMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  const menuItems = useCallback((): MenuItem[] => {
    if (!folder || !menu) return []
    const node = menu.node
    if (node === null) {
      return [
        { label: 'New Note', onClick: () => void newFileIn(folder.rootPath) },
        { label: 'New Folder', onClick: () => void newFolderIn(folder.rootPath) }
      ]
    }
    if (node.type === 'folder') {
      return [
        { label: 'New Note', onClick: () => void newFileIn(node.path) },
        { label: 'New Folder', onClick: () => void newFolderIn(node.path) },
        { label: 'Rename', onClick: () => void renameNode(node) },
        { label: 'Delete', onClick: () => void trashNode(node), danger: true }
      ]
    }
    return [
      { label: 'Print', onClick: () => void printNode(node) },
      { label: 'Rename', onClick: () => void renameNode(node) },
      { label: 'Delete', onClick: () => void trashNode(node), danger: true }
    ]
  }, [folder, menu, newFileIn, newFolderIn, renameNode, trashNode, printNode])

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

  // Load saved UI preferences (theme, zoom, sidebar width, view mode) on launch.
  useEffect(() => {
    void (async () => {
      const settings = await window.api.getSettings()
      setTheme(settings.theme)
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, settings.zoom))
      setZoom(z)
      window.api.applyZoom(z)
      setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, settings.sidebarWidth)))
      setViewMode(settings.viewMode)
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

  const toggleView = useCallback(() => {
    setViewMode((prev) => {
      const next: ViewMode = prev === 'page' ? 'wide' : 'page'
      void window.api.setViewMode(next)
      return next
    })
  }, [])

  // Drag-to-resize the sidebar. We track the pointer on the whole window so the
  // drag keeps working even when the cursor moves over the editor.
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    document.body.classList.add('resizing-col')
    const onMove = (ev: MouseEvent): void => {
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX))
      setSidebarWidth(w)
    }
    const onUp = (ev: MouseEvent): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.classList.remove('resizing-col')
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX))
      void window.api.setSidebarWidth(w)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

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
      } else if (key === 'p') {
        e.preventDefault()
        printActive()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, closeTab, zoomIn, zoomOut, zoomReset, printActive])

  const activeContent = activePath ? latestByPath.current.get(activePath) ?? '' : ''

  return (
    <div className="app-shell">
      <div className="app">
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <div className="sidebar-header">
            <span className="sidebar-title">{folder ? folder.rootName : 'MD Editor'}</span>
            <div className="sidebar-actions">
              <button className="icon-btn" title="Open folder" onClick={openFolder}>
                ⌕
              </button>
            </div>
          </div>
          <div
            className="tree-scroll"
            onContextMenu={(e) => {
              if (!folder) return
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, node: null })
            }}
          >
            {folder ? (
              folder.tree.length > 0 ? (
                <FileTree
                  nodes={folder.tree}
                  activePath={activePath}
                  onSelect={openFileByPath}
                  onContextMenu={openContextMenu}
                />
              ) : (
                <p className="empty-hint">This folder is empty. Right-click to add a note or folder.</p>
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

        <div
          className="col-resizer"
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize"
          onMouseDown={startResize}
        />

        <main className={`editor-pane view-${viewMode}`}>
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
                onCountsChange={handleCountsChange}
                onReady={handleEditorReady}
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
        <div className="status-left">
          <button
            className="status-btn"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? '☀ Light' : '☾ Dark'}
          </button>
          <button
            className="status-btn"
            onClick={toggleView}
            title={
              viewMode === 'page'
                ? 'Switch to wide view (fills the window)'
                : 'Switch to page view (8.5×11 with margins)'
            }
          >
            {viewMode === 'page' ? '▭ Page' : '⬌ Wide'}
          </button>
          {activePath && (
            <button className="status-btn" onClick={printActive} title="Print this note (Ctrl P)">
              ⎙ Print
            </button>
          )}
        </div>

        <span className="status-message">{status}</span>

        {counts && (
          <span
            className={`status-counts${counts.selected ? ' selected' : ''}`}
            title={counts.selected ? 'Counts for the selected text' : 'Counts for the whole note'}
          >
            {formatCounts(counts)}
          </span>
        )}

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

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />
      )}

      {prompt && (
        <PromptDialog
          title={prompt.title}
          initialValue={prompt.value}
          confirmLabel={prompt.confirmLabel}
          onSubmit={(v) => {
            prompt.resolve(v)
            setPrompt(null)
          }}
          onCancel={() => {
            prompt.resolve(null)
            setPrompt(null)
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          onConfirm={() => {
            confirm.resolve(true)
            setConfirm(null)
          }}
          onCancel={() => {
            confirm.resolve(false)
            setConfirm(null)
          }}
        />
      )}
    </div>
  )
}

export default App
