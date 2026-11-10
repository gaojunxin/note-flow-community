import { reactive } from 'vue'

export const COMMUNITY_SYNC_UNAVAILABLE = '社区版仅保存在本机；未连接服务器，自动同步和兜底检查均不运行。'
export const syncDelivery = reactive({ connected: false, lastCheckedAt: 0, error: COMMUNITY_SYNC_UNAVAILABLE })
export const SYNC_CONNECTED_CHECK_MS = 300_000
export const SYNC_FALLBACK_CHECK_MS = 30_000
export interface LocalSyncReadiness { pending: boolean; cursors: string[]; epoch?: string; initialized: boolean }
/** No transport, poll timer, event listener or sync callback is installed. */
export function createPcSyncEvents(_run: (force?: boolean) => Promise<unknown>) {
  return {
    start() { syncDelivery.connected = false; syncDelivery.error = COMMUNITY_SYNC_UNAVAILABLE },
    stop() { syncDelivery.connected = false }
  }
}
export async function shouldSyncWorkspace(_userId: string, _notesOnly = false): Promise<boolean> { return false }
/** Remote cursor interpretation belongs to the unavailable sync component. */
export function cursorSequence(_cursor: string): undefined { return undefined }
export function needsSync(_local: LocalSyncReadiness, _remote: { syncEpoch: string; latestSeq?: string | number }): never {
  throw Object.assign(new Error(COMMUNITY_SYNC_UNAVAILABLE), { code: 'COMPONENT_UNAVAILABLE' })
}
