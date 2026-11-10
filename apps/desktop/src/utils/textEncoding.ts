const utf8 = new TextDecoder('utf-8', { fatal: true })
const windows1252Extension = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ'
const extendedBytes = new Map(
  Array.from(windows1252Extension, (character, index) => [character, 0x80 + index]),
)

export function repairMojibake(value: string) {
  const source = value.trim().normalize('NFC')
  if (!/[\u0080-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013-\u203a\u20ac]/.test(source)) return source
  const bytes: number[] = []
  for (const character of source) {
    const code = character.charCodeAt(0)
    const byte = code <= 0xff ? code : extendedBytes.get(character)
    if (byte === undefined) return source
    bytes.push(byte)
  }
  try {
    const repaired = utf8.decode(Uint8Array.from(bytes)).normalize('NFC')
    return repaired.includes('\uFFFD') ? source : repaired
  } catch {
    return source
  }
}
