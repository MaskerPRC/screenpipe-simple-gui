const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // 数据库操作
  selectDatabase: () => ipcRenderer.invoke('select-database'),
  connectDatabase: (dbPath) => ipcRenderer.invoke('connect-database', dbPath),
  getTables: () => ipcRenderer.invoke('get-tables'),
  getTableSchema: (tableName) => ipcRenderer.invoke('get-table-schema', tableName),
  queryTable: (params) => ipcRenderer.invoke('query-table', params),
  executeQuery: (sql) => ipcRenderer.invoke('execute-query', sql),
  getRelatedData: (params) => ipcRenderer.invoke('get-related-data', params),
  // 时间线相关
  getAllFrames: () => ipcRenderer.invoke('get-all-frames'),
  readImageFile: (filePath) => ipcRenderer.invoke('read-image-file', filePath),
  readVideoFile: (filePath) => ipcRenderer.invoke('read-video-file', filePath)
})

