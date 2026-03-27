import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  CreateProfileInput,
  DeleteProfileInput,
  Profile,
  UpdateProfileInput
} from '@shared/types'

export const useProfileStore = defineStore('profiles', () => {
  const profiles = ref<Profile[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  function toErrorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : 'Unknown profile operation error'
  }

  const profileMap = computed(() => {
    return new Map(profiles.value.map((profile) => [profile.id, profile]))
  })

  async function loadProfiles(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const result = await window.api.db.getProfiles()

      if (result.success) {
        profiles.value = result.data
      } else {
        error.value = result.error
      }
    } catch (cause) {
      error.value = toErrorMessage(cause)
    } finally {
      loading.value = false
    }
  }

  async function createProfile(input: CreateProfileInput): Promise<boolean> {
    saving.value = true
    error.value = null

    try {
      const result = await window.api.db.createProfile(input)

      if (!result.success) {
        error.value = result.error
        return false
      }

      await loadProfiles()
      return true
    } catch (cause) {
      error.value = toErrorMessage(cause)
      return false
    } finally {
      saving.value = false
    }
  }

  async function updateProfile(input: UpdateProfileInput): Promise<boolean> {
    saving.value = true
    error.value = null

    try {
      const result = await window.api.db.updateProfile(input)

      if (!result.success) {
        error.value = result.error
        return false
      }

      await loadProfiles()
      return true
    } catch (cause) {
      error.value = toErrorMessage(cause)
      return false
    } finally {
      saving.value = false
    }
  }

  async function deleteProfile(input: DeleteProfileInput): Promise<boolean> {
    error.value = null
    try {
      const result = await window.api.db.deleteProfile(input)

      if (!result.success) {
        error.value = result.error
        return false
      }

      await loadProfiles()
      return true
    } catch (cause) {
      error.value = toErrorMessage(cause)
      return false
    }
  }

  async function cloneProfile(id: string): Promise<boolean> {
    error.value = null
    try {
      const result = await window.api.db.cloneProfile({ id })

      if (!result.success) {
        error.value = result.error
        return false
      }

      await loadProfiles()
      return true
    } catch (cause) {
      error.value = toErrorMessage(cause)
      return false
    }
  }

  function getProfileById(id: string): Profile | undefined {
    return profileMap.value.get(id)
  }

  return {
    profiles,
    loading,
    saving,
    error,
    loadProfiles,
    createProfile,
    updateProfile,
    deleteProfile,
    cloneProfile,
    getProfileById
  }
})
