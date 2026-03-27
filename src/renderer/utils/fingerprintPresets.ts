import gpuVendorsData from '@main/templates/gpu-vendors.json'
import uaTemplatesData from '@main/templates/ua-templates.json'
import type { OSType } from '@shared/types'

interface GpuVendorEntry {
  vendor: string
  renderer: string
  weight: number
}

interface GpuVendorData {
  [key: string]: {
    vendors: GpuVendorEntry[]
  }
}

interface UaTemplateEntry {
  os: OSType
  typicalScreens: Array<{
    width: number
    height: number
    pixelRatio: number
  }>
  typicalFonts: string[]
}

const gpuPresets = gpuVendorsData as GpuVendorData
const uaTemplates = uaTemplatesData as UaTemplateEntry[]

export const COMMON_LOCALE_OPTIONS = [
  'en-US',
  'en-GB',
  'zh-CN',
  'zh-TW',
  'ja-JP',
  'ko-KR',
  'fr-FR',
  'de-DE',
  'es-ES',
  'it-IT',
  'pt-BR',
  'ru-RU',
  'tr-TR',
  'vi-VN',
  'id-ID',
  'th-TH'
]

export const FALLBACK_TIMEZONE_OPTIONS = [
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Australia/Sydney',
  'UTC'
]

export const CPU_CORE_OPTIONS = [2, 4, 6, 8, 12, 16, 24, 32]
export const MEMORY_OPTIONS = [0.25, 0.5, 1, 2, 4, 8]
export const PIXEL_RATIO_OPTIONS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3]
export const COLOR_DEPTH_OPTIONS = [24, 30, 32]

export function getTimezoneOptions(): string[] {
  const supportedValuesOf = Intl.supportedValuesOf as ((key: 'timeZone') => string[]) | undefined

  if (typeof supportedValuesOf === 'function') {
    return Array.from(new Set([...FALLBACK_TIMEZONE_OPTIONS, ...supportedValuesOf('timeZone')]))
  }

  return FALLBACK_TIMEZONE_OPTIONS
}

export function getFontOptions(os: OSType): string[] {
  const fonts = uaTemplates
    .filter((template) => template.os === os)
    .flatMap((template) => template.typicalFonts)

  return Array.from(new Set(fonts)).sort((left, right) => left.localeCompare(right))
}

export function getScreenPresets(os: OSType): Array<{
  label: string
  width: number
  height: number
  pixelRatio: number
}> {
  const screens = uaTemplates
    .filter((template) => template.os === os)
    .flatMap((template) => template.typicalScreens)

  return Array.from(
    new Map(
      screens.map((screen) => [
        `${screen.width}x${screen.height}@${screen.pixelRatio}`,
        {
          label: `${screen.width} x ${screen.height} (${screen.pixelRatio}x)`,
          width: screen.width,
          height: screen.height,
          pixelRatio: screen.pixelRatio
        }
      ])
    ).values()
  )
}

export function getGpuVendorOptions(os: OSType): string[] {
  const vendors = gpuPresets[os]?.vendors ?? []
  return Array.from(new Set(vendors.map((entry) => entry.vendor))).sort((left, right) =>
    left.localeCompare(right)
  )
}

export function getGpuRendererOptions(os: OSType, vendor?: string): string[] {
  const vendors = gpuPresets[os]?.vendors ?? []
  const entries = vendor ? vendors.filter((entry) => entry.vendor === vendor) : vendors
  return Array.from(new Set(entries.map((entry) => entry.renderer)))
}

