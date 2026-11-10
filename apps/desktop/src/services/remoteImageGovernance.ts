import type { NoteEntity } from '@note-flow/core'
import type { KnowledgeEntity } from './knowledge'
import { findMarkdownImages,type MarkdownImageReference } from './attachmentReferences'
import { platformFetch } from './platformFetch'
import { queueAttachment,removeLocalAttachment,unlinkKnowledgeAttachment,uploadKnowledgeAttachment,type AttachmentItem } from './attachments'
import api from './api'

export type RemoteImageEntityType='note'|'knowledge'
export const REMOTE_IMAGE_BATCH_LIMIT=500
export interface RemoteImageCandidate{uid:string;entityType:RemoteImageEntityType;entityUid:string;entityTitle:string;noteUid:string;noteTitle:string;url:string;host:string;alt:string;reference:MarkdownImageReference}
export interface RemoteImageFailure{candidateUid:string;entityType:RemoteImageEntityType;entityUid:string;noteUid:string;noteTitle:string;url:string;reason:string}
export interface RemoteImageGovernanceResult{processed:number;converted:number;failed:number;updatedNotes:number;updatedKnowledge:number;failures:RemoteImageFailure[]}
interface RemoteImageJob{uid:string;status:'queued'|'running'|'completed'|'partial'|'failed';total:number;processed:number;converted:number;failed:number;updatedEntities:number;errors:Array<{entityType:RemoteImageEntityType;entityUid:string;url:string;reason:string}>}
const responseBody=<T>(response:{data:any})=>(response.data?.data??response.data) as T

const MAX_IMAGE_BYTES=25*1024*1024
const extension=(type:string)=>({"image/jpeg":'.jpg',"image/png":'.png',"image/gif":'.gif',"image/webp":'.webp',"image/svg+xml":'.svg',"image/avif":'.avif'} as Record<string,string>)[type.split(';')[0].toLowerCase()]||'.img'
const safeName=(value:string)=>value.replace(/[\\/:*?"<>|]/g,'-').trim().slice(0,100)

export function scanRemoteImages(notes:NoteEntity[],knowledge:KnowledgeEntity[]=[]):RemoteImageCandidate[]{
  const documents=[
    ...notes.map(value=>({entityType:'note' as const,entityUid:value.uid,entityTitle:value.title||'未命名笔记',content:value.content||''})),
    ...knowledge.map(value=>({entityType:'knowledge' as const,entityUid:value.uid,entityTitle:value.title||'未命名知识',content:value.content||''}))
  ]
  return documents.flatMap(document=>findMarkdownImages(document.content).filter(reference=>reference.kind==='remote').map((reference,index)=>({uid:`${document.entityType}:${document.entityUid}:${reference.start}:${index}`,entityType:document.entityType,entityUid:document.entityUid,entityTitle:document.entityTitle,noteUid:document.entityUid,noteTitle:document.entityTitle,url:reference.url,host:reference.host||'未知域名',alt:reference.alt,reference})))
}

async function download(candidate:RemoteImageCandidate){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20_000);try{const response=await platformFetch(candidate.url,{signal:controller.signal,redirect:'follow',credentials:'omit'});if(!response.ok)throw new Error(`HTTP ${response.status}`);const type=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();if(!type.startsWith('image/'))throw new Error(`返回内容不是图片（${type||'未知类型'}）`);const declared=Number(response.headers.get('content-length')||0);if(declared>MAX_IMAGE_BYTES)throw new Error('图片超过 25 MB');const blob=await response.blob();if(!blob.size)throw new Error('图片内容为空');if(blob.size>MAX_IMAGE_BYTES)throw new Error('图片超过 25 MB');let sourceName='';try{sourceName=decodeURIComponent(new URL(candidate.url).pathname.split('/').pop()||'')}catch{sourceName=''}const base=safeName(candidate.alt||sourceName.replace(/\.[^.]+$/,'')||'远程图片');return new File([blob],`${base}${extension(type)}`,{type})}finally{clearTimeout(timer)}}

export async function convertRemoteImages(ownerId:string,notes:NoteEntity[],candidateUids:Set<string>,updateNote:(note:NoteEntity,content:string)=>Promise<NoteEntity>,onProgress?:(completed:number,total:number)=>void,knowledge:KnowledgeEntity[]=[],updateKnowledge?:(value:KnowledgeEntity,content:string)=>Promise<KnowledgeEntity>):Promise<RemoteImageGovernanceResult>{
  const all=scanRemoteImages(notes,knowledge).filter(candidate=>candidateUids.has(candidate.uid)),groups=new Map<string,RemoteImageCandidate[]>()
  for(const candidate of all){const key=`${candidate.entityType}:${candidate.entityUid}`;groups.set(key,[...(groups.get(key)||[]),candidate])}
  const failures:RemoteImageFailure[]=[],result={processed:0,converted:0,failed:0,updatedNotes:0,updatedKnowledge:0,failures}
  for(const candidates of groups.values()){
    const first=candidates[0],note=first.entityType==='note'?notes.find(value=>value.uid===first.entityUid):undefined,value=first.entityType==='knowledge'?knowledge.find(item=>item.uid===first.entityUid):undefined
    if(!note&&!value)continue
    const replacements:Array<{reference:MarkdownImageReference;url:string;localUid?:string;attachment?:AttachmentItem}>=[]
    for(const candidate of candidates){
      try{
        const file=await download(candidate)
        if(candidate.entityType==='knowledge'){
          const attachment=await uploadKnowledgeAttachment(candidate.entityUid,file,file.name)
          replacements.push({reference:candidate.reference,url:attachment.contentUrl||`/api/v1/attachments/${attachment.uid}/content`,attachment})
        }else{
          const attachment=await queueAttachment(ownerId,candidate.entityUid,file)
          replacements.push({reference:candidate.reference,url:`attachment:${attachment.uid}`,localUid:attachment.uid})
        }
        result.converted++
      }catch(source){failures.push(failure(candidate,source instanceof Error?source.message:'图片转换失败'));result.failed++}
      finally{result.processed++;onProgress?.(result.processed,all.length)}
    }
    if(!replacements.length)continue
    let content=(note?.content||value?.content||'')
    for(const item of replacements.sort((a,b)=>b.reference.start-a.reference.start))content=content.slice(0,item.reference.start)+`![${item.reference.alt}](${item.url})`+content.slice(item.reference.end)
    try{
      if(note){await updateNote(note,content);result.updatedNotes++}
      else if(value&&updateKnowledge){await updateKnowledge(value,content);result.updatedKnowledge++}
      else throw new Error('知识正文更新器不可用')
    }catch(source){
      for(const item of replacements)if(item.localUid)await removeLocalAttachment(ownerId,item.localUid).catch(()=>undefined);else if(item.attachment)await unlinkKnowledgeAttachment(first.entityUid,item.attachment).catch(()=>undefined)
      result.converted-=replacements.length;result.failed+=replacements.length
      for(const candidate of candidates.filter(candidate=>replacements.some(item=>item.reference===candidate.reference)))failures.push(failure(candidate,`${candidate.entityType==='knowledge'?'知识':'笔记'}正文保存失败：${source instanceof Error?source.message:'未知错误'}`))
    }
  }
  return result
}

export async function convertRemoteImagesOnServer(candidates:RemoteImageCandidate[],onProgress?:(completed:number,total:number,status?:RemoteImageJob['status'])=>void):Promise<RemoteImageGovernanceResult>{
  if(candidates.length>REMOTE_IMAGE_BATCH_LIMIT)throw new Error(`每批最多转换 ${REMOTE_IMAGE_BATCH_LIMIT} 条，请使用“选择前${REMOTE_IMAGE_BATCH_LIMIT}条”后再提交。`)
  // This endpoint only creates a background job, while subsequent requests poll
  // its state. Do not inherit the generic 20-second UI request timeout: a busy
  // reverse proxy or server must not make the client abandon an already-created
  // job and tempt the user to create a duplicate conversion.
  const created=responseBody<RemoteImageJob>(await api.post('/api/v1/governance/remote-images/jobs',{items:candidates.map(value=>({entityType:value.entityType,entityUid:value.entityUid,url:value.url,alt:value.alt}))},{timeout:0}))
  let job=created
  while(job.status==='queued'||job.status==='running'){
    onProgress?.(job.processed,job.total,job.status)
    await new Promise(resolve=>window.setTimeout(resolve,700))
    job=responseBody<RemoteImageJob>(await api.get(`/api/v1/governance/remote-images/jobs/${job.uid}`,{timeout:0}))
  }
  onProgress?.(job.processed,job.total,job.status)
  const failures=job.errors.map(error=>{const candidate=candidates.find(value=>value.entityType===error.entityType&&value.entityUid===error.entityUid&&(!error.url||value.url===error.url));return{candidateUid:candidate?.uid||`${error.entityType}:${error.entityUid}:${error.url}`,entityType:error.entityType,entityUid:error.entityUid,noteUid:error.entityUid,noteTitle:candidate?.entityTitle||error.entityUid,url:error.url||candidate?.url||'',reason:error.reason}})
  return{processed:job.processed,converted:job.converted,failed:job.failed,updatedNotes:job.updatedEntities,updatedKnowledge:0,failures}
}

function failure(candidate:RemoteImageCandidate,reason:string):RemoteImageFailure{return{candidateUid:candidate.uid,entityType:candidate.entityType,entityUid:candidate.entityUid,noteUid:candidate.entityUid,noteTitle:candidate.entityTitle,url:candidate.url,reason}}
