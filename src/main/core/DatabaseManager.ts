import { Prisma, PrismaClient } from '@prisma/client'
import { access, stat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRelativeDatabaseUrl, ensureAppDirectories, getAppPaths } from '@main/utils/paths'
import { logger } from '@main/utils/logger'

const execFileAsync = promisify(execFile)

function resolveNodeExecutable(): string {
  return process.env.npm_node_execpath ?? process.env.NODE ?? 'node'
}

export class DatabaseManager {
  private static instance: DatabaseManager | null = null
  private prisma: PrismaClient | null = null
  private readyPromise: Promise<PrismaClient> | null = null

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager()
    }

    return DatabaseManager.instance
  }

  public async getClient(): Promise<PrismaClient> {
    if (!this.readyPromise) {
      this.readyPromise = this.initialize()
    }

    return this.readyPromise
  }

  public async disconnect(): Promise<void> {
    if (this.prisma) {
      await this.prisma.$disconnect()
      this.prisma = null
      this.readyPromise = null
    }
  }

  private async initialize(): Promise<PrismaClient> {
    await ensureAppDirectories()

    const paths = getAppPaths()
    const databaseUrl = createRelativeDatabaseUrl(paths.database, paths.schema)

    process.env.DATABASE_URL = databaseUrl

    await this.ensureSchema(databaseUrl)

    let prisma = new PrismaClient()

    await prisma.$connect()

    try {
      await prisma.profile.count()
    } catch (error) {
      if (!this.isMissingTableError(error)) {
        throw error
      }

      await prisma.$disconnect()
      await this.bootstrapDatabase(databaseUrl)
      prisma = new PrismaClient()
      await prisma.$connect()
    }

    await this.ensureCompatibility(prisma)

    this.prisma = prisma
    logger.info('Database ready at', paths.database)

    return prisma
  }

  private async ensureSchema(databaseUrl: string): Promise<void> {
    const paths = getAppPaths()
    const prismaCliPath = join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js')
    const bootstrapSqlPath = join(process.cwd(), 'prisma', 'bootstrap.sql')

    try {
      await access(prismaCliPath, fsConstants.F_OK)
    } catch {
      throw new Error(`Prisma CLI not found at ${prismaCliPath}. Run npm install first.`)
    }

    const needsBootstrap = await this.shouldBootstrap(paths.database)

    if (!needsBootstrap) {
      return
    }

    await access(bootstrapSqlPath, fsConstants.F_OK)
    await this.bootstrapDatabase(databaseUrl)
  }

  private async bootstrapDatabase(databaseUrl: string): Promise<void> {
    const paths = getAppPaths()
    const prismaCliPath = join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js')
    const bootstrapSqlPath = join(process.cwd(), 'prisma', 'bootstrap.sql')

    await execFileAsync(
      resolveNodeExecutable(),
      [prismaCliPath, 'db', 'execute', '--file', bootstrapSqlPath, '--schema', paths.schema],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl
        }
      }
    )
  }

  private async shouldBootstrap(databasePath: string): Promise<boolean> {
    try {
      const fileStats = await stat(databasePath)
      return fileStats.size === 0
    } catch {
      return true
    }
  }

  private isMissingTableError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021'
  }

  private async ensureCompatibility(prisma: PrismaClient): Promise<void> {
    await this.ensureGroupTable(prisma)

    const tableInfo = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      'PRAGMA table_info("Profile")'
    )
    const existingColumns = new Set(tableInfo.map((column) => column.name))

    if (!existingColumns.has('fingerprintEnabled')) {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "Profile" ADD COLUMN "fingerprintEnabled" BOOLEAN NOT NULL DEFAULT true'
      )
    }

    if (!existingColumns.has('fingerprintOs')) {
      await prisma.$executeRawUnsafe('ALTER TABLE "Profile" ADD COLUMN "fingerprintOs" TEXT')
    }

    if (!existingColumns.has('fingerprintConfig')) {
      await prisma.$executeRawUnsafe('ALTER TABLE "Profile" ADD COLUMN "fingerprintConfig" TEXT')
    }

    if (!existingColumns.has('groupId')) {
      await prisma.$executeRawUnsafe('ALTER TABLE "Profile" ADD COLUMN "groupId" TEXT')
    }

    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "Profile_groupId_idx" ON "Profile"("groupId")'
    )
  }

  private async ensureGroupTable(prisma: PrismaClient): Promise<void> {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Group" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "color" TEXT NOT NULL DEFAULT '#2563eb',
        "sortOrder" INTEGER NOT NULL DEFAULT 0
      )
    `)
  }
}
