/** Tagged representation preserves unknown fields and binary media without magic object keys. */
export type PortableValue =
  | {kind: 'null' | 'undefined'}
  | {kind: 'boolean'; value: boolean}
  | {kind: 'number'; value: number}
  | {kind: 'string' | 'bigint' | 'date'; value: string}
  | {kind: 'array'; value: PortableValue[]}
  | {kind: 'object'; value: Array<[string, PortableValue]>}
  | {kind: 'blob'; value: string; mediaType: string}
  | {kind: 'bytes' | 'buffer'; value: string}

const toBase64 = (bytes: Uint8Array) => {
  let result = ''
  for (let offset = 0; offset < bytes.length; offset += 16384) result += String.fromCharCode(...bytes.subarray(offset, offset + 16384))
  return btoa(result)
}
const fromBase64 = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0))

export async function encodePortableValue(value: unknown, ancestors = new Set<object>()): Promise<PortableValue> {
  if (value === null) return {kind: 'null'}
  if (value === undefined) return {kind: 'undefined'}
  if (typeof value === 'boolean') return {kind: 'boolean', value}
  if (typeof value === 'string') return {kind: 'string', value}
  if (typeof value === 'bigint') return {kind: 'bigint', value: String(value)}
  if (typeof value === 'number' && Number.isFinite(value)) return {kind: 'number', value}
  if (value instanceof Date) return {kind: 'date', value: value.toISOString()}
  if (value instanceof Blob) return {kind: 'blob', mediaType: value.type, value: toBase64(new Uint8Array(await value.arrayBuffer()))}
  if (value instanceof Uint8Array) return {kind: 'bytes', value: toBase64(value)}
  if (value instanceof ArrayBuffer) return {kind: 'buffer', value: toBase64(new Uint8Array(value))}
  if (typeof value !== 'object' || !value || ancestors.has(value)) throw Error('无法导出循环引用或不支持的数据类型')
  const seen = new Set(ancestors); seen.add(value)
  if (Array.isArray(value)) return {kind: 'array', value: await Promise.all(value.map(item => encodePortableValue(item, seen)))}
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw Error('无法导出非普通对象')
  const entries: Array<[string, PortableValue]> = []
  for (const [key, item] of Object.entries(value)) entries.push([key, await encodePortableValue(item, seen)])
  return {kind: 'object', value: entries}
}

export function decodePortableValue(input: unknown, depth = 0): unknown {
  if (depth > 100 || !input || typeof input !== 'object') throw Error('备份数据格式无效')
  const node = input as PortableValue
  switch (node.kind) {
    case 'null': return null
    case 'undefined': return undefined
    case 'boolean': if (typeof node.value === 'boolean') return node.value; break
    case 'number': if (typeof node.value === 'number' && Number.isFinite(node.value)) return node.value; break
    case 'string': if (typeof node.value === 'string') return node.value; break
    case 'bigint': if (typeof node.value === 'string' && /^-?\d+$/.test(node.value)) return BigInt(node.value); break
    case 'date': if (typeof node.value === 'string' && Number.isFinite(Date.parse(node.value))) return new Date(node.value); break
    case 'bytes': if (typeof node.value === 'string') return fromBase64(node.value); break
    case 'buffer': if (typeof node.value === 'string') return fromBase64(node.value).buffer; break
    case 'blob': if (typeof node.value === 'string' && typeof node.mediaType === 'string') return new Blob([fromBase64(node.value)], {type: node.mediaType}); break
    case 'array': if (Array.isArray(node.value)) return node.value.map(item => decodePortableValue(item, depth + 1)); break
    case 'object': {
      if (!Array.isArray(node.value)) break
      const result: Record<string, unknown> = {}
      const seen = new Set<string>()
      for (const entry of node.value) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || seen.has(entry[0])) throw Error('备份对象字段无效')
        seen.add(entry[0])
        // Preserve __proto__ as data without mutating the object's prototype.
        Object.defineProperty(result, entry[0], {value: decodePortableValue(entry[1], depth + 1), enumerable: true, writable: true, configurable: true})
      }
      return result
    }
  }
  throw Error('备份数据格式无效')
}
