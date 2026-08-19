import { app, shell, BrowserWindow, ipcMain, dialog, Menu, MenuItem, session } from 'electron'
import { join } from 'path'
import { promises as fs, statSync, watch, type FSWatcher } from 'fs'
import * as path from 'path'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx'])

// ---- Small persisted config (last opened folder + note) ----
interface AppConfig {
  lastFolder?: string
  lastFile?: string
  theme?: 'light' | 'dark'
  zoom?: number
  sidebarWidth?: number
  viewMode?: 'page' | 'wide'
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

async function readConfig(): Promise<AppConfig> {
  try {
    const raw = await fs.readFile(configPath(), 'utf-8')
    return JSON.parse(raw) as AppConfig
  } catch {
    return {}
  }
}

async function writeConfig(patch: Partial<AppConfig>): Promise<void> {
  const current = await readConfig()
  const next = { ...current, ...patch }
  try {
    await fs.writeFile(configPath(), JSON.stringify(next, null, 2), 'utf-8')
  } catch {
    // Non-fatal: config persistence is best-effort.
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'MD Editor',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Open external links in the OS browser, never inside the app window.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Right-click menu: spelling suggestions for misspelled words + edit actions.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu()

    for (const suggestion of params.dictionarySuggestions) {
      menu.append(
        new MenuItem({
          label: suggestion,
          click: () => mainWindow.webContents.replaceMisspelling(suggestion)
        })
      )
    }

    if (params.misspelledWord) {
      if (params.dictionarySuggestions.length === 0) {
        menu.append(new MenuItem({ label: 'No spelling suggestions', enabled: false }))
      }
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(
        new MenuItem({
          label: 'Add to dictionary',
          click: () =>
            mainWindow.webContents.session.addWordToSpellCheckerDictionary(
              params.misspelledWord
            )
        })
      )
      menu.append(new MenuItem({ type: 'separator' }))
    }

    const { editFlags } = params
    if (params.isEditable || params.selectionText) {
      menu.append(new MenuItem({ role: 'cut', enabled: editFlags.canCut }))
      menu.append(new MenuItem({ role: 'copy', enabled: editFlags.canCopy }))
      menu.append(new MenuItem({ role: 'paste', enabled: editFlags.canPaste }))
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({ role: 'selectAll' }))
    }

    if (menu.items.length > 0) {
      menu.popup({ window: mainWindow })
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Recursively reads a directory into a tree of folders and markdown files.
 * Non-markdown files are omitted. Hidden entries (dotfiles) are skipped.
 */
interface TreeNode {
  name: string
  path: string
  type: 'folder' | 'file'
  children?: TreeNode[]
}

async function readDirTree(dirPath: string): Promise<TreeNode[]> {
  let entries
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }

  const folders: TreeNode[] = []
  const files: TreeNode[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = path.join(dirPath, entry.name)

    if (entry.isDirectory()) {
      // Show every folder so the whole directory structure is browsable, even
      // subfolders that contain no markdown files.
      const children = await readDirTree(fullPath)
      folders.push({ name: entry.name, path: fullPath, type: 'folder', children })
    } else if (entry.isFile()) {
      if (MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push({ name: entry.name, path: fullPath, type: 'file' })
      }
    }
  }

  const byName = (a: TreeNode, b: TreeNode): number =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  folders.sort(byName)
  files.sort(byName)
  return [...folders, ...files]
}

// ---- Watching the open folder ----
// The sidebar mirrors a folder on disk, so changes made outside the app (in
// Explorer, by a sync client, by another editor) have to reach the renderer.
// One recursive watcher follows whichever root is open; its events are
// debounced because a single save can emit several in a row.

let folderWatcher: FSWatcher | null = null
let watchedRoot: string | null = null
let watchTimer: NodeJS.Timeout | null = null
// The last tree handed to the renderer, serialized. Rewriting a file's contents
// leaves the listing identical, so comparing against this avoids pointless
// updates on every save.
let lastTreeJson = ''

function sendToWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

async function pushTree(rootPath: string): Promise<void> {
  if (rootPath !== watchedRoot) return
  const tree = await readDirTree(rootPath)
  const json = JSON.stringify(tree)
  if (json === lastTreeJson) return
  lastTreeJson = json
  sendToWindows('folder:changed', { rootPath, rootName: path.basename(rootPath), tree })
}

function stopWatchingFolder(): void {
  if (watchTimer) {
    clearTimeout(watchTimer)
    watchTimer = null
  }
  folderWatcher?.close()
  folderWatcher = null
  watchedRoot = null
}

/** Watches `rootPath` for changes, treating `tree` as what the renderer shows. */
function watchFolder(rootPath: string, tree: TreeNode[]): void {
  lastTreeJson = JSON.stringify(tree)
  if (watchedRoot === rootPath && folderWatcher) return
  stopWatchingFolder()
  watchedRoot = rootPath
  try {
    folderWatcher = watch(rootPath, { recursive: true }, () => {
      if (watchTimer) clearTimeout(watchTimer)
      watchTimer = setTimeout(() => {
        watchTimer = null
        void pushTree(rootPath)
      }, 250)
    })
    // A watcher can fail on its own (folder deleted, drive unplugged). Drop it
    // instead of crashing; the window still re-reads the tree when refocused.
    folderWatcher.on('error', () => stopWatchingFolder())
  } catch {
    // Unwatchable location (some network paths). Refresh-on-focus still covers it.
    folderWatcher = null
  }
}

// ---- Files opened from Explorer (double-click, "Open with") ----
// Windows passes the file path in argv. On a cold start that is this process's
// own argv; when the app is already running, the single-instance lock forwards
// the new process's argv to the running copy instead of launching a second one.

function markdownPathFromArgv(argv: string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue
    if (!MARKDOWN_EXTENSIONS.has(path.extname(arg).toLowerCase())) continue
    try {
      const resolved = path.resolve(arg)
      if (statSync(resolved).isFile()) return resolved
    } catch {
      // Not a real file (or unreadable) — keep looking at the other arguments.
    }
  }
  return null
}

// A file the app was launched with, held until the UI is ready to receive it.
let pendingOpenFile: string | null = null

function registerIpc(): void {
  // Let the user pick a vault/root folder.
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const rootPath = result.filePaths[0]
    const tree = await readDirTree(rootPath)
    watchFolder(rootPath, tree)
    await writeConfig({ lastFolder: rootPath })
    return { rootPath, rootName: path.basename(rootPath), tree }
  })

  // Return the last-opened folder + note so the app can restore the session.
  ipcMain.handle('app:getLastSession', async () => {
    const cfg = await readConfig()
    if (!cfg.lastFolder) return null
    // Verify the folder still exists before offering to restore it.
    try {
      await fs.access(cfg.lastFolder)
    } catch {
      return null
    }
    const tree = await readDirTree(cfg.lastFolder)
    watchFolder(cfg.lastFolder, tree)
    let lastFile: string | null = null
    if (cfg.lastFile) {
      try {
        await fs.access(cfg.lastFile)
        lastFile = cfg.lastFile
      } catch {
        lastFile = null
      }
    }
    return {
      rootPath: cfg.lastFolder,
      rootName: path.basename(cfg.lastFolder),
      tree,
      lastFile
    }
  })

  // Remember which note is open, so it can be reopened next launch.
  ipcMain.handle('app:setLastFile', async (_e, filePath: string | null) => {
    await writeConfig({ lastFile: filePath ?? undefined })
    return true
  })

  // Hand over a file the app was launched with, exactly once.
  ipcMain.handle('app:takePendingFile', async () => {
    const file = pendingOpenFile
    pendingOpenFile = null
    return file
  })

  // Remember which folder the sidebar is showing. Used when a file opened from
  // Explorer adopts its own folder as the root, so the next launch restores it.
  ipcMain.handle('app:setLastFolder', async (_e, rootPath: string) => {
    if (typeof rootPath === 'string' && rootPath.length > 0) {
      await writeConfig({ lastFolder: rootPath })
    }
    return true
  })

  // UI preferences (theme, zoom, sidebar width, view mode), loaded on launch
  // and persisted on change.
  ipcMain.handle('app:getSettings', async () => {
    const cfg = await readConfig()
    return {
      theme: cfg.theme === 'light' ? 'light' : 'dark',
      zoom: typeof cfg.zoom === 'number' ? cfg.zoom : 1,
      sidebarWidth: typeof cfg.sidebarWidth === 'number' ? cfg.sidebarWidth : 260,
      viewMode: cfg.viewMode === 'wide' ? 'wide' : 'page'
    }
  })

  ipcMain.handle('app:setTheme', async (_e, theme: 'light' | 'dark') => {
    await writeConfig({ theme: theme === 'light' ? 'light' : 'dark' })
    return true
  })

  ipcMain.handle('app:setZoom', async (_e, zoom: number) => {
    if (typeof zoom === 'number' && Number.isFinite(zoom)) {
      await writeConfig({ zoom })
    }
    return true
  })

  ipcMain.handle('app:setSidebarWidth', async (_e, width: number) => {
    if (typeof width === 'number' && Number.isFinite(width)) {
      await writeConfig({ sidebarWidth: Math.round(width) })
    }
    return true
  })

  ipcMain.handle('app:setViewMode', async (_e, mode: 'page' | 'wide') => {
    await writeConfig({ viewMode: mode === 'wide' ? 'wide' : 'page' })
    return true
  })

  // Re-read a folder's tree (for refresh after edits/new files).
  ipcMain.handle('fs:readTree', async (_e, rootPath: string) => {
    if (typeof rootPath !== 'string' || rootPath.length === 0) return null
    const tree = await readDirTree(rootPath)
    watchFolder(rootPath, tree)
    return { rootPath, rootName: path.basename(rootPath), tree }
  })

  // Read a markdown file's contents.
  ipcMain.handle('fs:readFile', async (_e, filePath: string) => {
    if (typeof filePath !== 'string') throw new Error('Invalid file path')
    if (!MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
      throw new Error('Not a markdown file')
    }
    return await fs.readFile(filePath, 'utf-8')
  })

  // Write a markdown file's contents.
  ipcMain.handle('fs:writeFile', async (_e, filePath: string, content: string) => {
    if (typeof filePath !== 'string') throw new Error('Invalid file path')
    if (typeof content !== 'string') throw new Error('Invalid content')
    await fs.writeFile(filePath, content, 'utf-8')
    return true
  })

  // Create a new subfolder inside a folder (collision-safe).
  ipcMain.handle('fs:createFolder', async (_e, dirPath: string, folderName: string) => {
    if (typeof dirPath !== 'string' || typeof folderName !== 'string') {
      throw new Error('Invalid arguments')
    }
    let name = folderName.trim().replace(/[\\/]/g, '')
    if (name.length === 0) name = 'New Folder'
    let target = path.join(dirPath, name)
    let counter = 1
    while (true) {
      try {
        await fs.access(target)
        target = path.join(dirPath, `${name} ${counter}`)
        counter += 1
      } catch {
        break
      }
    }
    await fs.mkdir(target)
    return target
  })

  // Rename a file or folder within its parent directory.
  ipcMain.handle('fs:rename', async (_e, oldPath: string, newName: string) => {
    if (typeof oldPath !== 'string' || typeof newName !== 'string') {
      throw new Error('Invalid arguments')
    }
    let name = newName.trim()
    if (name.length === 0) throw new Error('Name cannot be empty')
    if (/[\\/]/.test(name)) throw new Error('Name cannot contain path separators')

    const stat = await fs.stat(oldPath)
    // Preserve a markdown extension on files if the user didn't type one.
    if (stat.isFile() && !MARKDOWN_EXTENSIONS.has(path.extname(name).toLowerCase())) {
      name = `${name}.md`
    }
    const target = path.join(path.dirname(oldPath), name)
    if (path.normalize(target) === path.normalize(oldPath)) return oldPath

    let exists = true
    try {
      await fs.access(target)
    } catch {
      exists = false
    }
    if (exists) throw new Error('An item with that name already exists')

    await fs.rename(oldPath, target)
    return target
  })

  // Move a file or folder to the OS trash (recoverable, not a hard delete).
  ipcMain.handle('fs:trash', async (_e, targetPath: string) => {
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
      throw new Error('Invalid path')
    }
    await shell.trashItem(targetPath)
    return true
  })

  // Create a new markdown file inside a folder.
  ipcMain.handle('fs:createFile', async (_e, dirPath: string, fileName: string) => {
    if (typeof dirPath !== 'string' || typeof fileName !== 'string') {
      throw new Error('Invalid arguments')
    }
    let name = fileName.trim()
    if (name.length === 0) name = 'Untitled'
    if (!MARKDOWN_EXTENSIONS.has(path.extname(name).toLowerCase())) {
      name = `${name}.md`
    }
    let target = path.join(dirPath, name)
    // Avoid clobbering an existing file: append a counter.
    let counter = 1
    const base = name.replace(/\.md$/i, '')
    while (true) {
      try {
        await fs.access(target)
        target = path.join(dirPath, `${base} ${counter}.md`)
        counter += 1
      } catch {
        break
      }
    }
    await fs.writeFile(target, '', 'utf-8')
    return target
  })
}

// A second copy of the app would fight over the same files and lose the point of
// "open this note in the editor I already have running", so only one runs.
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  // Explorer launched a second copy: take the file it was given and hand it to
  // the window that is already open.
  app.on('second-instance', (_event, argv) => {
    const file = markdownPathFromArgv(argv)
    const [win] = BrowserWindow.getAllWindows()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
    if (file) win.webContents.send('file:open', file)
  })

  pendingOpenFile = markdownPathFromArgv(process.argv)

  app.whenReady().then(() => {
    // Enable English spellchecking (ignored on platforms that use the OS checker).
    try {
      session.defaultSession.setSpellCheckerLanguages(['en-US'])
    } catch {
      // Some platforms manage languages via the OS; safe to ignore.
    }
    registerIpc()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  stopWatchingFolder()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
