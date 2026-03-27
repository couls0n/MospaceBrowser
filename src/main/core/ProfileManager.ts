import type { Profile as PrismaProfile, Proxy as PrismaProxy } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseManager } from '@main/core/DatabaseManager'
import { FingerprintGenerator } from '@main/core/FingerprintGenerator'
import { decryptString, encryptString } from '@main/utils/encryption'
import { getAppPaths } from '@main/utils/paths'
import type {
  CloneProfileInput,
  CreateProfileInput,
  CreateProxyInput,
  DeleteProfileInput,
  FingerprintConfig,
  FingerprintGenerationOptions,
  OSType,
  Profile,
  ProfileFilter,
  ProfileProxyConfig,
  ProxyRecord,
  UpdateProfileInput
} from '@shared/types'

function toOptionalProxyConfig(
  profile: PrismaProfile,
  password?: string
): ProfileProxyConfig | undefined {
  if (
    !profile.proxyType ||
    !profile.proxyHost ||
    !profile.proxyPort ||
    profile.proxyType === 'none'
  ) {
    return undefined
  }

  return {
    type: profile.proxyType as ProfileProxyConfig['type'],
    host: profile.proxyHost,
    port: profile.proxyPort,
    username: profile.proxyUsername ?? undefined,
    password
  }
}

function parseFingerprintConfig(config?: string | null): FingerprintConfig | undefined {
  if (!config) {
    return undefined
  }

  return JSON.parse(config) as FingerprintConfig
}

export class ProfileManager {
  private static instance: ProfileManager | null = null
  private readonly databaseManager = DatabaseManager.getInstance()
  private readonly fingerprintGenerator = FingerprintGenerator.getInstance()

  public static getInstance(): ProfileManager {
    if (!ProfileManager.instance) {
      ProfileManager.instance = new ProfileManager()
    }

    return ProfileManager.instance
  }

  /**
   * Generate a fingerprint configuration for a profile.
   * @param options - Generation options including seed (profileId) and optional IP
   * @returns FingerprintConfig object
   */
  public generateFingerprint(options: FingerprintGenerationOptions): FingerprintConfig {
    return this.fingerprintGenerator.generate(options)
  }

  /**
   * Validate a fingerprint configuration for consistency.
   * @param config - The fingerprint config to validate
   * @returns True if valid
   */
  public validateFingerprint(config: FingerprintConfig): boolean {
    return this.fingerprintGenerator.validateConsistency(config)
  }

  public async createProfile(input: CreateProfileInput): Promise<Profile> {
    const prisma = await this.databaseManager.getClient()
    const id = randomUUID()
    const storagePath = join(getAppPaths().profiles, id)
    const fingerprintState = this.resolveFingerprintState({
      profileId: id,
      fingerprintEnabled: input.fingerprintEnabled,
      fingerprintOs: input.fingerprintOs,
      fingerprintConfig: input.fingerprintConfig
    })

    await mkdir(storagePath, { recursive: true })

    const profile = await prisma.profile.create({
      data: {
        id,
        name: input.name,
        notes: input.notes,
        browserConfig: JSON.stringify(input.browserConfig),
        fingerprintEnabled: fingerprintState.enabled,
        fingerprintOs: fingerprintState.os,
        fingerprintConfig: fingerprintState.config ? JSON.stringify(fingerprintState.config) : null,
        proxyType: input.proxyConfig?.type,
        proxyHost: input.proxyConfig?.host,
        proxyPort: input.proxyConfig?.port,
        proxyUsername: input.proxyConfig?.username,
        proxyPassword: await encryptString(input.proxyConfig?.password),
        storagePath,
        groupId: input.groupId
      }
    })

    await this.syncFingerprintFile(storagePath, fingerprintState.config)

    return this.toProfile(profile)
  }

  public async getProfiles(filter?: ProfileFilter): Promise<Profile[]> {
    const prisma = await this.databaseManager.getClient()
    const profiles = await prisma.profile.findMany({
      where: filter?.groupId ? { groupId: filter.groupId } : undefined,
      orderBy: { createdAt: 'desc' }
    })

    return Promise.all(profiles.map((profile) => this.toProfile(profile)))
  }

  public async getProfileById(id: string): Promise<Profile> {
    const prisma = await this.databaseManager.getClient()
    const profile = await prisma.profile.findUnique({
      where: { id }
    })

    if (!profile) {
      throw new Error(`Profile ${id} not found.`)
    }

    return this.toProfile(profile)
  }

  public async updateProfile(input: UpdateProfileInput): Promise<Profile> {
    const prisma = await this.databaseManager.getClient()
    const current = await prisma.profile.findUnique({
      where: { id: input.id }
    })

    if (!current) {
      throw new Error(`Profile ${input.id} not found.`)
    }

    const proxyConfig = input.proxyConfig
    const shouldClearProxy = proxyConfig?.type === 'none'
    const fingerprintState = this.resolveFingerprintState({
      profileId: current.id,
      fingerprintEnabled: input.fingerprintEnabled ?? current.fingerprintEnabled,
      fingerprintOs: input.fingerprintOs ?? (current.fingerprintOs as OSType | null),
      fingerprintConfig:
        input.fingerprintConfig ?? parseFingerprintConfig(current.fingerprintConfig)
    })
    const profile = await prisma.profile.update({
      where: { id: input.id },
      data: {
        name: input.name ?? current.name,
        notes: input.notes ?? current.notes,
        browserConfig: input.browserConfig
          ? JSON.stringify(input.browserConfig)
          : current.browserConfig,
        fingerprintEnabled: fingerprintState.enabled,
        fingerprintOs: fingerprintState.os,
        fingerprintConfig: fingerprintState.config ? JSON.stringify(fingerprintState.config) : null,
        proxyType: shouldClearProxy ? null : (proxyConfig?.type ?? current.proxyType),
        proxyHost: shouldClearProxy ? null : (proxyConfig?.host ?? current.proxyHost),
        proxyPort: shouldClearProxy ? null : (proxyConfig?.port ?? current.proxyPort),
        proxyUsername: shouldClearProxy ? null : (proxyConfig?.username ?? current.proxyUsername),
        proxyPassword: shouldClearProxy
          ? null
          : ((await encryptString(proxyConfig?.password)) ?? current.proxyPassword),
        groupId: input.groupId ?? current.groupId
      }
    })

    await this.syncFingerprintFile(profile.storagePath, fingerprintState.config)

    return this.toProfile(profile)
  }

  public async deleteProfile(input: DeleteProfileInput): Promise<void> {
    const prisma = await this.databaseManager.getClient()
    const profile = await prisma.profile.findUnique({
      where: { id: input.id }
    })

    if (!profile) {
      throw new Error(`Profile ${input.id} not found.`)
    }

    await prisma.profile.delete({
      where: { id: input.id }
    })

    if (input.removeData) {
      await rm(profile.storagePath, { recursive: true, force: true })
    }
  }

  public async cloneProfile(input: CloneProfileInput): Promise<Profile> {
    const prisma = await this.databaseManager.getClient()
    const source = await prisma.profile.findUnique({
      where: { id: input.id }
    })

    if (!source) {
      throw new Error(`Profile ${input.id} not found.`)
    }

    const id = randomUUID()
    const storagePath = join(getAppPaths().profiles, id)
    const fingerprintState = this.resolveFingerprintState({
      profileId: id,
      fingerprintEnabled: source.fingerprintEnabled,
      fingerprintOs: (source.fingerprintOs as OSType | null) ?? undefined
    })

    await mkdir(storagePath, { recursive: true })

    const cloned = await prisma.profile.create({
      data: {
        id,
        name: input.name ?? `${source.name} Copy`,
        notes: source.notes,
        browserConfig: source.browserConfig,
        fingerprintEnabled: fingerprintState.enabled,
        fingerprintOs: fingerprintState.os,
        fingerprintConfig: fingerprintState.config ? JSON.stringify(fingerprintState.config) : null,
        proxyType: source.proxyType,
        proxyHost: source.proxyHost,
        proxyPort: source.proxyPort,
        proxyUsername: source.proxyUsername,
        proxyPassword: source.proxyPassword,
        storagePath,
        groupId: source.groupId
      }
    })

    try {
      await cp(source.storagePath, storagePath, { recursive: true, force: true })
    } catch {
      // A fresh profile directory is acceptable when there is no state to copy.
    }

    await this.syncFingerprintFile(storagePath, fingerprintState.config)

    return this.toProfile(cloned)
  }

  public async createProxy(input: CreateProxyInput): Promise<ProxyRecord> {
    const prisma = await this.databaseManager.getClient()
    const proxy = await prisma.proxy.create({
      data: {
        name: input.name,
        type: input.type,
        host: input.host,
        port: input.port,
        username: input.username,
        password: await encryptString(input.password)
      }
    })

    return this.toProxy(proxy)
  }

  public async getProxies(): Promise<ProxyRecord[]> {
    const prisma = await this.databaseManager.getClient()
    const proxies = await prisma.proxy.findMany({
      orderBy: { createdAt: 'desc' }
    })

    return Promise.all(proxies.map((proxy) => this.toProxy(proxy)))
  }

  public async deleteProxy(id: string): Promise<void> {
    const prisma = await this.databaseManager.getClient()
    await prisma.proxy.delete({
      where: { id }
    })
  }

  private async toProfile(profile: PrismaProfile): Promise<Profile> {
    const browserConfig = JSON.parse(profile.browserConfig) as Profile['browserConfig']
    const proxyPassword = await decryptString(profile.proxyPassword ?? undefined)
    const fingerprintConfig = parseFingerprintConfig(profile.fingerprintConfig)

    return {
      id: profile.id,
      name: profile.name,
      notes: profile.notes ?? undefined,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
      browserConfig,
      fingerprintEnabled: profile.fingerprintEnabled,
      fingerprintOs: (profile.fingerprintOs as OSType | null) ?? undefined,
      fingerprintConfig,
      proxyConfig: toOptionalProxyConfig(profile, proxyPassword),
      storagePath: profile.storagePath,
      groupId: profile.groupId ?? undefined
    }
  }

  private async toProxy(proxy: PrismaProxy): Promise<ProxyRecord> {
    return {
      id: proxy.id,
      name: proxy.name ?? undefined,
      type: proxy.type as ProxyRecord['type'],
      host: proxy.host,
      port: proxy.port,
      username: proxy.username ?? undefined,
      password: await decryptString(proxy.password ?? undefined),
      countryCode: proxy.countryCode ?? undefined,
      latency: proxy.latency ?? undefined,
      lastChecked: proxy.lastChecked?.toISOString(),
      isActive: proxy.isActive,
      createdAt: proxy.createdAt.toISOString(),
      updatedAt: proxy.updatedAt.toISOString()
    }
  }

  private resolveFingerprintState(options: {
    profileId: string
    fingerprintEnabled?: boolean
    fingerprintOs?: OSType | null
    fingerprintConfig?: FingerprintConfig
  }): {
    enabled: boolean
    os?: OSType
    config?: FingerprintConfig
  } {
    const enabled = options.fingerprintEnabled ?? true
    const os = options.fingerprintOs ?? undefined

    if (!enabled) {
      return {
        enabled: false,
        os,
        config: undefined
      }
    }

    return {
      enabled: true,
      os,
      config:
        options.fingerprintConfig ??
        this.generateFingerprint({
          seed: options.profileId,
          os
        })
    }
  }

  private async syncFingerprintFile(
    storagePath: string,
    fingerprintConfig?: FingerprintConfig
  ): Promise<void> {
    const fingerprintPath = join(storagePath, 'fingerprint.json')

    if (!fingerprintConfig) {
      await rm(fingerprintPath, { force: true })
      return
    }

    await writeFile(fingerprintPath, JSON.stringify(fingerprintConfig, null, 2), 'utf-8')
  }
}
