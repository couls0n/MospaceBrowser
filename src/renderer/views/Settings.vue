<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Folder, Setting } from '@element-plus/icons-vue'
import type { BrowserExecutablePathInfo, SystemPaths } from '@shared/types'

const props = defineProps<{
  systemPaths: SystemPaths | null
}>()

const emit = defineEmits<{
  back: []
}>()

const loading = ref(false)
const saving = ref(false)
const browserPathInfo = ref<BrowserExecutablePathInfo | null>(null)
const form = reactive({
  browserExecutablePath: ''
})

const browserPathSourceLabel = computed(() => {
  if (!browserPathInfo.value) {
    return '读取中'
  }

  if (browserPathInfo.value.source === 'environment') {
    return '环境变量覆盖'
  }

  if (browserPathInfo.value.source === 'settings') {
    return '应用设置'
  }

  if (browserPathInfo.value.source === 'auto-detected') {
    return '自动检测'
  }

  return '内置默认值'
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

  ElMessage.success('设置已保存。')
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
  <section class="settings-page">
    <div class="page-head">
      <div>
        <p class="page-head__eyebrow">SYSTEM SETTINGS</p>
        <h2>浏览器与存储设置</h2>
        <p>配置 Chromium 路径、查看本地存储目录，并保持启动环境一致。</p>
      </div>

      <el-button class="settings-back-btn" @click="emit('back')">返回浏览器列表</el-button>
    </div>

    <div class="settings-grid">
      <div class="panel-card settings-card">
        <div class="settings-card__head">
          <div>
            <p class="settings-card__eyebrow">Browser Runtime</p>
            <h3>Chromium 可执行文件</h3>
          </div>
          <el-tag type="info" effect="plain">{{ browserPathSourceLabel }}</el-tag>
        </div>

        <p class="settings-card__copy">
          启动顺序会优先使用环境变量，其次使用这里保存的路径，最后回退到应用内置默认路径。
        </p>

        <el-form label-position="top" class="settings-form">
          <el-form-item label="浏览器路径">
            <el-input
              v-model="form.browserExecutablePath"
              :disabled="loading"
              placeholder="请选择 chrome.exe 或其他 Chromium 内核浏览器"
            />
          </el-form-item>

          <div class="settings-actions">
            <el-button :icon="Setting" @click="pickBrowserExecutable">浏览</el-button>
            <el-button type="primary" :loading="saving" @click="saveSettings">保存</el-button>
            <el-button :disabled="saving || loading" @click="clearConfiguredPath"
              >恢复默认</el-button
            >
          </div>
        </el-form>

        <div class="settings-summary">
          <div>
            <span>当前解析路径</span>
            <strong>{{ browserPathInfo?.resolvedPath || '读取中...' }}</strong>
          </div>
        </div>
      </div>

      <div class="panel-card settings-card">
        <div class="settings-card__head">
          <div>
            <p class="settings-card__eyebrow">Local Storage</p>
            <h3>本地数据目录</h3>
          </div>
        </div>

        <div class="path-list">
          <div class="path-item">
            <el-icon><Folder /></el-icon>
            <div>
              <span>用户数据目录</span>
              <strong>{{ props.systemPaths?.userData || '读取中...' }}</strong>
            </div>
          </div>

          <div class="path-item">
            <el-icon><Folder /></el-icon>
            <div>
              <span>浏览器配置目录</span>
              <strong>{{ props.systemPaths?.profiles || '读取中...' }}</strong>
            </div>
          </div>

          <div class="path-item">
            <el-icon><Folder /></el-icon>
            <div>
              <span>数据库目录</span>
              <strong>{{ props.systemPaths?.database || '读取中...' }}</strong>
            </div>
          </div>

          <div class="path-item">
            <el-icon><Folder /></el-icon>
            <div>
              <span>日志目录</span>
              <strong>{{ props.systemPaths?.logs || '读取中...' }}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings-page {
  display: grid;
  gap: 18px;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.page-head__eyebrow {
  margin: 0 0 8px;
  color: var(--accent-color);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.18em;
}

.page-head h2 {
  margin: 0;
  font-size: 28px;
  color: var(--text-primary);
}

.page-head p {
  margin: 8px 0 0;
  color: var(--text-secondary);
}

.settings-back-btn {
  height: 40px;
  padding: 0 18px;
  border-radius: 6px;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.settings-card {
  padding: 24px;
}

.settings-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.settings-card__eyebrow {
  margin: 0 0 8px;
  color: var(--accent-color);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.settings-card h3 {
  margin: 0;
  font-size: 22px;
  color: var(--text-primary);
}

.settings-card__copy {
  margin: 12px 0 20px;
  color: var(--text-secondary);
  line-height: 1.8;
}

.settings-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.settings-summary {
  margin-top: 20px;
  padding: 18px;
  border-radius: 14px;
  background: #f7f8fc;
}

.settings-summary span,
.path-item span {
  display: block;
  margin-bottom: 6px;
  color: var(--text-secondary);
  font-size: 13px;
}

.settings-summary strong,
.path-item strong {
  color: var(--text-primary);
  word-break: break-all;
}

.path-list {
  display: grid;
  gap: 14px;
}

.path-item {
  display: flex;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 14px;
  background: #f7f8fc;
}

.path-item .el-icon {
  margin-top: 2px;
  color: var(--accent-color);
  font-size: 18px;
}

@media (max-width: 1100px) {
  .page-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .settings-grid {
    grid-template-columns: 1fr;
  }
}
</style>
