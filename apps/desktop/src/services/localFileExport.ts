import {captureFileExportBoundary} from './fileExportBoundary'
import {invoke} from '@tauri-apps/api/core'
import {isCommunityEdition} from './clientCapabilities'
import {isDesktopClient} from './serverConfig'
import {saveNativeFileExport,type FileExportOptions} from './nativeFileExportLease'
import {exportCommunityFile} from '../community/fileExport'
export async function saveLocalExport(blob:Blob,name:string,options:FileExportOptions={},assertSourceCurrent?:()=>void):Promise<boolean>{
 const boundary=captureFileExportBoundary()
 const assertCurrent=()=>{boundary();assertSourceCurrent?.()}
 assertCurrent()
 if(isCommunityEdition){const result=await exportCommunityFile(blob,name,assertCurrent,options);assertCurrent();return result}
 if(isDesktopClient())return saveNativeFileExport(blob,name,assertCurrent,invoke,options)
 assertCurrent()
 const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true
}
