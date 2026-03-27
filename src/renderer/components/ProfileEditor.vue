<script setup lang="ts">
import { computed, reactive, ref, toRaw, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { DEFAULT_BROWSER_CONFIG, OS_TYPES } from '@shared/constants'
import { useFingerprintStore } from '@renderer/stores/fingerprint'
import type {
  CreateProfileInput,
  FingerprintConfig,
  OSType,
  Profile,
  UpdateProfileInput
} from '@shared/types'

interface ProfileFormState {
  name: string
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
const isEditMode = computed(() => Boolean(props.profile))
const activeStep = ref(0)

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

const form = reactive<ProfileFormState>({
  name: '',
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

const steps = [
  { title: '基础信息', description: '名称、首页和窗口尺寸' },
  { title: '指纹配置', description: '持久化并注入指纹' },
  { title: '代理设置', description: '绑定 HTTP / SOCKS5 代理' },
  { title: '确认保存', description: '检查当前配置后提交' }
]

function resetForm(profile?: Profile | null): void {
  form.name = profile?.name ?? ''
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
  fingerprintStore.setFingerprint(cloneFingerprintConfig(profile?.fingerprintConfig) ?? null)
  activeStep.value = 0
}

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      resetForm(props.profile)
    }
  }
)

watch(
  () => form.enableFingerprint,
  (enabled) => {
    if (!enabled) {
      fingerprintStore.clearFingerprint()
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
    ElMessage.warning('请填写语言设置。')
    return false
  }

  if (!form.timezone) {
    ElMessage.warning('请填写时区。')
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
    ElMessage.warning('已启用代理时，代理地址不能为空。')
    return false
  }

  if (!Number.isInteger(form.proxyPort) || form.proxyPort < 1 || form.proxyPort > 65535) {
    ElMessage.warning('代理端口需要在 1 到 65535 之间。')
    return false
  }

  return true
}

async function ensureFingerprintReady(): Promise<boolean> {
  if (!form.enableFingerprint) {
    return true
  }

  if (fingerprintStore.currentFingerprint) {
    return true
  }

  const generated = await previewFingerprint()

  if (!generated) {
    ElMessage.error(fingerprintStore.error || '指纹生成失败，请稍后再试。')
    return false
  }

  return true
}

async function previewFingerprint(): Promise<boolean> {
  if (!form.enableFingerprint) {
    fingerprintStore.clearFingerprint()
    return true
  }

  const seed = props.profile?.id ?? crypto.randomUUID()
  const os = form.selectedOS === 'random' ? undefined : form.selectedOS
  const generated = await fingerprintStore.generateFingerprint(seed, { os })
  return generated !== null
}

async function goNext(): Promise<void> {
  if (activeStep.value === 0 && !validateBasicInfo()) {
    return
  }

  if (activeStep.value === 2 && !validateProxy()) {
    return
  }

  if (activeStep.value < 3) {
    activeStep.value += 1
  }
}

async function submit(): Promise<void> {
  if (!validateBasicInfo() || !validateProxy()) {
    return
  }

  const fingerprintReady = await ensureFingerprintReady()

  if (!fingerprintReady) {
    return
  }

  const payloadBase: CreateProfileInput = {
    name: form.name,
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
    width="1100px"
    align-center
    append-to-body
    class="profile-editor-dialog"
    @close="closeDialog"
  >
    <el-steps :active="activeStep" finish-status="success" simple>
      <el-step v-for="step in steps" :key="step.title" :title="step.title" />
    </el-steps>

    <div v-show="activeStep === 0" class="step-content">
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
            <el-form-item label="语言">
              <el-input v-model="form.locale" placeholder="zh-CN / en-US" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="时区">
              <el-input v-model="form.timezone" placeholder="Asia/Hong_Kong" />
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
              <el-input-number
                v-model="form.pixelRatio"
                :min="1"
                :max="3"
                :step="0.25"
                controls-position="right"
              />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
    </div>

    <div v-show="activeStep === 1" class="step-content">
      <el-form label-position="top">
        <el-form-item>
          <el-checkbox v-model="form.enableFingerprint">
            为这个浏览器持久化并注入反检测指纹
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

          <el-button
            type="primary"
            plain
            :loading="fingerprintStore.loading"
            @click="previewFingerprint"
          >
            生成并保存当前指纹
          </el-button>

          <p class="fingerprint-hint">
            这份指纹会随着 profile
            一起持久化，浏览器启动时自动注入到新页面；浏览器运行后可在列表页直接点击“验证”查看当前环境。
          </p>

          <div
            v-if="fingerprintStore.hasFingerprint && fingerprintStore.fingerprintSummary"
            class="fingerprint-preview"
          >
            <el-divider>当前指纹预览</el-divider>
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="操作系统">{{
                fingerprintStore.fingerprintSummary.os
              }}</el-descriptions-item>
              <el-descriptions-item label="浏览器">{{
                fingerprintStore.fingerprintSummary.browser
              }}</el-descriptions-item>
              <el-descriptions-item label="分辨率">{{
                fingerprintStore.fingerprintSummary.resolution
              }}</el-descriptions-item>
              <el-descriptions-item label="CPU 核心数">{{
                fingerprintStore.fingerprintSummary.cpuCores
              }}</el-descriptions-item>
              <el-descriptions-item label="内存">{{
                fingerprintStore.fingerprintSummary.memory
              }}</el-descriptions-item>
              <el-descriptions-item label="时区">{{
                fingerprintStore.fingerprintSummary.timezone
              }}</el-descriptions-item>
              <el-descriptions-item label="语言">{{
                fingerprintStore.fingerprintSummary.locale
              }}</el-descriptions-item>
              <el-descriptions-item label="字体"
                >{{ fingerprintStore.fingerprintSummary.fontCount }} 项</el-descriptions-item
              >
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

    <div v-show="activeStep === 2" class="step-content">
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

    <div v-show="activeStep === 3" class="step-content">
      <el-alert title="保存前请再次确认这份浏览器配置" type="info" :closable="false" class="mb-4" />

      <el-descriptions :column="1" border>
        <el-descriptions-item label="浏览器名称">{{ form.name || '未填写' }}</el-descriptions-item>
        <el-descriptions-item label="首页地址">{{ form.homeUrl }}</el-descriptions-item>
        <el-descriptions-item label="窗口尺寸"
          >{{ form.width }} x {{ form.height }} ({{ form.pixelRatio }}x)</el-descriptions-item
        >
        <el-descriptions-item label="语言 / 时区"
          >{{ form.locale }} / {{ form.timezone }}</el-descriptions-item
        >
        <el-descriptions-item label="指纹状态">
          {{ form.enableFingerprint ? '已启用，启动时自动注入' : '已关闭' }}
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

    <template #footer>
      <div class="dialog-footer">
        <el-button v-if="activeStep > 0" @click="activeStep--">上一步</el-button>
        <el-button v-if="activeStep < 3" type="primary" @click="goNext">下一步</el-button>
        <el-button v-else type="success" :loading="saving" @click="submit">
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
}

:deep(.profile-editor-dialog .el-dialog__footer) {
  padding: 14px 24px 22px;
}

:deep(.profile-editor-dialog .el-step__title) {
  font-weight: 600;
}

:deep(.profile-editor-dialog .el-input-number) {
  width: 100%;
}

.step-content {
  padding: 22px 0 8px;
  min-height: 460px;
}

.fingerprint-preview {
  margin-top: 20px;
  padding: 18px;
  border: 1px solid #e8ecf3;
  border-radius: 16px;
  background: #f8f9fc;
}

.fingerprint-hint {
  margin: 14px 0 0;
  color: var(--text-secondary);
  line-height: 1.8;
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

@media (max-width: 900px) {
  .step-content {
    min-height: 360px;
  }
}
</style>
