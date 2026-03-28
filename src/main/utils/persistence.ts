import { readFile, rename, rm, writeFile } from 'node:fs/promises'

const CURRENT_PERSISTENCE_VERSION = 1

interface PersistedEnvelope<T> {
  version: number
  savedAt: string
  data: T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPersistedEnvelope<T>(value: unknown): value is PersistedEnvelope<T> {
  return (
    isRecord(value) &&
    typeof value.version === 'number' &&
    typeof value.savedAt === 'string' &&
    'data' in value
  )
}

export function serializePersistedData<T>(data: T): string {
  const envelope: PersistedEnvelope<T> = {
    version: CURRENT_PERSISTENCE_VERSION,
    savedAt: new Date().toISOString(),
    data
  }

  return JSON.stringify(envelope)
}

export function parsePersistedData<T>(payload: string | null | undefined, label: string): T | undefined {
  if (!payload) {
    return undefined
  }

  try {
    const parsed = JSON.parse(payload) as unknown
    return isPersistedEnvelope<T>(parsed) ? parsed.data : (parsed as T)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse persisted ${label}: ${message}`)
  }
}

export async function readPersistedJsonFile<T>(path: string, label: string): Promise<T | undefined> {
  try {
    const payload = await readFile(path, 'utf-8')
    return parsePersistedData<T>(payload, label)
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      return undefined
    }

    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to read ${label} from ${path}: ${message}`)
  }
}

export async function writeJsonFileAtomic(path: string, data: string | unknown): Promise<void> {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`
  const payload = typeof data === 'string' ? data : JSON.stringify(data, null, 2)

  try {
    await writeFile(tempPath, payload, 'utf-8')
    await rm(path, { force: true })
    await rename(tempPath, path)
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined)
  }
}
