<template>
  <div class="timeline-preview">
    <!-- 顶部信息栏 -->
    <div class="preview-header">
      <div class="preview-info">
        <h3 v-if="currentFrame">{{ formatTimestamp(currentFrame.timestamp) }}</h3>
        <div v-if="currentFrame" class="info-tags">
          <span v-if="currentFrame.app_name" class="tag">{{ currentFrame.app_name }}</span>
          <span v-if="currentFrame.window_name" class="tag">{{ currentFrame.window_name }}</span>
          <span v-if="currentFrame.focused" class="tag focused">聚焦</span>
          <span v-if="currentFrame.browser_url" class="tag url">{{ currentFrame.browser_url }}</span>
        </div>
      </div>
      <div class="preview-controls">
        <button @click="toggleOverlay" class="btn btn-sm">
          {{ showOverlay ? '隐藏' : '显示' }}信息叠加
        </button>
      </div>
    </div>

    <!-- 时间筛选器 -->
    <div class="time-filter">
      <div class="filter-label">时间筛选：</div>
      <div class="filter-inputs">
        <div class="filter-group">
          <label>开始时间</label>
          <input 
            type="datetime-local" 
            v-model="filterStartTime"
            @change="applyTimeFilter"
            class="datetime-input"
            :max="filterEndTime || (timeRange.end ? formatDateTimeLocal(timeRange.end) : '')"
          />
        </div>
        <div class="filter-group">
          <label>结束时间</label>
          <input 
            type="datetime-local" 
            v-model="filterEndTime"
            @change="applyTimeFilter"
            class="datetime-input"
            :min="filterStartTime || (timeRange.start ? formatDateTimeLocal(timeRange.start) : '')"
            :max="timeRange.end ? formatDateTimeLocal(timeRange.end) : ''"
          />
        </div>
        <button @click="resetTimeFilter" class="btn btn-sm btn-reset">
          🔄 重置
        </button>
      </div>
      <div v-if="hasActiveFilter" class="filter-info">
        已筛选：{{ filteredFrames.length }} / {{ props.frames.length }} 帧
      </div>
    </div>

    <!-- 中间预览区域 -->
    <div class="preview-area">
      <div v-if="loading" class="loading">加载中...</div>
      <div v-else-if="error" class="error">
        <div class="error-icon">⚠️</div>
        <div class="error-message">{{ error }}</div>
        <div v-if="error.includes('文件大小为 0')" class="error-hint">
          此视频文件可能正在录制中或已损坏，请尝试查看其他帧
        </div>
      </div>
      <div v-else-if="!currentFrame" class="empty-preview">
        <p>请拖动时间线选择时间点</p>
      </div>
      <div v-else class="image-container">
        <img 
          v-if="imageSrc" 
          :src="imageSrc" 
          alt="Screenshot"
          class="preview-image"
          @error="handleImageError"
        />
        <div v-else class="no-image">
          <p>无法加载截图</p>
          <p class="image-path">{{ getImagePath(currentFrame) }}</p>
        </div>
        
        <!-- 信息叠加层 -->
        <div v-if="showOverlay && overlayData" class="overlay">
          <!-- OCR 文本叠加 -->
          <div v-if="overlayData.ocrText" class="overlay-section ocr-overlay">
            <div class="overlay-title">OCR 文本</div>
            <div class="overlay-content">{{ truncateText(overlayData.ocrText.text, 500) }}</div>
          </div>
          
          <!-- 音频转录叠加 -->
          <div v-if="overlayData.audioTranscription" class="overlay-section audio-overlay">
            <div class="overlay-title">音频转录</div>
            <div class="overlay-content">{{ overlayData.audioTranscription.transcription }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部时间线 -->
    <div class="timeline-control">
      <div class="timeline-info">
        <span>{{ formatTimestamp(timeRange.start) }}</span>
        <span class="current-time">{{ formatTimestamp(currentTime) }}</span>
        <span>{{ formatTimestamp(timeRange.end) }}</span>
      </div>
      <div class="timeline-slider-container" @mousedown="startDrag" @mousemove="onDrag" @mouseup="stopDrag" @mouseleave="stopDrag">
        <div class="timeline-track">
          <div 
            class="timeline-progress" 
            :style="{ width: progressPercent + '%' }"
          ></div>
          <div 
            class="timeline-handle" 
            :style="{ left: progressPercent + '%' }"
            @mousedown.stop="startDrag"
          ></div>
          <!-- 时间标记点 -->
          <div 
            v-for="marker in timeMarkers" 
            :key="marker.time"
            class="timeline-marker"
            :style="{ left: marker.percent + '%' }"
            :title="formatTimestamp(marker.time)"
          ></div>
          <!-- 有截图的帧标记点（高亮显示） -->
          <div 
            v-for="marker in availableFrameMarkers" 
            :key="'available-' + marker.frameId"
            class="timeline-marker timeline-marker-available"
            :style="{ left: marker.percent + '%' }"
            :title="formatTimestamp(marker.time) + ' (有截图)'"
            @click="updateCurrentFrame(marker.time)"
          ></div>
        </div>
      </div>
      <div class="timeline-controls">
        <button @click="playPause" class="btn btn-sm">⏯️ {{ isPlaying ? '暂停' : '播放' }}</button>
        <button @click="stepBackward" class="btn btn-sm">⏮️ 上一步</button>
        <button @click="stepForward" class="btn btn-sm">⏭️ 下一步</button>
        <input 
          v-model.number="playbackSpeed" 
          type="range" 
          min="0.5" 
          max="3" 
          step="0.5"
          class="speed-slider"
        />
        <span class="speed-label">{{ playbackSpeed }}x</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'

const props = defineProps({
  frames: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['frame-change'])

const currentFrame = ref(null)
const currentTime = ref(null)
const imageSrc = ref('')
const loading = ref(false)
const error = ref('')
const showOverlay = ref(true)
const overlayData = ref(null)
const isPlaying = ref(false)
const playbackSpeed = ref(1)
const isDragging = ref(false)

// 时间筛选
const filterStartTime = ref('')
const filterEndTime = ref('')

// 组件是否已挂载（用于防止在卸载后执行操作）
const isMounted = ref(false)

// 视频缓存：同一个视频文件只读取一次
const videoCache = new Map()

// 复用 video 元素，避免重复创建
let cachedVideoElement = null
let cachedVideoSrc = null

// 帧可用性缓存：缓存帧是否可用的检查结果
const frameAvailabilityCache = new Map()
// 响应式触发器：用于触发 computed 重新计算
const cacheUpdateTrigger = ref(0)

// 筛选后的 frames
const filteredFrames = computed(() => {
  if (!filterStartTime.value && !filterEndTime.value) {
    return props.frames
  }
  
  let filtered = [...props.frames]
  
  if (filterStartTime.value) {
    const startTime = new Date(filterStartTime.value).getTime()
    filtered = filtered.filter(f => {
      const frameTime = new Date(f.timestamp).getTime()
      return frameTime >= startTime
    })
  }
  
  if (filterEndTime.value) {
    const endTime = new Date(filterEndTime.value).getTime()
    filtered = filtered.filter(f => {
      const frameTime = new Date(f.timestamp).getTime()
      return frameTime <= endTime
    })
  }
  
  return filtered
})

// 是否有活动的筛选
const hasActiveFilter = computed(() => {
  return !!filterStartTime.value || !!filterEndTime.value
})

// 计算时间范围（基于筛选后的 frames）
const timeRange = computed(() => {
  const frames = filteredFrames.value
  if (frames.length === 0) {
    // 如果没有筛选后的帧，使用原始 frames 的范围作为参考
    if (props.frames.length === 0) {
      return { start: null, end: null }
    }
    const times = props.frames.map(f => new Date(f.timestamp).getTime())
    return {
      start: new Date(Math.min(...times)),
      end: new Date(Math.max(...times))
    }
  }
  const times = frames.map(f => new Date(f.timestamp).getTime())
  return {
    start: new Date(Math.min(...times)),
    end: new Date(Math.max(...times))
  }
})

// 计算进度百分比
const progressPercent = computed(() => {
  if (!currentTime.value || !timeRange.value.start || !timeRange.value.end) return 0
  const start = timeRange.value.start.getTime()
  const end = timeRange.value.end.getTime()
  const current = currentTime.value.getTime()
  return ((current - start) / (end - start)) * 100
})

// 时间标记点（每10%一个标记）
const timeMarkers = computed(() => {
  if (!timeRange.value.start || !timeRange.value.end) return []
  const markers = []
  for (let i = 0; i <= 10; i++) {
    const percent = i * 10
    const time = new Date(
      timeRange.value.start.getTime() + 
      (timeRange.value.end.getTime() - timeRange.value.start.getTime()) * (percent / 100)
    )
    markers.push({ time, percent })
  }
  return markers
})

// 有可用截图的帧标记点（高亮显示）
// 优化：当标记点过多时进行采样，避免渲染过多元素导致性能问题
const availableFrameMarkers = computed(() => {
  // 访问响应式触发器，确保缓存更新时重新计算
  const _ = cacheUpdateTrigger.value
  
  if (!timeRange.value.start || !timeRange.value.end || filteredFrames.value.length === 0) return []
  
  const markers = []
  const start = timeRange.value.start.getTime()
  const end = timeRange.value.end.getTime()
  const range = end - start
  
  // 遍历筛选后的帧，检查是否可用（使用缓存）
  filteredFrames.value.forEach(frame => {
    const cacheKey = `${frame.id}_${frame.name}`
    const isAvailable = frameAvailabilityCache.get(cacheKey)
    
    // 显示已检查过且可用的帧
    // 如果未检查过，暂时不显示（等待检查）
    if (isAvailable === true) {
      const frameTime = new Date(frame.timestamp).getTime()
      const percent = ((frameTime - start) / range) * 100
      
      markers.push({
        frameId: frame.id,
        time: frame.timestamp,
        percent: Math.max(0, Math.min(100, percent))
      })
    }
  })
  
  // 如果标记点过多，进行采样优化
  // 基于时间线宽度动态调整采样密度
  // 假设时间线宽度约为 1000px，每个标记点至少需要 2px 间距才能清晰显示
  // 因此最多显示约 500 个标记点
  const maxMarkers = 500
  if (markers.length > maxMarkers) {
    // 使用更智能的采样策略：按时间间隔采样，而不是简单的步长
    // 这样可以确保时间分布更均匀
    const sampledMarkers = []
    const step = Math.ceil(markers.length / maxMarkers)
    
    // 均匀采样
    for (let i = 0; i < markers.length; i += step) {
      sampledMarkers.push(markers[i])
    }
    
    // 确保第一个和最后一个标记点被包含
    if (markers.length > 0) {
      const firstMarker = markers[0]
      const lastMarker = markers[markers.length - 1]
      
      // 确保第一个标记点
      if (sampledMarkers.length === 0 || sampledMarkers[0].frameId !== firstMarker.frameId) {
        sampledMarkers.unshift(firstMarker)
      }
      
      // 确保最后一个标记点
      const lastSampled = sampledMarkers[sampledMarkers.length - 1]
      if (lastMarker.frameId !== lastSampled.frameId) {
        sampledMarkers.push(lastMarker)
      }
    }
    
    // 去重（以防万一）
    const uniqueMarkers = []
    const seenIds = new Set()
    for (const marker of sampledMarkers) {
      if (!seenIds.has(marker.frameId)) {
        seenIds.add(marker.frameId)
        uniqueMarkers.push(marker)
      }
    }
    
    return uniqueMarkers
  }
  
  return markers
})

// 应用时间筛选
async function applyTimeFilter() {
  if (!isMounted.value) return
  
  await nextTick()
  const frames = filteredFrames.value
  if (frames.length > 0) {
    // 如果当前帧不在筛选范围内，跳转到筛选后的第一个帧
    if (currentFrame.value) {
      const isInFiltered = frames.some(f => f.id === currentFrame.value.id)
      if (!isInFiltered) {
        await updateCurrentFrame(frames[0].timestamp)
      }
    } else {
      await updateCurrentFrame(frames[0].timestamp)
    }
  } else {
    // 如果没有筛选结果，清空当前帧
    if (isMounted.value) {
      currentFrame.value = null
      currentTime.value = null
      imageSrc.value = ''
    }
  }
}

// 重置时间筛选
async function resetTimeFilter() {
  filterStartTime.value = ''
  filterEndTime.value = ''
  await applyTimeFilter()
}

// 格式化日期时间为 datetime-local 输入格式
function formatDateTimeLocal(date) {
  if (!date) return ''
  try {
    const d = new Date(date)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}`
  } catch (e) {
    return ''
  }
}

// 预检查帧可用性（后台任务）
async function precheckFrameAvailability() {
  const frames = filteredFrames.value
  if (frames.length === 0) return
  
  // 分批检查，避免一次性检查太多导致阻塞
  const batchSize = 10
  let checkedCount = 0
  
  for (let i = 0; i < frames.length; i += batchSize) {
    const batch = frames.slice(i, i + batchSize)
    
    // 并行检查一批帧
    await Promise.all(batch.map(async (frame) => {
      const cacheKey = `${frame.id}_${frame.name}`
      
      // 如果已经检查过，跳过
      if (frameAvailabilityCache.has(cacheKey)) {
        return
      }
      
      // 检查帧是否可用
      await isFrameAvailable(frame)
      checkedCount++
    }))
    
    // 每批之间稍作延迟，避免阻塞 UI
    if (i + batchSize < frames.length) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
}

// 根据时间查找对应的 frame（在筛选后的 frames 中查找）
function findFrameByTime(time) {
  const frames = filteredFrames.value
  if (!time || frames.length === 0) return null
  
  const targetTime = new Date(time).getTime()
  let closestFrame = frames[0]
  let minDiff = Math.abs(new Date(closestFrame.timestamp).getTime() - targetTime)
  
  for (const frame of frames) {
    const diff = Math.abs(new Date(frame.timestamp).getTime() - targetTime)
    if (diff < minDiff) {
      minDiff = diff
      closestFrame = frame
    }
  }
  
  return closestFrame
}

// 更新当前帧
async function updateCurrentFrame(time) {
  if (!isMounted.value) return
  
  const frame = findFrameByTime(time)
  if (!frame || frame.id === currentFrame.value?.id) return
  
  if (!isMounted.value) return
  
  currentFrame.value = frame
  currentTime.value = new Date(frame.timestamp)
  emit('frame-change', frame)
  
  // 加载图片
  const loadResult = await loadImage(frame)
  
  if (!isMounted.value) return
  
  // 如果加载失败且是空文件错误，尝试查找下一个有效帧（仅在拖动时间线时）
  // 注意：stepBackward 和 stepForward 已经处理了跳过逻辑，这里只处理拖动时间线的情况
  if (!loadResult && error.value && error.value.includes('文件大小为 0')) {
    const frames = filteredFrames.value
    const currentIndex = frames.findIndex(f => f.id === frame.id)
    if (currentIndex >= 0 && currentIndex < frames.length - 1) {
      // 尝试下一个帧
      const nextFrame = frames[currentIndex + 1]
      if (nextFrame && isMounted.value) {
        currentFrame.value = nextFrame
        currentTime.value = new Date(nextFrame.timestamp)
        emit('frame-change', nextFrame)
        await loadImage(nextFrame)
      }
    }
  }
  
  // 加载叠加数据
  if (isMounted.value && currentFrame.value) {
    await loadOverlayData(currentFrame.value)
  }
}

// 加载图片（从视频中提取帧）
// 返回 true 表示成功，false 表示失败
async function loadImage(frame) {
  if (!frame) {
    return false
  }
  
  loading.value = true
  error.value = ''
  imageSrc.value = ''
  
  try {
    // 如果 name 字段是视频文件，从视频中提取帧
    if (frame.name && (frame.name.endsWith('.mp4') || frame.name.endsWith('.webm') || frame.name.endsWith('.ogg'))) {
      const videoPath = frame.name
      const frameIndex = frame.offset_index || 0
      
      // 检查缓存
      let videoBlobUrl = videoCache.get(videoPath)
      
      if (!videoBlobUrl) {
        // 缓存未命中，通过 IPC 读取视频文件
        const videoResult = await window.electronAPI.readVideoFile(videoPath)
        
        if (!videoResult.success) {
          console.error('[loadImage] 读取视频失败:', videoResult.error)
          // 对于空文件，显示更友好的提示
          if (videoResult.error && videoResult.error.includes('文件大小为 0')) {
            error.value = '⚠️ 视频文件为空或损坏（文件大小为 0）'
            // 更新缓存：标记为不可用
            const cacheKey = `${frame.id}_${frame.name}`
            frameAvailabilityCache.set(cacheKey, false)
          cacheUpdateTrigger.value++
          } else {
            error.value = '无法加载视频: ' + videoResult.error
          }
          loading.value = false
          return false
        }
        
        // 更新缓存：标记为可用
        const cacheKey = `${frame.id}_${frame.name}`
        if (videoResult.data && videoResult.data.fileSize > 0) {
          frameAvailabilityCache.set(cacheKey, true)
          cacheUpdateTrigger.value++
        } else {
          frameAvailabilityCache.set(cacheKey, false)
          cacheUpdateTrigger.value++
        }
        
        // 检查文件路径是否有效
        if (!videoResult.data || !videoResult.data.filePath) {
          console.error('[loadImage] 视频文件路径无效')
          error.value = '视频文件路径无效'
          loading.value = false
          return false
        }
        
        // 使用自定义协议 pipeline-video:// 来访问视频文件
        // 这样不需要将整个文件加载到内存
        const encodedPath = encodeURIComponent(videoPath)
        videoBlobUrl = `pipeline-video://${encodedPath}`
        // 存入缓存
        videoCache.set(videoPath, videoBlobUrl)
      }
      
      // 使用 video 元素和 canvas 提取帧（使用 Blob URL）
      const imageData = await extractFrameFromVideo(videoBlobUrl, frameIndex)
      
      if (imageData) {
        imageSrc.value = imageData
        // 更新缓存：标记为可用
        const cacheKey = `${frame.id}_${frame.name}`
        frameAvailabilityCache.set(cacheKey, true)
        cacheUpdateTrigger.value++
        return true
      } else {
        console.error('[loadImage] 提取帧返回空数据')
        error.value = '无法从视频中提取帧'
        // 更新缓存：标记为不可用
        const cacheKey = `${frame.id}_${frame.name}`
        frameAvailabilityCache.set(cacheKey, false)
        return false
      }
    } else {
      // 尝试直接读取图片文件
      const imagePath = frame.name
      if (imagePath) {
        const result = await window.electronAPI.readImageFile(imagePath)
        if (result.success) {
          imageSrc.value = result.data
          // 更新缓存：标记为可用
          const cacheKey = `${frame.id}_${frame.name}`
          frameAvailabilityCache.set(cacheKey, true)
          cacheUpdateTrigger.value++
          return true
        } else {
          error.value = '无法加载图片: ' + result.error
          // 更新缓存：标记为不可用
          const cacheKey = `${frame.id}_${frame.name}`
          frameAvailabilityCache.set(cacheKey, false)
          cacheUpdateTrigger.value++
          return false
        }
      } else {
        error.value = '未找到图片路径'
        // 更新缓存：标记为不可用
        const cacheKey = `${frame.id}_${frame.name}`
        frameAvailabilityCache.set(cacheKey, false)
        cacheUpdateTrigger.value++
        return false
      }
    }
  } catch (err) {
    console.error('[loadImage] 发生错误:', err)
    error.value = err.message
    return false
  } finally {
    loading.value = false
  }
}

        // 从视频文件中提取帧（使用浏览器原生 API）
        // videoBlobUrl 是 pipeline-video:// 协议 URL 或 Blob URL
        function extractFrameFromVideo(videoBlobUrl, frameIndex) {
          return new Promise((resolve, reject) => {
            // 如果视频源相同，复用 video 元素
            let video = cachedVideoElement
            const needNewVideo = !video || cachedVideoSrc !== videoBlobUrl
            
            if (needNewVideo) {
              // 清理旧的 video 元素
              if (video) {
                video.pause()
                video.src = ''
                video.load()
                try { video.remove() } catch (e) { console.error('[extractFrameFromVideo] 移除 video 失败:', e) }
              }
              
              video = document.createElement('video')
              video.crossOrigin = 'anonymous'
              video.preload = 'auto'
              video.muted = true
              video.playsInline = true
              video.src = videoBlobUrl
              
              cachedVideoElement = video
              cachedVideoSrc = videoBlobUrl
            }
    
    let timeoutId = null
    let metadataHandler = null
    let seekedHandler = null
    let errorHandler = null
    
    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      if (metadataHandler && video) {
        video.removeEventListener('loadedmetadata', metadataHandler)
      }
      if (seekedHandler && video) {
        video.removeEventListener('seeked', seekedHandler)
      }
      if (errorHandler && video) {
        video.removeEventListener('error', errorHandler)
      }
    }
    
    // 设置超时
    timeoutId = setTimeout(() => {
      console.error('[extractFrameFromVideo] 超时！video.readyState:', video?.readyState, 'video.duration:', video?.duration, 'video.currentTime:', video?.currentTime)
      cleanup()
      reject(new Error('视频加载超时'))
    }, 5000)
    
    // 定义 seekedHandler，用于提取帧
    seekedHandler = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        
        if (canvas.width === 0 || canvas.height === 0) {
          console.error('[extractFrameFromVideo] 视频尺寸无效')
          cleanup()
          reject(new Error('视频尺寸无效'))
          return
        }
        
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        
        // 使用 JPEG 格式，质量 0.85，平衡质量和速度
        const imageData = canvas.toDataURL('image/jpeg', 0.85)
        cleanup()
        resolve(imageData)
      } catch (err) {
        console.error('[extractFrameFromVideo] seeked 处理出错:', err)
        cleanup()
        reject(err)
      }
    }
    
    errorHandler = (e) => {
      console.error('[extractFrameFromVideo] error 事件触发:', video.error)
      cleanup()
      const errorMsg = video.error ? 
        `错误代码: ${video.error.code}, ${video.error.message}` : 
        '未知错误'
      reject(new Error('视频加载失败: ' + errorMsg))
    }
    
    // 先添加事件监听器
    video.addEventListener('seeked', seekedHandler, { once: true })
    video.addEventListener('error', errorHandler, { once: true })
    
    // 如果 video 已经加载过元数据，直接跳转
    if (!needNewVideo && video.readyState >= 2) {
      // 视频已经加载了元数据，直接跳转
      const timeInSeconds = frameIndex / 30 // 假设 30fps
      if (video.duration > 0) {
        const targetTime = Math.min(Math.max(0, timeInSeconds), video.duration - 0.1)
        
        // 如果目标时间与当前时间相同或非常接近，直接提取帧
        if (Math.abs(video.currentTime - targetTime) < 0.01) {
          // 使用 setTimeout 确保 video 状态稳定
          setTimeout(() => {
            seekedHandler()
          }, 10)
        } else {
          // 设置新的时间点，等待 seeked 事件
          video.currentTime = targetTime
        }
      } else {
        console.error('[extractFrameFromVideo] video.duration 无效:', video.duration)
        cleanup()
        reject(new Error('无法获取视频时长'))
        return
      }
    } else {
      // 需要等待元数据加载
      metadataHandler = () => {
        const timeInSeconds = frameIndex / 30 // 假设 30fps
        if (video.duration > 0) {
          const targetTime = Math.min(Math.max(0, timeInSeconds), video.duration - 0.1)
          video.currentTime = targetTime
        } else {
          console.error('[extractFrameFromVideo] video.duration 无效:', video.duration)
          cleanup()
          reject(new Error('无法获取视频时长'))
        }
      }
      video.addEventListener('loadedmetadata', metadataHandler, { once: true })
      video.load()
    }
  })
}

// 加载叠加数据（OCR、音频转录等）
async function loadOverlayData(frame) {
  overlayData.value = null
  
  try {
    // 加载 OCR 文本（通过 frame_id 关联）
    if (frame.id) {
      const ocrResult = await window.electronAPI.getRelatedData({
        tableName: 'ocr_text',
        foreignKey: 'frame_id',
        foreignValue: frame.id
      })
      
      if (ocrResult.success && ocrResult.data && ocrResult.data.length > 0) {
        // 取第一条 OCR 数据（通常一个 frame 对应一条 OCR 记录）
        const ocrData = ocrResult.data[0]
        overlayData.value = {
          ocrText: {
            text: ocrData.text || '',
            text_json: ocrData.text_json || null,
            app_name: ocrData.app_name || '',
            window_name: ocrData.window_name || '',
            ocr_engine: ocrData.ocr_engine || '',
            text_length: ocrData.text_length || 0
          }
        }
      }
    }
  } catch (err) {
    console.error('加载叠加数据失败:', err)
  }
}

// 时间线拖动
function startDrag(e) {
  isDragging.value = true
  updateTimeFromMouse(e)
}

function onDrag(e) {
  if (!isDragging.value) return
  updateTimeFromMouse(e)
}

function stopDrag() {
  isDragging.value = false
}

function updateTimeFromMouse(e) {
  const container = e.currentTarget
  const rect = container.getBoundingClientRect()
  const percent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
  
  if (timeRange.value.start && timeRange.value.end) {
    const start = timeRange.value.start.getTime()
    const end = timeRange.value.end.getTime()
    const time = new Date(start + (end - start) * (percent / 100))
    updateCurrentFrame(time)
  }
}

// 播放控制
let playInterval = null

function playPause() {
  isPlaying.value = !isPlaying.value
  
  if (isPlaying.value) {
    startPlayback()
  } else {
    stopPlayback()
  }
}

function startPlayback() {
  if (playInterval) clearInterval(playInterval)
  
  const interval = 1000 / playbackSpeed.value // 每秒播放速度
  playInterval = setInterval(() => {
    if (!currentTime.value || !timeRange.value.end) {
      stopPlayback()
      return
    }
    
    const nextTime = new Date(currentTime.value.getTime() + interval)
    if (nextTime > timeRange.value.end) {
      stopPlayback()
      return
    }
    
    updateCurrentFrame(nextTime)
  }, 100)
}

function stopPlayback() {
  isPlaying.value = false
  if (playInterval) {
    clearInterval(playInterval)
    playInterval = null
  }
}

// 检查帧是否可用（文件不为空）
async function isFrameAvailable(frame) {
  if (!frame || !frame.name) {
    return false
  }
  
  // 检查缓存
  const cacheKey = `${frame.id}_${frame.name}`
  if (frameAvailabilityCache.has(cacheKey)) {
    return frameAvailabilityCache.get(cacheKey)
  }
  
  let isAvailable = false
  
  // 如果是视频文件，检查文件大小
  if (frame.name && (frame.name.endsWith('.mp4') || frame.name.endsWith('.webm') || frame.name.endsWith('.ogg'))) {
    try {
      const result = await window.electronAPI.readVideoFile(frame.name)
      isAvailable = result.success && result.data && result.data.fileSize > 0
    } catch (err) {
      console.error('[isFrameAvailable] 检查帧可用性失败:', err)
      isAvailable = false
    }
  } else {
    // 对于图片文件，假设可用（可以后续优化）
    isAvailable = true
  }
  
  // 存入缓存
  frameAvailabilityCache.set(cacheKey, isAvailable)
  // 触发响应式更新
  cacheUpdateTrigger.value++
  return isAvailable
}

// 查找最近的上一个可用帧
async function findPreviousAvailableFrame(startIndex) {
  const frames = filteredFrames.value
  if (startIndex <= 0) return null
  
  // 限制查找范围，最多向前查找 50 个帧
  const maxSearch = Math.min(50, startIndex)
  
  for (let i = startIndex - 1; i >= startIndex - maxSearch && i >= 0; i--) {
    const frame = frames[i]
    if (frame && await isFrameAvailable(frame)) {
      return frame
    }
  }
  
  return null
}

// 查找最近的下一个可用帧
async function findNextAvailableFrame(startIndex) {
  const frames = filteredFrames.value
  if (startIndex >= frames.length - 1) return null
  
  // 限制查找范围，最多向后查找 50 个帧
  const maxSearch = Math.min(50, frames.length - startIndex - 1)
  
  for (let i = startIndex + 1; i <= startIndex + maxSearch && i < frames.length; i++) {
    const frame = frames[i]
    if (frame && await isFrameAvailable(frame)) {
      return frame
    }
  }
  
  return null
}

async function stepBackward() {
  if (!currentFrame.value) return
  
  const frames = filteredFrames.value
  const currentIndex = frames.findIndex(f => f.id === currentFrame.value.id)
  if (currentIndex <= 0) return
  
  // 先尝试直接上一个帧
  const previousFrame = frames[currentIndex - 1]
  if (previousFrame) {
    // 检查是否可用
    const isAvailable = await isFrameAvailable(previousFrame)
    
    if (isAvailable) {
      // 如果可用，直接跳转
      updateCurrentFrame(previousFrame.timestamp)
    } else {
      // 如果不可用，查找最近的上一个可用帧
      const availableFrame = await findPreviousAvailableFrame(currentIndex)
      if (availableFrame) {
        updateCurrentFrame(availableFrame.timestamp)
      } else {
        error.value = '未找到可用的上一个帧'
      }
    }
  }
}

async function stepForward() {
  if (!currentFrame.value) return
  
  const frames = filteredFrames.value
  const currentIndex = frames.findIndex(f => f.id === currentFrame.value.id)
  if (currentIndex >= frames.length - 1) return
  
  // 先尝试直接下一个帧
  const nextFrame = frames[currentIndex + 1]
  if (nextFrame) {
    // 检查是否可用
    const isAvailable = await isFrameAvailable(nextFrame)
    
    if (isAvailable) {
      // 如果可用，直接跳转
      updateCurrentFrame(nextFrame.timestamp)
    } else {
      // 如果不可用，查找最近的下一个可用帧
      const availableFrame = await findNextAvailableFrame(currentIndex)
      if (availableFrame) {
        updateCurrentFrame(availableFrame.timestamp)
      } else {
        error.value = '未找到可用的下一个帧'
      }
    }
  }
}

function toggleOverlay() {
  showOverlay.value = !showOverlay.value
}

function handleImageError() {
  error.value = '图片加载失败'
  imageSrc.value = ''
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

function truncateText(text, maxLength) {
  if (!text) return '-'
  const str = String(text)
  return str.length > maxLength ? str.substring(0, maxLength) + '...' : str
}

// 初始化
onMounted(async () => {
  isMounted.value = true
  const frames = filteredFrames.value
  if (frames.length > 0) {
    const firstFrame = frames[0]
    await updateCurrentFrame(firstFrame.timestamp)
    
    // 启动后台预检查任务
    // 延迟一下，让初始帧先加载完成
    setTimeout(() => {
      if (isMounted.value) {
        precheckFrameAvailability()
      }
    }, 1000)
  }
})

onUnmounted(() => {
  isMounted.value = false
  stopPlayback()
  
  // 清理 Blob URL，释放内存
  videoCache.forEach((blobUrl) => {
    if (blobUrl && blobUrl.startsWith('blob:')) {
      URL.revokeObjectURL(blobUrl)
    }
  })
  videoCache.clear()
  
  // 清理帧可用性缓存
  frameAvailabilityCache.clear()
  
  // 清理 video 元素
  if (cachedVideoElement) {
    cachedVideoElement.pause()
    cachedVideoElement.src = ''
    cachedVideoElement.load()
    try { cachedVideoElement.remove() } catch {}
    cachedVideoElement = null
    cachedVideoSrc = null
  }
  
  // 清空当前状态
  currentFrame.value = null
  currentTime.value = null
  imageSrc.value = ''
  filterStartTime.value = ''
  filterEndTime.value = ''
})

// 监听 frames 变化
watch(() => props.frames, async (newFrames) => {
  if (!isMounted.value) return
  
  await nextTick()
  const frames = filteredFrames.value
  if (frames.length > 0 && !currentFrame.value) {
    const firstFrame = frames[0]
    if (isMounted.value) {
      await updateCurrentFrame(firstFrame.timestamp)
      
      // 启动后台预检查任务
      setTimeout(() => {
        if (isMounted.value) {
          precheckFrameAvailability()
        }
      }, 1000)
    }
  }
}, { immediate: true, flush: 'post' })

// 监听筛选后的 frames 变化
watch(filteredFrames, async (newFrames, oldFrames) => {
  if (!isMounted.value) return
  
  // 避免在初始化时触发
  if (!oldFrames || oldFrames.length === 0) return
  
  await nextTick()
  
  // 如果当前帧不在新的筛选结果中，跳转到第一个帧
  if (newFrames.length > 0) {
    if (!currentFrame.value || !newFrames.some(f => f.id === currentFrame.value.id)) {
      if (isMounted.value) {
        await updateCurrentFrame(newFrames[0].timestamp)
      }
    }
  } else if (currentFrame.value && isMounted.value) {
    // 如果没有筛选结果，清空当前帧
    currentFrame.value = null
    currentTime.value = null
    imageSrc.value = ''
  }
}, { flush: 'post' })
</script>

<style scoped>
.timeline-preview {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1a1a;
  color: white;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background: #2c2c2c;
  border-bottom: 1px solid #444;
}

.preview-info h3 {
  margin: 0 0 8px 0;
  font-size: 16px;
}

.info-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tag {
  background: #444;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
}

.tag.focused {
  background: #2ecc71;
}

.tag.url {
  background: #3498db;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #000;
  position: relative;
}

.image-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.preview-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.no-image {
  text-align: center;
  color: #888;
}

.image-path {
  font-size: 11px;
  margin-top: 8px;
  color: #666;
}

.overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.overlay-section {
  background: rgba(0, 0, 0, 0.7);
  padding: 12px;
  border-radius: 8px;
  max-width: 400px;
  backdrop-filter: blur(4px);
}

.overlay-title {
  font-weight: 600;
  margin-bottom: 8px;
  font-size: 12px;
  color: #3498db;
  display: flex;
  align-items: center;
  gap: 8px;
}

.overlay-engine {
  font-size: 11px;
  color: #95a5a6;
  font-weight: normal;
}

.overlay-meta {
  margin-top: 8px;
  font-size: 11px;
  color: #95a5a6;
}

.overlay-content {
  font-size: 13px;
  line-height: 1.5;
  color: #fff;
}

.timeline-control {
  padding: 16px 20px;
  background: #2c2c2c;
  border-top: 1px solid #444;
}

.timeline-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
  font-size: 12px;
  color: #aaa;
}

.current-time {
  font-weight: 600;
  color: #3498db;
}

.timeline-slider-container {
  position: relative;
  height: 40px;
  cursor: pointer;
  margin-bottom: 12px;
}

.timeline-track {
  position: relative;
  width: 100%;
  height: 6px;
  background: #444;
  border-radius: 3px;
  margin-top: 17px;
  overflow: visible;
}

.timeline-progress {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: #3498db;
  border-radius: 3px;
  transition: width 0.1s;
}

.timeline-handle {
  position: absolute;
  top: -8px;
  width: 22px;
  height: 22px;
  background: #3498db;
  border: 3px solid #fff;
  border-radius: 50%;
  cursor: grab;
  transform: translateX(-50%);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  transition: left 0.1s;
}

.timeline-handle:active {
  cursor: grabbing;
}

.timeline-marker {
  position: absolute;
  top: -2px;
  width: 2px;
  height: 10px;
  background: #666;
  transform: translateX(-50%);
  z-index: 1;
}

.timeline-marker-available {
  width: 4px !important;
  height: 14px !important;
  background: linear-gradient(180deg, #2ecc71 0%, #27ae60 100%) !important;
  box-shadow: 0 0 6px rgba(46, 204, 113, 0.8), 0 0 12px rgba(46, 204, 113, 0.4) !important;
  border-radius: 2px;
  top: -4px !important;
  z-index: 100 !important;
  animation: pulse-glow 2s ease-in-out infinite;
  cursor: pointer;
  transition: all 0.2s ease;
  pointer-events: auto;
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
}

.timeline-marker-available:hover {
  width: 5px;
  height: 16px;
  box-shadow: 0 0 8px rgba(46, 204, 113, 1), 0 0 16px rgba(46, 204, 113, 0.6);
}

@keyframes pulse-glow {
  0%, 100% {
    opacity: 1;
    box-shadow: 0 0 6px rgba(46, 204, 113, 0.8), 0 0 12px rgba(46, 204, 113, 0.4);
  }
  50% {
    opacity: 0.9;
    box-shadow: 0 0 10px rgba(46, 204, 113, 1), 0 0 20px rgba(46, 204, 113, 0.6);
  }
}

.timeline-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.speed-slider {
  width: 100px;
}

.speed-label {
  font-size: 12px;
  color: #aaa;
  min-width: 40px;
}

.loading, .error, .empty-preview {
  text-align: center;
  color: #888;
  padding: 40px;
}

.error {
  color: #e74c3c;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.error-icon {
  font-size: 48px;
  margin-bottom: 8px;
}

.error-message {
  font-size: 16px;
  font-weight: 500;
}

.error-hint {
  font-size: 14px;
  color: #999;
  margin-top: 8px;
  max-width: 400px;
  line-height: 1.5;
}

.btn {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  background: #444;
  color: white;
  transition: background 0.2s;
}

.btn:hover {
  background: #555;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 12px;
}

.btn-reset {
  background: #e74c3c;
}

.btn-reset:hover {
  background: #c0392b;
}

/* 时间筛选器样式 */
.time-filter {
  padding: 12px 20px;
  background: #252525;
  border-bottom: 1px solid #444;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.filter-label {
  font-size: 13px;
  color: #aaa;
  font-weight: 500;
  white-space: nowrap;
}

.filter-inputs {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.filter-group label {
  font-size: 11px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.datetime-input {
  padding: 6px 10px;
  border: 1px solid #444;
  border-radius: 4px;
  background: #1a1a1a;
  color: white;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 180px;
}

.datetime-input:hover {
  border-color: #555;
  background: #222;
}

.datetime-input:focus {
  outline: none;
  border-color: #3498db;
  background: #222;
  box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
}

.datetime-input::-webkit-calendar-picker-indicator {
  filter: invert(0.8);
  cursor: pointer;
}

.filter-info {
  font-size: 12px;
  color: #3498db;
  margin-left: auto;
  white-space: nowrap;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .time-filter {
    flex-direction: column;
    align-items: flex-start;
  }
  
  .filter-inputs {
    width: 100%;
  }
  
  .filter-group {
    flex: 1;
    min-width: 150px;
  }
  
  .filter-info {
    margin-left: 0;
    width: 100%;
  }
}
</style>

