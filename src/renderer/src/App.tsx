import { useCallback, useEffect, useRef, useState } from 'react'
import type { FolderResult, TreeNode } from '../../preload/index'
import { FileTree } from './components/FileTree'
import { Editor } from './components/Editor'

interface OpenFile {
  path: string
  name: string
  content: string
}

function App(): JSX.Element {
  const [folder, setFolder] = useState<FolderResult | null>(null)
  const [openFile, setOpenFile] = useState<OpenFile | null>(null)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<string>('')

  // Latest markdown from the editor, kept in a ref so Ctrl+S always saves the newest.
  const latestContent = useRef<string>('')

  const openFolder = useCallback(async () => {
    const result = await window.api.openFolder()
    if (result) {
      setFolder(result)
    }
  }, [])

  const refreshTree = useCallback(async () => {
    if (!folder) return
    const result = await window.api.readTree(folder.rootPath)
    if (result) setFolder(result)
  }, [folder])

  const loadFile = useCallback(async (filePath: string, name: string) => {
    const content = await window.api.readFile(filePath)
    latestContent.current = content
    setOpenFile({ path: filePath, name, content })
    setDirty(false)
    setStatus('')
    void window.api.setLastFile(filePath)
  }, [])

  const openFileByPath = useCallback(
    async (node: TreeNode) => {
      if (node.type !== 'file') return
      if (dirty) {
        const discard = window.confirm(
          `"${openFile?.name}" has unsaved changes. Discard them?`
        )
        if (!discard) return
      }
      try {
        await loadFile(node.path, node.name)
      } catch (err) {
        setStatus(`Could not open file: ${(err as Error).message}`)
      }
    },
    [dirty, openFile, loadFile]
  )

  // Restore the previous session (last folder + note) on first launch.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const session = await window.api.getLastSession()
      if (cancelled || !session) return
      setFolder({ rootPath: session.rootPath, rootName: session.rootName, tree: session.tree })
      if (session.lastFile) {
        const name = session.lastFile.split(/[\\/]/).pop() || session.lastFile
        try {
          await loadFile(session.lastFile, name)
        } catch {
          /* file vanished; ignore */
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadFile])

  const save = useCallback(async () => {
    if (!openFile) return
    try {
      await window.api.writeFile(openFile.path, latestContent.current)
      setDirty(false)
      setStatus(`Saved ${openFile.name}`)
      window.setTimeout(() => setStatus(''), 2000)
    } catch (err) {
      setStatus(`Save failed: ${(err as Error).message}`)
    }
  }, [openFile])

  // Milkdown fires this for every content change, including its own load-time
  // normalization, so it only captures content — it does not flag unsaved edits.
  const handleChange = useCallback((markdown: string) => {
    latestContent.current = markdown
  }, [])

  // Fired only on genuine user input, so this is what marks the file dirty.
  const handleUserEdit = useCallback(() => {
    setDirty(true)
  }, [])

  const createFile = useCallback(async () => {
    if (!folder) return
    const name = window.prompt('New note name:', 'Untitled')
    if (name === null) return
    const newPath = await window.api.createFile(folder.rootPath, name)
    await refreshTree()
    await loadFile(newPath, newPath.split(/[\\/]/).pop() || name)
  }, [folder, refreshTree, loadFile])

  // Global Ctrl+S to save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  return (
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
              <FileTree
                nodes={folder.tree}
                activePath={openFile?.path ?? null}
                onSelect={openFileByPath}
              />
            ) : (
              <p className="empty-hint">No markdown files in this folder.</p>
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
        {openFile ? (
          <>
            <div className="editor-titlebar">
              <span className="file-name">
                {openFile.name}
                {dirty ? ' •' : ''}
              </span>
              <span className="status">{status}</span>
            </div>
            <Editor
              key={openFile.path}
              initialValue={openFile.content}
              onChange={handleChange}
              onUserEdit={handleUserEdit}
            />
          </>
        ) : (
          <div className="editor-empty">
            <p>Select a note from the sidebar, or open a folder to get started.</p>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
