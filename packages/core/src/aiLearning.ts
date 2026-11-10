/** Public, provider-independent learning contracts. No account credentials or transport. */
export interface LearningReference {truncated?:boolean;fullLength?:number;kind:'note'|'knowledge'|'attachment'|'task';uid:string;title:string;version?:number;content:string}
export type LearningFinishReason='completed'|'cancelled'|'network_error'|'timeout'|'process_exit'|'length'
export interface LearningDirectorySnapshot {noteUids:string[];schema:'note-flow-directory-context/1';areaUid:string;areaLabel:string;capturedAt:string;folderCount:number;includedFolders:number;noteCount:number;includedTitles:number;complete:boolean;content:string}
export interface LearningMessage { workspaceSources?:string[]; directorySnapshot?:LearningDirectorySnapshot; attemptUid?:string;finishReason?:LearningFinishReason; references?:LearningReference[]; uid:string; version:number; role:'user'|'assistant'; content:string; status:'complete'|'pending'|'failed'|'interrupted'; referenceUid?:string }
export interface LearningSession { createdAt?:string; updatedAt?:string; uid:string; revision:number; title:string; input:string; messages:LearningMessage[]; draft:string; draftSources:string[] }
export interface LearningNote { uid:string; title?:string; content?:string; version?:number; aiPolicy?:string }
export interface LearningCache { references?:LearningReference[]; epoch?:string; sessions:LearningSession[]; selectedUid:string; input:string; draft:string; sources:string[]; pendingSend?:{signature:string;uid:string}; operation?:{key:string; payload:string} }
export function learningCacheKey(server:string,user:string) {
  if(!user)throw new Error('请先登录后使用学习讨论')
  return `note-flow-ai-learning:v1:${encodeURIComponent(server)}:${encodeURIComponent(user)}`
}
export function learningExcerpt(session:LearningSession, ids:string[]) {
  const selected=session.messages.filter(message=>ids.includes(message.uid)&&message.status==='complete')
  if(!ids.length||selected.length!==new Set(ids).size)throw new Error('请选择完整的讨论消息')
  return selected.map(message=>message.content).join('\n\n')
}
export function learningAppendPreview(note:LearningNote, draft:string) {
  if(note.version==null)throw new Error('目标笔记尚未同步，请同步后重新预览')
  return {targetUid:note.uid,targetVersion:note.version,before:note.content||'',after:`${note.content||''}\n\n${draft}`}
}
export function readLearningCache(storage:Pick<Storage,'getItem'>,key:string):LearningCache {
  try {const data=JSON.parse(storage.getItem(key)||'null');if(data)return validateLearningCache(data)} catch { /* damaged cache must not block a fresh session */ }
  return {sessions:[],selectedUid:'',input:'',draft:'',sources:[]}
}

/** Validate the whole imported cache before replacing any live state. */
export function validateLearningCache(value:unknown):LearningCache {
  const fail=()=>{throw new Error('学习缓存或备份格式无效，原草稿已保留')}
  const object=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v)
  const text=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max
  const ids=(v:unknown,max:number):v is string[]=>Array.isArray(v)&&v.length<=max&&v.every(id=>text(id,64)&&id.length>0)&&new Set(v).size===v.length
  if(!object(value)||!Array.isArray(value.sessions)||value.sessions.length>1000||!text(value.selectedUid,64)||!text(value.input,8000)||!text(value.draft,50000)||!ids(value.sources,50))return fail()
  const validReferences=(refs:unknown)=>Array.isArray(refs)&&refs.length<=10&&refs.every(r=>object(r)&&['note','knowledge','attachment','task'].includes(String(r.kind))&&text(r.uid,64)&&text(r.title,200)&&text(r.content,24000)&&(r.truncated===undefined||r.truncated===true&&Number.isInteger(r.fullLength)&&Number(r.fullLength)>String(r.content).length))
  if(value.references!==undefined&&!validReferences(value.references))return fail()
  const sessionIds=new Set<string>()
  for(const s of value.sessions){
    if(!object(s)||!text(s.uid,64)||!s.uid||sessionIds.has(s.uid as string)||!Number.isInteger(s.revision)||Number(s.revision)<1||!text(s.title,200)||!text(s.input,8000)||!text(s.draft,50000)||!ids(s.draftSources,50)||!Array.isArray(s.messages)||s.messages.length>200)return fail()
    for(const stamp of [s.createdAt,s.updatedAt])if(stamp!==undefined&&(!text(stamp,40)||!Number.isFinite(Date.parse(stamp as string))))return fail()
    sessionIds.add(s.uid as string);const messageIds=new Set<string>()
    for(const m of s.messages){if(!object(m)||!text(m.uid,64)||!m.uid||messageIds.has(m.uid as string)||m.version!==1||!['user','assistant'].includes(String(m.role))||!['complete','pending','failed','interrupted'].includes(String(m.status))||!text(m.content,100000)||(m.referenceUid!=null&&!text(m.referenceUid,64)))return fail();if(m.references!==undefined&&!validReferences(m.references))return fail();if(m.workspaceSources!==undefined&&!ids(m.workspaceSources,2000))return fail();if(m.directorySnapshot!==undefined){const d=m.directorySnapshot;if(!object(d)||d.schema!=='note-flow-directory-context/1'||!text(d.areaUid,64)||!text(d.areaLabel,200)||!text(d.content,12000)||!text(d.capturedAt,40)||!Number.isFinite(Date.parse(String(d.capturedAt)))||typeof d.complete!=='boolean'||!ids(d.noteUids,2000)||d.noteUids.length!==d.includedTitles||d.complete===true&&(d.includedFolders!==d.folderCount||d.includedTitles!==d.noteCount)||['folderCount','includedFolders','noteCount','includedTitles'].some(k=>!Number.isSafeInteger(d[k])||Number(d[k])<0)||Number(d.includedFolders)>Number(d.folderCount)||Number(d.includedTitles)>Number(d.noteCount))return fail();}if(m.attemptUid!==undefined&&(!text(m.attemptUid,64)||!m.attemptUid))return fail();if(m.finishReason!==undefined&&!['completed','cancelled','network_error','timeout','process_exit','length'].includes(String(m.finishReason)))return fail();messageIds.add(m.uid as string)}
    const messages=s.messages as Record<string,unknown>[]
    if(s.draftSources.some(id=>!messages.some(m=>m.uid===id&&m.status==='complete')))return fail()
  }
  if(value.selectedUid&&!sessionIds.has(value.selectedUid as string))return fail()
  if(value.epoch!==undefined&&!text(value.epoch,200))return fail()
  if(value.pendingSend!==undefined&&(!object(value.pendingSend)||!text(value.pendingSend.signature,110000)||!text(value.pendingSend.uid,64)))return fail()
  if(value.operation!==undefined){
    if(!object(value.operation)||!text(value.operation.key,64)||!text(value.operation.payload,110000))return fail()
    try{const p=JSON.parse(value.operation.payload as string);if(!object(p)||p.operationUid!==value.operation.key||!text(p.title,200)||!text(p.content,50000)||!ids(p.sources,50)||!Number.isInteger(p.revision))return fail()}catch{return fail()}
  }
  return value as unknown as LearningCache
}

/** Incremental transport contract; credentials and provider reasoning are never events. */
export interface LearningStreamEvent {requestUid:string;messageUid:string;attemptUid:string;seq:number;type:'start'|'text_delta'|'tool_status'|'done'|'error';text?:string;finishReason?:LearningFinishReason}
export interface LearningQueryScope {enabled:boolean;kinds:Array<'note'|'knowledge'|'task'>;areaUid:string;includeCompletedTasks:boolean}
export interface LearningTaskProposal {key:string;selected:boolean;title:string;description:string;priority:number;estimatedMinutes:number|null;startAt:string|null;dueAt:string|null;parentKey:string|null}
export interface LearningActionProposal {uid:string;scope:string;kind:'knowledge'|'tasks';sessionUid:string;message:LearningMessage;model:{channel:string;model:string};title:string;conclusion:string;content:string;applicability:string;limitations:string;areaUid:string;projectUid:string;tasks:LearningTaskProposal[];createdAt:string}
export interface LearningActionResult {uid:string;kind:'knowledge'|'task';title:string;status:'pending'|'saved'|'failed';error?:string;key?:string}
export interface LearningActionOperation {uid:string;signature:string;proposal:LearningActionProposal;results:LearningActionResult[];lease?:string;leaseUntil?:number}
