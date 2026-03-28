<script setup lang="ts">
import { computed, reactive, ref, toRaw, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { DEFAULT_BROWSER_CONFIG, OS_TYPES } from '@shared/constants'
import { useFingerprintStore } from '@renderer/stores/fingerprint'
import { useGroupStore } from '@renderer/stores/groups'
import {
  COLOR_DEPTH_OPTIONS,
  COMMON_LOCALE_OPTIONS,
  CPU_CORE_OPTIONS,
  MEMORY_OPTIONS,
  PIXEL_RATIO_OPTIONS,
  getFontOptions,
  getGpuRendererOptions,
  getGpuVendorOptions,
  getScreenPresets,
  getTimezoneOptions
} from '@renderer/utils/fingerprintPresets'
import type {
  CreateProfileInput,
  FingerprintConfig,
  OSType,
  Profile,
  UpdateProfileInput
} from '@shared/types'

type FingerprintMode = 'default' | 'custom'

interface ProfileFormState {
  name: string
  groupId: string
  notes: string
  locale: string
  timezone: string
  colorScheme: 'system' | 'light' | 'dark'
  homeUrl: string
  width: number
  height: number
  pixelRatio: number
  proxyType: 'none' | 'http' | 'https' | 'socks5'
  proxyHost: string
  proxyPort: number
  proxyUsername: string
  proxyPassword: string
  selectedOS: OSType | 'random'
  enableFingerprint: boolean
}

const props = defineProps<{
  modelValue: boolean
  profile?: Profile | null
  saving?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [payload: CreateProfileInput | UpdateProfileInput]
}>()

const fingerprintStore = useFingerprintStore()
const groupStore = useGroupStore()
const isEditMode = computed(() => Boolean(props.profile))
const fingerprintMode = ref<FingerprintMode>('default')
const defaultFingerprint = ref<FingerprintConfig | null>(null)
const fingerprintSeed = ref('')
const isResetting = ref(false)

const form = reactive<ProfileFormState>({
  name: '',
  groupId: '',
  notes: '',
  locale: DEFAULT_BROWSER_CONFIG.locale,
  timezone: DEFAULT_BROWSER_CONFIG.timezone,
  colorScheme: DEFAULT_BROWSER_CONFIG.colorScheme,
  homeUrl: DEFAULT_BROWSER_CONFIG.homeUrl,
  width: DEFAULT_BROWSER_CONFIG.window.width,
  height: DEFAULT_BROWSER_CONFIG.window.height,
  pixelRatio: DEFAULT_BROWSER_CONFIG.window.pixelRatio,
  proxyType: 'none',
  proxyHost: '',
  proxyPort: 8080,
  proxyUsername: '',
  proxyPassword: '',
  selectedOS: 'random',
  enableFingerprint: true
})

function cloneFingerprintConfig(
  config?: FingerprintConfig | null
): FingerprintConfig | null | undefined {
  if (config === null) {
    return null
  }

  if (!config) {
    return undefined
  }

  return structuredClone(toRaw(config))
}

function buildOptionList(values: string[], currentValue: string): string[] {
  return Array.from(new Set([currentValue, ...values].filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  )
}

function resolveFingerprintPresetOs(config?: FingerprintConfig | null): OSType {
  if (form.selectedOS !== 'random') {
    return form.selectedOS
  }

  if (!config) {
    return OS_TYPES.WIN10
  }

  if (config.software.platform === 'MacIntel') {
    return OS_TYPES.MACOS
  }

  if (config.software.platform.includes('Linux')) {
    return OS_TYPES.LINUX
  }

  if (config.userAgent.includes('Windows')) {
    return OS_TYPES.WIN10
  }

  return OS_TYPES.WIN10
}

function getFingerprintSeed(randomize = false): string {
  if (randomize || !fingerprintSeed.value) {
    fingerprintSeed.value = randomize ? crypto.randomUUID() : (props.profile?.id ?? crypto.randomUUID())
  }

  return fingerprintSeed.value
}

function getFingerprintGenerationOptions(apply: boolean): {
  seed: string
  options: { os?: OSType; locale: string; timezone: string; apply: boolean }
} {
  return {
    seed: getFingerprintSeed(),
    options: {
      os: form.selectedOS === 'random' ? undefined : form.selectedOS,
      locale: form.locale.trim() || DEFAULT_BROWSER_CONFIG.locale,
      timezone: form.timezone.trim() || DEFAULT_BROWSER_CONFIG.timezone,
      apply
    }
  }
}

const localeOptions = computed(() => buildOptionList(COMMON_LOCALE_OPTIONS, form.locale))
const timezoneOptions = computed(() => buildOptionList(getTimezoneOptions(), form.timezone))
const groupOptions = computed(() => groupStore.groups)
const currentFingerprint = computed(() => fingerprintStore.currentFingerprint)
const presetOs = computed(() => resolveFingerprintPresetOs(currentFingerprint.value ?? defaultFingerprint.value))
const screenPresets = computed(() => getScreenPresets(presetOs.value))
const fontOptions = computed(() =>
  buildOptionList(getFontOptions(presetOs.value), currentFingerprint.value?.hardware.fonts[0] ?? '')
)
const gpuVendorOptions = computed(() =>
  buildOptionList(getGpuVendorOptions(presetOs.value), currentFingerprint.value?.hardware.gpu.vendor ?? '')
)
const gpuRendererOptions = computed(() =>
  buildOptionList(
    getGpuRendererOptions(presetOs.value, currentFingerprint.value?.hardware.gpu.vendor),
    currentFingerprint.value?.hardware.gpu.renderer ?? ''
  )
)

const fingerprintSummary = computed(() => {
  const config = currentFingerprint.value ?? defaultFingerprint.value

  if (!config) {
    return null
  }

  const os =
    config.software.platform === 'MacIntel'
      ? 'macOS'
      : config.software.platform.includes('Linux')
        ? 'Linux'
        : 'Windows'
  const browserVersion = config.userAgent.match(/(?:Chrome|Edg|OPR|Vivaldi)\/([\d.]+)/)?.[1] ?? 'Chrome'

  return {
    os,
    browser: `Chrome ${browserVersion}`,
    resolution: `${config.hardware.screen.width} x ${config.hardware.screen.height}`,
    cpuCores: config.hardware.cpuCores,
    memory: `${config.hardware.memory} GB`,
    timezone: config.software.timezone,
    locale: config.software.locale,
    gpuVendor: config.hardware.gpu.vendor,
    fontCount: config.hardware.fonts.length,
    dnt: config.software.doNotTrack ? '开启' : '关闭'
  }
})

function syncLocaleTimezoneToFingerprints(): void {
  if (defaultFingerprint.value) {
    defaultFingerprint.value.software.locale = form.locale
    defaultFingerprint.value.software.timezone = form.timezone
  }

  if (fingerprintStore.currentFingerprint) {
    fingerprintStore.currentFingerprint.software.locale = form.locale
    fingerprintStore.currentFingerprint.software.timezone = form.timezone
  }
}

function resetForm(profile?: Profile | null): void {
  isResetting.value = true

  form.name = profile?.name ?? ''
  form.groupId = profile?.groupId ?? ''
  form.notes = profile?.notes ?? ''
  form.locale = profile?.browserConfig.locale ?? DEFAULT_BROWSER_CONFIG.locale
  form.timezone = profile?.browserConfig.timezone ?? DEFAULT_BROWSER_CONFIG.timezone
  form.colorScheme = profile?.browserConfig.colorScheme ?? DEFAULT_BROWSER_CONFIG.colorScheme
  form.homeUrl = profile?.browserConfig.homeUrl ?? DEFAULT_BROWSER_CONFIG.homeUrl
  form.width = profile?.browserConfig.window.width ?? DEFAULT_BROWSER_CONFIG.window.width
  form.height = profile?.browserConfig.window.height ?? DEFAULT_BROWSER_CONFIG.window.height
  form.pixelRatio =
    profile?.browserConfig.window.pixelRatio ?? DEFAULT_BROWSER_CONFIG.window.pixelRatio
  form.proxyType = profile?.proxyConfig?.type ?? 'none'
  form.proxyHost = profile?.proxyConfig?.host ?? ''
  form.proxyPort = profile?.proxyConfig?.port ?? 8080
  form.proxyUsername = profile?.proxyConfig?.username ?? ''
  form.proxyPassword = profile?.proxyConfig?.password ?? ''
  form.selectedOS = profile?.fingerprintOs ?? 'random'
  form.enableFingerprint = profile?.fingerprintEnabled ?? true

  fingerprintSeed.value = profile?.id ?? crypto.randomUUID()
  defaultFingerprint.value = cloneFingerprintConfig(profile?.fingerprintConfig) ?? null
  fingerprintStore.setFingerprint(cloneFingerprintConfig(profile?.fingerprintConfig) ?? null)
  fingerprintMode.value = profile?.fingerprintConfig ? 'custom' : 'default'

  isResetting.value = false

  if (form.enableFingerprint && !profile?.fingerprintConfig) {
    void refreshDefaultFingerprint({ applyToCurrent: true })
  }
}

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      void groupStore.loadGroups()
      resetForm(props.profile)
    }
  }
)

watch(
  () => form.enableFingerprint,
  (enabled) => {
    if (isResetting.value || !props.modelValue) {
      return
    }

    if (!enabled) {
      defaultFingerprint.value = null
      fingerprintStore.clearFingerprint()
      return
    }

    if (!fingerprintStore.currentFingerprint) {
      void refreshDefaultFingerprint({ applyToCurrent: fingerprintMode.value === 'default' })
    }
  }
)

watch(
  () => [form.locale, form.timezone],
  () => {
    if (isResetting.value) {
      return
    }

    syncLocaleTimezoneToFingerprints()

    if (props.modelValue && form.enableFingerprint && fingerprintMode.value === 'default') {
      void refreshDefaultFingerprint({ applyToCurrent: true })
    }
  }
)

watch(
  () => form.selectedOS,
  () => {
    if (isResetting.value) {
      return
    }

    if (props.modelValue && form.enableFingerprint && fingerprintMode.value === 'default') {
      void refreshDefaultFingerprint({ applyToCurrent: true })
    }
  }
)

function closeDialog(): void {
  emit('update:modelValue', false)
}

function normalizeHomeUrl(input: string): string {
  const trimmed = input.trim()

  if (!trimmed) {
    return DEFAULT_BROWSER_CONFIG.homeUrl
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  return `https://${trimmed}`
}

function validateBasicInfo(): boolean {
  form.name = form.name.trim()
  form.notes = form.notes.trim()
  form.locale = form.locale.trim()
  form.timezone = form.timezone.trim()
  form.homeUrl = normalizeHomeUrl(form.homeUrl)

  if (!form.name) {
    ElMessage.warning('请先填写浏览器名称。')
    return false
  }

  try {
    new URL(form.homeUrl)
  } catch {
    ElMessage.warning('首页地址格式不正确，请输入完整网址或域名。')
    return false
  }

  if (!form.locale) {
    ElMessage.warning('请选择或输入语言。')
    return false
  }

  if (!form.timezone) {
    ElMessage.warning('请选择或输入时区。')
    return false
  }

  return true
}

function validateProxy(): boolean {
  if (form.proxyType === 'none') {
    return true
  }

  form.proxyHost = form.proxyHost.trim()

  if (!form.proxyHost) {
    ElMessage.warning('启用代理时，代理地址不能为空。')
    return false
  }

  if (!Number.isInteger(form.proxyPort) || form.proxyPort < 1 || form.proxyPort > 65535) {
    ElMessage.warning('代理端口需要在 1 到 65535 之间。')
    return false
  }

  return true
}

async function refreshDefaultFingerprint(options: {
  randomizeSeed?: boolean
  applyToCurrent?: boolean
} = {}): Promise<FingerprintConfig | null> {
  if (!form.enableFingerprint) {
    defaultFingerprint.value = null
    fingerprintStore.clearFingerprint()
    return null
  }

  const seed = getFingerprintSeed(options.randomizeSeed)
  const generation = getFingerprintGenerationOptions(options.applyToCurrent !== false)
  const generated = await fingerprintStore.generateFingerprint(seed, generation.options)

  if (!generated) {
    return null
  }

  defaultFingerprint.value = cloneFingerprintConfig(generated) ?? null

  if (options.applyToCurrent === false && fingerprintMode.value === 'default') {
    fingerprintStore.setFingerprint(cloneFingerprintConfig(generated) ?? null)
  }

  return generated
}

async function applyDefaultFingerprint(options: { randomizeSeed?: boolean } = {}): Promise<void> {
  const generated =
    defaultFingerprint.value && !options.randomizeSeed
      ? defaultFingerprint.value
      : await refreshDefaultFingerprint({
          randomizeSeed: options.randomizeSeed,
          applyToCurrent: false
        })

  if (!generated) {
    ElMessage.error(fingerprintStore.error || '默认指纹生成失败，请稍后重试。')
    return
  }

  fingerprintStore.setFingerprint(cloneFingerprintConfig(generated) ?? null)
}

async function fillCustomFromDefault(randomizeSeed = false): Promise<void> {
  const generated = await refreshDefaultFingerprint({
    randomizeSeed,
    applyToCurrent: false
  })

  if (!generated) {
    ElMessage.error(fingerprintStore.error || '默认指纹生成失败，请稍后重试。')
    return
  }

  fingerprintStore.setFingerprint(cloneFingerprintConfig(generated) ?? null)
  fingerprintMode.value = 'custom'
}

async function handleFingerprintModeChange(mode: FingerprintMode): Promise<void> {
  fingerprintMode.value = mode

  if (!form.enableFingerprint) {
    return
  }

  if (mode === 'default') {
    await applyDefaultFingerprint()
    return
  }

  if (!fingerprintStore.currentFingerprint) {
    await fillCustomFromDefault()
  }
}

function applyWindowPreset(preset: { width: number; height: number; pixelRatio: number }): void {
  form.width = preset.width
  form.height = preset.height
  form.pixelRatio = preset.pixelRatio
}

function useMatchingGpuRenderer(): void {
  const vendor = fingerprintStore.currentFingerprint?.hardware.gpu.vendor

  if (!vendor || !fingerprintStore.currentFingerprint) {
    return
  }

  const [renderer] = getGpuRendererOptions(presetOs.value, vendor)

  if (renderer) {
    fingerprintStore.currentFingerprint.hardware.gpu.renderer = renderer
  }
}

async function ensureFingerprintReady(): Promise<boolean> {
  if (!form.enableFingerprint) {
    return true
  }

  if (!fingerprintStore.currentFingerprint) {
    const generated = await refreshDefaultFingerprint({
      applyToCurrent: true
    })

    if (!generated) {
      ElMessage.error(fingerprintStore.error || '指纹生成失败，请稍后重试。')
      return false
    }
  }

  if (!fingerprintStore.currentFingerprint) {
    return false
  }

  const valid = await fingerprintStore.validateFingerprint(fingerprintStore.currentFingerprint)

  if (!valid) {
    ElMessage.warning('当前指纹组合不够合理，请调整后再保存。')
    return false
  }

  return true
}

async function submit(): Promise<void> {
  if (!validateBasicInfo() || !validateProxy()) {
    return
  }

  if (!(await ensureFingerprintReady())) {
    return
  }

  const payloadBase: CreateProfileInput = {
    name: form.name,
    groupId: form.groupId || undefined,
    notes: form.notes || undefined,
    browserConfig: {
      locale: form.locale,
      timezone: form.timezone,
      colorScheme: form.colorScheme,
      homeUrl: form.homeUrl,
      window: {
        width: form.width,
        height: form.height,
        pixelRatio: form.pixelRatio
      }
    },
    proxyConfig:
      form.proxyType === 'none'
        ? {
            type: 'none',
            host: 'localhost',
            port: 80
          }
        : {
            type: form.proxyType,
            host: form.proxyHost,
            port: form.proxyPort,
            username: form.proxyUsername || undefined,
            password: form.proxyPassword || undefined
          },
    fingerprintEnabled: form.enableFingerprint,
    fingerprintOs: form.selectedOS === 'random' ? undefined : form.selectedOS,
    fingerprintConfig: form.enableFingerprint
      ? (cloneFingerprintConfig(fingerprintStore.currentFingerprint) ?? undefined)
      : undefined
  }

  if (props.profile) {
    emit('save', {
      id: props.profile.id,
      ...payloadBase
    })
  } else {
    emit('save', payloadBase)
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="isEditMode ? '编辑浏览器' : '创建浏览器'"
    width="1240px"
    align-center
    append-to-body
    class="profile-editor-dialog"
    @close="closeDialog"
  >
    <div class="editor-layout">
      <section class="editor-section">
        <header class="editor-section__header">
          <div>
            <h3>基础信息</h3>
            <p>在同一个界面中完成浏览器名称、语言、窗口和分组设置。</p>
          </div>
        </header>

        <div class="step-content">
      <el-form label-position="top" class="editor-form">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="浏览器名称" required>
              <el-input v-model="form.name" placeholder="例如：test001 / TikTok US / Work A" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="首页地址">
              <el-input v-model="form.homeUrl" placeholder="https://example.com" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="备注">
          <el-input
            v-model="form.notes"
            type="textarea"
            :rows="3"
            placeholder="补充这个浏览器的用途、账号信息或使用说明"
          />
        </el-form-item>

        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="分组">
              <el-select v-model="form.groupId" clearable placeholder="默认分组">
                <el-option label="默认分组" value="" />
                <el-option
                  v-for="group in groupOptions"
                  :key="group.id"
                  :label="group.name"
                  :value="group.id"
                />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="语言">
              <el-select
                v-model="form.locale"
                filterable
                allow-create
                default-first-option
                placeholder="选择或输入语言"
              >
                <el-option
                  v-for="locale in localeOptions"
                  :key="locale"
                  :label="locale"
                  :value="locale"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="时区">
              <el-select
                v-model="form.timezone"
                filterable
                allow-create
                default-first-option
                placeholder="选择或输入时区"
              >
                <el-option
                  v-for="timezone in timezoneOptions"
                  :key="timezone"
                  :label="timezone"
                  :value="timezone"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="主题模式">
              <el-select v-model="form.colorScheme">
                <el-option label="跟随系统" value="system" />
                <el-option label="浅色" value="light" />
                <el-option label="深色" value="dark" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider>窗口尺寸</el-divider>

        <el-form-item label="常用窗口预设">
          <div class="preset-list">
            <el-button
              v-for="preset in screenPresets"
              :key="preset.label"
              plain
              @click="applyWindowPreset(preset)"
            >
              {{ preset.label }}
            </el-button>
          </div>
        </el-form-item>

        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="宽度">
              <el-input-number
                v-model="form.width"
                :min="800"
                :max="3840"
                :step="20"
                controls-position="right"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="高度">
              <el-input-number
                v-model="form.height"
                :min="600"
                :max="2160"
                :step="20"
                controls-position="right"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="像素比">
              <el-select v-model="form.pixelRatio" placeholder="选择像素比">
                <el-option
                  v-for="ratio in PIXEL_RATIO_OPTIONS"
                  :key="ratio"
                  :label="`${ratio}x`"
                  :value="ratio"
                />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
        </div>
      </section>

      <section class="editor-section">
        <header class="editor-section__header">
          <div>
            <h3>指纹配置</h3>
            <p>默认指纹和自定义指纹都在这里处理，不再单独切步骤。</p>
          </div>
        </header>

        <div class="step-content">
      <el-form label-position="top">
        <el-form-item>
          <el-checkbox v-model="form.enableFingerprint">
            为这个浏览器启用持久化指纹，并在启动时自动注入
          </el-checkbox>
        </el-form-item>

        <template v-if="form.enableFingerprint">
          <el-form-item label="目标操作系统">
            <el-radio-group v-model="form.selectedOS">
              <el-radio-button label="random">随机</el-radio-button>
              <el-radio-button :label="OS_TYPES.WIN10">Windows 10</el-radio-button>
              <el-radio-button :label="OS_TYPES.WIN11">Windows 11</el-radio-button>
              <el-radio-button :label="OS_TYPES.MACOS">macOS</el-radio-button>
              <el-radio-button :label="OS_TYPES.LINUX">Linux</el-radio-button>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="使用方式">
            <el-radio-group v-model="fingerprintMode" @change="handleFingerprintModeChange">
              <el-radio-button label="default">默认指纹</el-radio-button>
              <el-radio-button label="custom">自定义指纹</el-radio-button>
            </el-radio-group>
          </el-form-item>

          <el-alert
            type="info"
            :closable="false"
            class="mb-4"
            title="语言和时区与基础信息联动。默认指纹会随基础配置自动重算，自定义模式可以在此基础上继续微调。"
          />

          <div class="fingerprint-actions">
            <template v-if="fingerprintMode === 'default'">
              <el-button type="primary" :loading="fingerprintStore.loading" @click="applyDefaultFingerprint()">
                应用默认指纹
              </el-button>
              <el-button
                plain
                :loading="fingerprintStore.loading"
                @click="applyDefaultFingerprint({ randomizeSeed: true })"
              >
                随机一个默认模板
              </el-button>
            </template>

            <template v-else>
              <el-button
                type="primary"
                plain
                :loading="fingerprintStore.loading"
                @click="fillCustomFromDefault()"
              >
                从默认指纹填充
              </el-button>
              <el-button
                plain
                :loading="fingerprintStore.loading"
                @click="fillCustomFromDefault(true)"
              >
                随机模板填充
              </el-button>
              <el-button plain @click="handleFingerprintModeChange('default')">切回默认指纹</el-button>
            </template>
          </div>

          <div v-if="fingerprintMode === 'custom' && currentFingerprint" class="fingerprint-grid">
            <section class="fingerprint-card">
              <header class="fingerprint-card__header">
                <h3>基础标识</h3>
                <span>可手动修改 UA、Client Hints 与语言环境</span>
              </header>

              <el-form-item label="User-Agent">
                <el-input
                  v-model="currentFingerprint.userAgent"
                  type="textarea"
                  :rows="3"
                  placeholder="Mozilla/5.0 ..."
                />
              </el-form-item>

              <el-form-item label="Sec-CH-UA">
                <el-input
                  v-model="currentFingerprint.secChUa"
                  placeholder="&quot;Not_A Brand&quot;;v=&quot;8&quot;, &quot;Chromium&quot;;v=&quot;142&quot;"
                />
              </el-form-item>

              <el-row :gutter="16">
                <el-col :span="12">
                  <el-form-item label="语言">
                    <el-select
                      v-model="form.locale"
                      filterable
                      allow-create
                      default-first-option
                    >
                      <el-option
                        v-for="locale in localeOptions"
                        :key="locale"
                        :label="locale"
                        :value="locale"
                      />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="时区">
                    <el-select
                      v-model="form.timezone"
                      filterable
                      allow-create
                      default-first-option
                    >
                      <el-option
                        v-for="timezone in timezoneOptions"
                        :key="timezone"
                        :label="timezone"
                        :value="timezone"
                      />
                    </el-select>
                  </el-form-item>
                </el-col>
              </el-row>

              <el-form-item label="Do Not Track">
                <el-switch
                  v-model="currentFingerprint.software.doNotTrack"
                  inline-prompt
                  active-text="开"
                  inactive-text="关"
                />
              </el-form-item>
            </section>

            <section class="fingerprint-card">
              <header class="fingerprint-card__header">
                <h3>硬件与分辨率</h3>
                <span>控制 CPU、内存和屏幕参数</span>
              </header>

              <el-row :gutter="16">
                <el-col :span="12">
                  <el-form-item label="CPU 核数">
                    <el-select v-model="currentFingerprint.hardware.cpuCores">
                      <el-option
                        v-for="cores in CPU_CORE_OPTIONS"
                        :key="cores"
                        :label="`${cores} 核`"
                        :value="cores"
                      />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="内存">
                    <el-select v-model="currentFingerprint.hardware.memory">
                      <el-option
                        v-for="memory in MEMORY_OPTIONS"
                        :key="memory"
                        :label="`${memory} GB`"
                        :value="memory"
                      />
                    </el-select>
                  </el-form-item>
                </el-col>
              </el-row>

              <el-row :gutter="16">
                <el-col :span="6">
                  <el-form-item label="宽度">
                    <el-input-number
                      v-model="currentFingerprint.hardware.screen.width"
                      :min="800"
                      :max="7680"
                      controls-position="right"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="6">
                  <el-form-item label="高度">
                    <el-input-number
                      v-model="currentFingerprint.hardware.screen.height"
                      :min="600"
                      :max="4320"
                      controls-position="right"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="6">
                  <el-form-item label="像素比">
                    <el-select v-model="currentFingerprint.hardware.screen.pixelRatio">
                      <el-option
                        v-for="ratio in PIXEL_RATIO_OPTIONS"
                        :key="ratio"
                        :label="`${ratio}x`"
                        :value="ratio"
                      />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="6">
                  <el-form-item label="色深">
                    <el-select v-model="currentFingerprint.hardware.screen.colorDepth">
                      <el-option
                        v-for="depth in COLOR_DEPTH_OPTIONS"
                        :key="depth"
                        :label="`${depth} bit`"
                        :value="depth"
                      />
                    </el-select>
                  </el-form-item>
                </el-col>
              </el-row>
            </section>

            <section class="fingerprint-card">
              <header class="fingerprint-card__header">
                <h3>图形与字体</h3>
                <span>调整 WebGL 厂商、渲染器和可见字体</span>
              </header>

              <el-row :gutter="16">
                <el-col :span="10">
                  <el-form-item label="WebGL 厂商">
                    <el-select
                      v-model="currentFingerprint.hardware.gpu.vendor"
                      filterable
                      allow-create
                      default-first-option
                    >
                      <el-option
                        v-for="vendor in gpuVendorOptions"
                        :key="vendor"
                        :label="vendor"
                        :value="vendor"
                      />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="14">
                  <el-form-item label="WebGL 渲染器">
                    <div class="gpu-renderer-row">
                      <el-select
                        v-model="currentFingerprint.hardware.gpu.renderer"
                        filterable
                        allow-create
                        default-first-option
                      >
                        <el-option
                          v-for="renderer in gpuRendererOptions"
                          :key="renderer"
                          :label="renderer"
                          :value="renderer"
                        />
                      </el-select>
                      <el-button plain @click="useMatchingGpuRenderer">匹配厂商</el-button>
                    </div>
                  </el-form-item>
                </el-col>
              </el-row>

              <el-form-item label="字体列表">
                <el-select
                  v-model="currentFingerprint.hardware.fonts"
                  multiple
                  filterable
                  allow-create
                  default-first-option
                  collapse-tags
                  collapse-tags-tooltip
                  placeholder="选择或输入字体"
                >
                  <el-option
                    v-for="font in fontOptions"
                    :key="font"
                    :label="font"
                    :value="font"
                  />
                </el-select>
              </el-form-item>
            </section>

            <section class="fingerprint-card">
              <header class="fingerprint-card__header">
                <h3>高级扰动</h3>
                <span>控制 Canvas、WebGL、Audio 与 ClientRects 相关噪声</span>
              </header>

              <el-form-item label="Canvas 噪声">
                <div class="slider-row">
                  <el-slider
                    v-model="currentFingerprint.advanced.canvasNoise"
                    :min="0"
                    :max="10"
                    show-input
                  />
                </div>
              </el-form-item>

              <el-row :gutter="16">
                <el-col :span="12">
                  <el-form-item label="WebGL 噪声">
                    <el-switch v-model="currentFingerprint.advanced.webglNoise" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="AudioContext 噪声">
                    <el-switch v-model="currentFingerprint.advanced.audioNoise" />
                  </el-form-item>
                </el-col>
              </el-row>

              <el-row :gutter="16">
                <el-col :span="12">
                  <el-form-item label="ClientRects 扰动">
                    <el-switch v-model="currentFingerprint.advanced.clientRectsNoise" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="Speech Voices 扰动">
                    <el-switch v-model="currentFingerprint.advanced.speechVoicesNoise" />
                  </el-form-item>
                </el-col>
              </el-row>
            </section>
          </div>

          <div v-if="fingerprintSummary" class="fingerprint-preview">
            <el-divider>当前指纹预览</el-divider>
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="操作系统">{{ fingerprintSummary.os }}</el-descriptions-item>
              <el-descriptions-item label="浏览器">{{ fingerprintSummary.browser }}</el-descriptions-item>
              <el-descriptions-item label="分辨率">{{ fingerprintSummary.resolution }}</el-descriptions-item>
              <el-descriptions-item label="CPU 核数">{{ fingerprintSummary.cpuCores }}</el-descriptions-item>
              <el-descriptions-item label="内存">{{ fingerprintSummary.memory }}</el-descriptions-item>
              <el-descriptions-item label="时区">{{ fingerprintSummary.timezone }}</el-descriptions-item>
              <el-descriptions-item label="语言">{{ fingerprintSummary.locale }}</el-descriptions-item>
              <el-descriptions-item label="字体">{{ fingerprintSummary.fontCount }} 项</el-descriptions-item>
              <el-descriptions-item label="GPU 厂商">{{ fingerprintSummary.gpuVendor }}</el-descriptions-item>
              <el-descriptions-item label="DNT">{{ fingerprintSummary.dnt }}</el-descriptions-item>
            </el-descriptions>
          </div>
        </template>

        <el-alert
          v-if="fingerprintStore.error"
          :title="fingerprintStore.error"
          type="error"
          :closable="false"
          class="mt-3"
        />
      </el-form>
        </div>
      </section>

      <section class="editor-section">
        <header class="editor-section__header">
          <div>
            <h3>代理设置</h3>
            <p>如果这个浏览器需要代理，可以直接在这里一并配置。</p>
          </div>
        </header>

        <div class="step-content">
      <el-form label-position="top">
        <el-form-item label="代理类型">
          <el-radio-group v-model="form.proxyType">
            <el-radio-button label="none">不使用代理</el-radio-button>
            <el-radio-button label="http">HTTP</el-radio-button>
            <el-radio-button label="https">HTTPS</el-radio-button>
            <el-radio-button label="socks5">SOCKS5</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <template v-if="form.proxyType !== 'none'">
          <el-row :gutter="16">
            <el-col :span="16">
              <el-form-item label="代理地址">
                <el-input v-model="form.proxyHost" placeholder="127.0.0.1" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="端口">
                <el-input-number
                  v-model="form.proxyPort"
                  :min="1"
                  :max="65535"
                  controls-position="right"
                />
              </el-form-item>
            </el-col>
          </el-row>

          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="账号">
                <el-input v-model="form.proxyUsername" placeholder="可选" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="密码">
                <el-input
                  v-model="form.proxyPassword"
                  type="password"
                  show-password
                  placeholder="可选"
                />
              </el-form-item>
            </el-col>
          </el-row>
        </template>
      </el-form>
        </div>
      </section>

      <section class="editor-section editor-section--summary">
        <header class="editor-section__header">
          <div>
            <h3>保存前摘要</h3>
            <p>所有选项都在当前页面完成，这里只做最终复核。</p>
          </div>
        </header>

        <div class="step-content">
      <el-alert title="保存前请再次确认这份浏览器配置" type="info" :closable="false" class="mb-4" />

      <el-descriptions :column="1" border>
        <el-descriptions-item label="浏览器名称">{{ form.name || '未填写' }}</el-descriptions-item>
        <el-descriptions-item label="分组">
          {{ groupStore.getGroupById(form.groupId)?.name || '默认分组' }}
        </el-descriptions-item>
        <el-descriptions-item label="首页地址">{{ form.homeUrl }}</el-descriptions-item>
        <el-descriptions-item label="窗口尺寸">
          {{ form.width }} x {{ form.height }} ({{ form.pixelRatio }}x)
        </el-descriptions-item>
        <el-descriptions-item label="语言 / 时区">
          {{ form.locale }} / {{ form.timezone }}
        </el-descriptions-item>
        <el-descriptions-item label="指纹状态">
          {{
            form.enableFingerprint
              ? fingerprintMode === 'custom'
                ? '已启用，自定义指纹'
                : '已启用，默认指纹'
              : '已关闭'
          }}
        </el-descriptions-item>
        <el-descriptions-item label="代理配置">
          {{
            form.proxyType === 'none'
              ? '不使用代理'
              : `${form.proxyType.toUpperCase()} ${form.proxyHost}:${form.proxyPort}`
          }}
        </el-descriptions-item>
      </el-descriptions>
        </div>
      </section>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button type="success" :loading="saving" @click="submit">
          {{ isEditMode ? '保存修改' : '创建浏览器' }}
        </el-button>
        <el-button @click="closeDialog">取消</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
:deep(.profile-editor-dialog) {
  max-width: calc(100vw - 48px);
}

:deep(.profile-editor-dialog .el-dialog) {
  overflow: hidden;
  margin: 0 auto;
  border-radius: 18px;
}

:deep(.profile-editor-dialog .el-dialog__header) {
  padding: 20px 24px 14px;
  border-bottom: 1px solid #eef1f6;
}

:deep(.profile-editor-dialog .el-dialog__body) {
  padding: 18px 24px 10px;
  max-height: calc(100vh - 180px);
  overflow-y: auto;
}

:deep(.profile-editor-dialog .el-dialog__footer) {
  padding: 14px 24px 22px;
}

:deep(.profile-editor-dialog .el-input-number) {
  width: 100%;
}

.editor-layout {
  display: grid;
  gap: 18px;
}

.editor-section {
  padding: 20px;
  border: 1px solid #e8ecf3;
  border-radius: 18px;
  background: #ffffff;
}

.editor-section--summary {
  background: #fafbff;
}

.editor-section__header {
  margin-bottom: 8px;
}

.editor-section__header h3 {
  margin: 0 0 6px;
  font-size: 18px;
}

.editor-section__header p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.step-content {
  padding: 8px 0 0;
  min-height: auto;
}

.preset-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.fingerprint-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 18px;
}

.fingerprint-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 18px;
}

.fingerprint-card {
  padding: 18px;
  border: 1px solid #e8ecf3;
  border-radius: 16px;
  background: #fafbff;
}

.fingerprint-card__header {
  margin-bottom: 14px;
}

.fingerprint-card__header h3 {
  margin: 0 0 4px;
  font-size: 16px;
}

.fingerprint-card__header span {
  color: var(--text-secondary);
  font-size: 13px;
}

.fingerprint-preview {
  margin-top: 20px;
  padding: 18px;
  border: 1px solid #e8ecf3;
  border-radius: 16px;
  background: #f8f9fc;
}

.gpu-renderer-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
}

.slider-row {
  padding: 6px 4px 0;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.mt-3 {
  margin-top: 12px;
}

.mb-4 {
  margin-bottom: 16px;
}

@media (max-width: 960px) {
  .fingerprint-grid {
    grid-template-columns: 1fr;
  }

  .gpu-renderer-row {
    grid-template-columns: 1fr;
  }
}
</style>
