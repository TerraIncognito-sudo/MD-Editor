import { contextBridge, ipcRenderer, webFrame, type IpcRendererEvent } from 'electron'

export interface TreeNode {
  name: string
  path: string
  type: 'folder' | 'file'
  children?: TreeNode[]
}

export interface FolderResult {
  rootPath: string
  rootName: string
  tree: TreeNode[]
}

export interface SessionResult extends FolderResult {
  lastFile: string | null
}

export interface Settings {
  theme: 'light' | 'dark'
  zoom: number
  sidebarWidth: number
  viewMode: 'page' | 'wide'
}

const api = {
  openFolder: (): Promise<FolderResult | null> => ipcRenderer.invoke('dialog:openFolder'),
  getLastSession: (): Promise<SessionResult | null> => ipcRenderer.invoke('app:getLastSession'),
  setLastFile: (filePath: string | null): Promise<boolean> =>
    ipcRenderer.invoke('app:setLastFile', filePath),
  setLastFolder: (rootPath: string): Promise<boolean> =>
    ipcRenderer.invoke('app:setLastFolder', rootPath),
  // A file the app was launched with from Explorer, if any. Returns it once.
  takePendingFile: (): Promise<string | null> => ipcRenderer.invoke('app:takePendingFile'),
  // Explorer asked the already-running app to open a file.
  onOpenFile: (callback: (filePath: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, filePath: string): void => callback(filePath)
    ipcRenderer.on('file:open', listener)
    return () => ipcRenderer.removeListener('file:open', listener)
  },
  // The open folder changed on disk (files added, renamed or removed elsewhere).
  onFolderChanged: (callback: (folder: FolderResult) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, folder: FolderResult): void => callback(folder)
    ipcRenderer.on('folder:changed', listener)
    return () => ipcRenderer.removeListener('folder:changed', listener)
  },
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('app:getSettings'),
  setTheme: (theme: 'light' | 'dark'): Promise<boolean> =>
    ipcRenderer.invoke('app:setTheme', theme),
  setZoom: (zoom: number): Promise<boolean> => ipcRenderer.invoke('app:setZoom', zoom),
  setSidebarWidth: (width: number): Promise<boolean> =>
    ipcRenderer.invoke('app:setSidebarWidth', width),
  setViewMode: (mode: 'page' | 'wide'): Promise<boolean> =>
    ipcRenderer.invoke('app:setViewMode', mode),
  // Applies the zoom to the renderer frame immediately (does not persist).
  applyZoom: (factor: number): void => webFrame.setZoomFactor(factor),
  readTree: (rootPath: string): Promise<FolderResult | null> =>
    ipcRenderer.invoke('fs:readTree', rootPath),
  readFile: (filePath: string): Promise<string> => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),
  createFile: (dirPath: string, fileName: string): Promise<string> =>
    ipcRenderer.invoke('fs:createFile', dirPath, fileName),
  createFolder: (dirPath: string, folderName: string): Promise<string> =>
    ipcRenderer.invoke('fs:createFolder', dirPath, folderName),
  rename: (oldPath: string, newName: string): Promise<string> =>
    ipcRenderer.invoke('fs:rename', oldPath, newName),
  trash: (targetPath: string): Promise<boolean> => ipcRenderer.invoke('fs:trash', targetPath)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
