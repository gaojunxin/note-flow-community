import {sha256} from '@noble/hashes/sha2.js'

/** Internal comparison only, not a persisted backup format or authenticity signature.
 * Length-delimited type tags prevent collisions between structures and value types. */
export async function fingerprintBackupValue(value: unknown): Promise<string> {
  const hash = sha256.create(), encoder = new TextEncoder(), ancestors = new Set<object>()
  const tag = (kind: string, size = 0) => hash.update(encoder.encode(`${kind}:${size}:`))
  const text = (kind: string, value: string) => {
    const bytes = encoder.encode(value); tag(kind, bytes.length); hash.update(bytes)
  }
  async function visit(value: unknown): Promise<void> {
    if (value === null) {tag('null'); return}
    if (value === undefined) {tag('undefined'); return}
    if (typeof value === 'string') {text('string', value); return}
    if (typeof value === 'boolean') {tag(value ? 'true' : 'false'); return}
    if (typeof value === 'bigint') {text('bigint', String(value)); return}
    if (typeof value === 'number' && Number.isFinite(value)) {text('number', String(value)); return}
    if (value instanceof Date) {text('date', value.toISOString()); return}
    if (value instanceof Blob) {
      text('mediaType', value.type); tag('blob', value.size)
      const reader = value.stream().getReader()
      let size = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > value.size) throw Error('附件读取长度异常，未导出备份')
          hash.update(chunk.value)
        }
        if (size !== value.size) throw Error('附件读取不完整，未导出备份')
      } finally {
        try {await reader.cancel()} finally {reader.releaseLock()}
      }
      return
    }
    if (value instanceof Uint8Array) {tag('bytes', value.byteLength); hash.update(value); return}
    if (value instanceof ArrayBuffer) {tag('buffer', value.byteLength); hash.update(new Uint8Array(value)); return}
    if (!value || typeof value !== 'object' || ancestors.has(value)) throw Error('备份包含循环引用或不支持的数据类型')
    ancestors.add(value)
    try {
      if (Array.isArray(value)) {
        tag('array', value.length)
        for (const item of value) await visit(item)
      } else {
        if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw Error('备份包含非普通对象')
        const keys = Object.keys(value).sort()
        tag('object', keys.length)
        for (const key of keys) {text('key', key); await visit((value as Record<string, unknown>)[key])}
      }
    } finally {ancestors.delete(value)}
  }
  try {await visit(value); return Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('')}
  finally {hash.destroy()}
}
