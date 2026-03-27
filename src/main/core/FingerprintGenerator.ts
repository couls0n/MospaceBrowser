import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type {
  FingerprintConfig,
  FingerprintGenerationOptions,
  HardwareProfile,
  ScreenConfig
} from '@shared/types'

/**
 * Seed-based random number generator for deterministic fingerprint generation.
 * Uses Mulberry32 algorithm for consistent results with the same seed.
 */
function createSeededRandom(seed: string): () => number {
  let state = 0
  for (let i = 0; i < seed.length; i++) {
    state = (state << 5) - state + seed.charCodeAt(i)
    state |= 0
  }

  return function (): number {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * CPU distribution entry for weight-based selection.
 */
interface CpuDistributionEntry {
  cores: number
  weight: number
}

/**
 * Memory distribution entry for weight-based selection.
 */
interface MemoryDistributionEntry {
  gb: number
  weight: number
  maxCores: number
}

/**
 * Screen configuration with weight for selection.
 */
interface ScreenConfigEntry {
  width: number
  height: number
  pixelRatio: number
}

/**
 * GPU vendor information.
 */
interface GpuVendorEntry {
  vendor: string
  renderer: string
  weight: number
}

/**
 * OS template for generating fingerprints.
 */
interface UATemplate {
  os: string
  osVersion: string
  weight: number
  userAgent: string
  secChUa: string
  platform: string
  typicalScreens: ScreenConfigEntry[]
  typicalFonts: string[]
  cpuDistribution: CpuDistributionEntry[]
  memoryDistribution: MemoryDistributionEntry[]
}

/**
 * GPU vendors by OS.
 */
interface GpuVendorsData {
  [os: string]: {
    vendors: GpuVendorEntry[]
  }
}

/**
 * Timezone mapping entry.
 */
interface TimezoneRangeEntry {
  start: string
  end: string
  timezone: string
  locale: string
}

/**
 * Timezone mapping data.
 */
interface TimezoneMappingData {
  timezoneRanges: TimezoneRangeEntry[]
  default: {
    timezone: string
    locale: string
  }
}

const DEFAULT_CHROMIUM_VERSION = '142.0.7444.175'
const DEFAULT_GREASE_BRAND_VERSION = '8'
const DEVICE_MEMORY_BUCKETS = [0.25, 0.5, 1, 2, 4, 8]
const VALID_SCREEN_RATIOS = [1.78, 1.6, 2.33, 1.33, 1.25, 1.5]

/**
 * FingerprintGenerator generates realistic browser fingerprints based on device templates.
 * Uses seeded random number generation to ensure the same profile ID always generates
 * the same fingerprint (consistency).
 */
export class FingerprintGenerator {
  private static instance: FingerprintGenerator | null = null
  private readonly templates: UATemplate[]
  private readonly gpuVendors: GpuVendorsData
  private readonly timezoneMapping: TimezoneMappingData

  /**
   * Get the singleton instance of FingerprintGenerator.
   */
  public static getInstance(): FingerprintGenerator {
    if (!FingerprintGenerator.instance) {
      FingerprintGenerator.instance = new FingerprintGenerator()
    }
    return FingerprintGenerator.instance
  }

  private constructor() {
    const runtimeAssetsRoot = app.isPackaged
      ? join(__dirname, '..')
      : join(process.cwd(), 'src', 'main')
    const templatesPath = join(runtimeAssetsRoot, 'templates', 'ua-templates.json')
    const gpuVendorsPath = join(runtimeAssetsRoot, 'templates', 'gpu-vendors.json')
    const timezoneMappingPath = join(runtimeAssetsRoot, 'templates', 'timezone-mapping.json')

    this.templates = JSON.parse(readFileSync(templatesPath, 'utf-8')) as UATemplate[]
    this.gpuVendors = JSON.parse(readFileSync(gpuVendorsPath, 'utf-8')) as GpuVendorsData
    this.timezoneMapping = JSON.parse(
      readFileSync(timezoneMappingPath, 'utf-8')
    ) as TimezoneMappingData
  }

  /**
   * Generate a fingerprint configuration based on the provided options.
   * @param options - Generation options including seed and optional IP
   * @returns FingerprintConfig object
   */
  public generate(options: FingerprintGenerationOptions): FingerprintConfig {
    const { seed, ip, os: preferredOs, locale: preferredLocale, timezone: preferredTimezone } = options
    const rng = createSeededRandom(seed)

    // 1. Select OS template based on weight or preference
    const template = preferredOs
      ? (this.templates.find((t) => t.os === preferredOs) ?? this.selectTemplateByWeight(rng()))
      : this.selectTemplateByWeight(rng())

    // 2. Build browser identity that matches the Chromium branch we target
    const browserIdentity = this.buildBrowserIdentity(template)

    // 3. Generate hardware configuration
    const hardware = this.generateHardware(template, seed)

    // 4. Determine timezone and locale from IP if provided, otherwise from template
    const derivedLocation = ip
      ? this.getTimezoneByIP(ip)
      : {
          timezone: this.getRandomTimezone(template.os, rng),
          locale: this.getRandomLocale(template.os, rng)
        }
    const timezone = preferredTimezone ?? derivedLocation.timezone
    const locale = preferredLocale ?? derivedLocation.locale

    // 5. Generate font list based on OS
    const fonts = this.generateFontList(template, seed)

    // 6. Select GPU based on OS
    const gpu = this.selectGPU(template.os, rng())

    // 7. Build fingerprint config
    const config: FingerprintConfig = {
      userAgent: browserIdentity.userAgent,
      secChUa: browserIdentity.secChUa,
      hardware: {
        cpuCores: hardware.cpuCores,
        memory: this.normalizeDeviceMemory(hardware.memory),
        screen: hardware.screen,
        gpu,
        fonts
      },
      software: {
        timezone,
        locale,
        platform: template.platform,
        doNotTrack: rng() > 0.7 // 30% chance of doNotTrack being true
      },
      advanced: {
        canvasNoise: Math.floor(rng() * 5) + 1, // 1-5 range for canvas noise
        webglNoise: rng() > 0.5,
        audioNoise: rng() > 0.5,
        clientRectsNoise: rng() > 0.35,
        speechVoicesNoise: rng() > 0.55
      }
    }

    return config
  }

  /**
   * Validate that a fingerprint configuration is consistent and realistic.
   * @param config - The fingerprint config to validate
   * @returns True if valid, false otherwise
   */
  public validateConsistency(config: FingerprintConfig): boolean {
    // Check platform consistency
    const platform = config.software.platform
    const userAgent = config.userAgent

    // Win32 platform should have Windows UA
    if (platform === 'Win32' && !userAgent.includes('Windows')) {
      return false
    }

    // MacIntel platform should have Mac UA
    if (platform === 'MacIntel' && !userAgent.includes('Macintosh')) {
      return false
    }

    // Linux platform should have Linux UA
    if (platform === 'Linux x86_64' && !userAgent.includes('Linux')) {
      return false
    }

    // Check screen resolution ratio is reasonable
    const { width, height } = config.hardware.screen
    const ratio = width / height

    const isValidRatio = VALID_SCREEN_RATIOS.some((r) => Math.abs(ratio - r) < 0.1)

    if (!isValidRatio) {
      return false
    }

    // Check that fonts match the platform
    const fonts = config.hardware.fonts
    if (platform === 'Win32') {
      // Windows should have Segoe UI
      if (!fonts.includes('Segoe UI')) {
        return false
      }
    } else if (platform === 'MacIntel') {
      // macOS should have Helvetica
      if (!fonts.includes('Helvetica')) {
        return false
      }
    }

    const { cpuCores, memory } = config.hardware

    if (!Number.isInteger(cpuCores) || cpuCores < 1 || cpuCores > 64) {
      return false
    }

    if (!DEVICE_MEMORY_BUCKETS.includes(memory)) {
      return false
    }

    return true
  }

  /**
   * Select an OS template based on weighted random selection.
   */
  private selectTemplateByWeight(randomValue: number): UATemplate {
    const totalWeight = this.templates.reduce((sum, t) => sum + t.weight, 0)
    let cumulativeWeight = 0
    const targetWeight = randomValue * totalWeight

    for (const template of this.templates) {
      cumulativeWeight += template.weight
      if (cumulativeWeight >= targetWeight) {
        return template
      }
    }

    return this.templates[this.templates.length - 1]
  }

  /**
   * Generate hardware configuration based on template and seed.
   */
  private generateHardware(template: UATemplate, seed: string): HardwareProfile {
    const rng = createSeededRandom(seed + '-hardware')

    // Select CPU cores based on distribution
    const cpuCores = this.selectCpuCores(template.cpuDistribution, rng())

    // Select memory based on distribution and CPU compatibility
    const memory = this.selectMemory(template.memoryDistribution, cpuCores, rng)

    // Select screen from typical screens
    const screen = this.selectScreen(template.typicalScreens, rng)

    return {
      cpuCores,
      memory,
      screen
    }
  }

  /**
   * Select CPU cores based on weight distribution.
   */
  private selectCpuCores(distribution: CpuDistributionEntry[], randomValue: number): number {
    const totalWeight = distribution.reduce((sum, d) => sum + d.weight, 0)
    let cumulativeWeight = 0
    const targetWeight = randomValue * totalWeight

    for (const entry of distribution) {
      cumulativeWeight += entry.weight
      if (cumulativeWeight >= targetWeight) {
        return entry.cores
      }
    }

    return distribution[distribution.length - 1].cores
  }

  /**
   * Select memory size based on distribution and CPU compatibility.
   */
  private selectMemory(
    distribution: MemoryDistributionEntry[],
    cpuCores: number,
    rng: () => number
  ): number {
    // Filter entries that are compatible with the CPU core count
    const compatibleEntries = distribution.filter((entry) => entry.maxCores >= cpuCores)

    if (compatibleEntries.length === 0) {
      return distribution[distribution.length - 1].gb
    }

    const totalWeight = compatibleEntries.reduce((sum, d) => sum + d.weight, 0)
    let cumulativeWeight = 0
    const targetWeight = rng() * totalWeight

    for (const entry of compatibleEntries) {
      cumulativeWeight += entry.weight
      if (cumulativeWeight >= targetWeight) {
        return entry.gb
      }
    }

    return compatibleEntries[compatibleEntries.length - 1].gb
  }

  /**
   * Select screen configuration from available options.
   */
  private selectScreen(screens: ScreenConfigEntry[], rng: () => number): ScreenConfig {
    const index = Math.floor(rng() * screens.length)
    const selected = screens[index]

    return {
      width: selected.width,
      height: selected.height,
      colorDepth: 24,
      pixelRatio: selected.pixelRatio
    }
  }

  /**
   * Select GPU vendor/renderer based on OS.
   */
  private selectGPU(os: string, randomValue: number): { vendor: string; renderer: string } {
    const osVendors = this.gpuVendors[os]

    if (!osVendors || osVendors.vendors.length === 0) {
      return {
        vendor: 'Google Inc.',
        renderer: 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'
      }
    }

    const totalWeight = osVendors.vendors.reduce((sum, v) => sum + v.weight, 0)
    let cumulativeWeight = 0
    const targetWeight = randomValue * totalWeight

    for (const vendor of osVendors.vendors) {
      cumulativeWeight += vendor.weight
      if (cumulativeWeight >= targetWeight) {
        return { vendor: vendor.vendor, renderer: vendor.renderer }
      }
    }

    const lastVendor = osVendors.vendors[osVendors.vendors.length - 1]
    return { vendor: lastVendor.vendor, renderer: lastVendor.renderer }
  }

  /**
   * Generate a list of fonts based on the OS template.
   * Includes all required fonts plus random additional ones.
   */
  private generateFontList(template: UATemplate, seed: string): string[] {
    const rng = createSeededRandom(seed + '-fonts')
    const requiredFonts = this.getRequiredFonts(template.os)
    const additionalCount = Math.floor(rng() * 50) + 50 // 50-100 additional fonts

    // Shuffle typical fonts and take additionalCount
    const shuffled = [...template.typicalFonts].sort(() => rng() - 0.5)
    const additionalFonts = shuffled.slice(0, additionalCount)

    // Combine required and additional, remove duplicates
    const allFonts = new Set([...requiredFonts, ...additionalFonts])

    return Array.from(allFonts)
  }

  /**
   * Get required fonts that must be present for a given OS.
   */
  private getRequiredFonts(os: string): string[] {
    switch (os) {
      case 'win10':
      case 'win11':
        return ['Arial', 'Times New Roman', 'Segoe UI']
      case 'macos':
        return ['Helvetica', 'Arial', 'Times', 'Lucida Grande']
      case 'linux':
        return ['DejaVu Sans', 'Liberation Sans', 'Noto Sans']
      default:
        return ['Arial', 'Times New Roman']
    }
  }

  /**
   * Get timezone and locale based on IP address.
   * Uses a simple IP range mapping.
   */
  private getTimezoneByIP(ip: string): { timezone: string; locale: string } {
    const ipNumber = this.ipToNumber(ip)

    for (const range of this.timezoneMapping.timezoneRanges) {
      const startNumber = this.ipToNumber(range.start)
      const endNumber = this.ipToNumber(range.end)

      if (ipNumber >= startNumber && ipNumber <= endNumber) {
        return { timezone: range.timezone, locale: range.locale }
      }
    }

    return {
      timezone: this.timezoneMapping.default.timezone,
      locale: this.timezoneMapping.default.locale
    }
  }

  /**
   * Convert IP address to numeric representation.
   */
  private ipToNumber(ip: string): number {
    const parts = ip.split('.').map(Number)
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return 0
    }
    return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
  }

  /**
   * Get a random timezone appropriate for the OS.
   */
  private getRandomTimezone(os: string, rng: () => number): string {
    const timezones: Record<string, string[]> = {
      win10: [
        'America/New_York',
        'America/Chicago',
        'America/Los_Angeles',
        'Europe/London',
        'Europe/Paris'
      ],
      win11: [
        'America/New_York',
        'America/Los_Angeles',
        'Europe/London',
        'Asia/Tokyo',
        'Australia/Sydney'
      ],
      macos: [
        'America/Los_Angeles',
        'America/New_York',
        'Europe/London',
        'Asia/Tokyo',
        'Pacific/Auckland'
      ],
      linux: ['UTC', 'America/New_York', 'Europe/London', 'Asia/Shanghai', 'Australia/Sydney']
    }

    const osTimezones = timezones[os] ?? timezones.win10
    const index = Math.floor(rng() * osTimezones.length)
    return osTimezones[index]
  }

  /**
   * Get a random locale appropriate for the OS.
   */
  private getRandomLocale(os: string, rng: () => number): string {
    const locales: Record<string, string[]> = {
      win10: ['en-US', 'en-GB', 'fr-FR', 'de-DE', 'es-ES'],
      win11: ['en-US', 'en-GB', 'ja-JP', 'zh-CN', 'de-DE'],
      macos: ['en-US', 'en-GB', 'ja-JP', 'fr-FR', 'de-DE'],
      linux: ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES']
    }

    const osLocales = locales[os] ?? locales.win10
    const index = Math.floor(rng() * osLocales.length)
    return osLocales[index]
  }

  private buildBrowserIdentity(template: UATemplate): { userAgent: string; secChUa: string } {
    const version = this.extractBrowserVersion(template.userAgent) ?? DEFAULT_CHROMIUM_VERSION
    const normalizedVersion = version === '120.0.0.0' ? DEFAULT_CHROMIUM_VERSION : version
    const normalizedUserAgent = template.userAgent.replace(
      /Chrome\/[\d.]+/,
      `Chrome/${normalizedVersion}`
    )

    return {
      userAgent: normalizedUserAgent,
      secChUa: this.buildSecChUa(template.secChUa, normalizedVersion)
    }
  }

  private extractBrowserVersion(userAgent: string): string | null {
    const match = userAgent.match(/Chrome\/([\d.]+)/)
    return match?.[1] ?? null
  }

  private buildSecChUa(secChUa: string, version: string): string {
    const majorVersion = version.split('.')[0] || '120'
    const brands: string[] = []
    const matcher = /"([^"]+)"\s*;\s*v="([^"]+)"/g
    let match: RegExpExecArray | null = matcher.exec(secChUa)

    while (match) {
      const brand = match[1]
      const nextVersion =
        brand.toLowerCase().includes('not') || brand.toLowerCase().includes('brand')
          ? DEFAULT_GREASE_BRAND_VERSION
          : majorVersion
      brands.push(`"${brand}";v="${nextVersion}"`)
      match = matcher.exec(secChUa)
    }

    if (!brands.length) {
      return `"Not_A Brand";v="${DEFAULT_GREASE_BRAND_VERSION}", "Chromium";v="${majorVersion}", "Google Chrome";v="${majorVersion}"`
    }

    return brands.join(', ')
  }

  private normalizeDeviceMemory(memoryGb: number): number {
    for (const bucket of DEVICE_MEMORY_BUCKETS) {
      if (memoryGb <= bucket) {
        return bucket
      }
    }

    return DEVICE_MEMORY_BUCKETS[DEVICE_MEMORY_BUCKETS.length - 1]
  }
}
