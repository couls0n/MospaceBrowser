import type { Profile as PrismaProfile, Proxy as PrismaProxy } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseManager } from '@main/core/DatabaseManager'
import { decryptString, encryptString } from '@main/utils/encryption'
import { getAppPaths } from '@main/utils/paths'
import type {
  CloneProfileInput,
  CreateProfileInput,
  CreateProxyInput,
  DeleteProfileInput,
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
  if (!profile.proxyType || !profile.proxyHost || !profile.proxyPort || profile.proxyType === 'none') {
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

export class ProfileManager {
  private static instance: ProfileManager | null = null
  private readonly databaseManager = DatabaseManager.getInstance()

  public static getInstance(): ProfileManager {
    if (!ProfileManager.instance) {
      ProfileManager.instance = new ProfileManager()
    }

    return ProfileManager.instance
  }

  public async createProfile(input: CreateProfileInput): Promise<Profile> {
    const prisma = await this.databaseManager.getClient()
    const id = randomUUID()
    const storagePath = join(getAppPaths().profiles, id)

    await mkdir(storagePath, { recursive: true })

    const profile = await prisma.profile.create({
      data: {
        id,
        name: input.name,
        notes: input.notes,
        browserConfig: JSON.stringify(input.browserConfig),
        proxyType: input.proxyConfig?.type,
        proxyHost: input.proxyConfig?.host,
        proxyPort: input.proxyConfig?.port,
        proxyUsername: input.proxyConfig?.username,
        proxyPassword: await encryptString(input.proxyConfig?.password),
        storagePath,
        groupId: input.groupId
      }
    })

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
    const profile = await prisma.profile.update({
      where: { id: input.id },
      data: {
        name: input.name ?? current.name,
        notes: input.notes ?? current.notes,
        browserConfig: input.browserConfig ? JSON.stringify(input.browserConfig) : current.browserConfig,
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

    await mkdir(storagePath, { recursive: true })

    const cloned = await prisma.profile.create({
      data: {
        id,
        name: input.name ?? `${source.name} Copy`,
        notes: source.notes,
        browserConfig: source.browserConfig,
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

    return {
      id: profile.id,
      name: profile.name,
      notes: profile.notes ?? undefined,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
      browserConfig,
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
}
