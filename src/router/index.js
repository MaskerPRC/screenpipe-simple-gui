import { createRouter, createWebHashHistory } from 'vue-router'
import PipelineDbViewer from '../views/PipelineDbViewer.vue'

const routes = [
  {
    path: '/',
    name: 'home',
    component: PipelineDbViewer
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
