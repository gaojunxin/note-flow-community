import {knowledgeAvailable} from './clientCapabilities'
import {localAiTasks} from './tasks'
import type {LearningReference} from '@note-flow/core/ai-learning'
import {createPcNotesService} from './notes'
import {localAiKnowledge} from './knowledge'
import {localAiAttachmentItems,readLocalAiAttachment,type AttachmentItem} from './attachments'
import {readAccountSetting} from './accountStorage'
export interface ReferenceChoice {kind:LearningReference['kind'];uid:string;title:string;reason?:string;version?:number}
const owner=()=>String(JSON.parse(readAccountSetting('note-flow-pc-user')||'null')?.userId||'local')
const notes=()=>createPcNotesService(owner())
const textFile=(item:AttachmentItem)=>/^text\//.test(item.mediaType||'')||/\.(txt|md|markdown|csv|json|log|ya?ml)$/i.test(item.originalFilename)
const pdf=(item:AttachmentItem)=>item.mediaType==='application/pdf'||/\.pdf$/i.test(item.originalFilename)
function attachmentReason(item:AttachmentItem){return item.sizeBytes>8*1024*1024?'文件超过 8 MB，请先摘录所需内容':textFile(item)||pdf(item)?undefined:/^image\//.test(item.mediaType||'')?'当前支持文本引用，图片需先识别为文字':'暂不支持提取此文件格式的文字'}
export async function listLearningReferences():Promise<{items:ReferenceChoice[];warnings:string[]}>{
 const results=await Promise.allSettled([notes().list('active'),(knowledgeAvailable?Promise.resolve(localAiKnowledge()):Promise.resolve([])),localAiAttachmentItems(owner()),localAiTasks()]);const items:ReferenceChoice[]=[],warnings:string[]=[]
 if(results[0].status==='fulfilled')for(const value of results[0].value)if(!value.deleted&&value.status!=='archived'&&value.aiPolicy!=='excluded')items.push({kind:'note',uid:value.uid,title:value.title||'未命名笔记',version:value.version})
 if(results[1].status==='fulfilled')for(const value of results[1].value)if(value.aiPolicy!=='excluded')items.push({kind:'knowledge',uid:value.uid,title:value.title||'未命名知识',version:value.version})
 if(results[2].status==='fulfilled')for(const value of results[2].value)items.push({kind:'attachment',uid:value.uid,title:value.originalFilename,version:value.version,reason:attachmentReason(value)})
 if(results[3].status==='fulfilled')for(const value of results[3].value)if(!value.deleted)items.push({kind:'task',uid:value.uid,title:value.title,version:value.version})
 results.forEach((value,index)=>{if(value.status==='rejected')warnings.push(`${['笔记','知识','附件','任务'][index]}暂时无法读取`)})
 return {items,warnings}
}
export async function resolveLearningReference(choice:ReferenceChoice,truncate=false):Promise<LearningReference>{
 if(!knowledgeAvailable&&choice?.kind==='knowledge')throw Error('知识引用属于高级版本功能')
 if(!choice||!['note','knowledge','attachment','task'].includes(choice.kind)||typeof choice.uid!=='string'||typeof choice.title!=='string')throw Error('引用资料格式无效')
 let content='',version=choice.version,title=choice.title
 if(choice.kind==='note'){const value=await notes().get(choice.uid);if(!value||value.deleted||value.status==='archived'||value.aiPolicy==='excluded')throw Error('笔记已删除、归档或禁止 AI 引用');content=value.content||'';version=value.version;title=value.title||title}
 else if(choice.kind==='knowledge'){const value=(await localAiKnowledge()).find(item=>item.uid===choice.uid);if(!value||value.aiPolicy==='excluded')throw Error('知识不在本机或已禁止 AI 引用');content=[value.conclusion,value.content,value.applicability,value.limitations].filter(Boolean).join('\n\n');version=value.version;title=value.title||title}
 else if(choice.kind==='task'){const value=(await localAiTasks()).find(item=>item.uid===choice.uid);if(!value||value.deleted)throw Error('本机任务已不存在');content=[value.title,value.description,`状态：${value.completed?'已完成':'未完成'}`,value.dueAt?`截止时间：${value.dueAt}`:''].filter(Boolean).join('\n');version=value.version;title=value.title}
 else {const item=(await localAiAttachmentItems(owner())).find(item=>item.uid===choice.uid);if(!item)throw Error('本机附件记录已不存在');const reason=attachmentReason(item);if(reason)throw Error(reason);
  if(item.noteUid){const parent=await notes().get(item.noteUid);if(!parent||parent.deleted||parent.status==='archived'||parent.aiPolicy==='excluded')throw Error('附件所属笔记不可用于 AI')}
  if(item.knowledgeUid){if(!knowledgeAvailable)throw Error('知识附件引用属于高级版本功能');const parent=(await localAiKnowledge()).find(value=>value.uid===item.knowledgeUid);if(!parent||parent.aiPolicy==='excluded')throw Error('附件所属知识不可用于 AI')}
  const blob=await readLocalAiAttachment(owner(),item);if(blob.size>8*1024*1024)throw Error('附件超过 8 MB');version=item.version;title=item.originalFilename;
  if(pdf(item)){const {pdfPreviewEngine,pdfPreviewOptions}=await import('./pdfPreview');const engine=await pdfPreviewEngine(),task=engine.getDocument(pdfPreviewOptions(new Uint8Array(await blob.arrayBuffer())));try{const document=await task.promise;if(document.numPages>50)throw Error('PDF 超过 50 页，请先摘录所需内容');for(let page=1;page<=document.numPages;page++){const text=await(await document.getPage(page)).getTextContent();content+=text.items.map(item=>'str'in item?item.str:'').join(' ')+'\n';if(content.length>24000)throw Error('PDF 文字超过引用上限，请先摘录所需内容')}}finally{await task.destroy()}}
  else content=await blob.text();
 }
 if(!content.trim())throw Error('没有可引用的文字；扫描 PDF 或图片需先进行文字识别')
 if(content.includes('\u0000'))throw Error('文件不属于可读取的文本格式')
 if(truncate&&content.length>8000)return{kind:choice.kind,uid:choice.uid,title:title.slice(0,200),version,content:content.slice(0,8000),truncated:true,fullLength:content.length}
 if(content.length>24000)throw Error('内容超过 24000 字，请先摘录所需部分')
 return {kind:choice.kind,uid:choice.uid,title:title.slice(0,200),version,content}
}
export async function verifyLearningReferences(references:LearningReference[]){
 if(!Array.isArray(references)||references.length>10)throw Error('最多引用 10 项资料')
 for(const reference of references){const current=await resolveLearningReference(reference,Boolean(reference.truncated));if(current.fullLength!==reference.fullLength||current.version!==reference.version||current.content!==reference.content)throw Error(`“${reference.title}”已变化，请移除后重新选择`)}
}
export const referenceContext=(references:LearningReference[])=>references.map(item=>`[引用${item.kind==='note'?'笔记':item.kind==='knowledge'?'知识':'附件'}：${item.title}]\n${item.content}`).join('\n\n')
