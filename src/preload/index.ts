import { contextBridge, ipcRenderer } from 'electron'

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

const api = {
  openFolder: (): Promise<FolderResult | null> => ipcRenderer.invoke('dialog:openFolder'),
  getLastSession: (): Promise<SessionResult | null> => ipcRenderer.invoke('app:getLastSession'),
  setLastFile: (filePath: string | null): Promise<boolean> =>
    ipcRenderer.invoke('app:setLastFile', filePath),
  readTree: (rootPath: string): Promise<FolderResult | null> =>
    ipcRenderer.invoke('fs:readTree', rootPath),
  readFile: (filePath: string): Promise<string> => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),
  createFile: (dirPath: string, fileName: string): Promise<string> =>
    ipcRenderer.invoke('fs:createFile', dirPath, fileName)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
