import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  BrowserControlExecutionResult,
  BrowserControlTab,
  BrowserInstanceInfo,
  ExecuteBrowserControlInput,
  LauncherStatusChange
} from '@shared/types'

type RunningRecord = Record<string, BrowserInstanceInfo>

function toRecord(instances: BrowserInstanceInfo[]): RunningRecord {
  return instances.reduce<RunningRecord>((record, instance) => {
    record[instance.profileId] = instance
    return record
  }, {})
}

export const useLauncherStore = defineStore('launcher', () => {
  const runningInstances = ref<RunningRecord>({})
  const loading = ref(false)
  const error = ref<string | null>(null)
  let unsubscribe: (() => void) | null = null

  const runningCount = computed(() => Object.keys(runningInstances.value).length)

  async function syncRunning(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const result = await window.api.launcher.getAllRunning()

      if (result.success) {
        runningInstances.value = toRecord(result.data)
      } else {
        error.value = result.error
      }
    } finally {
      loading.value = false
    }
  }

  async function startProfile(profileId: string): Promise<boolean> {
    error.value = null
    const result = await window.api.launcher.start({ profileId })

    if (!result.success) {
      error.value = result.error
      return false
    }

    runningInstances.value = {
      ...runningInstances.value,
      [profileId]: result.data
    }

    return true
  }

  async function stopProfile(profileId: string): Promise<boolean> {
    error.value = null
    const result = await window.api.launcher.stop({ profileId })

    if (!result.success) {
      error.value = result.error
      return false
    }

    const nextInstances = { ...runningInstances.value }
    delete nextInstances[profileId]
    runningInstances.value = nextInstances

    return true
  }

  async function verifyProfile(profileId: string): Promise<boolean> {
    error.value = null
    const result = await window.api.launcher.verify({ profileId })

    if (!result.success) {
      error.value = result.error
      return false
    }

    return true
  }

  async function getControlTabs(profileId: string): Promise<BrowserControlTab[] | null> {
    error.value = null
    const result = await window.api.launcher.getControlTabs({ profileId })

    if (!result.success) {
      error.value = result.error
      return null
    }

    return result.data
  }

  async function executeControl(
    input: ExecuteBrowserControlInput
  ): Promise<BrowserControlExecutionResult | null> {
    error.value = null
    const result = await window.api.launcher.executeControl(input)

    if (!result.success) {
      error.value = result.error
      return null
    }

    return result.data
  }

  function applyStatusChange(payload: LauncherStatusChange): void {
    if (payload.status === 'started' && payload.data) {
      runningInstances.value = {
        ...runningInstances.value,
        [payload.profileId]: payload.data
      }
      return
    }

    const nextInstances = { ...runningInstances.value }
    delete nextInstances[payload.profileId]
    runningInstances.value = nextInstances
  }

  function setupListeners(): void {
    if (unsubscribe) {
      return
    }

    unsubscribe = window.api.onLauncherStatusChange((payload) => {
      applyStatusChange(payload)
    })
  }

  function isRunning(profileId: string): boolean {
    return Boolean(runningInstances.value[profileId])
  }

  return {
    runningInstances,
    runningCount,
    loading,
    error,
    syncRunning,
    startProfile,
    stopProfile,
    verifyProfile,
    getControlTabs,
    executeControl,
    setupListeners,
    isRunning
  }
})
