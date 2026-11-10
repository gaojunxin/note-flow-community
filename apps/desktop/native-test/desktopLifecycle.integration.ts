import {afterEach,describe,expect,it,vi} from 'vitest'
import {listenCommunityDesktopClose,closeCommunityDesktop} from '../src/community/desktopLifecycle'
afterEach(()=>vi.unstubAllGlobals())
describe('desktop close transport',()=>{
 it('subscribes and releases the native close event and only invokes confirmed destruction',async()=>{
  const stop=vi.fn(),listen=vi.fn().mockResolvedValue(stop),invoke=vi.fn().mockResolvedValue(undefined),handler=vi.fn()
  vi.stubGlobal('window',{__TAURI_INTERNALS__:{},__TAURI__:{core:{invoke},event:{listen}}})
  const release=await listenCommunityDesktopClose(handler)
  expect(listen).toHaveBeenCalledWith('note-flow-community-close',handler);expect(invoke).not.toHaveBeenCalled()
  release();expect(stop).toHaveBeenCalledOnce()
  await closeCommunityDesktop();expect(invoke).toHaveBeenCalledWith('community_close_confirmed')
 })
 it('keeps Web without a native listener and rejects a missing desktop bridge',async()=>{
  vi.stubGlobal('window',{});await expect(listenCommunityDesktopClose(vi.fn())).resolves.toBeTypeOf('function')
  await expect(closeCommunityDesktop()).rejects.toThrow('关闭接口不可用')
  vi.stubGlobal('window',{__TAURI_INTERNALS__:{}})
  await expect(listenCommunityDesktopClose(vi.fn())).rejects.toThrow('关闭接口不可用')
 })
 it('propagates a failed native close instead of claiming it succeeded',async()=>{
  vi.stubGlobal('window',{__TAURI_INTERNALS__:{},__TAURI__:{core:{invoke:vi.fn().mockRejectedValue(Error('window failed'))},event:{listen:vi.fn()}}})
  await expect(closeCommunityDesktop()).rejects.toThrow('window failed')
  vi.stubGlobal('window',{__TAURI_INTERNALS__:{},__TAURI__:{core:{invoke:vi.fn().mockRejectedValue({code:'STORAGE_ERROR'})},event:{listen:vi.fn()}}})
  await expect(closeCommunityDesktop()).rejects.toThrow('社区桌面关闭失败，请重试')
 })
})
