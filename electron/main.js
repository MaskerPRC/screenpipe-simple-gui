import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFileSync, existsSync, createReadStream, statSync } from 'fs'
import Database from 'better-sqlite3'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 开发模式下启用热重载
// 注意：electron-reloader 可能不完全支持 ES 模块
// 推荐使用 nodemon 来监听 electron 目录的变化（通过 npm run electron:dev:watch）
if (!app.isPackaged) {
  try {
    // 尝试使用 electron-reloader（如果可用）
    const reloaderModule = await import('electron-reloader')
    const reloader = reloaderModule.default || reloaderModule
    // 对于 ES 模块，传递 __dirname
    if (typeof reloader === 'function') {
      reloader(__dirname, {
        debug: true,
        watchRenderer: false, // 由 Vite HMR 处理渲染进程
        ignore: ['node_modules', 'dist', 'src']
      })
      console.log('✓ electron-reloader 热重载已启用')
    }
  } catch (err) {
    // 如果 electron-reloader 不可用，使用 nodemon（推荐）
    // nodemon 会通过 package.json 中的脚本自动重启 Electron
    console.log('ℹ 使用 nodemon 进行热重载（推荐使用 npm run electron:dev:watch）')
  }
}

let mainWindow = null
let db = null

function createWindow() {
  // 设置窗口图标路径
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'app.asar', 'build', 'icons', '512x512.png')
    : join(__dirname, '..', 'build', 'icons', '512x512.png')

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js'),
      webSecurity: false // 允许加载本地文件
    }
  })

  // 开发模式下总是使用开发服务器
  // app.isPackaged 在开发时为 false，打包后为 true
  const isDev = !app.isPackaged

  if (isDev) {
    // 开发模式：等待 Vite 服务器启动后加载
    const devUrl = 'http://localhost:5173'
    mainWindow.loadURL(devUrl).catch(() => {
      // 如果加载失败，等待一下再重试
      setTimeout(() => {
        mainWindow.loadURL(devUrl)
      }, 1000)
    })
    mainWindow.webContents.openDevTools()
  } else {
    // 生产模式：加载构建后的文件
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }
}

// 注册自定义协议来提供视频文件（支持 Range 请求）
function registerVideoProtocol() {
  protocol.registerStreamProtocol('pipeline-video', (request, callback) => {
    try {
      // 从 URL 中提取文件路径
      // pipeline-video://filepath 或 pipeline-video:///filepath
      let urlPath = request.url.replace(/^pipeline-video:\/\/+/, '')
      // 处理 Windows 路径（C:\...）
      if (urlPath.startsWith('/')) {
        urlPath = urlPath.substring(1)
      }
      const filePath = decodeURIComponent(urlPath)
      
      console.log('[protocol] 请求视频文件:', filePath)
      console.log('[protocol] 请求头:', JSON.stringify(request.headers, null, 2))
      console.log('[protocol] 请求方法:', request.method)
      console.log('[protocol] 完整 URL:', request.url)
      
      if (!existsSync(filePath)) {
        console.error('[protocol] 文件不存在:', filePath)
        callback({ statusCode: 404 })
        return
      }

      const stats = statSync(filePath)
      const fileSize = stats.size
      console.log('[protocol] 文件大小:', fileSize, 'bytes')
      console.log('[protocol] 文件是否可读:', stats.mode)
      console.log('[protocol] 文件修改时间:', stats.mtime)
      
      // 检查文件大小
      if (fileSize === 0) {
        console.error('[protocol] 文件大小为 0，可能是空文件或损坏')
        callback({ statusCode: 416, statusMessage: 'File is empty' }) // Range Not Satisfiable
        return
      }
      
      // 处理 Range 请求（视频元素需要这个来支持跳转）
      const rangeHeader = request.headers.Range || request.headers.range
      if (rangeHeader) {
        console.log('[protocol] 收到 Range 请求:', rangeHeader)
        // 解析 Range 头：bytes=start-end
        const matches = rangeHeader.match(/bytes=(\d+)-(\d*)/)
        if (matches) {
          const start = parseInt(matches[1], 10)
          const end = matches[2] ? parseInt(matches[2], 10) : fileSize - 1
          const chunkSize = end - start + 1
          
          console.log('[protocol] Range 解析: start=', start, 'end=', end, 'chunkSize=', chunkSize)
          
          // 验证 Range 有效性
          if (start < 0 || end < 0 || start >= fileSize || end >= fileSize || start > end || chunkSize <= 0) {
            console.error('[protocol] Range 无效: start=', start, 'end=', end, 'fileSize=', fileSize, 'chunkSize=', chunkSize)
            callback({ 
              statusCode: 416, 
              statusMessage: `Range Not Satisfiable: bytes ${start}-${end}/${fileSize}` 
            })
            return
          }
          
          const stream = createReadStream(filePath, { start, end })
          
          callback({
            statusCode: 206, // Partial Content
            headers: {
              'Content-Type': 'video/mp4',
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': chunkSize.toString()
            },
            data: stream
          })
          console.log('[protocol] 返回 Range 响应: 206 Partial Content')
          return
        } else {
          console.warn('[protocol] Range 头格式无效:', rangeHeader)
        }
      }
      
      // 没有 Range 请求，返回整个文件
      console.log('[protocol] 返回整个文件, size:', fileSize)
      const stream = createReadStream(filePath)
      callback({
        statusCode: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': fileSize.toString(),
          'Accept-Ranges': 'bytes'
        },
        data: stream
      })
      console.log('[protocol] 返回完整文件响应: 200 OK')
    } catch (error) {
      console.error('[protocol] 发生错误:', error)
      console.error('[protocol] 错误堆栈:', error.stack)
      callback({ statusCode: 500 })
    }
  })
}

app.whenReady().then(() => {
  // 注册自定义协议（必须在 app.whenReady() 之后）
  registerVideoProtocol()
  
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 选择数据库文件
ipcMain.handle('select-database', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'SQLite数据库', extensions: ['sqlite', 'db', 'sqlite3'] }
    ]
  })

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

// 连接数据库
ipcMain.handle('connect-database', async (event, dbPath) => {
  try {
    if (db) {
      db.close()
    }
    db = new Database(dbPath, { readonly: true })
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 验证表名安全性（防止SQL注入）
function validateTableName(tableName) {
  // 只允许字母、数字、下划线
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)
}

// 获取所有表
ipcMain.handle('get-tables', async () => {
  if (!db) {
    return { success: false, error: '数据库未连接' }
  }

  try {
    const tables = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'
      ORDER BY name
    `).all()

    // 获取每个表的记录数
    const tablesWithCount = tables.map(table => {
      if (!validateTableName(table.name)) {
        return { name: table.name, count: 0 }
      }
      try {
        const count = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get()
        return {
          name: table.name,
          count: count.count
        }
      } catch (e) {
        return {
          name: table.name,
          count: 0
        }
      }
    })

    return { success: true, data: tablesWithCount }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 获取表结构
ipcMain.handle('get-table-schema', async (event, tableName) => {
  if (!db) {
    return { success: false, error: '数据库未连接' }
  }

  if (!validateTableName(tableName)) {
    return { success: false, error: '无效的表名' }
  }

  try {
    const schema = db.prepare(`PRAGMA table_info(${tableName})`).all()
    return { success: true, data: schema }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 查询表数据
ipcMain.handle('query-table', async (event, { tableName, limit = 100, offset = 0, where = '', orderBy = '' }) => {
  if (!db) {
    return { success: false, error: '数据库未连接' }
  }

  if (!validateTableName(tableName)) {
    return { success: false, error: '无效的表名' }
  }

  try {
    let query = `SELECT * FROM ${tableName}`
    const params = []

    if (where) {
      query += ` WHERE ${where}`
    }

    if (orderBy) {
      // 验证 orderBy 中的列名
      const orderByMatch = orderBy.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+(ASC|DESC)$/i)
      if (orderByMatch) {
        query += ` ORDER BY ${orderByMatch[1]} ${orderByMatch[2]}`
      }
    } else {
      // 默认按主键或id排序
      const schema = db.prepare(`PRAGMA table_info(${tableName})`).all()
      const pkColumn = schema.find(col => col.pk === 1) || schema.find(col => col.name === 'id')
      if (pkColumn) {
        query += ` ORDER BY ${pkColumn.name} DESC`
      }
    }

    query += ` LIMIT ? OFFSET ?`
    params.push(limit, offset)

    const data = db.prepare(query).all(...params)
    const totalResult = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}${where ? ` WHERE ${where}` : ''}`).get()
    const total = totalResult.count

    return { success: true, data, total }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 执行自定义SQL查询
ipcMain.handle('execute-query', async (event, sql) => {
  if (!db) {
    return { success: false, error: '数据库未连接' }
  }

  try {
    // 安全检查：只允许SELECT查询
    const trimmedSql = sql.trim().toUpperCase()
    if (!trimmedSql.startsWith('SELECT')) {
      return { success: false, error: '只允许执行SELECT查询' }
    }

    const result = db.prepare(sql).all()
    return { success: true, data: result }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 获取关联数据
ipcMain.handle('get-related-data', async (event, { tableName, foreignKey, foreignValue }) => {
  if (!db) {
    return { success: false, error: '数据库未连接' }
  }

  if (!validateTableName(tableName) || !validateTableName(foreignKey)) {
    return { success: false, error: '无效的表名或列名' }
  }

  try {
    const query = `SELECT * FROM ${tableName} WHERE ${foreignKey} = ? LIMIT 100`
    const data = db.prepare(query).all(foreignValue)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 获取所有 frames 数据（用于时间线）
ipcMain.handle('get-all-frames', async () => {
  if (!db) {
    return { success: false, error: '数据库未连接' }
  }

  try {
    const data = db.prepare(`
      SELECT * FROM frames 
      ORDER BY timestamp ASC
    `).all()
    return { success: true, data }
  } catch (error) {
    return { success: false, error: error.message }
  }
})


// 读取视频文件 - 现在只返回成功状态，实际使用自定义协议访问
ipcMain.handle('read-video-file', async (event, filePath) => {
  try {
    if (!existsSync(filePath)) {
      console.log('[read-video-file] 文件不存在:', filePath)
      return { success: false, error: '视频文件不存在' }
    }

    // 检查文件大小
    const stats = statSync(filePath)
    console.log('[read-video-file] 文件路径:', filePath)
    console.log('[read-video-file] 文件大小:', stats.size, 'bytes')
    console.log('[read-video-file] 文件修改时间:', stats.mtime)
    
    if (stats.size === 0) {
      console.warn('[read-video-file] 文件大小为 0，可能是空文件或损坏')
      return { success: false, error: '视频文件为空或损坏（文件大小为 0）' }
    }

    // 不再读取整个文件，只返回成功状态
    // 前端会使用 pipeline-video:// 协议直接访问文件
    return {
      success: true,
      data: {
        filePath: filePath,
        fileSize: stats.size
      }
    }
  } catch (error) {
    console.error('[read-video-file] 发生错误:', error)
    return { success: false, error: error.message }
  }
})

// 读取图片文件并转换为 base64（保留用于直接读取图片文件的情况）
ipcMain.handle('read-image-file', async (event, filePath) => {
  try {
    if (!existsSync(filePath)) {
      return { success: false, error: '文件不存在' }
    }

    // 读取图片文件
    const imageBuffer = readFileSync(filePath)
    const base64 = imageBuffer.toString('base64')
    const ext = filePath.split('.').pop().toLowerCase()
    const mimeType = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'

    return {
      success: true,
      data: `data:${mimeType};base64,${base64}`
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

