import { toRaw } from 'vue'

function getPathLabel(path: string): string {
  return path || 'root'
}

function normalize(value: unknown, seen: WeakMap<object, unknown>, path: string): unknown {
  if (value === null || value === undefined) {
    return value
  }

  const valueType = typeof value

  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return value
  }

  if (valueType === 'bigint') {
    return value.toString()
  }

  if (valueType === 'function' || valueType === 'symbol') {
    throw new Error(`Unsupported ${valueType} value at ${getPathLabel(path)}.`)
  }

  if (valueType !== 'object') {
    return value
  }

  const rawValue = toRaw(value as object)

  if (rawValue === null) {
    return null
  }

  if (Array.isArray(rawValue)) {
    return rawValue.map((item, index) => normalize(item, seen, `${path}[${index}]`))
  }

  if (rawValue instanceof Date) {
    return rawValue.toISOString()
  }

  if (rawValue instanceof Map) {
    const mapped: Record<string, unknown> = {}

    for (const [key, entryValue] of rawValue.entries()) {
      const keyText = String(key)
      const childPath = path ? `${path}.${keyText}` : keyText
      mapped[keyText] = normalize(entryValue, seen, childPath)
    }

    return mapped
  }

  if (rawValue instanceof Set) {
    return Array.from(rawValue.values())
      .map((item, index) => normalize(item, seen, `${path}[${index}]`))
  }

  const constructorName = (rawValue as { constructor?: { name?: string } }).constructor?.name

  if (constructorName && constructorName !== 'Object') {
    throw new Error(
      `Unsupported object "${constructorName}" at ${getPathLabel(path)}. ` +
        'Please provide plain JSON-serializable data.'
    )
  }

  if (seen.has(rawValue)) {
    return seen.get(rawValue)
  }

  const normalizedObject: Record<string, unknown> = {}
  seen.set(rawValue, normalizedObject)

  for (const [key, entryValue] of Object.entries(rawValue)) {
    const childPath = path ? `${path}.${key}` : key
    normalizedObject[key] = normalize(entryValue, seen, childPath)
  }

  return normalizedObject
}

export function toPlainData<T>(input: T): T {
  return normalize(input, new WeakMap(), '') as T
}
