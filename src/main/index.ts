import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import * as path from 'path'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx'])

// ---- Small persisted config (last opened folder + note) ----
interface AppConfig {
  lastFolder?: string
  lastFile?: string
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
      const children = await readDirTree(fullPath)
      // Keep a folder only if it contains markdown somewhere inside it.
      if (children.length > 0) {
        folders.push({ name: entry.name, path: fullPath, type: 'folder', children })
      }
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

function registerIpc(): void {
  // Let the user pick a vault/root folder.
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const rootPath = result.filePaths[0]
    const tree = await readDirTree(rootPath)
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

  // Re-read a folder's tree (for refresh after edits/new files).
  ipcMain.handle('fs:readTree', async (_e, rootPath: string) => {
    if (typeof rootPath !== 'string' || rootPath.length === 0) return null
    const tree = await readDirTree(rootPath)
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

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
