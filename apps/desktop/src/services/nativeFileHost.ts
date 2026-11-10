import {invoke} from '@tauri-apps/api/core'
import {captureFileExportBoundary} from './fileExportBoundary'
import {saveNativeFileExport} from './nativeFileExportLease'

/** Public local file boundary. Binary IPC uses base64, never JSON byte arrays. */
export async function nativeBlobBase64(blob:Blob):Promise<string>{
 const bytes=new Uint8Array(await blob.arrayBuffer())
 let binary=''
 for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768))
 return btoa(binary)
}
export async function readNativeProfileMedia(storageKey:string,relativePath:string):Promise<Uint8Array>{
 const encoded=await invoke<string>('read_profile_media_base64',{storageKey,relativePath})
 if(typeof encoded!=='string')throw new Error('本地媒体读取响应无效')
 return Uint8Array.from(atob(encoded),character=>character.charCodeAt(0))
}
export async function saveNativeProfileMedia(storageKey:string,kind:'attachments'|'recordings',blob:Blob,fileName:string,sha256:string):Promise<string>{
 return invoke<string>('save_profile_media_base64',{storageKey,kind,fileName,sha256,contentBase64:await nativeBlobBase64(blob)})
}
export async function saveNativeEditionTransfer(blob:Blob,defaultName:string):Promise<boolean>{
 if(!blob.size||blob.size>64*1024*1024)throw new Error('版本切换档案支持最大 64 MiB，请保留原空间并分开备份媒体')
 return saveNativeFileExport(blob,defaultName,captureFileExportBoundary(),invoke)
}
