<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowDown,
  CirclePlusFilled,
  CopyDocument,
  Delete,
  Download,
  EditPen,
  MoreFilled,
  Refresh,
  Search,
  Setting,
  Upload,
  VideoPause,
  VideoPlay,
  View
} from '@element-plus/icons-vue'
import { DEFAULT_BROWSER_CONFIG } from '@shared/constants'
import ProfileEditor from '@renderer/components/ProfileEditor.vue'
import { useLauncherStore } from '@renderer/stores/launcher'
import { useProfileStore } from '@renderer/stores/profiles'
import type { CreateProfileInput, Profile, UpdateProfileInput } from '@shared/types'

interface ExportPayload {
  version: number
  exportedAt: string
  profiles: CreateProfileInput[]
}

const emit = defineEmits<{
  'open-settings': []
}>()

const profileStore = useProfileStore()
const launcherStore = useLauncherStore()

const editorVisible = ref(false)
const editingProfileId = ref<string | null>(null)
const searchKeyword = ref('')
const groupFilter = ref('all')
const currentPage = ref(1)
const pageSize = ref(20)
const selectedProfileIds = ref<string[]>([])
const importInput = ref<HTMLInputElement | null>(null)

const editingProfile = computed<Profile | null>(() => {
  if (!editingProfileId.value) {
    return null
  }

  return profileStore.getProfileById(editingProfileId.value) ?? null
})

const sortedProfiles = computed(() => {
  return [...profileStore.profiles].sort((left, right) => {
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  })
})

const groupOptions = computed(() => {
  const entries = new Map<string, string>()

  for (const profile of profileStore.profiles) {
    const value = profile.groupId?.trim() || 'default'
    const label = profile.groupId?.trim() || '默认分组'
    entries.set(value, label)
  }

  return [
    { label: '按分组筛选', value: 'all' },
    ...Array.from(entries.entries()).map(([value, label]) => ({ label, value }))
  ]
})

const filteredProfiles = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()

  return sortedProfiles.value.filter((profile) => {
    const matchesGroup =
      groupFilter.value === 'all' ||
      (groupFilter.value === 'default' ? !profile.groupId : profile.groupId === groupFilter.value)

    if (!matchesGroup) {
      return false
    }

    if (!keyword) {
      return true
    }

    const haystack = [
      profile.name,
      profile.notes ?? '',
      profile.groupId ?? '',
      profile.proxyConfig?.host ?? ''
    ]
      .join(' ')
      .toLowerCase()

    return haystack.includes(keyword)
  })
})

const totalProfiles = computed(() => filteredProfiles.value.length)
const selectionCount = computed(() => selectedProfileIds.value.length)

const pagedProfiles = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredProfiles.value.slice(start, start + pageSize.value)
})

watch([searchKeyword, groupFilter, pageSize], () => {
  currentPage.value = 1
})

watch(totalProfiles, (total) => {
  const maxPage = Math.max(1, Math.ceil(total / pageSize.value))

  if (currentPage.value > maxPage) {
    currentPage.value = maxPage
  }
})

async function refresh(): Promise<void> {
  await Promise.all([profileStore.loadProfiles(), launcherStore.syncRunning()])
}

function openCreateDialog(): void {
  editingProfileId.value = null
  editorVisible.value = true
}

function openEditDialog(profileId: string): void {
  editingProfileId.value = profileId
  editorVisible.value = true
}

function handleSelectionChange(rows: Profile[]): void {
  selectedProfileIds.value = rows.map((row) => row.id)
}

function getRunningLabel(profileId: string): string {
  return launcherStore.isRunning(profileId) ? '运行中' : '未启动'
}

function getGroupLabel(profile: Profile): string {
  return profile.groupId?.trim() || '默认分组'
}

function getProxyLabel(profile: Profile): string {
  if (!profile.proxyConfig || profile.proxyConfig.type === 'none') {
    return '默认'
  }

  const address = profile.proxyConfig.host
    ? `${profile.proxyConfig.host}:${profile.proxyConfig.port}`
    : ''

  return `${profile.proxyConfig.type.toUpperCase()}${address ? ` : ${address}` : ''}`
}

function getNotesLabel(profile: Profile): string {
  return profile.notes?.trim() || '添加备注...'
}

function formatDate(value: string | number): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '--'
  }

  const pad = (input: number): string => String(input).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

function getActivityTime(profile: Profile): string {
  const runningInstance = launcherStore.runningInstances[profile.id]
  return runningInstance ? formatDate(runningInstance.startTime) : formatDate(profile.updatedAt)
}

function rowClassName({ row }: { row: Profile }): string {
  return launcherStore.isRunning(row.id) ? 'browser-table__row--running' : ''
}

async function handleSave(payload: CreateProfileInput | UpdateProfileInput): Promise<void> {
  const saved =
    'id' in payload
      ? await profileStore.updateProfile(payload)
      : await profileStore.createProfile(payload)

  if (saved) {
    ElMessage.success('浏览器配置已保存。')
    editorVisible.value = false
    editingProfileId.value = null
    await refresh()
  } else if (profileStore.error) {
    ElMessage.error(profileStore.error)
  }
}

async function handleDelete(profileId: string): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    '删除后会同时移除本地浏览器数据目录，这个操作不能撤销。',
    '删除浏览器',
    {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    }
  )
    .then(() => true)
    .catch(() => false)

  if (!confirmed) {
    return
  }

  const removed = await profileStore.deleteProfile({
    id: profileId,
    removeData: true
  })

  if (removed) {
    ElMessage.success('浏览器已删除。')
    await launcherStore.syncRunning()
  } else if (profileStore.error) {
    ElMessage.error(profileStore.error)
  }
}

async function handleClone(profileId: string): Promise<void> {
  const cloned = await profileStore.cloneProfile(profileId)

  if (cloned) {
    ElMessage.success('浏览器已克隆。')
    await refresh()
  } else if (profileStore.error) {
    ElMessage.error(profileStore.error)
  }
}

async function handleStart(profileId: string): Promise<void> {
  const started = await launcherStore.startProfile(profileId)

  if (!started && launcherStore.error) {
    ElMessage.error(launcherStore.error)
  }
}

async function handleStop(profileId: string): Promise<void> {
  const stopped = await launcherStore.stopProfile(profileId)

  if (!stopped && launcherStore.error) {
    ElMessage.error(launcherStore.error)
  }
}

async function handleVerify(profileId: string): Promise<void> {
  const verified = await launcherStore.verifyProfile(profileId)

  if (verified) {
    ElMessage.success('已在运行中的浏览器里打开验证页。')
  } else if (launcherStore.error) {
    ElMessage.error(launcherStore.error)
  }
}

async function openDirectory(path: string): Promise<void> {
  const result = await window.api.system.openDirectory({ path })

  if (!result.success) {
    ElMessage.error(result.error)
  }
}

async function handleRowCommand(command: string, profile: Profile): Promise<void> {
  if (command === 'clone') {
    await handleClone(profile.id)
    return
  }

  if (command === 'directory') {
    await openDirectory(profile.storagePath)
  }
}

function onRowCommand(profile: Profile, command: string | number | object): void {
  void handleRowCommand(String(command), profile)
}

async function handleBatchCommand(command: string): Promise<void> {
  if (!selectedProfileIds.value.length) {
    ElMessage.warning('请先选择至少一个浏览器。')
    return
  }

  if (command === 'delete') {
    const confirmed = await ElMessageBox.confirm(
      `确定删除已选中的 ${selectedProfileIds.value.length} 个浏览器吗？`,
      '批量删除',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
      .then(() => true)
      .catch(() => false)

    if (!confirmed) {
      return
    }
  }

  let successCount = 0

  for (const profileId of selectedProfileIds.value) {
    if (command === 'start') {
      if (await launcherStore.startProfile(profileId)) {
        successCount += 1
      }
      continue
    }

    if (command === 'stop') {
      if (await launcherStore.stopProfile(profileId)) {
        successCount += 1
      }
      continue
    }

    if (command === 'verify') {
      if (await launcherStore.verifyProfile(profileId)) {
        successCount += 1
      }
      continue
    }

    if (command === 'clone') {
      if (await profileStore.cloneProfile(profileId)) {
        successCount += 1
      }
      continue
    }

    if (command === 'delete') {
      if (
        await profileStore.deleteProfile({
          id: profileId,
          removeData: true
        })
      ) {
        successCount += 1
      }
    }
  }

  if (command === 'clone' || command === 'delete') {
    await profileStore.loadProfiles()
  }

  await launcherStore.syncRunning()

  if (successCount > 0) {
    ElMessage.success(`批量操作完成，成功处理 ${successCount} 个浏览器。`)
  } else if (profileStore.error || launcherStore.error) {
    ElMessage.error(profileStore.error || launcherStore.error || '批量操作失败。')
  }
}

function exportProfiles(): void {
  const exportSource = selectedProfileIds.value.length
    ? filteredProfiles.value.filter((profile) => selectedProfileIds.value.includes(profile.id))
    : filteredProfiles.value

  if (!exportSource.length) {
    ElMessage.warning('没有可导出的浏览器配置。')
    return
  }

  const payload: ExportPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles: exportSource.map((profile) => ({
      name: profile.name,
      notes: profile.notes,
      browserConfig: profile.browserConfig,
      proxyConfig: profile.proxyConfig,
      fingerprintEnabled: profile.fingerprintEnabled,
      fingerprintOs: profile.fingerprintOs,
      fingerprintConfig: profile.fingerprintConfig,
      groupId: profile.groupId
    }))
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8'
  })
  const downloadUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = downloadUrl
  anchor.download = `xuss-browser-profiles-${Date.now()}.json`
  anchor.click()
  URL.revokeObjectURL(downloadUrl)

  ElMessage.success('浏览器配置已导出。')
}

function triggerImport(): void {
  importInput.value?.click()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeImportedProfiles(payload: unknown): CreateProfileInput[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord).map(toImportedProfile)
  }

  if (isRecord(payload) && Array.isArray(payload.profiles)) {
    return payload.profiles.filter(isRecord).map(toImportedProfile)
  }

  return []
}

function toImportedProfile(source: Record<string, unknown>): CreateProfileInput {
  const browserConfig = isRecord(source.browserConfig) ? source.browserConfig : {}
  const windowConfig = isRecord(browserConfig.window) ? browserConfig.window : {}
  const proxyConfig = isRecord(source.proxyConfig) ? source.proxyConfig : undefined

  return {
    name: String(source.name || `导入浏览器 ${Math.floor(Math.random() * 1000)}`),
    notes: typeof source.notes === 'string' ? source.notes : undefined,
    browserConfig: {
      locale:
        typeof browserConfig.locale === 'string'
          ? browserConfig.locale
          : DEFAULT_BROWSER_CONFIG.locale,
      timezone:
        typeof browserConfig.timezone === 'string'
          ? browserConfig.timezone
          : DEFAULT_BROWSER_CONFIG.timezone,
      colorScheme:
        browserConfig.colorScheme === 'light' ||
        browserConfig.colorScheme === 'dark' ||
        browserConfig.colorScheme === 'system'
          ? browserConfig.colorScheme
          : DEFAULT_BROWSER_CONFIG.colorScheme,
      homeUrl:
        typeof browserConfig.homeUrl === 'string'
          ? browserConfig.homeUrl
          : DEFAULT_BROWSER_CONFIG.homeUrl,
      window: {
        width:
          typeof windowConfig.width === 'number'
            ? windowConfig.width
            : DEFAULT_BROWSER_CONFIG.window.width,
        height:
          typeof windowConfig.height === 'number'
            ? windowConfig.height
            : DEFAULT_BROWSER_CONFIG.window.height,
        pixelRatio:
          typeof windowConfig.pixelRatio === 'number'
            ? windowConfig.pixelRatio
            : DEFAULT_BROWSER_CONFIG.window.pixelRatio
      }
    },
    proxyConfig:
      proxyConfig &&
      (proxyConfig.type === 'none' ||
        proxyConfig.type === 'http' ||
        proxyConfig.type === 'https' ||
        proxyConfig.type === 'socks5') &&
      typeof proxyConfig.host === 'string' &&
      typeof proxyConfig.port === 'number'
        ? {
            type: proxyConfig.type,
            host: proxyConfig.host,
            port: proxyConfig.port,
            username: typeof proxyConfig.username === 'string' ? proxyConfig.username : undefined,
            password: typeof proxyConfig.password === 'string' ? proxyConfig.password : undefined
          }
        : undefined,
    fingerprintEnabled:
      typeof source.fingerprintEnabled === 'boolean' ? source.fingerprintEnabled : true,
    fingerprintOs:
      source.fingerprintOs === 'win10' ||
      source.fingerprintOs === 'win11' ||
      source.fingerprintOs === 'macos' ||
      source.fingerprintOs === 'linux'
        ? source.fingerprintOs
        : undefined,
    fingerprintConfig: isRecord(source.fingerprintConfig)
      ? (source.fingerprintConfig as unknown as CreateProfileInput['fingerprintConfig'])
      : undefined,
    groupId: typeof source.groupId === 'string' ? source.groupId : undefined
  }
}

async function handleImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  if (!file) {
    return
  }

  try {
    const content = await file.text()
    const imported = normalizeImportedProfiles(JSON.parse(content))

    if (!imported.length) {
      ElMessage.error('导入文件中没有识别到可用的浏览器配置。')
      input.value = ''
      return
    }

    let successCount = 0

    for (const payload of imported) {
      const created = await profileStore.createProfile(payload)

      if (created) {
        successCount += 1
      }
    }

    if (successCount > 0) {
      ElMessage.success(`成功导入 ${successCount} 个浏览器配置。`)
      await refresh()
    } else if (profileStore.error) {
      ElMessage.error(profileStore.error)
    }
  } catch {
    ElMessage.error('导入失败，请检查 JSON 格式。')
  } finally {
    input.value = ''
  }
}

onMounted(async () => {
  launcherStore.setupListeners()
  await refresh()
})
</script>

<template>
  <section class="browser-list-page">
    <div class="page-head">
      <div>
        <p class="page-head__eyebrow">BROWSER WORKSPACE</p>
        <h2>浏览器列表</h2>
        <p>统一管理本地浏览器、指纹、代理和启动状态。</p>
      </div>

      <div class="page-head__stats">
        <div>
          <span>浏览器总数</span>
          <strong>{{ profileStore.profiles.length }}</strong>
        </div>
        <div>
          <span>运行中</span>
          <strong>{{ launcherStore.runningCount }}</strong>
        </div>
        <div>
          <span>已选中</span>
          <strong>{{ selectionCount }}</strong>
        </div>
      </div>
    </div>

    <el-alert
      v-if="profileStore.error"
      type="error"
      :closable="false"
      :title="profileStore.error"
      class="list-alert"
    />

    <div class="panel-card list-panel">
      <div class="list-toolbar">
        <div class="list-toolbar__left">
          <el-button class="toolbar-btn toolbar-btn--accent" @click="openCreateDialog">
            <el-icon><CirclePlusFilled /></el-icon>
            <span>创建浏览器</span>
          </el-button>

          <el-dropdown @command="handleBatchCommand">
            <el-button class="toolbar-btn toolbar-btn--accent">
              <span>批量操作</span>
              <el-icon><ArrowDown /></el-icon>
            </el-button>

            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="start">批量启动</el-dropdown-item>
                <el-dropdown-item command="stop">批量停止</el-dropdown-item>
                <el-dropdown-item command="verify">批量验证</el-dropdown-item>
                <el-dropdown-item command="clone">批量克隆</el-dropdown-item>
                <el-dropdown-item command="delete" divided>批量删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>

          <el-button class="toolbar-btn toolbar-btn--accent toolbar-btn--ghost" @click="refresh">
            <el-icon><Refresh /></el-icon>
            <span>同步器</span>
          </el-button>
        </div>

        <div class="list-toolbar__right">
          <el-select v-model="groupFilter" class="toolbar-select">
            <el-option
              v-for="option in groupOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>

          <el-input v-model="searchKeyword" class="toolbar-search" placeholder="名称">
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>

          <el-button class="toolbar-btn toolbar-btn--plain" @click="emit('open-settings')">
            <el-icon><Setting /></el-icon>
            <span>设置</span>
          </el-button>

          <el-button class="toolbar-btn toolbar-btn--plain" @click="triggerImport">
            <el-icon><Upload /></el-icon>
            <span>导入</span>
          </el-button>

          <el-button class="toolbar-btn toolbar-btn--plain" @click="exportProfiles">
            <el-icon><Download /></el-icon>
            <span>导出</span>
          </el-button>
        </div>
      </div>

      <el-table
        v-loading="profileStore.loading || launcherStore.loading"
        :data="pagedProfiles"
        row-key="id"
        border
        class="browser-table"
        :row-class-name="rowClassName"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="58" align="center" />

        <el-table-column label="序号" width="90" align="center">
          <template #default="scope">
            {{ (currentPage - 1) * pageSize + scope.$index + 1 }}
          </template>
        </el-table-column>

        <el-table-column label="名称" min-width="180">
          <template #default="scope">
            <div class="name-cell">
              <strong>{{ scope.row.name }}</strong>
              <span>{{ getRunningLabel(scope.row.id) }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="分组" width="150">
          <template #default="scope">
            <span class="group-tag">{{ getGroupLabel(scope.row) }}</span>
          </template>
        </el-table-column>

        <el-table-column label="代理" min-width="160">
          <template #default="scope">
            {{ getProxyLabel(scope.row) }}
          </template>
        </el-table-column>

        <el-table-column label="备注" min-width="160" show-overflow-tooltip>
          <template #default="scope">
            {{ getNotesLabel(scope.row) }}
          </template>
        </el-table-column>

        <el-table-column label="最近活动时间" width="190">
          <template #default="scope">
            {{ getActivityTime(scope.row) }}
          </template>
        </el-table-column>

        <el-table-column label="启动" width="150" align="center">
          <template #default="scope">
            <el-button
              class="table-action table-action--run"
              @click="
                launcherStore.isRunning(scope.row.id)
                  ? handleStop(scope.row.id)
                  : handleStart(scope.row.id)
              "
            >
              <el-icon>
                <VideoPause v-if="launcherStore.isRunning(scope.row.id)" />
                <VideoPlay v-else />
              </el-icon>
              <span>{{ launcherStore.isRunning(scope.row.id) ? '停止' : '启动' }}</span>
            </el-button>
          </template>
        </el-table-column>

        <el-table-column label="操作" min-width="290" align="center">
          <template #default="scope">
            <div class="table-actions">
              <el-button
                class="table-action table-action--verify"
                @click="handleVerify(scope.row.id)"
              >
                <el-icon><View /></el-icon>
                <span>验证</span>
              </el-button>

              <el-button
                class="table-action table-action--edit"
                @click="openEditDialog(scope.row.id)"
              >
                <el-icon><EditPen /></el-icon>
                <span>编辑</span>
              </el-button>

              <el-button
                class="table-action table-action--delete"
                @click="handleDelete(scope.row.id)"
              >
                <el-icon><Delete /></el-icon>
                <span>删除</span>
              </el-button>

              <el-dropdown @command="onRowCommand(scope.row, $event)">
                <el-button class="table-action table-action--more" circle>
                  <el-icon><MoreFilled /></el-icon>
                </el-button>

                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="clone">
                      <el-icon><CopyDocument /></el-icon>
                      <span>克隆浏览器</span>
                    </el-dropdown-item>
                    <el-dropdown-item command="directory">
                      <el-icon><Setting /></el-icon>
                      <span>打开目录</span>
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div class="list-footer">
        <span>共 {{ totalProfiles }} 条</span>
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="totalProfiles"
          layout="sizes, prev, pager, next, jumper"
        />
      </div>
    </div>

    <input
      ref="importInput"
      type="file"
      accept="application/json,.json"
      hidden
      @change="handleImportFile"
    />

    <profile-editor
      v-model="editorVisible"
      :profile="editingProfile"
      :saving="profileStore.saving"
      @save="handleSave"
    />
  </section>
</template>

<style scoped>
.browser-list-page {
  display: grid;
  gap: 16px;
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

.page-head__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 1fr));
  gap: 12px;
  min-width: 420px;
}

.page-head__stats div {
  display: grid;
  gap: 6px;
  padding: 16px 18px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: #ffffff;
}

.page-head__stats span {
  color: var(--text-secondary);
  font-size: 12px;
}

.page-head__stats strong {
  color: var(--text-primary);
  font-size: 22px;
}

.list-alert {
  margin-bottom: 4px;
}

.list-panel {
  padding: 18px 22px 8px;
}

.list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.list-toolbar__left,
.list-toolbar__right,
.table-actions,
.name-cell {
  display: flex;
  align-items: center;
}

.list-toolbar__left,
.list-toolbar__right {
  flex-wrap: wrap;
  gap: 12px;
}

.toolbar-select {
  width: 188px;
}

.toolbar-search {
  width: 160px;
}

.toolbar-btn {
  height: 40px;
  padding: 0 18px;
  border-radius: 6px;
  font-weight: 600;
}

.toolbar-btn :deep(.el-icon) {
  margin-right: 8px;
}

.toolbar-btn--accent {
  color: #ffffff;
  border-color: var(--accent-color);
  background: linear-gradient(135deg, #7568f4 0%, #685bec 100%);
}

.toolbar-btn--accent:hover {
  color: #ffffff;
  border-color: var(--accent-color-strong);
  background: linear-gradient(135deg, #685bec 0%, #5f52e9 100%);
}

.toolbar-btn--ghost {
  background: linear-gradient(135deg, #7c73f1 0%, #7267ee 100%);
}

.toolbar-btn--plain {
  color: var(--text-primary);
  border-color: var(--border-color-strong);
  background: #ffffff;
}

.toolbar-btn--plain:hover {
  color: var(--accent-color);
  border-color: var(--accent-color);
  background: #f8f7ff;
}

.browser-table {
  margin-top: 8px;
}

.browser-table :deep(.el-table__header-wrapper th) {
  height: 62px;
  padding: 0;
  background: #ffffff;
  color: #7f8ca3;
  font-size: 14px;
  font-weight: 600;
}

.browser-table :deep(.el-table__row td) {
  height: 72px;
  color: var(--text-primary);
}

.browser-table :deep(.browser-table__row--running td) {
  background: #fbfcff;
}

.name-cell {
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.name-cell strong {
  color: var(--text-primary);
  font-size: 15px;
}

.name-cell span {
  color: #6b778c;
  font-size: 12px;
}

.group-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 74px;
  padding: 6px 12px;
  border: 1px solid #dddafe;
  border-radius: 8px;
  background: #f3f1ff;
  color: var(--accent-color);
  font-size: 13px;
}

.table-actions {
  justify-content: center;
  gap: 8px;
}

.table-action {
  height: 40px;
  padding: 0 16px;
  border: none;
  border-radius: 6px;
  font-weight: 600;
}

.table-action :deep(.el-icon) {
  margin-right: 6px;
}

.table-action--run,
.table-action--edit {
  color: #ffffff;
  background: linear-gradient(135deg, #7568f4 0%, #6658eb 100%);
}

.table-action--run:hover,
.table-action--edit:hover {
  color: #ffffff;
  background: linear-gradient(135deg, #685bec 0%, #594ce2 100%);
}

.table-action--verify {
  color: var(--accent-color);
  border: 1px solid #d9d6ff;
  background: #f8f7ff;
}

.table-action--delete {
  color: #ffffff;
  background: linear-gradient(135deg, #ff6668 0%, #ff4d4f 100%);
}

.table-action--delete:hover {
  color: #ffffff;
  background: linear-gradient(135deg, #ff5759 0%, #f43d3f 100%);
}

.table-action--more {
  width: 40px;
  padding: 0;
  color: var(--text-secondary);
  border: 1px solid var(--border-color-strong);
  background: #ffffff;
}

.table-action--more :deep(.el-icon) {
  margin-right: 0;
}

.list-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 20px;
  padding: 18px 0 10px;
  color: var(--text-secondary);
}

@media (max-width: 1280px) {
  .page-head,
  .list-toolbar {
    flex-direction: column;
    align-items: flex-start;
  }

  .page-head__stats {
    min-width: 0;
    width: 100%;
  }

  .list-toolbar__right {
    width: 100%;
  }
}

@media (max-width: 900px) {
  .page-head__stats {
    grid-template-columns: 1fr;
  }

  .toolbar-select,
  .toolbar-search {
    width: 100%;
  }

  .list-panel {
    padding: 16px;
  }

  .list-footer {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
