import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { CreateGroupInput, GroupRecord, UpdateGroupInput } from '@shared/types'

export const useGroupStore = defineStore('groups', () => {
  const groups = ref<GroupRecord[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  function toErrorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : 'Unknown group operation error'
  }

  const groupMap = computed(() => {
    return new Map(groups.value.map((group) => [group.id, group]))
  })

  async function loadGroups(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const result = await window.api.db.getGroups()

      if (result.success) {
        groups.value = result.data
      } else {
        error.value = result.error
      }
    } catch (cause) {
      error.value = toErrorMessage(cause)
    } finally {
      loading.value = false
    }
  }

  async function createGroup(input: CreateGroupInput): Promise<GroupRecord | null> {
    saving.value = true
    error.value = null

    try {
      const result = await window.api.db.createGroup(input)

      if (!result.success) {
        error.value = result.error
        return null
      }

      await loadGroups()
      return result.data
    } catch (cause) {
      error.value = toErrorMessage(cause)
      return null
    } finally {
      saving.value = false
    }
  }

  async function updateGroup(input: UpdateGroupInput): Promise<GroupRecord | null> {
    saving.value = true
    error.value = null

    try {
      const result = await window.api.db.updateGroup(input)

      if (!result.success) {
        error.value = result.error
        return null
      }

      await loadGroups()
      return result.data
    } catch (cause) {
      error.value = toErrorMessage(cause)
      return null
    } finally {
      saving.value = false
    }
  }

  async function deleteGroup(id: string): Promise<boolean> {
    saving.value = true
    error.value = null

    try {
      const result = await window.api.db.deleteGroup({ id })

      if (!result.success) {
        error.value = result.error
        return false
      }

      await loadGroups()
      return true
    } catch (cause) {
      error.value = toErrorMessage(cause)
      return false
    } finally {
      saving.value = false
    }
  }

  function getGroupById(id?: string): GroupRecord | undefined {
    return id ? groupMap.value.get(id) : undefined
  }

  return {
    groups,
    loading,
    saving,
    error,
    groupMap,
    loadGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    getGroupById
  }
})
