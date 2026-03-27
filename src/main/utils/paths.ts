import { app } from 'electron'
import { dirname, join, relative } from 'node:path'
import { mkdir } from 'node:fs/promises'

export interface AppPaths {
  userData: string
  logs: string
  database: string
  profiles: string
  secrets: string
  schema: string
}

export function getAppPaths(): AppPaths {
  const userData = app.getPath('userData')

  return {
    userData,
    logs: join(userData, 'logs'),
    database: join(userData, 'database.db'),
    profiles: join(userData, 'profiles'),
    secrets: join(userData, 'secrets'),
    schema: join(process.cwd(), 'prisma', 'schema.prisma')
  }
}

export async function ensureAppDirectories(): Promise<void> {
  const paths = getAppPaths()

  await Promise.all([
    mkdir(paths.userData, { recursive: true }),
    mkdir(paths.logs, { recursive: true }),
    mkdir(paths.profiles, { recursive: true }),
    mkdir(paths.secrets, { recursive: true })
  ])
}

export function createRelativeDatabaseUrl(databasePath: string, schemaPath: string): string {
  const schemaDirectory = dirname(schemaPath)
  const relativePath = relative(schemaDirectory, databasePath).replace(/\\/g, '/')
  const normalizedPath = relativePath.startsWith('.') ? relativePath : `./${relativePath}`

  return `file:${normalizedPath}`
}
