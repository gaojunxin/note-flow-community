import {Capacitor, registerPlugin} from '@capacitor/core'
import {createIndexedDbLocalHost} from '@note-flow/core/local-storage-web'
import {createNativeLocalHost} from '@note-flow/core/local-storage-native'
import {CoreProviderError} from '@note-flow/core/community'
import type {CoreErrorCode} from '@note-flow/core/contracts'

type LocalInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>
type DesktopWindow = Window & {isTauri?: boolean; __TAURI_INTERNALS__?: unknown; __TAURI__?: {core?: {invoke?: LocalInvoke}}}
export function createCommunityStorage(databaseName: string) {
  if (Capacitor.isNativePlatform()) {
    const plugin = registerPlugin<{request(input: {input: string}): Promise<{result: unknown}>}>('CommunityLocal')
    return createNativeLocalHost({async request(input) {
      try {return (await plugin.request({input: JSON.stringify(input)})).result}
      catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'STORAGE_ERROR'
        const known = ['STORAGE_ERROR','SCHEMA_INCOMPATIBLE','INVALID_CHANGE','REVISION_CONFLICT','PROFILE_BUSY']
        throw new CoreProviderError((known.includes(code) ? code : 'STORAGE_ERROR') as CoreErrorCode, '社区移动本地仓储操作失败')
      }
    }})
  }
  const platform = window as DesktopWindow
  // 原生壳即使桥接尚不可用也必须失败，不能在同一空间悄悄建立浏览器写库。
  const desktop = Boolean(platform.isTauri || platform.__TAURI_INTERNALS__ || platform.__TAURI__ || platform.location?.hostname === 'tauri.localhost')
  if (!desktop) return createIndexedDbLocalHost(databaseName)
  const invoke = platform.__TAURI__?.core?.invoke
  return createNativeLocalHost({async request(input) {
    if (!invoke) throw new CoreProviderError('STORAGE_ERROR', '社区桌面本地仓储接口不可用')
    try {return await invoke('community_local_request', {input})}
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'STORAGE_ERROR'
      const known = ['STORAGE_ERROR','SCHEMA_INCOMPATIBLE','INVALID_CHANGE','REVISION_CONFLICT','PROFILE_BUSY']
      throw new CoreProviderError((known.includes(code) ? code : 'STORAGE_ERROR') as CoreErrorCode, '社区桌面本地仓储操作失败')
    }
  }})
}
