export const LOCAL_SYNC_REQUEST = 'note-flow:local-sync-request'
export function requestLocalSync() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LOCAL_SYNC_REQUEST))
}
