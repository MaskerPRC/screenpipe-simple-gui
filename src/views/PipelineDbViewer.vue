<template>
  <div class="db-viewer">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <button @click="selectDatabase" class="btn btn-primary">
          <span>📂</span> 选择数据库
        </button>
        <span v-if="currentDbPath" class="db-path">{{ currentDbPath }}</span>
      </div>
      <div class="toolbar-right">
        <input 
          v-model="searchQuery" 
          @input="handleSearch"
          type="text" 
          placeholder="搜索表或数据..." 
          class="search-input"
        />
      </div>
    </div>

    <div class="main-content">
      <!-- 左侧表列表 -->
      <div class="sidebar">
        <h3>数据表 ({{ filteredTables.length }})</h3>
        <div class="table-list">
          <div 
            v-for="table in filteredTables" 
            :key="table.name"
            @click="selectTable(table.name)"
            :class="['table-item', { active: selectedTable === table.name }]"
          >
            <span class="table-name">{{ table.name }}</span>
            <span class="table-count">{{ table.count }}</span>
          </div>
        </div>
      </div>

      <!-- 中间数据表格 -->
      <div class="content-area">
        <div v-if="!selectedTable" class="empty-state">
          <p>请从左侧选择一个数据表</p>
        </div>
        
        <div v-else class="table-view">
          <!-- 表信息头部 -->
          <div class="table-header">
            <h2>{{ selectedTable }}</h2>
            <div class="table-actions">
              <button 
                v-if="selectedTable === 'frames'" 
                @click="viewMode = viewMode === 'table' ? 'timeline' : viewMode === 'timeline' ? 'preview' : 'table'" 
                class="btn btn-sm"
              >
                {{ viewMode === 'table' ? '📅 时间线视图' : viewMode === 'timeline' ? '🖼️ 预览视图' : '📊 表格视图' }}
              </button>
              <button @click="refreshData" class="btn btn-sm">🔄 刷新</button>
              <button @click="showSchema = !showSchema" class="btn btn-sm">
                {{ showSchema ? '隐藏' : '显示' }}表结构
              </button>
            </div>
          </div>

          <!-- 表结构 -->
          <div v-if="showSchema && tableSchema.length > 0" class="schema-panel">
            <h4>表结构</h4>
            <table class="schema-table">
              <thead>
                <tr>
                  <th>列名</th>
                  <th>类型</th>
                  <th>非空</th>
                  <th>主键</th>
                  <th>默认值</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="col in tableSchema" :key="col.cid">
                  <td><strong>{{ col.name }}</strong></td>
                  <td>{{ col.type }}</td>
                  <td>{{ col.notnull ? '是' : '否' }}</td>
                  <td>{{ col.pk ? '✓' : '' }}</td>
                  <td>{{ col.dflt_value || '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 预览视图 -->
          <div v-if="viewMode === 'preview' && selectedTable === 'frames'" class="preview-container">
            <TimelinePreview 
              :frames="allFrames" 
              @frame-change="handleFrameChange"
            />
          </div>

          <!-- 时间线视图 -->
          <div v-else-if="viewMode === 'timeline' && selectedTable === 'frames'" class="timeline-container">
            <div v-if="loading" class="loading">加载中...</div>
            <div v-else-if="error" class="error">{{ error }}</div>
            <div v-else class="timeline">
              <div 
                v-for="(item, index) in timelineData" 
                :key="item.id || index"
                @click="viewDetails(item)"
                class="timeline-item"
              >
                <div class="timeline-marker"></div>
                <div class="timeline-content">
                  <div class="timeline-header">
                    <span class="timeline-time">{{ formatTimestamp(item.timestamp) }}</span>
                    <span v-if="item.app_name" class="timeline-app">{{ item.app_name }}</span>
                    <span v-if="item.focused" class="timeline-badge focused">聚焦</span>
                  </div>
                  <div v-if="item.window_name" class="timeline-window">{{ item.window_name }}</div>
                  <div v-if="item.browser_url" class="timeline-url">{{ item.browser_url }}</div>
                  <div v-if="item.name" class="timeline-file">{{ truncateText(item.name, 80) }}</div>
                </div>
              </div>
              
              <!-- 时间线分页 -->
              <div class="pagination">
                <button 
                  @click="changePage(currentPage - 1)" 
                  :disabled="currentPage === 1"
                  class="btn btn-sm"
                >
                  上一页
                </button>
                <span class="page-info">
                  第 {{ currentPage }} / {{ totalPages }} 页 (共 {{ totalRecords }} 条)
                </span>
                <button 
                  @click="changePage(currentPage + 1)" 
                  :disabled="currentPage === totalPages"
                  class="btn btn-sm"
                >
                  下一页
                </button>
                <select v-model="pageSize" @change="changePageSize" class="page-size-select">
                  <option :value="50">50 条/页</option>
                  <option :value="100">100 条/页</option>
                  <option :value="200">200 条/页</option>
                  <option :value="500">500 条/页</option>
                </select>
              </div>
            </div>
          </div>

          <!-- 数据表格 -->
          <div v-else class="data-table-container">
            <div v-if="loading" class="loading">加载中...</div>
            <div v-else-if="error" class="error">{{ error }}</div>
            <div v-else>
              <table class="data-table">
                <thead>
                  <tr>
                    <th 
                      v-for="column in columns" 
                      :key="column"
                      @click="sortBy(column)"
                      :class="{ sortable: true, sorted: sortColumn === column }"
                    >
                      {{ column }}
                      <span v-if="sortColumn === column" class="sort-indicator">
                        {{ sortOrder === 'ASC' ? '↑' : '↓' }}
                      </span>
                    </th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, index) in tableData" :key="index">
                    <td v-for="column in columns" :key="column">
                      <span v-if="isBlob(row[column])" class="blob-indicator">
                        [BLOB: {{ getBlobSize(row[column]) }}]
                      </span>
                      <span v-else-if="isLongText(row[column])" class="long-text">
                        {{ truncateText(row[column], 100) }}
                      </span>
                      <span v-else>{{ formatValue(row[column]) }}</span>
                    </td>
                    <td>
                      <button @click="viewDetails(row)" class="btn-link">详情</button>
                    </td>
                  </tr>
                </tbody>
              </table>

              <!-- 分页 -->
              <div class="pagination">
                <button 
                  @click="changePage(currentPage - 1)" 
                  :disabled="currentPage === 1"
                  class="btn btn-sm"
                >
                  上一页
                </button>
                <span class="page-info">
                  第 {{ currentPage }} / {{ totalPages }} 页 (共 {{ totalRecords }} 条)
                </span>
                <button 
                  @click="changePage(currentPage + 1)" 
                  :disabled="currentPage === totalPages"
                  class="btn btn-sm"
                >
                  下一页
                </button>
                <select v-model="pageSize" @change="changePageSize" class="page-size-select">
                  <option :value="50">50 条/页</option>
                  <option :value="100">100 条/页</option>
                  <option :value="200">200 条/页</option>
                  <option :value="500">500 条/页</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧详情面板 -->
      <div v-if="selectedRow" class="detail-panel">
        <div class="detail-header">
          <h3>详细信息</h3>
          <button @click="selectedRow = null" class="btn-close">×</button>
        </div>
        <div class="detail-content">
          <div v-for="(value, key) in selectedRow" :key="key" class="detail-item">
            <div class="detail-label">{{ key }}</div>
            <div class="detail-value">
              <pre v-if="isJson(value)">{{ formatJson(value) }}</pre>
              <span v-else-if="isBlob(value)">[BLOB: {{ getBlobSize(value) }}]</span>
              <span v-else>{{ formatValue(value) }}</span>
            </div>
          </div>
          
          <!-- 关联数据 -->
          <div v-if="hasRelatedData" class="related-data">
            <h4>关联数据</h4>
            <div v-for="(related, key) in relatedData" :key="key" class="related-section">
              <h5>{{ key }}</h5>
              <div v-if="related.length === 0" class="no-data">无关联数据</div>
              <table v-else class="related-table">
                <thead>
                  <tr>
                    <th v-for="col in getRelatedColumns(related[0])" :key="col">{{ col }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(item, idx) in related" :key="idx">
                    <td v-for="col in getRelatedColumns(item)" :key="col">
                      {{ truncateText(item[col], 50) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import TimelinePreview from '../components/TimelinePreview.vue'

const currentDbPath = ref('')
const tables = ref([])
const selectedTable = ref('')
const tableSchema = ref([])
const tableData = ref([])
const columns = ref([])
const loading = ref(false)
const error = ref('')
const searchQuery = ref('')
const showSchema = ref(false)
const selectedRow = ref(null)
const relatedData = ref({})
const viewMode = ref('table') // 'table'、'timeline' 或 'preview'
const allFrames = ref([]) // 所有 frames 数据，用于预览视图

// 分页
const currentPage = ref(1)
const pageSize = ref(100)
const totalRecords = ref(0)
const sortColumn = ref('')
const sortOrder = ref('DESC')

const filteredTables = computed(() => {
  if (!searchQuery.value) return tables.value
  const query = searchQuery.value.toLowerCase()
  return tables.value.filter(table => 
    table.name.toLowerCase().includes(query)
  )
})

const totalPages = computed(() => {
  return Math.ceil(totalRecords.value / pageSize.value)
})

const hasRelatedData = computed(() => {
  return Object.keys(relatedData.value).length > 0
})

const timelineData = computed(() => {
  if (viewMode.value === 'timeline' && selectedTable.value === 'frames') {
    return tableData.value
  }
  return []
})

// 选择数据库
async function selectDatabase() {
  try {
    const dbPath = await window.electronAPI.selectDatabase()
    if (dbPath) {
      const result = await window.electronAPI.connectDatabase(dbPath)
      if (result.success) {
        currentDbPath.value = dbPath
        await loadTables()
      } else {
        alert('连接数据库失败: ' + result.error)
      }
    }
  } catch (err) {
    console.error('选择数据库失败:', err)
    alert('选择数据库失败: ' + err.message)
  }
}

// 加载表列表
async function loadTables() {
  try {
    const result = await window.electronAPI.getTables()
    if (result.success) {
      tables.value = result.data
    } else {
      error.value = result.error
    }
  } catch (err) {
    error.value = err.message
  }
}

// 选择表
async function selectTable(tableName) {
  selectedTable.value = tableName
  selectedRow.value = null
  relatedData.value = {}
  showSchema.value = false
  currentPage.value = 1
  // 如果是 frames 表，加载所有数据用于预览视图
  if (tableName === 'frames') {
    await loadAllFrames()
    viewMode.value = 'preview' // 默认使用预览视图
    // 时间线视图按时间倒序排列
    sortColumn.value = 'timestamp'
    sortOrder.value = 'DESC'
  } else {
    viewMode.value = 'table'
    sortColumn.value = ''
    sortOrder.value = 'DESC'
  }
  await loadTableSchema(tableName)
  await loadTableData()
}

// 加载所有 frames 数据
async function loadAllFrames() {
  try {
    const result = await window.electronAPI.getAllFrames()
    if (result.success) {
      allFrames.value = result.data
    }
  } catch (err) {
    console.error('加载所有 frames 失败:', err)
  }
}

// 处理帧变化
function handleFrameChange(frame) {
  // 可以在这里处理帧变化事件
  console.log('当前帧:', frame)
}

// 加载表结构
async function loadTableSchema(tableName) {
  try {
    const result = await window.electronAPI.getTableSchema(tableName)
    if (result.success) {
      tableSchema.value = result.data
      // 提取列名
      columns.value = result.data.map(col => col.name)
    }
  } catch (err) {
    console.error('加载表结构失败:', err)
  }
}

// 加载表数据
async function loadTableData() {
  if (!selectedTable.value) return
  
  loading.value = true
  error.value = ''
  
  try {
    const offset = (currentPage.value - 1) * pageSize.value
    const orderBy = sortColumn.value 
      ? `${sortColumn.value} ${sortOrder.value}` 
      : ''
    
    const result = await window.electronAPI.queryTable({
      tableName: selectedTable.value,
      limit: pageSize.value,
      offset: offset,
      orderBy: orderBy
    })
    
    if (result.success) {
      tableData.value = result.data
      totalRecords.value = result.total
    } else {
      error.value = result.error
    }
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

// 刷新数据
function refreshData() {
  loadTableData()
}

// 排序
function sortBy(column) {
  if (sortColumn.value === column) {
    sortOrder.value = sortOrder.value === 'ASC' ? 'DESC' : 'ASC'
  } else {
    sortColumn.value = column
    sortOrder.value = 'DESC'
  }
  loadTableData()
}

// 改变页码
function changePage(page) {
  if (page >= 1 && page <= totalPages.value) {
    currentPage.value = page
    loadTableData()
  }
}

// 改变每页大小
function changePageSize() {
  currentPage.value = 1
  loadTableData()
}

// 查看详情
async function viewDetails(row) {
  selectedRow.value = row
  relatedData.value = {}
  
  // 加载关联数据
  if (selectedTable.value === 'frames' && row.video_chunk_id) {
    const result = await window.electronAPI.getRelatedData({
      tableName: 'video_chunks',
      foreignKey: 'id',
      foreignValue: row.video_chunk_id
    })
    if (result.success) {
      relatedData.value['video_chunks'] = result.data
    }
  }
  
  if (selectedTable.value === 'frames' && row.id) {
    const result = await window.electronAPI.getRelatedData({
      tableName: 'ocr_text',
      foreignKey: 'frame_id',
      foreignValue: row.id
    })
    if (result.success) {
      relatedData.value['ocr_text'] = result.data
    }
  }
  
  if (selectedTable.value === 'ocr_text' && row.frame_id) {
    const result = await window.electronAPI.getRelatedData({
      tableName: 'frames',
      foreignKey: 'id',
      foreignValue: row.frame_id
    })
    if (result.success) {
      relatedData.value['frames'] = result.data
    }
  }
}

// 搜索
function handleSearch() {
  // 可以在这里实现搜索功能
}

// 工具函数
function formatValue(value) {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'number') return value.toString()
  return value
}

function truncateText(text, maxLength) {
  if (!text) return '-'
  const str = String(text)
  return str.length > maxLength ? str.substring(0, maxLength) + '...' : str
}

function isLongText(value) {
  if (!value) return false
  return typeof value === 'string' && value.length > 100
}

function isBlob(value) {
  return value && typeof value === 'object' && value.constructor === Uint8Array
}

function getBlobSize(value) {
  if (isBlob(value)) {
    return value.length + ' bytes'
  }
  return '0 bytes'
}

function isJson(value) {
  if (!value || typeof value !== 'string') return false
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

function formatJson(value) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function getRelatedColumns(data) {
  return Object.keys(data || {})
}

function formatTimestamp(timestamp) {
  if (!timestamp) return '-'
  try {
    const date = new Date(timestamp)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  } catch (e) {
    return timestamp
  }
}

// 初始化：尝试连接默认数据库
onMounted(async () => {
  const defaultPath = 'C:\\Users\\song8\\.screenpipe\\db.sqlite'
  try {
    const result = await window.electronAPI.connectDatabase(defaultPath)
    if (result.success) {
      currentDbPath.value = defaultPath
      await loadTables()
    }
  } catch (err) {
    console.log('默认数据库连接失败，请手动选择数据库')
  }
})
</script>

<style scoped>
.db-viewer {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #fff;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #2c3e50;
  color: white;
  border-bottom: 1px solid #34495e;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.db-path {
  font-size: 12px;
  color: #bdc3c7;
  max-width: 400px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-input {
  padding: 6px 12px;
  border: 1px solid #34495e;
  border-radius: 4px;
  background: #34495e;
  color: white;
  width: 300px;
}

.search-input::placeholder {
  color: #95a5a6;
}

.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.sidebar {
  width: 250px;
  background: #ecf0f1;
  border-right: 1px solid #bdc3c7;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar h3 {
  padding: 16px;
  margin: 0;
  background: #34495e;
  color: white;
  font-size: 14px;
}

.table-list {
  flex: 1;
  overflow-y: auto;
}

.table-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
  border-bottom: 1px solid #d5dbdb;
  transition: background 0.2s;
}

.table-item:hover {
  background: #d5dbdb;
}

.table-item.active {
  background: #3498db;
  color: white;
}

.table-name {
  font-weight: 500;
}

.table-count {
  font-size: 12px;
  color: #7f8c8d;
  background: #ecf0f1;
  padding: 2px 8px;
  border-radius: 12px;
}

.table-item.active .table-count {
  background: rgba(255, 255, 255, 0.3);
  color: white;
}

.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #7f8c8d;
  font-size: 18px;
}

.table-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #ecf0f1;
}

.table-header h2 {
  margin: 0;
  font-size: 20px;
}

.table-actions {
  display: flex;
  gap: 8px;
}

.schema-panel {
  padding: 16px;
  background: #f8f9fa;
  border-bottom: 1px solid #ecf0f1;
  max-height: 300px;
  overflow-y: auto;
}

.schema-panel h4 {
  margin-bottom: 12px;
  font-size: 14px;
}

.schema-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.schema-table th,
.schema-table td {
  padding: 8px;
  text-align: left;
  border-bottom: 1px solid #dee2e6;
}

.schema-table th {
  background: #e9ecef;
  font-weight: 600;
}

.data-table-container {
  flex: 1;
  overflow: auto;
  padding: 16px;
}

.loading, .error {
  padding: 40px;
  text-align: center;
  color: #7f8c8d;
}

.error {
  color: #e74c3c;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.data-table th {
  background: #f8f9fa;
  padding: 12px;
  text-align: left;
  font-weight: 600;
  border-bottom: 2px solid #dee2e6;
  position: sticky;
  top: 0;
  z-index: 10;
}

.data-table th.sortable {
  cursor: pointer;
  user-select: none;
}

.data-table th.sortable:hover {
  background: #e9ecef;
}

.data-table th.sorted {
  background: #d4edda;
}

.sort-indicator {
  margin-left: 4px;
  font-size: 12px;
}

.data-table td {
  padding: 10px 12px;
  border-bottom: 1px solid #ecf0f1;
}

.data-table tbody tr:hover {
  background: #f8f9fa;
}

.blob-indicator {
  color: #7f8c8d;
  font-style: italic;
}

.long-text {
  color: #34495e;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 16px;
  border-top: 1px solid #ecf0f1;
}

.page-info {
  color: #7f8c8d;
  font-size: 14px;
}

.page-size-select {
  padding: 6px 12px;
  border: 1px solid #bdc3c7;
  border-radius: 4px;
  background: white;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
}

.btn-primary {
  background: #3498db;
  color: white;
}

.btn-primary:hover {
  background: #2980b9;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 12px;
  background: #ecf0f1;
}

.btn-sm:hover {
  background: #d5dbdb;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-link {
  background: none;
  border: none;
  color: #3498db;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}

.detail-panel {
  width: 400px;
  background: #f8f9fa;
  border-left: 1px solid #bdc3c7;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: #34495e;
  color: white;
}

.detail-header h3 {
  margin: 0;
  font-size: 16px;
}

.btn-close {
  background: none;
  border: none;
  color: white;
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  width: 30px;
  height: 30px;
  line-height: 1;
}

.detail-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.detail-item {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #dee2e6;
}

.detail-label {
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 6px;
  font-size: 12px;
  text-transform: uppercase;
}

.detail-value {
  color: #34495e;
  word-break: break-word;
  font-size: 13px;
}

.detail-value pre {
  background: #e9ecef;
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 12px;
  margin: 0;
}

.related-data {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 2px solid #bdc3c7;
}

.related-data h4 {
  margin-bottom: 16px;
  color: #2c3e50;
}

.related-section {
  margin-bottom: 20px;
}

.related-section h5 {
  margin-bottom: 8px;
  color: #34495e;
  font-size: 14px;
}

.related-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.related-table th,
.related-table td {
  padding: 6px;
  text-align: left;
  border: 1px solid #dee2e6;
}

.related-table th {
  background: #e9ecef;
  font-weight: 600;
}

.no-data {
  color: #7f8c8d;
  font-style: italic;
  padding: 8px;
}

/* 时间线视图样式 */
.timeline-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  background: #fafafa;
}

.timeline {
  position: relative;
  max-width: 900px;
  margin: 0 auto;
}

.timeline-item {
  position: relative;
  padding-left: 40px;
  padding-bottom: 30px;
  cursor: pointer;
  transition: all 0.2s;
}

.timeline-item:hover {
  background: rgba(52, 152, 219, 0.05);
  border-radius: 8px;
  padding-left: 40px;
  padding-right: 16px;
  padding-top: 8px;
  padding-bottom: 22px;
  margin-left: -16px;
  margin-right: -16px;
}

.timeline-marker {
  position: absolute;
  left: 0;
  top: 8px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #3498db;
  border: 3px solid #fff;
  box-shadow: 0 0 0 2px #3498db;
  z-index: 2;
}

.timeline-item::before {
  content: '';
  position: absolute;
  left: 5px;
  top: 20px;
  bottom: -10px;
  width: 2px;
  background: #e0e0e0;
  z-index: 1;
}

.timeline-item:last-child::before {
  display: none;
}

.timeline-content {
  background: white;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  border-left: 3px solid #3498db;
}

.timeline-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.timeline-time {
  font-weight: 600;
  color: #2c3e50;
  font-size: 14px;
}

.timeline-app {
  background: #ecf0f1;
  color: #34495e;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.timeline-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}

.timeline-badge.focused {
  background: #2ecc71;
  color: white;
}

.timeline-window {
  color: #7f8c8d;
  font-size: 13px;
  margin-top: 6px;
  margin-bottom: 4px;
  word-break: break-word;
}

.timeline-url {
  color: #3498db;
  font-size: 12px;
  margin-top: 4px;
  word-break: break-all;
  text-decoration: underline;
}

.timeline-file {
  color: #95a5a6;
  font-size: 11px;
  margin-top: 6px;
  font-family: 'Courier New', monospace;
  word-break: break-all;
}

/* 预览视图容器 */
.preview-container {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
