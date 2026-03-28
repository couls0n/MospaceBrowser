import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { toPlainData } from '@renderer/utils/serialization'
import type { FingerprintConfig, FingerprintGenerationOptions, OSType } from '@shared/types'

export const useFingerprintStore = defineStore('fingerprint', () => {
  const currentFingerprint = ref<FingerprintConfig | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const hasFingerprint = computed(() => currentFingerprint.value !== null)

  async function generateFingerprint(
    seed: string,
    options: { ip?: string; os?: OSType; locale?: string; timezone?: string; apply?: boolean } = {}
  ): Promise<FingerprintConfig | null> {
    loading.value = true
    error.value = null

    try {
      const payload: FingerprintGenerationOptions = {
        seed,
        ip: options.ip,
        os: options.os,
        locale: options.locale,
        timezone: options.timezone
      }

      const result = await window.api.fingerprint.generate(payload)

      if (!result.success) {
        error.value = result.error
        return null
      }

      if (options.apply !== false) {
        currentFingerprint.value = result.data
      }

      return result.data
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Unknown error generating fingerprint'
      return null
    } finally {
      loading.value = false
    }
  }

  async function validateFingerprint(config: FingerprintConfig): Promise<boolean> {
    try {
      const payload = toPlainData(config)
      const result = await window.api.fingerprint.validate(payload)

      if (!result.success) {
        error.value = result.error
        return false
      }

      return result.success && result.data
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Unknown error validating fingerprint'
      return false
    }
  }

  function getOSLabel(userAgent: string): string {
    if (userAgent.includes('Windows NT 10.0')) {
      return userAgent.includes('Win64') ? 'Windows 10/11 (64-bit)' : 'Windows 10/11'
    }

    if (userAgent.includes('Macintosh')) {
      return 'macOS'
    }

    if (userAgent.includes('Linux')) {
      return 'Linux'
    }

    return 'Unknown OS'
  }

  function getBrowserLabel(userAgent: string): string {
    const versionMatch = userAgent.match(/Chrome\/([\d.]+)/)
    return versionMatch ? `Chrome ${versionMatch[1]}` : 'Chrome'
  }

  const fingerprintSummary = computed(() => {
    if (!currentFingerprint.value) {
      return null
    }

    const fingerprint = currentFingerprint.value

    return {
      os: getOSLabel(fingerprint.userAgent),
      browser: getBrowserLabel(fingerprint.userAgent),
      resolution: `${fingerprint.hardware.screen.width} x ${fingerprint.hardware.screen.height}`,
      cpuCores: fingerprint.hardware.cpuCores,
      memory: `${fingerprint.hardware.memory} GB`,
      timezone: fingerprint.software.timezone,
      locale: fingerprint.software.locale,
      gpuVendor: fingerprint.hardware.gpu.vendor,
      fontCount: fingerprint.hardware.fonts.length
    }
  })

  function clearFingerprint(): void {
    currentFingerprint.value = null
    error.value = null
  }

  function setFingerprint(config: FingerprintConfig | null): void {
    currentFingerprint.value = config
    error.value = null
  }

  return {
    currentFingerprint,
    loading,
    error,
    hasFingerprint,
    fingerprintSummary,
    generateFingerprint,
    validateFingerprint,
    clearFingerprint,
    setFingerprint
  }
})
