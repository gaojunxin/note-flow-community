const MAX_BASE64_LENGTH = 2_800_000

function normalizeBase64(source: string) {
  const trimmed = source.trim()
  const payload = trimmed.startsWith('data:') ? trimmed.slice(trimmed.indexOf(',') + 1) : trimmed
  const compact = payload.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!compact) throw new Error('请输入要解码的 Base64 内容')
  if (compact.length > MAX_BASE64_LENGTH) throw new Error('内容过大，请将其作为附件处理')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) throw new Error('内容不是有效的 Base64 编码')
  const remainder = compact.length % 4
  if (remainder === 1) throw new Error('内容不是有效的 Base64 编码')
  return compact.padEnd(compact.length + (remainder ? 4 - remainder : 0), '=')
}

export function decodeBase64Text(source: string) {
  let binary: string
  try {
    binary = atob(normalizeBase64(source))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('内容')) throw error
    throw new Error('内容不是有效的 Base64 编码')
  }
  const bytes = Uint8Array.from(binary, value => value.charCodeAt(0))
  const decoded = new TextDecoder('utf-8').decode(bytes)
  if (!decoded) throw new Error('解码结果为空')
  return decoded
}

export function isProbablyBase64Text(source: string) {
  const value = source.trim()
  if (!value) return false
  if (/^data:[^,]+;base64,/i.test(value)) return true
  const compact = value.replace(/\s+/g, '')
  if (compact.length < 12 || compact.length % 4 === 1 || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(compact)) return false
  try {
    const decoded = decodeBase64Text(value)
    return !decoded.includes('\uFFFD') && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(decoded)
  } catch {
    return false
  }
}
