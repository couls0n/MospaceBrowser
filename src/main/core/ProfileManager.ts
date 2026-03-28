import type { Group as PrismaGroup, Profile as PrismaProfile, Proxy as PrismaProxy } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseManager } from '@main/core/DatabaseManager'
import { FingerprintGenerator } from '@main/core/FingerprintGenerator'
import { decryptString, encryptString } from '@main/utils/encryption'
import {
  parsePersistedData,
  readPersistedJsonFile,
  serializePersistedData,
  writeJsonFileAtomic
} from '@main/utils/persistence'
import { getAppPaths } from '@main/utils/paths'
import { logger } from '@main/utils/logger'
import type {
  BrowserProfileConfig,
  CloneProfileInput,
  CreateProfileInput,
  CreateGroupInput,
  CreateProxyInput,
  DeleteGroupInput,
  DeleteProfileInput,
  FingerprintConfig,
  FingerprintGenerationOptions,
  GroupRecord,
  OSType,
  Profile,
  ProfileFilter,
  ProfileProxyConfig,
  ProxyRecord,
  UpdateGroupInput,
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

interface PersistedProfileSnapshot {
  id: string
  name: string
  notes?: string
  groupId?: string
  storagePath: string
  browserConfig: BrowserProfileConfig
  fingerprintEnabled: boolean
  fingerprintOs?: OSType
  fingerprintConfig?: FingerprintConfig
  proxyConfig?: Omit<ProfileProxyConfig, 'password'>
}

interface ProfilePersistenceState {
  browserConfig: BrowserProfileConfig
  fingerprintConfig?: FingerprintConfig
}

function parseBrowserConfig(config?: string | null): BrowserProfileConfig {
  const parsed = parsePersistedData<BrowserProfileConfig>(config, 'browser config')

  if (!parsed) {
    throw new Error('Persisted browser config is missing.')
  }

  return parsed
}

function parseFingerprintConfig(config?: string | null): FingerprintConfig | undefined {
  return parsePersistedData<FingerprintConfig>(config, 'fingerprint config')
}

function sanitizeProxyConfig(
  proxyConfig?: ProfileProxyConfig
): Omit<ProfileProxyConfig, 'password'> | undefined {
  if (!proxyConfig || proxyConfig.type === 'none') {
    return undefined
  }

  return {
    type: proxyConfig.type,
    host: proxyConfig.host,
    port: proxyConfig.port,
    username: proxyConfig.username
  }
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
      fingerprintConfig: input.fingerprintConfig,
      browserConfig: input.browserConfig
    })

    await mkdir(storagePath, { recursive: true })

    const snapshot = this.buildProfileSnapshot({
      id,
      name: input.name,
      notes: input.notes,
      groupId: input.groupId,
      storagePath,
      browserConfig: input.browserConfig,
      fingerprintEnabled: fingerprintState.enabled,
      fingerprintOs: fingerprintState.os,
      fingerprintConfig: fingerprintState.config,
      proxyConfig: input.proxyConfig
    })

    let createdProfile: PrismaProfile | null = null

    try {
      createdProfile = await prisma.profile.create({
        data: {
          id,
          name: input.name,
          notes: input.notes,
          browserConfig: serializePersistedData(input.browserConfig),
          fingerprintEnabled: fingerprintState.enabled,
          fingerprintOs: fingerprintState.os,
          fingerprintConfig: fingerprintState.config
            ? serializePersistedData(fingerprintState.config)
            : null,
          proxyType: input.proxyConfig?.type,
          proxyHost: input.proxyConfig?.host,
          proxyPort: input.proxyConfig?.port,
          proxyUsername: input.proxyConfig?.username,
          proxyPassword: await encryptString(input.proxyConfig?.password),
          storagePath,
          groupId: input.groupId
        }
      })

      await this.syncProfileArtifacts(snapshot)

      return this.toProfile(createdProfile)
    } catch (error) {
      if (createdProfile) {
        await prisma.profile
          .delete({
            where: { id: createdProfile.id }
          })
          .catch((rollbackError) => {
            logger.error('Failed to roll back profile record after create failure.', {
              profileId: createdProfile?.id,
              error: rollbackError
            })
          })
      }

      await rm(storagePath, { recursive: true, force: true }).catch((cleanupError) => {
        logger.error('Failed to clean up profile storage after create failure.', {
          storagePath,
          error: cleanupError
        })
      })

      throw error
    }
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
    const persistedState = await this.loadPersistedProfileState(current)
    const browserConfig = input.browserConfig ?? persistedState.browserConfig
    const fingerprintState = this.resolveFingerprintState({
      profileId: current.id,
      fingerprintEnabled: input.fingerprintEnabled ?? current.fingerprintEnabled,
      fingerprintOs: input.fingerprintOs ?? (current.fingerprintOs as OSType | null),
      fingerprintConfig: input.fingerprintConfig ?? persistedState.fingerprintConfig,
      browserConfig
    })
    const nextProxyConfig = shouldClearProxy
      ? undefined
      : (proxyConfig ?? toOptionalProxyConfig(current))
    const previousSnapshot = this.buildProfileSnapshot({
      id: current.id,
      name: current.name,
      notes: current.notes,
      groupId: current.groupId,
      storagePath: current.storagePath,
      browserConfig: persistedState.browserConfig,
      fingerprintEnabled: current.fingerprintEnabled,
      fingerprintOs: (current.fingerprintOs as OSType | null) ?? undefined,
      fingerprintConfig: persistedState.fingerprintConfig,
      proxyConfig: toOptionalProxyConfig(current)
    })
    const nextSnapshot = this.buildProfileSnapshot({
      id: current.id,
      name: input.name ?? current.name,
      notes: input.notes ?? current.notes,
      groupId: input.groupId ?? current.groupId,
      storagePath: current.storagePath,
      browserConfig,
      fingerprintEnabled: fingerprintState.enabled,
      fingerprintOs: fingerprintState.os,
      fingerprintConfig: fingerprintState.config,
      proxyConfig: nextProxyConfig
    })

    let updatedProfile: PrismaProfile | null = null

    try {
      updatedProfile = await prisma.profile.update({
        where: { id: input.id },
        data: {
          name: input.name ?? current.name,
          notes: input.notes ?? current.notes,
          browserConfig: serializePersistedData(browserConfig),
          fingerprintEnabled: fingerprintState.enabled,
          fingerprintOs: fingerprintState.os,
          fingerprintConfig: fingerprintState.config
            ? serializePersistedData(fingerprintState.config)
            : null,
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

      await this.syncProfileArtifacts(nextSnapshot)

      return this.toProfile(updatedProfile)
    } catch (error) {
      if (updatedProfile) {
        await prisma.profile
          .update({
            where: { id: current.id },
            data: {
              name: current.name,
              notes: current.notes,
              browserConfig: current.browserConfig,
              fingerprintEnabled: current.fingerprintEnabled,
              fingerprintOs: current.fingerprintOs,
              fingerprintConfig: current.fingerprintConfig,
              proxyType: current.proxyType,
              proxyHost: current.proxyHost,
              proxyPort: current.proxyPort,
              proxyUsername: current.proxyUsername,
              proxyPassword: current.proxyPassword,
              groupId: current.groupId
            }
          })
          .catch((rollbackError) => {
            logger.error('Failed to roll back profile record after update failure.', {
              profileId: current.id,
              error: rollbackError
            })
          })

        await this.syncProfileArtifacts(previousSnapshot).catch((rollbackError) => {
          logger.error('Failed to restore profile artifacts after update failure.', {
            profileId: current.id,
            storagePath: current.storagePath,
            error: rollbackError
          })
        })
      }

      throw error
    }
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
    const persistedState = await this.loadPersistedProfileState(source)
    const browserConfig = persistedState.browserConfig
    const fingerprintState = this.resolveFingerprintState({
      profileId: id,
      fingerprintEnabled: source.fingerprintEnabled,
      fingerprintOs: (source.fingerprintOs as OSType | null) ?? undefined,
      fingerprintConfig: persistedState.fingerprintConfig,
      browserConfig
    })
    const snapshot = this.buildProfileSnapshot({
      id,
      name: input.name ?? `${source.name} Copy`,
      notes: source.notes,
      groupId: source.groupId,
      storagePath,
      browserConfig,
      fingerprintEnabled: fingerprintState.enabled,
      fingerprintOs: fingerprintState.os,
      fingerprintConfig: fingerprintState.config,
      proxyConfig: toOptionalProxyConfig(source)
    })

    await mkdir(storagePath, { recursive: true })

    let clonedProfile: PrismaProfile | null = null

    try {
      clonedProfile = await prisma.profile.create({
        data: {
          id,
          name: input.name ?? `${source.name} Copy`,
          notes: source.notes,
          browserConfig: serializePersistedData(browserConfig),
          fingerprintEnabled: fingerprintState.enabled,
          fingerprintOs: fingerprintState.os,
          fingerprintConfig: fingerprintState.config
            ? serializePersistedData(fingerprintState.config)
            : null,
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
      } catch (copyError) {
        logger.warn('Failed to clone profile storage; continuing with a fresh profile directory.', {
          sourceProfileId: source.id,
          sourceStoragePath: source.storagePath,
          targetStoragePath: storagePath,
          error: copyError
        })
      }

      await this.syncProfileArtifacts(snapshot)

      return this.toProfile(clonedProfile)
    } catch (error) {
      if (clonedProfile) {
        await prisma.profile
          .delete({
            where: { id: clonedProfile.id }
          })
          .catch((rollbackError) => {
            logger.error('Failed to roll back cloned profile record after failure.', {
              profileId: clonedProfile?.id,
              error: rollbackError
            })
          })
      }

      await rm(storagePath, { recursive: true, force: true }).catch((cleanupError) => {
        logger.error('Failed to clean up cloned profile storage after failure.', {
          storagePath,
          error: cleanupError
        })
      })

      throw error
    }
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

  public async createGroup(input: CreateGroupInput): Promise<GroupRecord> {
    const prisma = await this.databaseManager.getClient()
    const name = input.name.trim()

    if (!name) {
      throw new Error('Group name is required.')
    }

    const existing = await prisma.group.findFirst({
      where: {
        name
      }
    })

    if (existing) {
      throw new Error(`Group "${name}" already exists.`)
    }

    const sortOrder =
      input.sortOrder ??
      ((await prisma.group.aggregate({
        _max: {
          sortOrder: true
        }
      }))._max.sortOrder ?? -1) + 1

    const group = await prisma.group.create({
      data: {
        id: randomUUID(),
        name,
        color: input.color ?? '#2563eb',
        sortOrder
      }
    })

    return this.toGroup(group)
  }

  public async getGroups(): Promise<GroupRecord[]> {
    const prisma = await this.databaseManager.getClient()
    const groups = await prisma.group.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
    })

    return groups.map((group) => this.toGroup(group))
  }

  public async updateGroup(input: UpdateGroupInput): Promise<GroupRecord> {
    const prisma = await this.databaseManager.getClient()
    const current = await prisma.group.findUnique({
      where: { id: input.id }
    })

    if (!current) {
      throw new Error(`Group ${input.id} not found.`)
    }

    const nextName = input.name?.trim() || current.name

    const duplicate = await prisma.group.findFirst({
      where: {
        id: {
          not: input.id
        },
        name: nextName
      }
    })

    if (duplicate) {
      throw new Error(`Group "${nextName}" already exists.`)
    }

    const group = await prisma.group.update({
      where: { id: input.id },
      data: {
        name: nextName,
        color: input.color ?? current.color,
        sortOrder: input.sortOrder ?? current.sortOrder
      }
    })

    return this.toGroup(group)
  }

  public async deleteGroup(input: DeleteGroupInput): Promise<void> {
    const prisma = await this.databaseManager.getClient()
    const group = await prisma.group.findUnique({
      where: { id: input.id }
    })

    if (!group) {
      throw new Error(`Group ${input.id} not found.`)
    }

    await prisma.$transaction([
      prisma.profile.updateMany({
        where: {
          groupId: input.id
        },
        data: {
          groupId: null
        }
      }),
      prisma.group.delete({
        where: { id: input.id }
      })
    ])
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
    const persistedState = await this.loadPersistedProfileState(profile)
    const proxyPassword = await decryptString(profile.proxyPassword ?? undefined)

    return {
      id: profile.id,
      name: profile.name,
      notes: profile.notes ?? undefined,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
      browserConfig: persistedState.browserConfig,
      fingerprintEnabled: profile.fingerprintEnabled,
      fingerprintOs: (profile.fingerprintOs as OSType | null) ?? undefined,
      fingerprintConfig: persistedState.fingerprintConfig,
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

  private toGroup(group: PrismaGroup): GroupRecord {
    return {
      id: group.id,
      name: group.name,
      color: group.color,
      sortOrder: group.sortOrder
    }
  }

  private resolveFingerprintState(options: {
    profileId: string
    fingerprintEnabled?: boolean
    fingerprintOs?: OSType | null
    fingerprintConfig?: FingerprintConfig
    browserConfig?: BrowserProfileConfig
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
          os,
          locale: options.browserConfig?.locale,
          timezone: options.browserConfig?.timezone
        })
    }
  }

  private buildProfileSnapshot(options: {
    id: string
    name: string
    notes?: string | null
    groupId?: string | null
    storagePath: string
    browserConfig: BrowserProfileConfig
    fingerprintEnabled: boolean
    fingerprintOs?: OSType
    fingerprintConfig?: FingerprintConfig
    proxyConfig?: ProfileProxyConfig
  }): PersistedProfileSnapshot {
    return {
      id: options.id,
      name: options.name,
      notes: options.notes ?? undefined,
      groupId: options.groupId ?? undefined,
      storagePath: options.storagePath,
      browserConfig: options.browserConfig,
      fingerprintEnabled: options.fingerprintEnabled,
      fingerprintOs: options.fingerprintOs,
      fingerprintConfig: options.fingerprintConfig,
      proxyConfig: sanitizeProxyConfig(options.proxyConfig)
    }
  }

  private getFingerprintPath(storagePath: string): string {
    return join(storagePath, 'fingerprint.json')
  }

  private getProfileStatePath(storagePath: string): string {
    return join(storagePath, 'profile-state.json')
  }

  private async loadPersistedProfileState(
    profile: PrismaProfile
  ): Promise<ProfilePersistenceState> {
    try {
      return {
        browserConfig: parseBrowserConfig(profile.browserConfig),
        fingerprintConfig: parseFingerprintConfig(profile.fingerprintConfig)
      }
    } catch (error) {
      const snapshot = await this.readProfileSnapshot(profile.storagePath)

      if (!snapshot) {
        throw error
      }

      logger.warn('Falling back to persisted profile snapshot after database parse failure.', {
        profileId: profile.id,
        storagePath: profile.storagePath,
        error: error instanceof Error ? error.message : String(error)
      })

      return {
        browserConfig: snapshot.browserConfig,
        fingerprintConfig: snapshot.fingerprintConfig
      }
    }
  }

  private async readProfileSnapshot(
    storagePath: string
  ): Promise<PersistedProfileSnapshot | undefined> {
    return readPersistedJsonFile<PersistedProfileSnapshot>(
      this.getProfileStatePath(storagePath),
      'profile snapshot'
    )
  }

  private async syncProfileArtifacts(snapshot: PersistedProfileSnapshot): Promise<void> {
    const fingerprintPath = this.getFingerprintPath(snapshot.storagePath)
    const profileStatePath = this.getProfileStatePath(snapshot.storagePath)

    await mkdir(snapshot.storagePath, { recursive: true })

    if (snapshot.fingerprintConfig) {
      await writeJsonFileAtomic(fingerprintPath, snapshot.fingerprintConfig)
    } else {
      await rm(fingerprintPath, { force: true })
    }

    await writeJsonFileAtomic(
      profileStatePath,
      serializePersistedData(snapshot)
    )
  }
}
