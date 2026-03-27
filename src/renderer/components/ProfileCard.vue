<script setup lang="ts">
import { computed } from 'vue'
import { CopyDocument, FolderOpened, RefreshRight } from '@element-plus/icons-vue'
import LauncherControl from '@renderer/components/LauncherControl.vue'
import type { BrowserInstanceInfo, Profile } from '@shared/types'

const props = defineProps<{
  profile: Profile
  instance?: BrowserInstanceInfo
}>()

const emit = defineEmits<{
  edit: [id: string]
  delete: [id: string]
  clone: [id: string]
  start: [id: string]
  stop: [id: string]
  openDir: [path: string]
}>()

const isRunning = computed(() => Boolean(props.instance))

const proxyLabel = computed(() => {
  if (!props.profile.proxyConfig || props.profile.proxyConfig.type === 'none') {
    return 'No proxy'
  }

  return `${props.profile.proxyConfig.type.toUpperCase()} · ${props.profile.proxyConfig.host}:${props.profile.proxyConfig.port}`
})

const windowLabel = computed(() => {
  const { width, height, pixelRatio } = props.profile.browserConfig.window
  return `${width} × ${height} · ${pixelRatio}x`
})

async function copyDebuggerLink(): Promise<void> {
  if (!props.instance?.websocketUrl) {
    return
  }

  await navigator.clipboard.writeText(props.instance.websocketUrl)
}
</script>

<template>
  <article class="profile-card">
    <div class="profile-card__header">
      <div>
        <p class="profile-card__eyebrow">Browser Profile</p>
        <h3>{{ profile.name }}</h3>
      </div>

      <el-tag :type="isRunning ? 'success' : 'info'" effect="dark">
        {{ isRunning ? 'Running' : 'Stopped' }}
      </el-tag>
    </div>

    <p class="profile-card__notes">
      {{ profile.notes || 'No notes yet. Use this environment for a dedicated local browsing workspace.' }}
    </p>

    <div class="profile-card__stats">
      <div>
        <span class="profile-card__label">Locale</span>
        <strong>{{ profile.browserConfig.locale }}</strong>
      </div>
      <div>
        <span class="profile-card__label">Timezone</span>
        <strong>{{ profile.browserConfig.timezone }}</strong>
      </div>
      <div>
        <span class="profile-card__label">Window</span>
        <strong>{{ windowLabel }}</strong>
      </div>
      <div>
        <span class="profile-card__label">Proxy</span>
        <strong>{{ proxyLabel }}</strong>
      </div>
    </div>

    <div v-if="instance" class="profile-card__instance">
      <span>PID {{ instance.pid }}</span>
      <span>Port {{ instance.debuggingPort }}</span>
    </div>

    <div class="profile-card__actions">
      <launcher-control
        :is-running="isRunning"
        @start="emit('start', profile.id)"
        @stop="emit('stop', profile.id)"
      />

      <el-button @click="emit('edit', profile.id)">Edit</el-button>
      <el-button @click="emit('clone', profile.id)">
        <el-icon><RefreshRight /></el-icon>
        Clone
      </el-button>
      <el-button @click="emit('openDir', profile.storagePath)">
        <el-icon><FolderOpened /></el-icon>
        Data
      </el-button>
      <el-button :disabled="!instance?.websocketUrl" @click="copyDebuggerLink">
        <el-icon><CopyDocument /></el-icon>
        DevTools WS
      </el-button>
      <el-button type="danger" plain @click="emit('delete', profile.id)">Delete</el-button>
    </div>
  </article>
</template>
