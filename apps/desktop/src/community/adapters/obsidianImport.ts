import type {FolderEntity} from '@note-flow/core/contracts'
import {scanObsidianVault,extractExcalidrawScene,obsidianImportDirectoryParts,importErrorMessage,pathSensitivity,classifyObsidianPath} from '../../services/imports/obsidianParser'
import type {ObsidianScan,ObsidianImportOptions,ImportRecord,AttachmentImportRecord,RemoteImageImportRecord,TaskImportRecord,ImportBatch} from '../../services/imports/obsidianParser'
import {createPcNotesService} from './notes'
import {createCanvasService} from './canvases'
import {foldersService} from './folders'
import {tagsService} from './tags'
import {queueAttachment} from './attachments'
import {workspaceService} from './workspace'
import {communityProfileId,createEntity,listEntities} from '../runtime'
export * from '../../services/imports/obsidianParser'
const unsupported=(operation:string):never=>{throw Error(`社区版暂不支持${operation}；未执行该操作，请使用本地导入与备份流程`)}
function normalizePath(path:string){const result:string[]=[];for(const part of path.replace(/\\/g,'/').normalize('NFC').split('/')){if(!part||part==='.')continue;if(part==='..')result.pop();else result.push(part)}return result.join('/')}
function attachmentFor(scan:ObsidianScan,notePath:string,reference:string){const raw=decodeURIComponent(reference.trim().replace(/^<|>$/g,'')),dir=notePath.replace(/[^/]+$/,'');const keys=[normalizePath(`${dir}${raw}`),normalizePath(raw)];for(const key of keys){const match=scan.attachments.find(item=>normalizePath(item.sourcePath)===key);if(match)return match}const base=normalizePath(raw).split('/').pop();const matches=scan.attachments.filter(item=>item.file.name.normalize('NFC')===base);if(matches.length>1)throw Error('同名附件存在多处，无法确定引用目标');return matches[0]}
export async function importObsidianScan(scan:ObsidianScan,onProgress?:(done:number,total:number)=>void,options:ObsidianImportOptions={}){
 if(options.projectStrategy==='top-level-folders')unsupported('顶层目录批量创建项目')
 if(options.remoteImages==='private'&&scan.remoteImageCount)unsupported('远程图片下载与私有附件转存')
 const profile=communityProfileId(),notes=createPcNotesService(profile),canvases=createCanvasService(profile),batchUid=crypto.randomUUID()
 const[areas,projects]=await Promise.all([workspaceService.areas(),workspaceService.projects(undefined,true)])
 const project=options.targetProjectUid?projects.find(value=>value.uid===options.targetProjectUid):undefined
 if(options.targetProjectUid&&!project)throw Error('所选目标项目不存在')
 const areaUid=project?.areaUid||options.targetAreaUid||null
 if(areaUid&&!areas.some(value=>value.uid===areaUid))throw Error('所选目标领域不存在')
 const records:ImportRecord[]=[],attachmentRecords:AttachmentImportRecord[]=[],remoteImageRecords:RemoteImageImportRecord[]=[],taskRecords:TaskImportRecord[]=[]
 const referenced=new Set<string>(),allTags=await tagsService.list()
 async function directory(sourcePath:string){if(options.organization==='flat')return null;let parentId:number|null=null;for(const name of obsidianImportDirectoryParts(sourcePath,'none')){const existing=(await foldersService.list()).find(value=>value.name===name&&value.parentId===parentId&&(value.areaUid||null)===areaUid&&(value.projectUid||null)===(project?.uid||null));const folder:FolderEntity=existing||await foldersService.create(name,parentId,{areaUid,projectUid:project?.uid||null});parentId=folder.id}return parentId}
 async function assertProfile(){if(communityProfileId()!==profile)throw Error('本地空间已切换，导入已停止；已保存项目保留在原空间')}
 for(let index=0;index<scan.items.length;index++){
  await assertProfile();const source=scan.items[index]
  if(source.classification.category==='private'){records.push({uid:crypto.randomUUID(),sourcePath:source.sourcePath,result:'skipped',errorMessage:'私密配置未写入普通笔记'});onProgress?.(index+1,scan.items.length);continue}
  let noteUid:string|undefined
  try{
   if(source.noteType==='excalidraw'){const document=extractExcalidrawScene(source.content,source.sourcePath);if(!document)throw Error('未找到画布原文');const canvas=await canvases.create({title:source.title,areaUid,projectUid:project?.uid||null,canvasType:'excalidraw',documentData:document,sceneData:document,dataFormat:'excalidraw-json',sourceFormat:'obsidian',sourcePath:source.sourcePath,createdAt:source.originalCreatedAt});records.push({uid:crypto.randomUUID(),sourcePath:source.sourcePath,result:'success',canvasUid:canvas.uid})}
   else{
    const folderId=await directory(source.sourcePath),tagIds:number[]=[]
    for(const name of source.tags.split(',').filter(Boolean)){let tag=allTags.find(value=>value.name===name);if(!tag){tag=await tagsService.create(name);allTags.push(tag)}tagIds.push(tag.id)}
    let note=await notes.create({title:source.title,content:source.content,type:source.classification.journal?'journal':'note',status:'active',folderId,areaUid,projectUid:project?.uid||null,tagIds,createdAt:source.originalCreatedAt,obsidianSourcePath:source.sourcePath,obsidianImportBatchUid:batchUid} as any);noteUid=note.uid
    let content=source.content
    for(const match of source.content.matchAll(/!\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]|!\[[^\]]*\]\(([^)]+)\)/g)){
     const raw=(match[1]||match[2]||'').trim();if(/^(?:https?:|data:|attachment:)/i.test(raw))continue
     let sourcePath=raw
     try{const attachment=attachmentFor(scan,source.sourcePath,raw);if(!attachment)throw Error('选择的文件中缺少该本地附件');sourcePath=attachment.sourcePath;referenced.add(normalizePath(sourcePath));if(pathSensitivity(sourcePath)||classifyObsidianPath(sourcePath).category==='private')throw Error('私密附件未写入普通笔记');if(!attachment.file.size)throw Error('附件没有可读取内容，请通过文件选择器重新选择原文件');const saved=await queueAttachment(profile,note.uid,attachment.file);content=content.replace(match[0],`![${attachment.file.name}](attachment:${saved.uid})`);attachmentRecords.push({sourcePath,noteSourcePath:source.sourcePath,noteUid:note.uid,originalReference:match[0],result:'success'})}catch(error){attachmentRecords.push({sourcePath,noteSourcePath:source.sourcePath,noteUid:note.uid,originalReference:match[0],result:'failed',errorMessage:importErrorMessage(error)})}
    }
    if(content!==source.content)note=await notes.update({...note,content})
    records.push({uid:crypto.randomUUID(),sourcePath:source.sourcePath,result:'success',noteUid:note.uid})
   }
  }catch(error){records.push({uid:crypto.randomUUID(),sourcePath:source.sourcePath,noteUid,result:'failed',errorMessage:importErrorMessage(error)})}
  onProgress?.(index+1,scan.items.length)
 }
 if(options.importStandaloneFiles!==false)for(const attachment of scan.attachments.filter(value=>!referenced.has(normalizePath(value.sourcePath)))){
  await assertProfile();let noteUid:string|undefined
  try{if(pathSensitivity(attachment.sourcePath)||classifyObsidianPath(attachment.sourcePath).category==='private')throw Error('私密附件未导入');if(!attachment.file.size)throw Error('文件没有可读取内容，请重新选择原文件');const folderId=await directory(attachment.sourcePath),node=await notes.create({title:attachment.file.name,content:'',type:'file',status:'active',folderId,areaUid,projectUid:project?.uid||null,mediaType:attachment.file.type,obsidianSourcePath:attachment.sourcePath,obsidianImportBatchUid:batchUid} as any);noteUid=node.uid;const saved=await queueAttachment(profile,node.uid,attachment.file);await notes.update({...node,attachmentUid:saved.uid,fileName:attachment.file.name,mediaType:attachment.file.type} as any);records.push({uid:crypto.randomUUID(),sourcePath:attachment.sourcePath,noteUid:node.uid,result:'success'});attachmentRecords.push({sourcePath:attachment.sourcePath,noteSourcePath:attachment.sourcePath,noteUid:node.uid,result:'success'})}catch(error){records.push({uid:crypto.randomUUID(),sourcePath:attachment.sourcePath,noteUid,result:'failed',errorMessage:importErrorMessage(error)});attachmentRecords.push({sourcePath:attachment.sourcePath,noteSourcePath:attachment.sourcePath,noteUid,result:'failed',errorMessage:importErrorMessage(error)})}
 }
 const success=records.filter(value=>value.result==='success').length,skipped=records.filter(value=>value.result==='skipped').length,failed=records.filter(value=>value.result==='failed').length
 const batch:ImportBatch={uid:batchUid,totalCount:records.length,successCount:success,skippedCount:skipped,failedCount:failed,status:'completed'}
 await createEntity('obsidian_import_batch',{...batch,records,attachmentRecords,sourceRoot:scan.rootName})
 return{batches:[batch],records,total:records.length,success,skipped,failed,attachmentSuccess:attachmentRecords.filter(value=>value.result==='success').length,attachmentFailed:attachmentRecords.filter(value=>value.result==='failed').length,attachmentRecords,remoteImageSuccess:0,remoteImageFailed:0,remoteImageRecords,taskSuccess:0,taskFailed:0,taskRecords}
}
export async function localObsidianImportSummary(){const notes=(await listEntities('note')).filter(value=>value.obsidianImportBatchUid||value.obsidianSourcePath);return{notes:notes.length,batches:new Set(notes.map(value=>value.obsidianImportBatchUid).filter(Boolean)).size}}
export async function deleteLocalObsidianImports():Promise<number>{return unsupported('整批删除导入数据')}
export async function resetAllLocalNotes():Promise<number>{return unsupported('清空本地笔记空间')}
export async function retryObsidianFailures(_scan:ObsidianScan,_records:ImportRecord[],_onProgress?:(done:number,total:number)=>void):Promise<Awaited<ReturnType<typeof importObsidianScan>>>{return unsupported('自动重试导入批次；请检查失败记录后重新选择对应文件')}
export async function retryObsidianAttachments(_scan:ObsidianScan,_records:AttachmentImportRecord[]):Promise<AttachmentImportRecord[]>{return unsupported('自动重试附件批次；请通过原笔记重新附加对应文件')}
