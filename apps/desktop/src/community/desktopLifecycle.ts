type DesktopApi = {core?: {invoke?: (command: string) => Promise<unknown>}; event?: {listen?: (name: string, handler: () => void) => Promise<() => void>}}
const desktop = () => {
  const platform = window as Window & {__TAURI_INTERNALS__?: unknown; __TAURI__?: DesktopApi}
  if (!platform.__TAURI_INTERNALS__) return undefined
  if (!platform.__TAURI__?.core?.invoke || !platform.__TAURI__?.event?.listen) throw Error('社区桌面关闭接口不可用')
  return platform.__TAURI__
}
export async function listenCommunityDesktopClose(handler: () => void): Promise<() => void> {
  const api = desktop()
  return api ? api.event!.listen!('note-flow-community-close', handler) : () => {}
}
export async function closeCommunityDesktop(): Promise<void> {
  const api = desktop()
  if (!api) throw Error('社区桌面关闭接口不可用')
  try {await api.core!.invoke!('community_close_confirmed')}
  catch(cause) {throw cause instanceof Error ? cause : Error('社区桌面关闭失败，请重试')}
}
