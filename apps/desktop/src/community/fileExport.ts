import {saveNativeFileExport,type FileExportOptions} from '../services/nativeFileExportLease'
import {captureFileExportBoundary} from '../services/fileExportBoundary'
import {Capacitor, registerPlugin} from '@capacitor/core'

/** Resolves true only after the native provider closes the selected document stream. */
export async function exportCommunityFile(blob: Blob, name: string, assertCurrent:()=>void=captureFileExportBoundary(), options:FileExportOptions={}): Promise<boolean> {
  assertCurrent()
  const mobile=Capacitor.isNativePlatform()
  const desktop=!mobile && typeof window!=='undefined' && Boolean((window as Window & {__TAURI_INTERNALS__?:unknown}).__TAURI_INTERNALS__)
  if(desktop){
    const invoke=(window as Window & {__TAURI__?:{core?:{invoke?:(command:string,args:Record<string,unknown>)=>Promise<unknown>}}}).__TAURI__?.core?.invoke
    if(!invoke)throw Error('桌面文件导出接口不可用')
    return saveNativeFileExport(blob,name,assertCurrent,invoke,options)
  }
  if (mobile || desktop) {
    if (blob.size > 64 * 1024 * 1024) throw Error('当前原生导出支持最大 64 MiB 文件')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    assertCurrent()
    const chunks: string[] = []
    for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)))
    const base64=btoa(chunks.join(''))
    assertCurrent()
    const plugin = registerPlugin<{saveFile(input: {name: string; mimeType: string; base64: string}): Promise<{saved: boolean}>}>('CommunityFiles')
    const response = await plugin.saveFile({name, mimeType: blob.type.split(';')[0] || 'application/octet-stream', base64})
    assertCurrent()
    if (typeof response?.saved !== 'boolean') throw Error('移动文件导出响应无效')
    return response.saved
  }
  assertCurrent()
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
