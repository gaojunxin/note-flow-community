import {inferMediaType} from './filePreview'
import {captureFileExportBoundary} from './fileExportBoundary'
import {invoke} from '@tauri-apps/api/core'
import {isDesktopClient} from './serverConfig'
import {ElMessage} from 'element-plus'

/** PC统一接管挂载的文件输入框；保留各业务原有change校验，Web不安装此适配。 */
export function installNativeFileInputs(){
 if(!isDesktopClient())return()=>{}
 let busy=false
 const select=async(event:MouseEvent)=>{
  const input=event.target
  if(!(input instanceof HTMLInputElement)||input.type!=='file'||input.disabled)return
  event.preventDefault()
  if(busy)return
  busy=true
  try{
   const check=captureFileExportBoundary()
   const folder=input.hasAttribute('webkitdirectory')
   const extensions=input.accept.split(',').map(value=>value.trim()).filter(value=>value.startsWith('.')).map(value=>value.slice(1))
   // MIME筛选交给原业务校验，避免只含MIME时错误限制可选类型。
   const entries=await invoke<Array<{name:string;relativePath:string;bytes:number[];lastModified:number}>|null>(folder?'choose_knowledge_import_folder':'choose_native_import_files',{multiple:input.multiple,extensions:input.accept.includes('/')?[]:extensions})
   check()
   if(!entries){input.dispatchEvent(new Event('cancel'));return}
   if(!input.isConnected)return
   const transfer=new DataTransfer()
   for(const entry of entries){const file=new File([new Uint8Array(entry.bytes)],entry.name,{lastModified:entry.lastModified,type:inferMediaType(entry.name)});if(folder)Object.defineProperty(file,'webkitRelativePath',{value:entry.relativePath});transfer.items.add(file)}
   input.files=transfer.files
   input.dispatchEvent(new Event('change',{bubbles:true}))
  }catch(source){input.dispatchEvent(new Event('cancel'));ElMessage.error(source instanceof Error?source.message:String(source))}finally{busy=false}
 }
 document.addEventListener('click',select,true)
 return()=>document.removeEventListener('click',select,true)
}