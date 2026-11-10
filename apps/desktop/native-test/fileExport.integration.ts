import {afterEach,describe,expect,it,vi} from 'vitest'
import {exportCommunityFile} from '../src/community/fileExport'
const platform=vi.hoisted(()=>({native:true,save:vi.fn()}))
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>platform.native},registerPlugin:()=>({saveFile:platform.save})}))
afterEach(()=>{platform.save.mockReset();platform.native=true;vi.unstubAllGlobals()})
describe('native document export',()=>{
 it('preserves binary bytes and waits for completed native writing',async()=>{
  let finish!:(value:{saved:boolean})=>void
  platform.save.mockReturnValue(new Promise(resolve=>{finish=resolve}))
  let settled=false
  const result=exportCommunityFile(new Blob([new Uint8Array([0,128,255])],{type:'image/png'}),'image.png').then(value=>{settled=true;return value})
  await vi.waitFor(()=>expect(platform.save).toHaveBeenCalledWith({name:'image.png',mimeType:'image/png',base64:'AID/'}))
  expect(settled).toBe(false);finish({saved:true});expect(await result).toBe(true)
 })
 it('returns cancellation without claiming a saved file',async()=>{
  platform.save.mockResolvedValue({saved:false})
  expect(await exportCommunityFile(new Blob(['backup'],{type:'application/json'}),'backup.json')).toBe(false)
 })
 it('propagates provider failures and rejects malformed responses',async()=>{
  platform.save.mockRejectedValueOnce(Error('storage full'))
  await expect(exportCommunityFile(new Blob(['data']),'file')).rejects.toThrow('storage full')
  platform.save.mockResolvedValue({})
  await expect(exportCommunityFile(new Blob(['data']),'file')).rejects.toThrow('移动文件导出响应无效')
 })
 it('rejects an oversized file before reading or sending bytes',async()=>{
  const blob={size:64*1024*1024+1,arrayBuffer:vi.fn()} as unknown as Blob
  await expect(exportCommunityFile(blob,'large')).rejects.toThrow('64 MiB')
  expect(blob.arrayBuffer).not.toHaveBeenCalled();expect(platform.save).not.toHaveBeenCalled()
 })
 it('uses a native desktop dialog and preserves cancellation',async()=>{
  platform.native=false
  const invoke=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  vi.stubGlobal('window',{__TAURI_INTERNALS__:{},__TAURI__:{core:{invoke}}})
  expect(await exportCommunityFile(new Blob([new Uint8Array([0,128,255])]),'bytes.bin')).toBe(false)
  expect(invoke).toHaveBeenCalledWith('community_save_file',{name:'bytes.bin',base64:'AID/'})
  expect(await exportCommunityFile(new Blob(['data']),'file')).toBe(true)
 })
 it('does not fall back to a browser download on a failed desktop bridge',async()=>{
  platform.native=false;vi.stubGlobal('window',{__TAURI_INTERNALS__:{}})
  await expect(exportCommunityFile(new Blob(['data']),'file')).rejects.toThrow('桌面文件导出接口不可用')
  vi.stubGlobal('window',{__TAURI_INTERNALS__:{},__TAURI__:{core:{invoke:vi.fn().mockRejectedValue({code:'STORAGE_ERROR'})}}})
  await expect(exportCommunityFile(new Blob(['data']),'file')).rejects.toThrow('桌面文件导出失败')
 })

})
