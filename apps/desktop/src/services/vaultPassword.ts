export interface PasswordOptions {
  length: number
  uppercase: boolean
  lowercase: boolean
  digits: boolean
  symbols: boolean
  avoidSimilar: boolean
}

export function createVaultPassword(options: PasswordOptions): string {
  const groups = [
    options.uppercase ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : '',
    options.lowercase ? 'abcdefghijklmnopqrstuvwxyz' : '',
    options.digits ? '0123456789' : '',
    options.symbols ? '!@#$%^&*()-_=+' : '',
  ].map(group => options.avoidSimilar ? group.replace(/[0O1Il]/g, '') : group).filter(Boolean)
  if (!groups.length) throw new Error('请至少选择一种字符')
  const length = Math.max(8, Math.min(64, Math.floor(options.length) || 16))
  function randomIndex(size: number) {
    const limit = Math.floor(256 / size) * size
    const buffer = new Uint8Array(1)
    do { crypto.getRandomValues(buffer) } while (buffer[0] >= limit)
    return buffer[0] % size
  }
  const pool = groups.join('')
  const result = groups.map(group => group[randomIndex(group.length)])
  while (result.length < length) result.push(pool[randomIndex(pool.length)])
  for (let index = result.length - 1; index > 0; index--) {
    const other = randomIndex(index + 1)
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result.join('')
}
