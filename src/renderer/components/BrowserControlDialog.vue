<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useLauncherStore } from '@renderer/stores/launcher'
import type { BrowserControlExecutionResult, BrowserControlTab } from '@shared/types'

const DEFAULT_SCRIPT = `const currentUrl = await page.url()
console.log('Current URL:', currentUrl)

await page.waitForSelector('body')

const summary = await page.evaluate(() => ({
  title: document.title,
  links: Array.from(document.querySelectorAll('a'))
    .slice(0, 5)
    .map((item) => ({
      text: item.textContent?.trim() ?? '',
      href: item.href
    }))
}))

return {
  currentUrl,
  ...summary
}`

const props = defineProps<{
  modelValue: boolean
  profileId: string | null
  profileName?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  closed: []
}>()

const launcherStore = useLauncherStore()

const tabs = ref<BrowserControlTab[]>([])
const selectedSessionId = ref('')
const timeoutMs = ref(30000)
const script = ref(DEFAULT_SCRIPT)
const loadingTabs = ref(false)
const runningScript = ref(false)
const executionResult = ref<BrowserControlExecutionResult | null>(null)

const dialogTitle = computed(() =>
  props.profileName ? `${props.profileName} · 控制` : '浏览器控制'
)

const canRun = computed(() => {
  return Boolean(props.profileId && tabs.value.length && script.value.trim() && !runningScript.value)
})

const helperMethods = [
  'page.goto(url)',
  'page.reload()',
  'page.url() / page.title()',
  'page.click(selector)',
  'page.fill(selector, value)',
  'page.type(selector, value)',
  'page.press(selector, key)',
  'page.waitForSelector(selector)',
  'page.waitForLoadState()',
  'page.evaluate(() => ...)',
  'browser.tabs()',
  'browser.activateTab(sessionId)',
  'browser.newTab(url)'
]

watch(
  () => [props.modelValue, props.profileId] as const,
  ([visible, profileId]) => {
    if (!visible || !profileId) {
      return
    }

    executionResult.value = null
    void loadTabs()
  },
  { immediate: true }
)

function handleDialogVisibleChange(value: boolean): void {
  emit('update:modelValue', value)
}

function handleClosed(): void {
  tabs.value = []
  selectedSessionId.value = ''
  executionResult.value = null
  emit('closed')
}

function formatTabLabel(tab: BrowserControlTab): string {
  const primaryLabel = tab.isPrimary ? '主标签 · ' : ''
  return `${primaryLabel}${tab.title || 'Untitled Tab'}`
}

function formatValue(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function applyTabSelection(nextTabs: BrowserControlTab[]): void {
  if (!nextTabs.length) {
    selectedSessionId.value = ''
    return
  }

  const stillSelected = nextTabs.some((tab) => tab.sessionId === selectedSessionId.value)

  if (stillSelected) {
    return
  }

  selectedSessionId.value = nextTabs[0].sessionId
}

async function loadTabs(showMessage = false): Promise<void> {
  if (!props.profileId) {
    tabs.value = []
    selectedSessionId.value = ''
    return
  }

  loadingTabs.value = true
  const result = await launcherStore.getControlTabs(props.profileId)
  loadingTabs.value = false

  if (!result) {
    tabs.value = []
    selectedSessionId.value = ''
    if (launcherStore.error) {
      ElMessage.error(launcherStore.error)
    }
    return
  }

  tabs.value = result
  applyTabSelection(result)

  if (!result.length && showMessage) {
    ElMessage.warning('当前没有可控制的标签页。')
  }
}

async function runScript(): Promise<void> {
  if (!props.profileId) {
    return
  }

  if (!script.value.trim()) {
    ElMessage.warning('请先输入要运行的脚本。')
    return
  }

  if (!selectedSessionId.value) {
    ElMessage.warning('请先选择一个标签页。')
    return
  }

  runningScript.value = true
  const result = await launcherStore.executeControl({
    profileId: props.profileId,
    sessionId: selectedSessionId.value,
    script: script.value,
    timeoutMs: timeoutMs.value
  })
  runningScript.value = false

  if (!result) {
    ElMessage.error(launcherStore.error || '脚本执行失败。')
    return
  }

  executionResult.value = result

  if (result.tab?.sessionId) {
    selectedSessionId.value = result.tab.sessionId
  }

  await loadTabs()

  if (result.success) {
    ElMessage.success('脚本执行完成。')
  } else if (result.error) {
    ElMessage.error(result.error)
  }
}

function resetScript(): void {
  script.value = DEFAULT_SCRIPT
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="dialogTitle"
    width="1120px"
    top="4vh"
    class="browser-control-dialog"
    @update:model-value="handleDialogVisibleChange"
    @closed="handleClosed"
  >
    <div class="control-panel">
      <div class="control-toolbar">
        <el-select
          v-model="selectedSessionId"
          class="control-toolbar__tabs"
          filterable
          placeholder="选择标签页"
          :loading="loadingTabs"
        >
          <el-option
            v-for="tab in tabs"
            :key="tab.sessionId"
            :label="formatTabLabel(tab)"
            :value="tab.sessionId"
          >
            <div class="tab-option">
              <strong>{{ formatTabLabel(tab) }}</strong>
              <span>{{ tab.url }}</span>
            </div>
          </el-option>
        </el-select>

        <el-input-number
          v-model="timeoutMs"
          :min="1000"
          :max="120000"
          :step="1000"
          controls-position="right"
        />

        <el-button :loading="loadingTabs" @click="loadTabs(true)">刷新标签</el-button>
        <el-button type="primary" :loading="runningScript" :disabled="!canRun" @click="runScript">
          运行脚本
        </el-button>
      </div>

      <div class="control-tip">
        这里运行的是 Playwright 风格的控制脚本。常见 DOM 读取请用
        <code>page.evaluate(() => ...)</code>，页面操作可以直接调用
        <code>page.goto</code>、<code>page.click</code>、<code>page.fill</code> 等 helper。
      </div>

      <div class="control-grid">
        <section class="panel-card panel-card--editor">
          <div class="panel-card__header">
            <div>
              <h3>脚本编辑器</h3>
              <p>脚本支持 <code>await</code> 和 <code>return</code>。</p>
            </div>

            <el-button text @click="resetScript">恢复示例</el-button>
          </div>

          <el-input
            v-model="script"
            type="textarea"
            class="script-editor"
            :autosize="{ minRows: 18, maxRows: 28 }"
            placeholder="输入控制脚本"
          />

          <div class="helper-list">
            <span>可用 helper</span>
            <div class="helper-list__chips">
              <code v-for="method in helperMethods" :key="method">{{ method }}</code>
            </div>
          </div>
        </section>

        <section class="panel-card panel-card--result">
          <div class="panel-card__header">
            <div>
              <h3>执行结果</h3>
              <p>返回值、日志和错误会展示在这里。</p>
            </div>
          </div>

          <div v-if="executionResult" class="result-shell">
            <div class="result-summary">
              <span
                class="result-summary__status"
                :class="
                  executionResult.success
                    ? 'result-summary__status--success'
                    : 'result-summary__status--error'
                "
              >
                {{ executionResult.success ? '执行成功' : '执行失败' }}
              </span>
              <span>耗时 {{ executionResult.durationMs }} ms</span>
              <span v-if="executionResult.tab">
                当前标签: {{ executionResult.tab.title || executionResult.tab.url }}
              </span>
            </div>

            <div v-if="executionResult.logs.length" class="result-block">
              <div class="result-block__title">控制台日志</div>
              <div class="result-log-list">
                <div
                  v-for="(entry, index) in executionResult.logs"
                  :key="`${entry.timestamp}-${index}`"
                  class="result-log-item"
                >
                  <strong>{{ entry.level.toUpperCase() }}</strong>
                  <span>{{ entry.timestamp }}</span>
                  <p>{{ entry.message }}</p>
                </div>
              </div>
            </div>

            <div v-if="executionResult.success" class="result-block">
              <div class="result-block__title">返回值</div>
              <pre>{{ formatValue(executionResult.result) }}</pre>
            </div>

            <div v-else class="result-block result-block--error">
              <div class="result-block__title">错误信息</div>
              <pre>{{ executionResult.error }}</pre>
            </div>
          </div>

          <el-empty
            v-else
            description="选择标签页并运行脚本后，这里会显示返回值和执行日志。"
          />
        </section>
      </div>
    </div>

    <template #footer>
      <el-button @click="handleDialogVisibleChange(false)">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.control-panel {
  display: grid;
  gap: 16px;
}

.control-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.control-toolbar__tabs {
  flex: 1 1 460px;
}

.tab-option {
  display: grid;
  gap: 4px;
  max-width: 100%;
}

.tab-option strong,
.tab-option span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-option span {
  color: #6b7280;
  font-size: 12px;
}

.control-tip {
  padding: 14px 16px;
  border-radius: 14px;
  background: #f8faff;
  border: 1px solid rgba(92, 102, 246, 0.14);
  color: #475569;
  line-height: 1.7;
}

.control-tip code,
.helper-list code {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(92, 102, 246, 0.08);
  color: #4f46e5;
}

.control-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
  gap: 16px;
}

.panel-card {
  min-width: 0;
  padding: 18px;
  border-radius: 18px;
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.2);
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.05);
}

.panel-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.panel-card__header h3 {
  margin: 0;
  color: #111827;
  font-size: 18px;
}

.panel-card__header p {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 13px;
}

.script-editor :deep(.el-textarea__inner) {
  min-height: 420px !important;
  font-family: 'Cascadia Code', 'SFMono-Regular', Consolas, monospace;
  line-height: 1.65;
}

.helper-list {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.helper-list > span,
.result-block__title {
  color: #334155;
  font-size: 13px;
  font-weight: 700;
}

.helper-list__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.result-shell {
  display: grid;
  gap: 14px;
}

.result-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.result-summary span {
  font-size: 13px;
  color: #475569;
}

.result-summary__status {
  padding: 6px 10px;
  border-radius: 999px;
  font-weight: 700;
}

.result-summary__status--success {
  color: #166534;
  background: #dcfce7;
}

.result-summary__status--error {
  color: #b91c1c;
  background: #fee2e2;
}

.result-block {
  display: grid;
  gap: 10px;
}

.result-block pre {
  margin: 0;
  padding: 14px;
  overflow: auto;
  border-radius: 14px;
  background: #0f172a;
  color: #dbeafe;
  font-size: 13px;
  line-height: 1.65;
  font-family: 'Cascadia Code', 'SFMono-Regular', Consolas, monospace;
}

.result-block--error pre {
  background: #3f1d1d;
  color: #fee2e2;
}

.result-log-list {
  display: grid;
  gap: 10px;
}

.result-log-item {
  padding: 12px 14px;
  border-radius: 14px;
  background: #f8fafc;
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.result-log-item strong {
  color: #4f46e5;
  font-size: 12px;
}

.result-log-item span {
  margin-left: 8px;
  color: #64748b;
  font-size: 12px;
}

.result-log-item p {
  margin: 8px 0 0;
  color: #0f172a;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 1080px) {
  .control-grid {
    grid-template-columns: 1fr;
  }
}
</style>
