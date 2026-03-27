import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { access, readFile, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { join } from 'node:path'
import { getAppPaths } from '@main/utils/paths'

const KEY_LENGTH = 32
const IV_LENGTH = 12

async function getOrCreateKey(): Promise<Buffer> {
  const keyPath = join(getAppPaths().secrets, 'app.key')

  try {
    await access(keyPath, fsConstants.F_OK)
    return await readFile(keyPath)
  } catch {
    const key = randomBytes(KEY_LENGTH)
    await writeFile(keyPath, key)
    return key
  }
}

export async function encryptString(value?: string): Promise<string | undefined> {
  if (!value) {
    return undefined
  }

  const key = await getOrCreateKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export async function decryptString(value?: string): Promise<string | undefined> {
  if (!value) {
    return undefined
  }

  const payload = Buffer.from(value, 'base64')
  const iv = payload.subarray(0, IV_LENGTH)
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + 16)
  const encrypted = payload.subarray(IV_LENGTH + 16)
  const key = await getOrCreateKey()
  const decipher = createDecipheriv('aes-256-gcm', key, iv)

  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
