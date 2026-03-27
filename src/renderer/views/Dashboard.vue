<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ProfileCard from '@renderer/components/ProfileCard.vue'
import ProfileEditor from '@renderer/components/ProfileEditor.vue'
import { useLauncherStore } from '@renderer/stores/launcher'
import { useProfileStore } from '@renderer/stores/profiles'
import type { CreateProfileInput, Profile, UpdateProfileInput } from '@shared/types'

const profileStore = useProfileStore()
const launcherStore = useLauncherStore()

const editorVisible = ref(false)
const editingProfileId = ref<string | null>(null)

const editingProfile = computed<Profile | null>(() => {
  if (!editingProfileId.value) {
    return null
  }

  return profileStore.getProfileById(editingProfileId.value) ?? null
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

async function handleSave(payload: CreateProfileInput | UpdateProfileInput): Promise<void> {
  const saved =
    'id' in payload
      ? await profileStore.updateProfile(payload)
      : await profileStore.createProfile(payload)

  if (saved) {
    ElMessage.success('Profile saved.')
    await refresh()
  } else if (profileStore.error) {
    ElMessage.error(profileStore.error)
  }
}

async function handleDelete(profileId: string): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    'Delete this profile and its local browser data folder?',
    'Delete Profile',
    {
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel',
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
    ElMessage.success('Profile deleted.')
    await launcherStore.syncRunning()
  } else if (profileStore.error) {
    ElMessage.error(profileStore.error)
  }
}

async function handleClone(profileId: string): Promise<void> {
  const cloned = await profileStore.cloneProfile(profileId)

  if (cloned) {
    ElMessage.success('Profile cloned.')
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
    ElMessage.success('Verification page opened in the running browser.')
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

onMounted(async () => {
  launcherStore.setupListeners()
  await refresh()
})
</script>

<template>
  <section class="dashboard">
    <div class="dashboard-toolbar">
      <div>
        <p class="eyebrow">Profiles</p>
        <h2>{{ profileStore.profiles.length }} local workspaces</h2>
      </div>

      <div class="dashboard-toolbar__actions">
        <el-tag effect="dark" type="success">{{ launcherStore.runningCount }} running</el-tag>
        <el-button @click="refresh">Refresh</el-button>
        <el-button type="primary" @click="openCreateDialog">Create Profile</el-button>
      </div>
    </div>

    <el-alert
      v-if="profileStore.error"
      type="error"
      :closable="false"
      :title="profileStore.error"
      class="dashboard-alert"
    />

    <div v-if="profileStore.loading" class="profile-grid">
      <el-skeleton v-for="index in 4" :key="index" animated class="profile-skeleton">
        <template #template>
          <el-skeleton-item variant="rect" style="width: 100%; height: 240px" />
        </template>
      </el-skeleton>
    </div>

    <div v-else class="profile-grid">
      <profile-card
        v-for="profile in profileStore.profiles"
        :key="profile.id"
        :profile="profile"
        :instance="launcherStore.runningInstances[profile.id]"
        @edit="openEditDialog"
        @delete="handleDelete"
        @clone="handleClone"
        @start="handleStart"
        @stop="handleStop"
        @verify="handleVerify"
        @open-dir="openDirectory"
      />
    </div>

    <profile-editor v-model="editorVisible" :profile="editingProfile" @save="handleSave" />
  </section>
</template>
