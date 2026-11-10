export interface BulkFailure<T> { item: T; message: string }
export interface BulkResult<T, R> { succeeded: Array<{ item: T; value: R }>; failed: BulkFailure<T>[]; total: number }

export async function runBulkOperation<T, R>(
  items: readonly T[],
  operation: (item: T, index: number) => Promise<R>,
  options: { chunkSize?: number; onProgress?: (completed: number, total: number) => void; yieldControl?: () => Promise<void> } = {}
): Promise<BulkResult<T, R>> {
  const chunkSize = Math.max(1, Math.min(100, options.chunkSize ?? 20))
  const succeeded: Array<{ item: T; value: R }> = [], failed: BulkFailure<T>[] = []
  const yieldControl = options.yieldControl || (() => new Promise<void>(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 0)
  }))
  for (let offset = 0; offset < items.length; offset += chunkSize) {
    const chunk = items.slice(offset, offset + chunkSize)
    const settled = await Promise.allSettled(chunk.map((item, index) => operation(item, offset + index)))
    settled.forEach((result, index) => {
      const item = chunk[index]
      if (result.status === 'fulfilled') succeeded.push({ item, value: result.value })
      else failed.push({ item, message: result.reason instanceof Error ? result.reason.message : String(result.reason || '操作失败') })
    })
    options.onProgress?.(Math.min(offset + chunk.length, items.length), items.length)
    if (offset + chunk.length < items.length) await yieldControl()
  }
  return { succeeded, failed, total: items.length }
}
