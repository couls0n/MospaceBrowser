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
}
