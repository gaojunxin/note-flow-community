import type {AttachmentItem} from './attachments'
import {invoke} from '@tauri-apps/api/core'
import {localAttachments,attachmentCacheMetadata} from './attachments'
import {clientOwnerScope} from './clientContext'
import {accountSessionRevision} from './accountStorage'
import {isDesktopClient} from './serverConfig'
export interface AttachmentAvailability {state:'available'|'remote'|'missing'|'invalid'|'unknown'|'pending'|'failed'|'linking';label:string;offline:boolean|null;localUid?:string;retryable:boolean}
interface LocalRow {uid:string;serverUid?:string;status:string;localPath?:string;blob?:Blob;sha256?:string}
interface Host {rows():Promise<LocalRow[]>;cache(uid:string):Promise<{blob?:Blob;sha256?:string}|undefined>;size(path:string):Promise<number|null>;current():boolean}
export function createAttachmentAvailabilityReader(host:Host){
 return async(items:AttachmentItem[]):Promise<Record<string,AttachmentAvailability>>=>{
  const rows=await host.rows();if(!host.current())throw Error('当前空间已变化')
  const results=await Promise.all(items.map(async item=>{
   const local=rows.find(row=>row.status!=='deleted'&&(row.uid===item.uid||row.serverUid===item.uid))
   let state:AttachmentAvailability['state']='remote',offline:boolean|null=false
   try{
    const cached=await host.cache(item.uid)
    const blob=local?.blob||cached?.blob
    if(blob instanceof Blob){const hash=local?.blob?local.sha256:cached?.sha256;state=blob.size!==item.sizeBytes||item.sha256&&hash&&hash.toLowerCase()!==item.sha256.toLowerCase()?'invalid':'available';offline=state==='available'}
    else if(local?.localPath){const size=await host.size(local.localPath);state=size===null?'missing':size===item.sizeBytes?'available':'invalid';offline=state==='available'}
    else if(local&&!local.serverUid)state='missing'
    if(state==='available'&&local?.sha256&&item.sha256&&local.sha256.toLowerCase()!==item.sha256.toLowerCase()){state='invalid';offline=false}
   }catch{state='unknown';offline=null}
   const transfer=local?.status==='failed'?'failed':local?.status==='uploaded_needs_link'?'linking':['pending','uploading'].includes(local?.status||'')?'pending':undefined
   const labels={available:'本机可用',remote:'尚未下载',missing:'本机副本缺失',invalid:'本机副本需修复',unknown:'本机状态待检查',pending:'等待上传',failed:'上传失败',linking:'等待关联'}
   const display=transfer||state
   return[item.uid,{state:display,label:labels[display]+(transfer&&offline===false?' · 本机副本不可用':''),offline,localUid:local?.uid,retryable:Boolean(transfer&&offline===true)} satisfies AttachmentAvailability] as const
  }))
  if(!host.current())throw Error('当前空间已变化')
  return Object.fromEntries(results)
 }
}
export function readAttachmentAvailability(ownerId:string,items:AttachmentItem[]){const scope=clientOwnerScope(ownerId),session=accountSessionRevision();return createAttachmentAvailabilityReader({rows:()=>localAttachments(ownerId),cache:uid=>attachmentCacheMetadata(ownerId,uid),size:path=>isDesktopClient()?invoke<number|null>('profile_media_size',{storageKey:scope,relativePath:path}):Promise.resolve(null),current:()=>scope===clientOwnerScope(ownerId)&&session===accountSessionRevision()})(items)}
