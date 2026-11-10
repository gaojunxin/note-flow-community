/** Reject error envelopes and obviously invalid responses before offering a ZIP download. */
export async function validateExportArchive(value: unknown): Promise<Blob> {
  if (!(value instanceof Blob) || value.size < 22) throw new Error('服务未返回完整的 ZIP 文件，请稍后重试')
  const signature = new Uint8Array(await value.slice(0, 4).arrayBuffer())
  if (signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 3 || signature[3] !== 4) {
    throw new Error('服务未返回有效的 ZIP 文件，请确认服务端已更新')
  }
  return value
}
