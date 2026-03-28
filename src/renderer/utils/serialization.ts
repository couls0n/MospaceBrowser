import { toRaw } from 'vue'

function normalize(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || value === undefined) {
    return value
  }

  const valueType = typeof value

  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return value
  }

  if (valueType === 'bigint') {
    return Number(value)
  }

  if (valueType === 'function' || valueType === 'symbol') {
    return undefined
  }

  if (valueType !== 'object') {
    return value
  }

  const rawValue = toRaw(value as object)

  if (rawValue === null) {
    return null
  }

  if (Array.isArray(rawValue)) {
    return rawValue
      .map((item) => normalize(item, seen))
      .filter((item) => item !== undefined)
  }

  if (rawValue instanceof Date) {
    return rawValue.toISOString()
  }

  if (rawValue instanceof Map) {
    const mapped: Record<string, unknown> = {}

    for (const [key, entryValue] of rawValue.entries()) {
      const normalizedEntry = normalize(entryValue, seen)

      if (normalizedEntry !== undefined) {
        mapped[String(key)] = normalizedEntry
      }
    }

    return mapped
  }

  if (rawValue instanceof Set) {
    return Array.from(rawValue.values())
      .map((item) => normalize(item, seen))
      .filter((item) => item !== undefined)
  }

  const constructorName = (rawValue as { constructor?: { name?: string } }).constructor?.name

  if (constructorName && constructorName !== 'Object') {
    // Host objects (Window, HTMLElement, etc.) cannot be sent over Electron IPC.
    return undefined
  }

  if (seen.has(rawValue)) {
    return seen.get(rawValue)
  }

  const normalizedObject: Record<string, unknown> = {}
  seen.set(rawValue, normalizedObject)

  for (const [key, entryValue] of Object.entries(rawValue)) {
    const normalizedEntry = normalize(entryValue, seen)

    if (normalizedEntry !== undefined) {
      normalizedObject[key] = normalizedEntry
    }
  }

  return normalizedObject
}

export function toPlainData<T>(input: T): T {
  return normalize(input, new WeakMap()) as T
}
