<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
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
import { toPlainData } from '@renderer/utils/serialization'
import type { CreateProfileInput, FingerprintConfig, OSType, Profile, UpdateProfileInput } from '@shared/types'

type EditableMode = 'default' | 'custom'
type RandomizableMode = 'default' | 'custom' | 'random'
type NoiseMode = 'default' | 'random'
type SectionKey = 'basic' | 'advanced' | 'summary'

interface ProfileFormState {
  name: string
  groupId: string
  notes: string
  locale: string
  timezone: string
  colorScheme: 'system' | 'light' | 'dark'
  homeUrl: string
  homePageMode: EditableMode
  width: number
  height: number
  pixelRatio: number
  proxyType: 'none' | 'http' | 'https' | 'socks5'
  proxyHost: string
  proxyPort: number
  proxyUsername: string
  proxyPassword: string
  selectedOS: OSType | 'random'
  browserVersion: string
  enableFingerprint: boolean
}

interface FingerprintFieldModes {
  userAgent: EditableMode
  secChUa: EditableMode
  language: EditableMode
  timezone: EditableMode
  screen: EditableMode
  fonts: RandomizableMode
  webgl: RandomizableMode
  canvas: NoiseMode
  audio: NoiseMode
  clientRects: NoiseMode
  speechVoices: NoiseMode
}

const BROWSER_VERSION_OPTIONS = ['120', '137', '140', '142']
const BROWSER_FULL_VERSION_MAP: Record<string, string> = {
  '120': '120.0.0.0',
  '137': '137.0.0.0',
  '140': '140.0.0.0',
  '142': '142.0.7444.175'
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
const defaultFingerprint = ref<FingerprintConfig | null>(null)
const fingerprintSeed = ref('')
const isResetting = ref(false)
const activeSection = ref<SectionKey>('basic')

const basicSectionRef = ref<HTMLElement | null>(null)
const advancedSectionRef = ref<HTMLElement | null>(null)
const summarySectionRef = ref<HTMLElement | null>(null)

const form = reactive<ProfileFormState>({
  name: '',
  groupId: '',
  notes: '',
  locale: DEFAULT_BROWSER_CONFIG.locale,
  timezone: DEFAULT_BROWSER_CONFIG.timezone,
  colorScheme: DEFAULT_BROWSER_CONFIG.colorScheme,
  homeUrl: DEFAULT_BROWSER_CONFIG.homeUrl,
  homePageMode: 'default',
  width: DEFAULT_BROWSER_CONFIG.window.width,
  height: DEFAULT_BROWSER_CONFIG.window.height,
  pixelRatio: DEFAULT_BROWSER_CONFIG.window.pixelRatio,
  proxyType: 'none',
  proxyHost: '',
  proxyPort: 8080,
  proxyUsername: '',
  proxyPassword: '',
  selectedOS: 'random',
  browserVersion: '142',
  enableFingerprint: true
})

const fieldModes = reactive<FingerprintFieldModes>({
  userAgent: 'default',
  secChUa: 'default',
  language: 'default',
  timezone: 'default',
  screen: 'default',
  fonts: 'default',
  webgl: 'default',
  canvas: 'default',
  audio: 'default',
  clientRects: 'default',
  speechVoices: 'default'
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

  return toPlainData(config)
}

function buildOptionList(values: string[], currentValue?: string): string[] {
  return Array.from(new Set([currentValue ?? '', ...values].filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  )
}

function extractBrowserMajorVersion(userAgent?: string): string {
  const matched = userAgent?.match(/(?:Chrome|Edg|OPR|Vivaldi)\/(\d+)/)?.[1]
  return matched && BROWSER_VERSION_OPTIONS.includes(matched) ? matched : '142'
}

function getFullBrowserVersion(majorVersion: string): string {
  return BROWSER_FULL_VERSION_MAP[majorVersion] ?? `${majorVersion}.0.0.0`
}

function rewriteUserAgentVersion(userAgent: string, majorVersion: string): string {
  const fullVersion = getFullBrowserVersion(majorVersion)
  return userAgent.replace(/(Chrome|Edg|OPR|Vivaldi)\/[\d.]+/g, (_matched, product) => {
    return `${product}/${fullVersion}`
  })
}

function rewriteSecChUaVersion(secChUa: string | undefined, majorVersion: string): string | undefined {
  if (!secChUa) {
    return undefined
  }

  return secChUa.replace(/"([^"]+)"\s*;\s*v="([^"]+)"/g, (_matched, brand: string) => {
    const normalized = brand.toLowerCase()

    if (normalized.includes('not')) {
      return `"${brand}";v="8"`
    }

    return `"${brand}";v="${majorVersion}"`
  })
}

function applyBrowserVersion(config: FingerprintConfig, majorVersion: string): FingerprintConfig {
  const next = cloneFingerprintConfig(config)

  if (!next) {
    return config
  }

  next.userAgent = rewriteUserAgentVersion(next.userAgent, majorVersion)
  next.secChUa = rewriteSecChUaVersion(next.secChUa, majorVersion)

  return next
}

function resolvePresetOs(config?: FingerprintConfig | null): OSType {
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

  return config.userAgent.includes('Windows') ? OS_TYPES.WIN10 : OS_TYPES.WIN10
}

function getFingerprintSeed(randomize = false): string {
  if (randomize || !fingerprintSeed.value) {
    fingerprintSeed.value = randomize ? createSeed() : (props.profile?.id ?? createSeed())
  }

  return fingerprintSeed.value
}

function getFingerprintGenerationOptions(): {
  seed: string
  options: { os?: OSType; locale: string; timezone: string; apply: false }
} {
  return {
    seed: getFingerprintSeed(),
    options: {
      os: form.selectedOS === 'random' ? undefined : form.selectedOS,
      locale: form.locale.trim() || DEFAULT_BROWSER_CONFIG.locale,
      timezone: form.timezone.trim() || DEFAULT_BROWSER_CONFIG.timezone,
      apply: false
    }
  }
}

const localeOptions = computed(() => buildOptionList(COMMON_LOCALE_OPTIONS, form.locale))
const timezoneOptions = computed(() => buildOptionList(getTimezoneOptions(), form.timezone))
const groupOptions = computed(() => groupStore.groups)
const currentFingerprint = computed(() => fingerprintStore.currentFingerprint)
const isFingerprintReady = computed(() => Boolean(currentFingerprint.value))

function createSeed(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // Fall back to timestamp-based seed when crypto is unavailable.
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
const presetOs = computed(() => resolvePresetOs(currentFingerprint.value ?? defaultFingerprint.value))
const screenPresets = computed(() => getScreenPresets(presetOs.value))
const fontOptions = computed(() =>
  buildOptionList(getFontOptions(presetOs.value), currentFingerprint.value?.hardware.fonts[0])
)
const gpuVendorOptions = computed(() =>
  buildOptionList(getGpuVendorOptions(presetOs.value), currentFingerprint.value?.hardware.gpu.vendor)
)
const gpuRendererOptions = computed(() =>
  buildOptionList(
    getGpuRendererOptions(presetOs.value, currentFingerprint.value?.hardware.gpu.vendor),
    currentFingerprint.value?.hardware.gpu.renderer
  )
)

const fingerprintSummary = computed(() => {
  const config = currentFingerprint.value ?? defaultFingerprint.value

  if (!config) {
    return null
  }

  return {
    browser: `Chrome ${extractBrowserMajorVersion(config.userAgent)}`,
    platform:
      config.software.platform === 'MacIntel'
        ? 'macOS'
        : config.software.platform.includes('Linux')
          ? 'Linux'
          : 'Windows',
    locale: config.software.locale,
    timezone: config.software.timezone,
    resolution: `${config.hardware.screen.width} x ${config.hardware.screen.height}`,
    memory: `${config.hardware.memory} GB`,
    cpuCores: `${config.hardware.cpuCores} 核`,
    gpu: `${config.hardware.gpu.vendor} / ${config.hardware.gpu.renderer}`,
    fonts: config.hardware.fonts.length,
    canvasNoise: config.advanced.canvasNoise,
    doNotTrack: config.software.doNotTrack ? '开启' : '关闭'
  }
})

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

function resetFieldModes(profile?: Profile | null): void {
  const hasCustomFingerprint = Boolean(profile?.fingerprintConfig)

  fieldModes.userAgent = hasCustomFingerprint ? 'custom' : 'default'
  fieldModes.secChUa = hasCustomFingerprint ? 'custom' : 'default'
  fieldModes.language = hasCustomFingerprint ? 'custom' : 'default'
  fieldModes.timezone = hasCustomFingerprint ? 'custom' : 'default'
  fieldModes.screen = hasCustomFingerprint ? 'custom' : 'default'
  fieldModes.fonts = hasCustomFingerprint ? 'custom' : 'default'
  fieldModes.webgl = hasCustomFingerprint ? 'custom' : 'default'
  fieldModes.canvas =
    profile?.fingerprintConfig && profile.fingerprintConfig.advanced.canvasNoise > 0
      ? 'random'
      : 'default'
  fieldModes.audio = profile?.fingerprintConfig?.advanced.audioNoise ? 'random' : 'default'
  fieldModes.clientRects =
    profile?.fingerprintConfig?.advanced.clientRectsNoise ? 'random' : 'default'
  fieldModes.speechVoices =
    profile?.fingerprintConfig?.advanced.speechVoicesNoise ? 'random' : 'default'
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
  form.homePageMode =
    (profile?.browserConfig.homeUrl ?? DEFAULT_BROWSER_CONFIG.homeUrl) === DEFAULT_BROWSER_CONFIG.homeUrl
      ? 'default'
      : 'custom'
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
  form.browserVersion = extractBrowserMajorVersion(profile?.fingerprintConfig?.userAgent)
  form.enableFingerprint = profile?.fingerprintEnabled ?? true

  fingerprintSeed.value = profile?.id ?? createSeed()
  defaultFingerprint.value = null
  fingerprintStore.setFingerprint(cloneFingerprintConfig(profile?.fingerprintConfig) ?? null)
  resetFieldModes(profile)
  activeSection.value = 'basic'

  isResetting.value = false
}

function copyDefaultFieldsIntoCurrent(): void {
  const baseline = defaultFingerprint.value
  const current = fingerprintStore.currentFingerprint

  if (!baseline || !current) {
    return
  }

  if (fieldModes.userAgent === 'default') {
    current.userAgent = baseline.userAgent
  }

  if (fieldModes.secChUa === 'default') {
    current.secChUa = baseline.secChUa
  }

  if (fieldModes.language === 'default') {
    current.software.locale = baseline.software.locale
  }

  if (fieldModes.timezone === 'default') {
    current.software.timezone = baseline.software.timezone
  }

  if (fieldModes.screen === 'default') {
    current.hardware.screen = toPlainData(baseline.hardware.screen)
  }

  if (fieldModes.fonts === 'default') {
    current.hardware.fonts = toPlainData(baseline.hardware.fonts)
  }

  if (fieldModes.webgl === 'default') {
    current.hardware.gpu = toPlainData(baseline.hardware.gpu)
    current.advanced.webglNoise = baseline.advanced.webglNoise
  }

  if (fieldModes.canvas === 'default') {
    current.advanced.canvasNoise = baseline.advanced.canvasNoise
  }

  if (fieldModes.audio === 'default') {
    current.advanced.audioNoise = baseline.advanced.audioNoise
  }

  if (fieldModes.clientRects === 'default') {
    current.advanced.clientRectsNoise = baseline.advanced.clientRectsNoise
  }

  if (fieldModes.speechVoices === 'default') {
    current.advanced.speechVoicesNoise = baseline.advanced.speechVoicesNoise
  }
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
  const generation = getFingerprintGenerationOptions()
  const generated = await fingerprintStore.generateFingerprint(seed, generation.options)

  if (!generated) {
    return null
  }

  const withVersion = applyBrowserVersion(generated, form.browserVersion)
  defaultFingerprint.value = cloneFingerprintConfig(withVersion) ?? null

  if (options.applyToCurrent || !fingerprintStore.currentFingerprint) {
    fingerprintStore.setFingerprint(cloneFingerprintConfig(withVersion) ?? null)
  }

  copyDefaultFieldsIntoCurrent()
  return withVersion
}

async function ensureFingerprintBuffer(): Promise<FingerprintConfig | null> {
  if (fingerprintStore.currentFingerprint) {
    return fingerprintStore.currentFingerprint
  }

  if (defaultFingerprint.value) {
    fingerprintStore.setFingerprint(cloneFingerprintConfig(defaultFingerprint.value) ?? null)
    return fingerprintStore.currentFingerprint
  }

  return refreshDefaultFingerprint({ applyToCurrent: true })
}

function applyWindowPreset(preset: { width: number; height: number; pixelRatio: number }): void {
  form.width = preset.width
  form.height = preset.height
  form.pixelRatio = preset.pixelRatio
}

function updateHomePageMode(mode: EditableMode): void {
  form.homePageMode = mode

  if (mode === 'default') {
    form.homeUrl = DEFAULT_BROWSER_CONFIG.homeUrl
  }
}

function updateProxyMode(mode: 'none' | 'custom'): void {
  if (mode === 'none') {
    form.proxyType = 'none'
    form.proxyHost = ''
    form.proxyPort = 8080
    form.proxyUsername = ''
    form.proxyPassword = ''
    return
  }

  form.proxyType = form.proxyType === 'none' ? 'http' : form.proxyType
}

function updateEditableMode(
  key: 'userAgent' | 'secChUa' | 'language' | 'timezone' | 'screen',
  mode: EditableMode
): void {
  fieldModes[key] = mode

  if (mode === 'default') {
    copyDefaultFieldsIntoCurrent()
  }
}

async function updateRandomizableMode(
  key: 'fonts' | 'webgl',
  mode: RandomizableMode
): Promise<void> {
  fieldModes[key] = mode
  const current = await ensureFingerprintBuffer()

  if (!current) {
    return
  }

  if (mode === 'default') {
    copyDefaultFieldsIntoCurrent()
    return
  }

  if (mode === 'random') {
    const generated = await refreshDefaultFingerprint({
      randomizeSeed: true,
      applyToCurrent: false
    })

    if (!generated) {
      return
    }

    if (key === 'fonts') {
      current.hardware.fonts = toPlainData(generated.hardware.fonts)
    } else {
      current.hardware.gpu = toPlainData(generated.hardware.gpu)
      current.advanced.webglNoise = true
    }
  }
}

async function updateNoiseMode(
  key: 'canvas' | 'audio' | 'clientRects' | 'speechVoices',
  mode: NoiseMode
): Promise<void> {
  fieldModes[key] = mode
  const current = await ensureFingerprintBuffer()

  if (!current) {
    return
  }

  if (mode === 'default') {
    copyDefaultFieldsIntoCurrent()
    return
  }

  if (key === 'canvas') {
    current.advanced.canvasNoise = Math.floor(Math.random() * 6) + 1
    return
  }

  if (key === 'audio') {
    current.advanced.audioNoise = true
    return
  }

  if (key === 'clientRects') {
    current.advanced.clientRectsNoise = true
    return
  }

  current.advanced.speechVoicesNoise = true
}

async function randomizeIdentity(): Promise<void> {
  const generated = await refreshDefaultFingerprint({
    randomizeSeed: true,
    applyToCurrent: false
  })

  if (!generated) {
    ElMessage.error(fingerprintStore.error || '随机模板生成失败，请稍后重试。')
    return
  }

  const current = await ensureFingerprintBuffer()

  if (!current) {
    return
  }

  current.userAgent = generated.userAgent
  current.secChUa = generated.secChUa
  fieldModes.userAgent = 'custom'
  fieldModes.secChUa = 'custom'
}

function useMatchingGpuRenderer(): void {
  const current = fingerprintStore.currentFingerprint

  if (!current) {
    return
  }

  const [renderer] = getGpuRendererOptions(presetOs.value, current.hardware.gpu.vendor)

  if (renderer) {
    current.hardware.gpu.renderer = renderer
  }
}

function scrollToSection(section: SectionKey): void {
  activeSection.value = section

  const element =
    section === 'basic'
      ? basicSectionRef.value
      : section === 'advanced'
        ? advancedSectionRef.value
        : summarySectionRef.value

  element?.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  })
}

async function ensureFingerprintReady(): Promise<boolean> {
  if (!form.enableFingerprint) {
    return true
  }

  const current = await ensureFingerprintBuffer()

  if (!current) {
    ElMessage.error(fingerprintStore.error || '指纹生成失败，请稍后重试。')
    return false
  }

  copyDefaultFieldsIntoCurrent()
  const valid = await fingerprintStore.validateFingerprint(current)

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
    return
  }

  emit('save', payloadBase)
}

watch(
  () => props.modelValue,
  async (visible) => {
    if (!visible) {
      return
    }

    try {
      await groupStore.loadGroups()
      resetForm(props.profile)

      if (form.enableFingerprint) {
        await refreshDefaultFingerprint({
          applyToCurrent: !props.profile?.fingerprintConfig
        })
      }
    } catch (cause) {
      ElMessage.error(
        cause instanceof Error ? cause.message : '初始化创建窗口失败，请稍后重试。'
      )
    }
  }
)

watch(
  () => form.enableFingerprint,
  async (enabled) => {
    if (isResetting.value || !props.modelValue) {
      return
    }

    if (!enabled) {
      defaultFingerprint.value = null
      fingerprintStore.clearFingerprint()
      return
    }

    await refreshDefaultFingerprint({
      applyToCurrent: !fingerprintStore.currentFingerprint
    })
  }
)

watch(
  () => [form.locale, form.timezone, form.selectedOS, form.browserVersion],
  async () => {
    if (isResetting.value || !props.modelValue || !form.enableFingerprint) {
      return
    }

    await refreshDefaultFingerprint({
      applyToCurrent: !fingerprintStore.currentFingerprint
    })
  }
)
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="isEditMode ? '编辑浏览器' : '创建浏览器'"
    width="min(1260px, calc(100vw - 24px))"
    align-center
    :lock-scroll="false"
    append-to-body
    class="profile-editor-dialog"
    @close="closeDialog"
  >
    <div class="profile-editor-shell">
      <aside class="profile-editor-nav">
        <div class="profile-editor-nav__line" />

        <button
          type="button"
          class="profile-editor-nav__item"
          :class="{ 'is-active': activeSection === 'basic' }"
          @click="scrollToSection('basic')"
        >
          基础设置
        </button>

        <button
          type="button"
          class="profile-editor-nav__item"
          :class="{ 'is-active': activeSection === 'advanced' }"
          @click="scrollToSection('advanced')"
        >
          高级设置
        </button>

        <button
          type="button"
          class="profile-editor-nav__item"
          :class="{ 'is-active': activeSection === 'summary' }"
          @click="scrollToSection('summary')"
        >
          保存确认
        </button>
      </aside>

      <div class="profile-editor-content">
        <section ref="basicSectionRef" class="config-section">
          <header class="config-section__header">
            <h3>基础设置</h3>
            <p>按截图里的方式，把核心浏览器参数集中在一页里配置。</p>
          </header>

          <div class="config-row">
            <div class="config-row__label">名称</div>
            <div class="config-row__control">
              <el-input v-model="form.name" placeholder="请输入浏览器名称" />
            </div>
          </div>

          <div class="config-row">
            <div class="config-row__label">选择分组</div>
            <div class="config-row__control">
              <el-select v-model="form.groupId" clearable placeholder="默认分组">
                <el-option label="默认分组" value="" />
                <el-option
                  v-for="group in groupOptions"
                  :key="group.id"
                  :label="group.name"
                  :value="group.id"
                />
              </el-select>
            </div>
          </div>

          <div class="config-row">
            <div class="config-row__label">操作系统</div>
            <div class="config-row__control">
              <div class="mode-switch">
                <button
                  type="button"
                  class="mode-switch__btn"
                  :class="{ 'is-active': form.selectedOS === 'random' }"
                  @click="form.selectedOS = 'random'"
                >
                  随机
                </button>
                <button
                  type="button"
                  class="mode-switch__btn"
                  :class="{ 'is-active': form.selectedOS === OS_TYPES.WIN10 }"
                  @click="form.selectedOS = OS_TYPES.WIN10"
                >
                  Win 10
                </button>
                <button
                  type="button"
                  class="mode-switch__btn"
                  :class="{ 'is-active': form.selectedOS === OS_TYPES.WIN11 }"
                  @click="form.selectedOS = OS_TYPES.WIN11"
                >
                  Win 11
                </button>
                <button
                  type="button"
                  class="mode-switch__btn"
                  :class="{ 'is-active': form.selectedOS === OS_TYPES.MACOS }"
                  @click="form.selectedOS = OS_TYPES.MACOS"
                >
                  macOS
                </button>
                <button
                  type="button"
                  class="mode-switch__btn"
                  :class="{ 'is-active': form.selectedOS === OS_TYPES.LINUX }"
                  @click="form.selectedOS = OS_TYPES.LINUX"
                >
                  Linux
                </button>
              </div>
            </div>
          </div>

          <div class="config-row">
            <div class="config-row__label">浏览器版本</div>
            <div class="config-row__control">
              <el-select v-model="form.browserVersion">
                <el-option
                  v-for="version in BROWSER_VERSION_OPTIONS"
                  :key="version"
                  :label="`Chrome ${version}`"
                  :value="version"
                />
              </el-select>
            </div>
          </div>

          <div class="config-row">
            <div class="config-row__label">内核版本</div>
            <div class="config-row__control">
              <el-input value="自动匹配" disabled />
            </div>
          </div>

          <div class="config-row">
            <div class="config-row__label">启动主页</div>
            <div class="config-row__control">
              <div class="row-stack">
                <div class="mode-switch">
                  <button
                    type="button"
                    class="mode-switch__btn"
                    :class="{ 'is-active': form.homePageMode === 'default' }"
                    @click="updateHomePageMode('default')"
                  >
                    默认
                  </button>
                  <button
                    type="button"
                    class="mode-switch__btn"
                    :class="{ 'is-active': form.homePageMode === 'custom' }"
                    @click="updateHomePageMode('custom')"
                  >
                    自定义
                  </button>
                </div>
                <el-input
                  v-model="form.homeUrl"
                  :disabled="form.homePageMode === 'default'"
                  placeholder="https://example.com"
                />
              </div>
            </div>
          </div>

          <div class="config-row">
            <div class="config-row__label">代理设置</div>
            <div class="config-row__control">
              <div class="row-stack">
                <div class="mode-switch">
                  <button
                    type="button"
                    class="mode-switch__btn"
                    :class="{ 'is-active': form.proxyType === 'none' }"
                    @click="updateProxyMode('none')"
                  >
                    不使用代理
                  </button>
                  <button
                    type="button"
                    class="mode-switch__btn"
                    :class="{ 'is-active': form.proxyType !== 'none' }"
                    @click="updateProxyMode('custom')"
                  >
                    自定义
                  </button>
                </div>

                <template v-if="form.proxyType !== 'none'">
                  <div class="proxy-grid">
                    <el-select v-model="form.proxyType">
                      <el-option label="HTTP" value="http" />
                      <el-option label="HTTPS" value="https" />
                      <el-option label="SOCKS5" value="socks5" />
                    </el-select>
                    <el-input v-model="form.proxyHost" placeholder="127.0.0.1" />
                    <el-input-number
                      v-model="form.proxyPort"
                      :min="1"
                      :max="65535"
                      controls-position="right"
                    />
                  </div>

                  <div class="proxy-grid proxy-grid--auth">
                    <el-input v-model="form.proxyUsername" placeholder="代理账号（可选）" />
                    <el-input
                      v-model="form.proxyPassword"
                      type="password"
                      show-password
                      placeholder="代理密码（可选）"
                    />
                  </div>
                </template>
              </div>
            </div>
          </div>

          <div class="config-row">
            <div class="config-row__label">语言</div>
            <div class="config-row__control">
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
            </div>
          </div>

          <div class="config-row">
            <div class="config-row__label">时区</div>
            <div class="config-row__control">
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
            </div>
          </div>

          <div class="config-row">
            <div class="config-row__label">窗口尺寸</div>
            <div class="config-row__control">
              <div class="row-stack">
                <div class="preset-list">
                  <button
                    v-for="preset in screenPresets"
                    :key="preset.label"
                    type="button"
                    class="preset-pill"
                    @click="applyWindowPreset(preset)"
                  >
                    {{ preset.label }}
                  </button>
                </div>

                <div class="triple-grid">
                  <el-input-number
                    v-model="form.width"
                    :min="800"
                    :max="3840"
                    :step="20"
                    controls-position="right"
                  />
                  <el-input-number
                    v-model="form.height"
                    :min="600"
                    :max="2160"
                    :step="20"
                    controls-position="right"
                  />
                  <el-select v-model="form.pixelRatio">
                    <el-option
                      v-for="ratio in PIXEL_RATIO_OPTIONS"
                      :key="ratio"
                      :label="`${ratio}x`"
                      :value="ratio"
                    />
                  </el-select>
                </div>
              </div>
            </div>
          </div>

          <div class="config-row">
            <div class="config-row__label">备注</div>
            <div class="config-row__control">
              <el-input
                v-model="form.notes"
                type="textarea"
                :rows="3"
                placeholder="补充这个浏览器的用途、账号信息或使用说明"
              />
            </div>
          </div>
        </section>

        <section ref="advancedSectionRef" class="config-section">
          <header class="config-section__header">
            <h3>高级设置</h3>
            <p>只展示当前项目已经真实接入的指纹能力，避免界面有选项但运行时不生效。</p>
          </header>

          <el-alert
            type="info"
            :closable="false"
            class="config-alert"
            title="当前页已按“默认 / 自定义 / 随机”模式重排。像 WebRTC、地理位置、MAC 地址这类项目里还没真正接管的能力，我没有做成假开关。"
          />

          <div class="config-row">
            <div class="config-row__label">启用指纹</div>
            <div class="config-row__control">
              <el-switch v-model="form.enableFingerprint" />
            </div>
          </div>

          <template v-if="form.enableFingerprint && isFingerprintReady">
            <div class="config-row">
              <div class="config-row__label">User Agent</div>
              <div class="config-row__control">
                <div class="row-stack">
                  <div class="inline-actions">
                    <div class="mode-switch">
                      <button
                        type="button"
                        class="mode-switch__btn"
                        :class="{ 'is-active': fieldModes.userAgent === 'default' }"
                        @click="updateEditableMode('userAgent', 'default')"
                      >
                        默认
                      </button>
                      <button
                        type="button"
                        class="mode-switch__btn"
                        :class="{ 'is-active': fieldModes.userAgent === 'custom' }"
                        @click="updateEditableMode('userAgent', 'custom')"
                      >
                        自定义
                      </button>
                    </div>
                    <el-button plain :loading="fingerprintStore.loading" @click="randomizeIdentity">
                      随机
                    </el-button>
                  </div>

                  <el-input
                    v-model="currentFingerprint!.userAgent"
                    type="textarea"
                    :rows="2"
                    :disabled="fieldModes.userAgent === 'default'"
                    placeholder="Mozilla/5.0 ..."
                  />
                </div>
              </div>
            </div>

            <div class="config-row">
              <div class="config-row__label">Sec-CH-UA</div>
              <div class="config-row__control">
                <div class="row-stack">
                  <div class="mode-switch">
                    <button
                      type="button"
                      class="mode-switch__btn"
                      :class="{ 'is-active': fieldModes.secChUa === 'default' }"
                      @click="updateEditableMode('secChUa', 'default')"
                    >
                      默认
                    </button>
                    <button
                      type="button"
                      class="mode-switch__btn"
                      :class="{ 'is-active': fieldModes.secChUa === 'custom' }"
                      @click="updateEditableMode('secChUa', 'custom')"
                    >
                      自定义
                    </button>
                  </div>

                  <el-input
                    v-model="currentFingerprint!.secChUa"
                    :disabled="fieldModes.secChUa === 'default'"
                    placeholder="&quot;Not_A Brand&quot;;v=&quot;8&quot;, &quot;Chromium&quot;;v=&quot;142&quot;"
                  />
                </div>
              </div>
            </div>
            <div class="config-row">
              <div class="config-row__label">语言</div>
              <div class="config-row__control">
                <div class="row-stack">
                  <div class="mode-switch">
                    <button
                      type="button"
                      class="mode-switch__btn"
                      :class="{ 'is-active': fieldModes.language === 'default' }"
                      @click="updateEditableMode('language', 'default')"
                    >
                      默认
                    </button>
                    <button
                      type="button"
                      class="mode-switch__btn"
                      :class="{ 'is-active': fieldModes.language === 'custom' }"
                      @click="updateEditableMode('language', 'custom')"
                    >
                      自定义
                    </button>
                  </div>

                  <el-select
                    v-model="form.locale"
                    filterable
                    allow-create
                    default-first-option
                    :disabled="fieldModes.language === 'default'"
                  >
                    <el-option
                      v-for="locale in localeOptions"
                      :key="locale"
                      :label="locale"
                      :value="locale"
                    />
                  </el-select>
                </div>
              </div>
            </div>

            <div class="config-row">
              <div class="config-row__label">时区</div>
              <div class="config-row__control">
                <div class="row-stack">
                  <div class="mode-switch">
                    <button
                      type="button"
                      class="mode-switch__btn"
                      :class="{ 'is-active': fieldModes.timezone === 'default' }"
                      @click="updateEditableMode('timezone', 'default')"
                    >
                      默认
                    </button>
                    <button
                      type="button"
                      class="mode-switch__btn"
                      :class="{ 'is-active': fieldModes.timezone === 'custom' }"
                      @click="updateEditableMode('timezone', 'custom')"
                    >
                      自定义
                    </button>
                  </div>

                  <el-select
                    v-model="form.timezone"
                    filterable
                    allow-create
                    default-first-option
                    :disabled="fieldModes.timezone === 'default'"
                  >
                    <el-option
                      v-for="timezone in timezoneOptions"
                      :key="timezone"
                      :label="timezone"
                      :value="timezone"
                    />
                  </el-select>
                </div>
              </div>
            </div>

            <div class="config-row">
              <div class="config-row__label">分辨率</div>
              <div class="config-row__control">
                <div class="row-stack">
                  <div class="mode-switch">
                    <button
                      type="button"
                      class="mode-switch__btn"
                      :class="{ 'is-active': fieldModes.screen === 'default' }"
                      @click="updateEditableMode('screen', 'default')"
                    >
                      默认
                    </button>
                    <button
                      type="button"
                      class="mode-switch__btn"
                      :class="{ 'is-active': fieldModes.screen === 'custom' }"
                      @click="updateEditableMode('screen', 'custom')"
                    >
                      自定义
                    </button>
                  </div>

                  <div class="quad-grid">
                    <el-input-number
                      v-model="currentFingerprint!.hardware.screen.width"
                      :disabled="fieldModes.screen === 'default'"
                      :min="800"
                      :max="7680"
                      controls-position="right"
                    />
                    <el-input-number
                      v-model="currentFingerprint!.hardware.screen.height"
                      :disabled="fieldModes.screen === 'default'"
                      :min="600"
                      :max="4320"
                      controls-position="right"
                    />
                    <el-select
                      v-model="currentFingerprint!.hardware.screen.pixelRatio"
                      :disabled="fieldModes.screen === 'default'"
                    >
                      <el-option
                        v-for="ratio in PIXEL_RATIO_OPTIONS"
                        :key="ratio"
                        :label="`${ratio}x`"
                        :value="ratio"
                      />
                    </el-select>
                    <el-select
                      v-model="currentFingerprint!.hardware.screen.colorDepth"
                      :disabled="fieldModes.screen === 'default'"
                    >
                      <el-option
                        v-for="depth in COLOR_DEPTH_OPTIONS"
                        :key="depth"
                        :label="`${depth} bit`"
                        :value="depth"
                      />
                    </el-select>
                  </div>
                </div>
              </div>
            </div>

            <div class="config-row">
              <div class="config-row__label">字体</div>
              <div class="config-row__control">
                <div class="row-stack">
                  <div class="mode-switch">
                    <button
                      type="button"
                      class="mode-switch__btn"
                      :class="{ 'is-active': fieldModes.fonts === 'default' }"
                      @click="void updateRandomizableMode('fonts', 'default')"
                    >
                      默认
                    </button>
                    <button
                      type="button"
                      class="mode-switch__btn"
                      :class="{ 'is-active': fieldModes.fonts === 'custom' }"
                      @click="void updateRandomizableMode('fonts', 'custom')"
                    >
                      自定义
                    </button>
                    <button
                      type="button"
                      class="mode-switch__btn"
                      :class="{ 'is-active': fieldModes.fonts === 'random' }"
                      @click="void updateRandomizableMode('fonts', 'random')"
                    >
                      随机匹配
                    </button>
                  </div>

                  <el-select
                    v-model="currentFingerprint!.hardware.fonts"
                    multiple
                    filterable
                    allow-create
                    default-first-option
                    collapse-tags
                    collapse-tags-tooltip
                    :disabled="fieldModes.fonts === 'default'"
                    placeholder="选择或输入字体"
                  >
                    <el-option
                      v-for="font in fontOptions"
                      :key="font"
                      :label="font"
                      :value="font"
                    />
                  </el-select>
                </div>
              </div>
            </div>

            <div class="config-row">
              <div class="config-row__label">Canvas</div>
              <div class="config-row__control">
                <div class="row-stack">
                  <div class="mode-switch">
                    <button
                      type="button"
                      class="mode-switch__btn"
                      :class="{ 'is-active': fieldModes.canvas === 'default' }"
                      @click="void updateNoiseMode('canvas', 'default')"
                    >
                      默认
                    </button>
                    <button
                      type="button"
                      class="mode-switch__btn"
                      :class="{ 'is-active': fieldModes.canvas === 'random' }"
                      @click="void updateNoiseMode('canvas', 'random')"
                    >
                      随机
                    </button>
                  </div>

                  <el-slider
                    v-model="currentFingerprint!.advanced.canvasNoise"
                    :min="0"
                    :max="10"
                    show-input
                    :disabled="fieldModes.canvas === 'default'"
                  />
                </div>
              </div>
            </div>

            <div class="config-row">
              <div class="config-row__label">WebGL 元数据</div>
              <div class="config-row__control">
                <div class="row-stack">
                  <div class="mode-switch">
                    <button
                      type="button"
                      class="mode-switch__btn"
                      :class="{ 'is-active': fieldModes.webgl === 'default' }"
                      @click="void updateRandomizableMode('webgl', 'default')"
                    >
                      默认
                    </button>
                    <button
                      type="button"
                      class="mode-switch__btn"
                      :class="{ 'is-active': fieldModes.webgl === 'custom' }"
                      @click="void updateRandomizableMode('webgl', 'custom')"
                    >
                      自定义
                    </button>
                    <button
                      type="button"
                      class="mode-switch__btn"
                      :class="{ 'is-active': fieldModes.webgl === 'random' }"
                      @click="void updateRandomizableMode('webgl', 'random')"
                    >
                      随机
                    </button>
                  </div>

                  <div class="row-stack">
                    <div class="double-grid">
                      <el-select
                        v-model="currentFingerprint!.hardware.gpu.vendor"
                        filterable
                        allow-create
                        default-first-option
                        :disabled="fieldModes.webgl === 'default'"
                      >
                        <el-option
                          v-for="vendor in gpuVendorOptions"
                          :key="vendor"
                          :label="vendor"
                          :value="vendor"
                        />
                      </el-select>
                      <div class="inline-actions inline-actions--stretch">
                        <el-select
                          v-model="currentFingerprint!.hardware.gpu.renderer"
                          filterable
                          allow-create
                          default-first-option
                          :disabled="fieldModes.webgl === 'default'"
                        >
                          <el-option
                            v-for="renderer in gpuRendererOptions"
                            :key="renderer"
                            :label="renderer"
                            :value="renderer"
                          />
                        </el-select>
                        <el-button plain :disabled="fieldModes.webgl === 'default'" @click="useMatchingGpuRenderer">
                          匹配厂商
                        </el-button>
                      </div>
                    </div>

                    <el-switch
                      v-model="currentFingerprint!.advanced.webglNoise"
                      :disabled="fieldModes.webgl === 'default'"
                      active-text="启用 WebGL 扰动"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div class="config-row">
              <div class="config-row__label">AudioContext</div>
              <div class="config-row__control">
                <div class="mode-switch">
                  <button
                    type="button"
                    class="mode-switch__btn"
                    :class="{ 'is-active': fieldModes.audio === 'default' }"
                    @click="void updateNoiseMode('audio', 'default')"
                  >
                    默认
                  </button>
                  <button
                    type="button"
                    class="mode-switch__btn"
                    :class="{ 'is-active': fieldModes.audio === 'random' }"
                    @click="void updateNoiseMode('audio', 'random')"
                  >
                    随机
                  </button>
                </div>
              </div>
            </div>

            <div class="config-row">
              <div class="config-row__label">ClientRects</div>
              <div class="config-row__control">
                <div class="mode-switch">
                  <button
                    type="button"
                    class="mode-switch__btn"
                    :class="{ 'is-active': fieldModes.clientRects === 'default' }"
                    @click="void updateNoiseMode('clientRects', 'default')"
                  >
                    默认
                  </button>
                  <button
                    type="button"
                    class="mode-switch__btn"
                    :class="{ 'is-active': fieldModes.clientRects === 'random' }"
                    @click="void updateNoiseMode('clientRects', 'random')"
                  >
                    随机
                  </button>
                </div>
              </div>
            </div>

            <div class="config-row">
              <div class="config-row__label">Speech Voices</div>
              <div class="config-row__control">
                <div class="mode-switch">
                  <button
                    type="button"
                    class="mode-switch__btn"
                    :class="{ 'is-active': fieldModes.speechVoices === 'default' }"
                    @click="void updateNoiseMode('speechVoices', 'default')"
                  >
                    默认
                  </button>
                  <button
                    type="button"
                    class="mode-switch__btn"
                    :class="{ 'is-active': fieldModes.speechVoices === 'random' }"
                    @click="void updateNoiseMode('speechVoices', 'random')"
                  >
                    随机
                  </button>
                </div>
              </div>
            </div>

            <div class="config-row">
              <div class="config-row__label">CPU</div>
              <div class="config-row__control">
                <el-select v-model="currentFingerprint!.hardware.cpuCores">
                  <el-option
                    v-for="cores in CPU_CORE_OPTIONS"
                    :key="cores"
                    :label="`${cores} 核`"
                    :value="cores"
                  />
                </el-select>
              </div>
            </div>

            <div class="config-row">
              <div class="config-row__label">内存</div>
              <div class="config-row__control">
                <el-select v-model="currentFingerprint!.hardware.memory">
                  <el-option
                    v-for="memory in MEMORY_OPTIONS"
                    :key="memory"
                    :label="`${memory} GB`"
                    :value="memory"
                  />
                </el-select>
              </div>
            </div>

            <div class="config-row">
              <div class="config-row__label">Do Not Track</div>
              <div class="config-row__control">
                <el-switch v-model="currentFingerprint!.software.doNotTrack" />
              </div>
            </div>
          </template>

          <div v-else-if="form.enableFingerprint" class="fingerprint-loading-panel">
            <el-skeleton :rows="4" animated />
            <el-button
              plain
              :loading="fingerprintStore.loading"
              @click="void refreshDefaultFingerprint({ applyToCurrent: true })"
            >
              重新加载指纹
            </el-button>
          </div>
        </section>

        <section ref="summarySectionRef" class="config-section config-section--summary">
          <header class="config-section__header">
            <h3>保存确认</h3>
            <p>这里保留一个轻量摘要，方便在提交前快速检查配置是否合理。</p>
          </header>

          <el-descriptions :column="2" border>
            <el-descriptions-item label="浏览器名称">
              {{ form.name || '未填写' }}
            </el-descriptions-item>
            <el-descriptions-item label="分组">
              {{ groupStore.getGroupById(form.groupId)?.name || '默认分组' }}
            </el-descriptions-item>
            <el-descriptions-item label="操作系统">
              {{
                form.selectedOS === 'random'
                  ? '随机'
                  : form.selectedOS === OS_TYPES.WIN10
                    ? 'Windows 10'
                    : form.selectedOS === OS_TYPES.WIN11
                      ? 'Windows 11'
                      : form.selectedOS === OS_TYPES.MACOS
                        ? 'macOS'
                        : 'Linux'
              }}
            </el-descriptions-item>
            <el-descriptions-item label="浏览器版本">
              Chrome {{ form.browserVersion }}
            </el-descriptions-item>
            <el-descriptions-item label="主页">
              {{ form.homeUrl }}
            </el-descriptions-item>
            <el-descriptions-item label="代理">
              {{
                form.proxyType === 'none'
                  ? '不使用代理'
                  : `${form.proxyType.toUpperCase()} ${form.proxyHost}:${form.proxyPort}`
              }}
            </el-descriptions-item>
            <el-descriptions-item label="窗口">
              {{ form.width }} x {{ form.height }} ({{ form.pixelRatio }}x)
            </el-descriptions-item>
            <el-descriptions-item label="语言 / 时区">
              {{ form.locale }} / {{ form.timezone }}
            </el-descriptions-item>
          </el-descriptions>

          <div v-if="fingerprintSummary" class="summary-panel">
            <div class="summary-panel__title">当前指纹摘要</div>

            <div class="summary-grid">
              <div class="summary-item">
                <span>浏览器</span>
                <strong>{{ fingerprintSummary.browser }}</strong>
              </div>
              <div class="summary-item">
                <span>平台</span>
                <strong>{{ fingerprintSummary.platform }}</strong>
              </div>
              <div class="summary-item">
                <span>语言</span>
                <strong>{{ fingerprintSummary.locale }}</strong>
              </div>
              <div class="summary-item">
                <span>时区</span>
                <strong>{{ fingerprintSummary.timezone }}</strong>
              </div>
              <div class="summary-item">
                <span>屏幕</span>
                <strong>{{ fingerprintSummary.resolution }}</strong>
              </div>
              <div class="summary-item">
                <span>CPU / 内存</span>
                <strong>{{ fingerprintSummary.cpuCores }} / {{ fingerprintSummary.memory }}</strong>
              </div>
              <div class="summary-item summary-item--wide">
                <span>GPU</span>
                <strong>{{ fingerprintSummary.gpu }}</strong>
              </div>
              <div class="summary-item">
                <span>字体</span>
                <strong>{{ fingerprintSummary.fonts }} 项</strong>
              </div>
              <div class="summary-item">
                <span>Canvas 噪声</span>
                <strong>{{ fingerprintSummary.canvasNoise }}</strong>
              </div>
              <div class="summary-item">
                <span>DNT</span>
                <strong>{{ fingerprintSummary.doNotTrack }}</strong>
              </div>
            </div>
          </div>

          <el-alert
            v-if="fingerprintStore.error"
            :title="fingerprintStore.error"
            type="error"
            :closable="false"
            class="config-alert"
          />
        </section>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="closeDialog">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">
          {{ isEditMode ? '保存修改' : '创建浏览器' }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
:deep(.profile-editor-dialog) {
  max-width: calc(100vw - 40px);
}

:deep(.profile-editor-dialog .el-dialog) {
  border-radius: 24px;
  overflow: hidden;
}

:deep(.profile-editor-dialog .el-dialog__header) {
  padding: 22px 28px 16px;
  border-bottom: 1px solid #edf0ff;
}

:deep(.profile-editor-dialog .el-dialog__body) {
  padding: 18px 24px 10px;
  max-height: calc(100vh - 170px);
  overflow-y: auto;
  background: linear-gradient(180deg, #fcfcff 0%, #ffffff 100%);
}

:deep(.profile-editor-dialog .el-dialog__footer) {
  padding: 18px 28px 26px;
  border-top: 1px solid #edf0ff;
}

:deep(.profile-editor-dialog .el-input-number) {
  width: 100%;
}

.profile-editor-shell {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 18px;
}

.profile-editor-nav {
  position: sticky;
  top: 0;
  align-self: start;
  display: grid;
  gap: 18px;
  padding: 12px 8px 12px 0;
}

.profile-editor-nav__line {
  position: absolute;
  left: 8px;
  top: 18px;
  bottom: 18px;
  width: 2px;
  background: linear-gradient(180deg, #6f63f6 0%, rgba(111, 99, 246, 0.18) 100%);
}

.profile-editor-nav__item {
  position: relative;
  z-index: 1;
  padding-left: 28px;
  border: none;
  background: transparent;
  color: #8b92a6;
  font-size: 15px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.profile-editor-nav__item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  transform: translateY(-50%);
  background: #dcdff6;
  box-shadow: 0 0 0 4px #ffffff;
}

.profile-editor-nav__item.is-active {
  color: #5d52ea;
}

.profile-editor-nav__item.is-active::before {
  background: #6f63f6;
}

.profile-editor-content {
  display: grid;
  gap: 18px;
}

.config-section {
  padding: 22px 24px;
  border-radius: 20px;
  border: 1px solid #eceffe;
  background: #ffffff;
  box-shadow: 0 16px 42px rgba(27, 35, 78, 0.05);
}

.config-section--summary {
  background: linear-gradient(180deg, #fcfcff 0%, #f8faff 100%);
}

.config-section__header {
  margin-bottom: 18px;
}

.config-section__header h3 {
  margin: 0 0 6px;
  color: #283247;
  font-size: 22px;
}

.config-section__header p {
  margin: 0;
  color: #7d879d;
  font-size: 13px;
  line-height: 1.6;
}

.config-alert {
  margin-bottom: 18px;
}

.fingerprint-loading-panel {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px dashed #d6dcf8;
  border-radius: 14px;
  background: #fafbff;
}

.config-row {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
  padding: 12px 0;
}

.config-row + .config-row {
  border-top: 1px solid #f2f4fb;
}

.config-row__label {
  padding-top: 10px;
  color: #535b6c;
  font-size: 15px;
  font-weight: 700;
}

.config-row__control {
  min-width: 0;
}

.row-stack {
  display: grid;
  gap: 12px;
}

.inline-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.inline-actions--stretch {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
}

.mode-switch {
  display: inline-flex;
  flex-wrap: wrap;
  border: 1px solid #d9def5;
  border-radius: 12px;
  overflow: hidden;
  background: #ffffff;
}

.mode-switch__btn {
  min-width: 88px;
  padding: 10px 18px;
  border: none;
  background: #ffffff;
  color: #596275;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.mode-switch__btn + .mode-switch__btn {
  border-left: 1px solid #d9def5;
}

.mode-switch__btn.is-active {
  background: linear-gradient(135deg, #7568f4 0%, #6658eb 100%);
  color: #ffffff;
}

.preset-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.preset-pill {
  padding: 10px 16px;
  border: 1px solid #d8def8;
  border-radius: 12px;
  background: #ffffff;
  color: #49546a;
  font-weight: 600;
  cursor: pointer;
}

.preset-pill:hover {
  border-color: #8478ff;
  color: #5f52ea;
}

.proxy-grid,
.triple-grid,
.quad-grid,
.double-grid {
  display: grid;
  gap: 12px;
}

.proxy-grid {
  grid-template-columns: 160px minmax(0, 1fr) 160px;
}

.proxy-grid--auth {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.triple-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.quad-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.double-grid {
  grid-template-columns: 280px minmax(0, 1fr);
}

.summary-panel {
  margin-top: 18px;
  padding: 18px;
  border-radius: 18px;
  border: 1px solid #e7eafb;
  background: #ffffff;
}

.summary-panel__title {
  margin-bottom: 14px;
  color: #344054;
  font-size: 14px;
  font-weight: 700;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.summary-item {
  padding: 12px 14px;
  border-radius: 14px;
  background: #f8faff;
  border: 1px solid #edf1ff;
}

.summary-item--wide {
  grid-column: span 2;
}

.summary-item span {
  display: block;
  margin-bottom: 6px;
  color: #7b8498;
  font-size: 12px;
}

.summary-item strong {
  color: #243144;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

@media (max-width: 1180px) {
  .profile-editor-shell {
    grid-template-columns: 1fr;
  }

  .profile-editor-nav {
    position: static;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding-right: 0;
  }

  .profile-editor-nav__line {
    display: none;
  }

  .profile-editor-nav__item {
    padding: 0;
  }

  .profile-editor-nav__item::before {
    display: none;
  }
}

@media (max-width: 960px) {
  .config-row {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .config-row__label {
    padding-top: 0;
  }

  .proxy-grid,
  .proxy-grid--auth,
  .triple-grid,
  .quad-grid,
  .double-grid,
  .summary-grid,
  .inline-actions--stretch {
    grid-template-columns: 1fr;
  }

  .summary-item--wide {
    grid-column: span 1;
  }
}
</style>
