<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { DEFAULT_BROWSER_CONFIG } from '@shared/constants'
import type { CreateProfileInput, Profile, UpdateProfileInput } from '@shared/types'

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
}

const props = defineProps<{
  modelValue: boolean
  profile?: Profile | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [payload: CreateProfileInput | UpdateProfileInput]
}>()

const isEditMode = computed(() => Boolean(props.profile))

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
  proxyPassword: ''
})

function resetForm(profile?: Profile | null): void {
  form.name = profile?.name ?? ''
  form.notes = profile?.notes ?? ''
  form.locale = profile?.browserConfig.locale ?? DEFAULT_BROWSER_CONFIG.locale
  form.timezone = profile?.browserConfig.timezone ?? DEFAULT_BROWSER_CONFIG.timezone
  form.colorScheme = profile?.browserConfig.colorScheme ?? DEFAULT_BROWSER_CONFIG.colorScheme
  form.homeUrl = profile?.browserConfig.homeUrl ?? DEFAULT_BROWSER_CONFIG.homeUrl
  form.width = profile?.browserConfig.window.width ?? DEFAULT_BROWSER_CONFIG.window.width
  form.height = profile?.browserConfig.window.height ?? DEFAULT_BROWSER_CONFIG.window.height
  form.pixelRatio = profile?.browserConfig.window.pixelRatio ?? DEFAULT_BROWSER_CONFIG.window.pixelRatio
  form.proxyType = profile?.proxyConfig?.type ?? 'none'
  form.proxyHost = profile?.proxyConfig?.host ?? ''
  form.proxyPort = profile?.proxyConfig?.port ?? 8080
  form.proxyUsername = profile?.proxyConfig?.username ?? ''
  form.proxyPassword = profile?.proxyConfig?.password ?? ''
}

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      resetForm(props.profile)
    }
  }
)

function closeDialog(): void {
  emit('update:modelValue', false)
}

function submit(): void {
  const payloadBase = {
    name: form.name,
    notes: form.notes,
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
            type: 'none' as const,
            host: 'localhost',
            port: 80
          }
        : {
            type: form.proxyType,
            host: form.proxyHost,
            port: form.proxyPort,
            username: form.proxyUsername || undefined,
            password: form.proxyPassword || undefined
          }
  }

  if (props.profile) {
    emit('save', {
      id: props.profile.id,
      ...payloadBase
    })
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
    width="720px"
    @close="closeDialog"
  >
    <el-form label-position="top" class="editor-form">
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="Profile Name">
            <el-input v-model="form.name" placeholder="Workspace profile" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="Home URL">
            <el-input v-model="form.homeUrl" placeholder="https://example.com" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="Notes">
        <el-input v-model="form.notes" type="textarea" :rows="3" placeholder="What is this profile for?" />
      </el-form-item>

      <div class="editor-grid">
        <el-form-item label="Locale">
          <el-input v-model="form.locale" placeholder="en-US" />
        </el-form-item>
        <el-form-item label="Timezone">
          <el-input v-model="form.timezone" placeholder="Asia/Hong_Kong" />
        </el-form-item>
        <el-form-item label="Color Scheme">
          <el-select v-model="form.colorScheme">
            <el-option label="System" value="system" />
            <el-option label="Light" value="light" />
            <el-option label="Dark" value="dark" />
          </el-select>
        </el-form-item>
        <el-form-item label="Proxy Type">
          <el-select v-model="form.proxyType">
            <el-option label="None" value="none" />
            <el-option label="HTTP" value="http" />
            <el-option label="HTTPS" value="https" />
            <el-option label="SOCKS5" value="socks5" />
          </el-select>
        </el-form-item>
      </div>

      <div class="editor-grid editor-grid--window">
        <el-form-item label="Window Width">
          <el-input-number v-model="form.width" :min="800" :max="3840" :step="20" controls-position="right" />
        </el-form-item>
        <el-form-item label="Window Height">
          <el-input-number v-model="form.height" :min="600" :max="2160" :step="20" controls-position="right" />
        </el-form-item>
        <el-form-item label="Scale">
          <el-input-number v-model="form.pixelRatio" :min="1" :max="3" :step="0.25" controls-position="right" />
        </el-form-item>
      </div>

      <div v-if="form.proxyType !== 'none'" class="editor-grid">
        <el-form-item label="Proxy Host">
          <el-input v-model="form.proxyHost" placeholder="127.0.0.1" />
        </el-form-item>
        <el-form-item label="Proxy Port">
          <el-input-number v-model="form.proxyPort" :min="1" :max="65535" controls-position="right" />
        </el-form-item>
        <el-form-item label="Proxy Username">
          <el-input v-model="form.proxyUsername" placeholder="Optional" />
        </el-form-item>
        <el-form-item label="Proxy Password">
          <el-input v-model="form.proxyPassword" type="password" show-password placeholder="Optional" />
        </el-form-item>
      </div>
    </el-form>

    <template #footer>
      <div class="editor-footer">
        <el-button @click="closeDialog">Cancel</el-button>
        <el-button type="primary" @click="submit">
          {{ isEditMode ? 'Save Changes' : 'Create Profile' }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>
