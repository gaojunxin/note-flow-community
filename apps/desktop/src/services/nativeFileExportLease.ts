export interface FileExportOptions {kind?:'vault-backup'|'knowledge-archive'}
export type FileExportInvoker=(command:string,args:Record<string,unknown>)=>Promise<unknown>
/** 原生选择的路径不跨IPC传递；租约属于当前窗口，知识包显式申请独立大小预算。 */
export async function saveNativeFileExport(blob:Blob,name:string,assertCurrent:()=>void,invoke:FileExportInvoker,options:FileExportOptions={}):Promise<boolean>{
 const maxMiB=options.kind==='knowledge-archive'?256:options.kind==='vault-backup'?100:64
 if(blob.size>maxMiB*1024*1024)throw Error(`本地导出最大支持 ${maxMiB} MiB`)
 let lease:string|undefined,cancelled=false
 const cancel=()=>{if(lease)void invoke('cancel_file_export',{leaseUid:lease}).catch(()=>{})}
 const changed=(event:Event)=>{try{assertCurrent();if(event.type!=='pagehide')return}catch{}cancelled=true;cancel()}
 const events=['note-flow:app-locked','note-flow:account-lifecycle-change','note-flow:profile-change','note-flow:vault-session-change','pagehide']
 const listening=typeof window!=='undefined'&&typeof window.addEventListener==='function'
 if(listening)for(const event of events)window.addEventListener(event,changed)
 const check=()=>{assertCurrent();if(cancelled)throw Error('文件导出已取消')}
 try{
  check()
  const chosen=await invoke('choose_file_export',{defaultName:name,...(options.kind?{exportKind:options.kind}:{})})
  if(chosen===null){check();return false}
  if(typeof chosen!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chosen))throw Error('文件选择响应无效，请升级客户端后重试')
  lease=chosen;check()
  const bytes=new Uint8Array(await blob.arrayBuffer());check()
  let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768))
  const contentBase64=btoa(binary);check()
  const saved=await invoke('commit_file_export',{leaseUid:lease,contentBase64});check()
  if(typeof saved!=='boolean')throw Error('文件导出响应无效，请升级客户端后重试')
  return saved
 }finally{
  if(listening)for(const event of events)window.removeEventListener(event,changed)
  if(lease)await invoke('cancel_file_export',{leaseUid:lease}).catch(()=>{})
 }
}
