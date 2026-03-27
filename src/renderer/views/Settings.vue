<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Folder, Setting } from '@element-plus/icons-vue'
import type { BrowserExecutablePathInfo, SystemPaths } from '@shared/types'

const props = defineProps<{
  systemPaths: SystemPaths | null
}>()

const loading = ref(false)
const saving = ref(false)
const browserPathInfo = ref<BrowserExecutablePathInfo | null>(null)
const form = reactive({
  browserExecutablePath: ''
})

const browserPathSourceLabel = computed(() => {
  if (!browserPathInfo.value) {
    return 'Loading...'
  }

  if (browserPathInfo.value.source === 'environment') {
    return 'Environment variable override'
  }

  if (browserPathInfo.value.source === 'settings') {
    return 'Saved application setting'
  }

  return 'Built-in default'
})

async function loadSettings(): Promise<void> {
  loading.value = true

  const [settingsResult, browserPathResult] = await Promise.all([
    window.api.system.getSettings(),
    window.api.system.getBrowserExecutable()
  ])

  if (!settingsResult.success) {
    ElMessage.error(settingsResult.error)
  } else {
    form.browserExecutablePath = settingsResult.data.browserExecutablePath ?? ''
  }

  if (!browserPathResult.success) {
    ElMessage.error(browserPathResult.error)
  } else {
    browserPathInfo.value = browserPathResult.data
  }

  loading.value = false
}

async function pickBrowserExecutable(): Promise<void> {
  const result = await window.api.system.pickBrowserExecutable()

  if (!result.success) {
    ElMessage.error(result.error)
    return
  }

  if (result.data) {
    form.browserExecutablePath = result.data
  }
}

async function saveSettings(): Promise<void> {
  saving.value = true
  const result = await window.api.system.updateSettings({
    browserExecutablePath: form.browserExecutablePath.trim() || undefined
  })

  if (!result.success) {
    ElMessage.error(result.error)
    saving.value = false
    return
  }

  ElMessage.success('Settings saved.')
  await loadSettings()
  saving.value = false
}

async function clearConfiguredPath(): Promise<void> {
  form.browserExecutablePath = ''
  await saveSettings()
}

onMounted(async () => {
  await loadSettings()
})
</script>

<template>
  <section class="settings-view">
    <div class="settings-card">
      <p class="eyebrow">Browser Runtime</p>
      <h2>Chromium executable</h2>
      <p class="settings-muted">
        Persist a custom Chromium path here. Launch will use the environment variable first, then
        this saved setting, then the built-in default.
      </p>

      <el-form label-position="top" class="settings-form">
        <el-form-item label="Saved browser executable path">
          <el-input
            v-model="form.browserExecutablePath"
            :disabled="loading"
            placeholder="Select chrome.exe or another Chromium executable"
          />
        </el-form-item>

        <div class="settings-actions">
          <el-button :icon="Setting" @click="pickBrowserExecutable">Browse</el-button>
          <el-button type="primary" :loading="saving" @click="saveSettings">Save</el-button>
          <el-button :disabled="saving || loading" @click="clearConfiguredPath"
            >Use Default</el-button
          >
        </div>
      </el-form>

      <el-descriptions :column="1" border size="small" class="settings-summary">
        <el-descriptions-item label="Resolved path">
          {{ browserPathInfo?.resolvedPath || 'Loading...' }}
        </el-descriptions-item>
        <el-descriptions-item label="Current source">
          {{ browserPathSourceLabel }}
        </el-descriptions-item>
      </el-descriptions>
    </div>

    <div class="settings-card">
      <p class="eyebrow">Storage Paths</p>
      <h2>Local app data</h2>

      <div class="settings-paths">
        <div class="settings-path-row">
          <el-icon><Folder /></el-icon>
          <span>{{ props.systemPaths?.userData || 'Loading...' }}</span>
        </div>
        <div class="settings-path-row">
          <el-icon><Folder /></el-icon>
          <span>{{ props.systemPaths?.profiles || 'Loading...' }}</span>
        </div>
        <div class="settings-path-row">
          <el-icon><Folder /></el-icon>
          <span>{{ props.systemPaths?.database || 'Loading...' }}</span>
        </div>
        <div class="settings-path-row">
          <el-icon><Folder /></el-icon>
          <span>{{ props.systemPaths?.logs || 'Loading...' }}</span>
        </div>
      </div>
    </div>
  </section>
</template>
