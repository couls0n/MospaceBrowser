<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { DEFAULT_BROWSER_CONFIG, OS_TYPES } from '@shared/constants'
import { useFingerprintStore } from '@renderer/stores/fingerprint'
import type { CreateProfileInput, OSType, Profile, UpdateProfileInput } from '@shared/types'

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
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [payload: CreateProfileInput | UpdateProfileInput]
}>()

const fingerprintStore = useFingerprintStore()
const isEditMode = computed(() => Boolean(props.profile))
const activeStep = ref(0)

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
  { title: 'Basic Info', description: 'Profile name and browser settings' },
  { title: 'Fingerprint', description: 'Persisted anti-detection fingerprint' },
  { title: 'Proxy', description: 'Optional outbound proxy' },
  { title: 'Confirm', description: 'Review and save' }
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
  fingerprintStore.setFingerprint(profile?.fingerprintConfig ?? null)
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

async function previewFingerprint(): Promise<void> {
  if (!form.enableFingerprint) {
    fingerprintStore.clearFingerprint()
    return
  }

  const seed = props.profile?.id ?? crypto.randomUUID()
  const os = form.selectedOS === 'random' ? undefined : form.selectedOS
  await fingerprintStore.generateFingerprint(seed, { os })
}

function submit(): void {
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
      ? (fingerprintStore.currentFingerprint ?? undefined)
      : undefined
  }

  if (props.profile) {
    const updatePayload: UpdateProfileInput = {
      id: props.profile.id,
      ...payloadBase
    }

    emit('save', updatePayload)
  } else {
    emit('save', payloadBase)
  }

  closeDialog()
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="isEditMode ? 'Edit Browser Profile' : 'Create Browser Profile'"
    width="800px"
    @close="closeDialog"
  >
    <el-steps :active="activeStep" finish-status="success" simple>
      <el-step v-for="step in steps" :key="step.title" :title="step.title" />
    </el-steps>

    <div v-show="activeStep === 0" class="step-content">
      <el-form label-position="top" class="editor-form">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="Profile Name" required>
              <el-input v-model="form.name" placeholder="e.g. Work Profile" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="Home URL">
              <el-input v-model="form.homeUrl" placeholder="https://example.com" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="Notes">
          <el-input
            v-model="form.notes"
            type="textarea"
            :rows="3"
            placeholder="What is this profile used for?"
          />
        </el-form-item>

        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="Locale">
              <el-input v-model="form.locale" placeholder="en-US" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="Timezone">
              <el-input v-model="form.timezone" placeholder="Asia/Hong_Kong" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="Color Scheme">
              <el-select v-model="form.colorScheme">
                <el-option label="System" value="system" />
                <el-option label="Light" value="light" />
                <el-option label="Dark" value="dark" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider>Window Settings</el-divider>

        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="Width">
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
            <el-form-item label="Height">
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
            <el-form-item label="Scale (DPR)">
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
            Persist and inject an anti-detection fingerprint for this profile
          </el-checkbox>
        </el-form-item>

        <template v-if="form.enableFingerprint">
          <el-form-item label="Target Operating System">
            <el-radio-group v-model="form.selectedOS">
              <el-radio-button label="random">Random</el-radio-button>
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
            Preview and Persist This Fingerprint
          </el-button>

          <p class="fingerprint-hint">
            The saved fingerprint is injected into every new page at launch time, and you can verify
            it with the profile's "Verify" action after the browser starts.
          </p>

          <div
            v-if="fingerprintStore.hasFingerprint && fingerprintStore.fingerprintSummary"
            class="fingerprint-preview"
          >
            <el-divider>Saved Fingerprint Preview</el-divider>
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="OS">{{
                fingerprintStore.fingerprintSummary.os
              }}</el-descriptions-item>
              <el-descriptions-item label="Browser">{{
                fingerprintStore.fingerprintSummary.browser
              }}</el-descriptions-item>
              <el-descriptions-item label="Resolution">{{
                fingerprintStore.fingerprintSummary.resolution
              }}</el-descriptions-item>
              <el-descriptions-item label="CPU Cores">{{
                fingerprintStore.fingerprintSummary.cpuCores
              }}</el-descriptions-item>
              <el-descriptions-item label="Memory">{{
                fingerprintStore.fingerprintSummary.memory
              }}</el-descriptions-item>
              <el-descriptions-item label="Timezone">{{
                fingerprintStore.fingerprintSummary.timezone
              }}</el-descriptions-item>
              <el-descriptions-item label="Locale">{{
                fingerprintStore.fingerprintSummary.locale
              }}</el-descriptions-item>
              <el-descriptions-item label="Fonts"
                >{{ fingerprintStore.fingerprintSummary.fontCount }} fonts</el-descriptions-item
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
        <el-form-item label="Proxy Type">
          <el-radio-group v-model="form.proxyType">
            <el-radio-button label="none">No Proxy</el-radio-button>
            <el-radio-button label="http">HTTP</el-radio-button>
            <el-radio-button label="https">HTTPS</el-radio-button>
            <el-radio-button label="socks5">SOCKS5</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <template v-if="form.proxyType !== 'none'">
          <el-row :gutter="16">
            <el-col :span="16">
              <el-form-item label="Proxy Host">
                <el-input v-model="form.proxyHost" placeholder="127.0.0.1" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="Proxy Port">
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
              <el-form-item label="Username (Optional)">
                <el-input v-model="form.proxyUsername" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="Password (Optional)">
                <el-input v-model="form.proxyPassword" type="password" show-password />
              </el-form-item>
            </el-col>
          </el-row>
        </template>
      </el-form>
    </div>

    <div v-show="activeStep === 3" class="step-content">
      <el-alert
        title="Review your profile settings before saving"
        type="info"
        :closable="false"
        class="mb-4"
      />

      <el-descriptions :column="1" border>
        <el-descriptions-item label="Profile Name">{{
          form.name || 'Not set'
        }}</el-descriptions-item>
        <el-descriptions-item label="Home URL">{{ form.homeUrl }}</el-descriptions-item>
        <el-descriptions-item label="Window Size"
          >{{ form.width }} x {{ form.height }} ({{ form.pixelRatio }}x)</el-descriptions-item
        >
        <el-descriptions-item label="Locale / Timezone"
          >{{ form.locale }} / {{ form.timezone }}</el-descriptions-item
        >
        <el-descriptions-item label="Fingerprint">
          {{ form.enableFingerprint ? 'Persisted and injected at launch' : 'Disabled' }}
        </el-descriptions-item>
        <el-descriptions-item label="Proxy">
          {{
            form.proxyType === 'none'
              ? 'No Proxy'
              : `${form.proxyType.toUpperCase()} ${form.proxyHost}:${form.proxyPort}`
          }}
        </el-descriptions-item>
      </el-descriptions>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button v-if="activeStep > 0" @click="activeStep--">Previous</el-button>
        <el-button v-if="activeStep < 3" type="primary" @click="activeStep++">Next</el-button>
        <el-button v-else type="success" @click="submit">
          {{ isEditMode ? 'Save Changes' : 'Create Profile' }}
        </el-button>
        <el-button @click="closeDialog">Cancel</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.step-content {
  padding: 20px 0;
  min-height: 300px;
}

.fingerprint-preview {
  margin-top: 20px;
  padding: 16px;
  background-color: var(--el-fill-color-light);
  border-radius: 8px;
}

.fingerprint-hint {
  margin: 14px 0 0;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
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
</style>
