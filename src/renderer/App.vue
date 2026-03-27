<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Moon, Sunny } from '@element-plus/icons-vue'
import { DEFAULT_BROWSER_PATH } from '@shared/constants'
import type { SystemPaths } from '@shared/types'
import Dashboard from '@renderer/views/Dashboard.vue'
import Settings from '@renderer/views/Settings.vue'

type ViewName = 'dashboard' | 'settings'

const activeView = ref<ViewName>('dashboard')
const darkMode = ref(false)
const platform = ref<string>('')
const version = ref<string>('')
const systemPaths = ref<SystemPaths | null>(null)

const currentView = computed(() => (activeView.value === 'dashboard' ? Dashboard : Settings))

watch(darkMode, (enabled) => {
  document.documentElement.classList.toggle('dark', enabled)
})

onMounted(async () => {
  const [platformResult, versionResult, pathsResult] = await Promise.all([
    window.api.system.getPlatform(),
    window.api.system.getVersion(),
    window.api.system.getPaths()
  ])

  if (platformResult.success) {
    platform.value = platformResult.data
  }

  if (versionResult.success) {
    version.value = versionResult.data
  }

  if (pathsResult.success) {
    systemPaths.value = pathsResult.data
  }
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-block">
        <p class="eyebrow">Workspace Browser Manager</p>
        <h1>XussBrowser</h1>
        <p class="subcopy">Isolated local browser profiles, safe launch orchestration, and profile storage management.</p>
      </div>

      <div class="topbar-actions">
        <div class="meta-chip">{{ platform || 'loading...' }} · v{{ version || '...' }}</div>

        <el-segmented
          v-model="activeView"
          :options="[
            { label: 'Dashboard', value: 'dashboard' },
            { label: 'Settings', value: 'settings' }
          ]"
        />

        <el-tooltip content="Toggle dark mode">
          <el-switch
            v-model="darkMode"
            inline-prompt
            :active-icon="Moon"
            :inactive-icon="Sunny"
          />
        </el-tooltip>
      </div>
    </header>

    <main class="content-shell">
      <component
        :is="currentView"
        :browser-path="DEFAULT_BROWSER_PATH"
        :system-paths="systemPaths"
      />
    </main>
  </div>
</template>
