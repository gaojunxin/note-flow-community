import type { NoteEntity, NoteOrganizationStatus, NoteType } from '@note-flow/core'
import { openDB } from 'idb'

export type GovernanceRole='unclassified'|'project_collection'|'project'|'area'|'knowledge'|'journal'|'task_list'|'inbox'|'private'|'ignore'
export type GovernanceIssue='pending'|'unclassified'|'missing_area'|'missing_project'|'missing_folder'|'missing_tags'|'task_candidates'|'duplicate_title'|'stale'
export interface GovernanceItem{noteUid:string;role:GovernanceRole;sourceType?:string;sourceRoot?:string;sourcePath?:string;sourceDir?:string;importBatchUid?:string;ignoredIssues:GovernanceIssue[];updatedAt:string}
export interface GovernanceSourceNode{path:string;sourceRoot?:string;role:GovernanceRole;areaUid?:string;projectUid?:string;childStrategy:'none'|'direct_projects';journalPattern:string;updatedAt:string}
export interface TaskCandidate{uid:string;noteUid:string;fingerprint:string;lineIndex:number;title:string;completed:boolean;state:'pending'|'converted'|'ignored';taskUid?:string;sourceText:string;updatedAt:string}
export interface GovernanceRule{uid:string;name:string;enabled:boolean;priority:number;sourceRoot?:string;pathPattern:string;actions:{role?:GovernanceRole;noteType?:NoteType;organizationStatus?:NoteOrganizationStatus;areaUid?:string|null;projectUid?:string|null;folderId?:number|null;addTagIds?:number[]};autoRun:boolean;createdAt:string;updatedAt:string}
export interface GovernanceBatch{uid:string;label:string;changes:Array<{noteUid:string;before:Partial<NoteEntity>;after:Partial<NoteEntity>;beforeRole?:GovernanceRole;afterRole?:GovernanceRole}>;createdAt:string;undoneAt?:string}

export const uuid=()=>crypto.randomUUID()
export const slash=(value:string)=>value.replace(/\\/g,'/').replace(/^\/+|\/+$/g,'')
export const dirOf=(value:string)=>{const parts=slash(value).split('/');parts.pop();return parts.join('/')}
export const rowValue=<T>(value:string|undefined,fallback:T):T=>{try{return value?JSON.parse(value) as T:fallback}catch{return fallback}}
const candidateFingerprint=(line:string,title:string)=>`${line.trim().toLocaleLowerCase()}|${title.toLocaleLowerCase()}`
export const inferredRole=(note:NoteEntity,role?:GovernanceRole):GovernanceRole=>role||(note.type==='journal'?'journal':'unclassified')
export const resolvedRole=(note:NoteEntity,current:GovernanceRole|undefined,role?:GovernanceRole):GovernanceRole=>current&&current!=='unclassified'?current:inferredRole(note,role)
const hasContentClassification=(note:NoteEntity)=>Boolean(
  note.folderId||note.folderUid||note.areaUid||note.projectUid||note.journalSeriesUid||note.periodType||(note.type&&note.type!=='note')
)

export function extractTaskCandidates(content:string){
  return content.split(/\r?\n/).flatMap((sourceText,lineIndex)=>{const match=sourceText.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/);if(!match)return[];const title=match[2].replace(/\s+#[\p{L}\p{N}_/-]+/gu,'').trim();return title?[{lineIndex,title,completed:match[1].toLocaleLowerCase()==='x',sourceText,fingerprint:candidateFingerprint(sourceText,title)}]:[]})
}

export function pathMatches(path:string,pattern:string){
  const escaped=slash(pattern).replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*\*/g,'\u0000').replace(/\*/g,'[^/]*').replace(/\u0000/g,'.*')
  return new RegExp(`^${escaped}$`,'i').test(slash(path))
}

export function issuesFor(note:NoteEntity,item?:GovernanceItem,candidates=0,titleCount=1,now=Date.now()):GovernanceIssue[]{
  const issues:GovernanceIssue[]=[]
  if(!note.organizationStatus||['inbox','pending','in_progress'].includes(note.organizationStatus))issues.push('pending')
  if((!item?.role||item.role==='unclassified')&&!hasContentClassification(note))issues.push('unclassified')
  if(!note.areaUid)issues.push('missing_area')
  if(!note.projectUid)issues.push('missing_project')
  if(!note.folderId&&!note.folderUid)issues.push('missing_folder')
  if(!(note.tagIds?.length||note.tagUids?.length))issues.push('missing_tags')
  if(candidates)issues.push('task_candidates')
  if(titleCount>1)issues.push('duplicate_title')
  if(note.updatedAt&&now-new Date(note.updatedAt).getTime()>180*86400000)issues.push('stale')
  return issues.filter(value=>!item?.ignoredIssues.includes(value))
}

export type GovernanceStoreName='items'|'candidates'|'sourceNodes'|'rules'|'batches'
export interface GovernanceTransactionStore {get(key:string):Promise<unknown>;put(value:unknown):Promise<unknown>}
export interface GovernanceStorage {
 get(store:GovernanceStoreName,key:string):Promise<unknown>
 put(store:GovernanceStoreName,value:unknown):Promise<unknown>
 getAll(store:GovernanceStoreName):Promise<unknown[]>
 getAllFromIndex(store:GovernanceStoreName,index:string,key:string):Promise<unknown[]>
 delete(store:GovernanceStoreName,key:string):Promise<unknown>
 transaction<T>(store:GovernanceStoreName,action:(store:GovernanceTransactionStore)=>Promise<T>):Promise<T>
}
function browserGovernanceStorage(ownerId:string):Promise<GovernanceStorage>{
 return openDB(`note-flow-governance-${ownerId||'anonymous'}`,1,{upgrade(db){
    if(!db.objectStoreNames.contains('items'))db.createObjectStore('items',{keyPath:'noteUid'})
    if(!db.objectStoreNames.contains('candidates')){const store=db.createObjectStore('candidates',{keyPath:'uid'});store.createIndex('by-note','noteUid')}
    if(!db.objectStoreNames.contains('sourceNodes'))db.createObjectStore('sourceNodes',{keyPath:'path'})
    if(!db.objectStoreNames.contains('rules'))db.createObjectStore('rules',{keyPath:'uid'})
    if(!db.objectStoreNames.contains('batches'))db.createObjectStore('batches',{keyPath:'uid'})
  }}).then(db=>({
   get:(store,key)=>db.get(store,key),put:(store,value)=>db.put(store,value),getAll:store=>db.getAll(store),getAllFromIndex:(store,index,key)=>db.getAllFromIndex(store,index,key),delete:(store,key)=>db.delete(store,key),
   async transaction(store,action){const tx=db.transaction(store,'readwrite');try{const result=await action({get:key=>tx.store.get(key),put:value=>tx.store.put(value)});await tx.done;return result}catch(error){try{tx.abort()}catch{/* Already aborted or completed. */}await tx.done.catch(()=>undefined);throw error}}
  }))
}
export function createBrowserGovernanceService(ownerId:string,storage?:()=>Promise<GovernanceStorage>){
  const database=storage||(()=>browserGovernanceStorage(ownerId))
  async function refreshCandidates(note:NoteEntity){
    const db=await database(),now=new Date().toISOString(),found=extractTaskCandidates(note.content||''),existing=await db.getAllFromIndex('candidates','by-note',note.uid) as TaskCandidate[]
    const byFingerprint=new Map(existing.map(value=>[value.fingerprint,value])),foundFingerprints=new Set(found.map(value=>value.fingerprint))
    await db.transaction('candidates',async store=>{
    for(const item of found){const current=byFingerprint.get(item.fingerprint);await store.put({...current,uid:current?.uid||uuid(),noteUid:note.uid,fingerprint:item.fingerprint,lineIndex:item.lineIndex,title:item.title,completed:item.completed,state:current?.state||'pending',sourceText:item.sourceText,updatedAt:now})}
    for(const current of existing)if(current.state==='pending'&&!foundFingerprints.has(current.fingerprint))await store.put({...current,state:'ignored',updatedAt:now})
    })
  }
  async function register(note:NoteEntity,source?:{sourceType?:string;sourceRoot?:string;sourcePath?:string;importBatchUid?:string;role?:GovernanceRole}){
    const db=await database(),current=await db.get('items',note.uid) as GovernanceItem|undefined,sourcePath=source?.sourcePath||String((note as any).obsidianSourcePath||''),sourceRoot=source?.sourceRoot||slash(sourcePath).split('/')[0]||undefined
    await db.put('items',{noteUid:note.uid,role:resolvedRole(note,current?.role,source?.role),sourceType:source?.sourceType||current?.sourceType||note.captureSource||undefined,sourceRoot:sourceRoot||current?.sourceRoot,sourcePath:sourcePath||current?.sourcePath,sourceDir:sourcePath?dirOf(sourcePath):current?.sourceDir,importBatchUid:source?.importBatchUid||current?.importBatchUid||String((note as any).obsidianImportBatchUid||'')||undefined,ignoredIssues:current?.ignoredIssues||[],updatedAt:new Date().toISOString()} satisfies GovernanceItem)
    await refreshCandidates(note)
  }
  async function backfill(notes:NoteEntity[]){for(const note of notes)await register(note,{sourceType:note.captureSource||undefined,sourcePath:String((note as any).obsidianSourcePath||'')||undefined,importBatchUid:String((note as any).obsidianImportBatchUid||'')||undefined})}
  async function items(){return await(await database()).getAll('items') as GovernanceItem[]}
  async function candidates(noteUid?:string){const db=await database(),values=(noteUid?await db.getAllFromIndex('candidates','by-note',noteUid):await db.getAll('candidates')) as TaskCandidate[];return values.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))}
  async function setCandidate(uid:string,state:TaskCandidate['state'],taskUid?:string){const db=await database(),current=await db.get('candidates',uid) as TaskCandidate|undefined;if(current)await db.put('candidates',{...current,state,taskUid,updatedAt:new Date().toISOString()})}
  async function setRole(noteUids:string[],role:GovernanceRole){const db=await database(),now=new Date().toISOString();await db.transaction('items',async store=>{for(const uid of noteUids){const current=await store.get(uid) as GovernanceItem|undefined;if(current)await store.put({...current,role,updatedAt:now})}})}
  async function sourceNodes(){const values=await(await database()).getAll('sourceNodes') as GovernanceSourceNode[];return values.sort((a,b)=>a.path.localeCompare(b.path,'zh-CN'))}
  async function saveSourceNode(value:Omit<GovernanceSourceNode,'updatedAt'>){const node={...value,updatedAt:new Date().toISOString()};await(await database()).put('sourceNodes',node);return node}
  async function ignoreIssue(noteUid:string,issue:GovernanceIssue){const db=await database(),current=await db.get('items',noteUid) as GovernanceItem|undefined;if(current)await db.put('items',{...current,ignoredIssues:[...new Set([...(current.ignoredIssues||[]),issue])],updatedAt:new Date().toISOString()})}
  async function rules(){const values=await(await database()).getAll('rules') as GovernanceRule[];return values.sort((a,b)=>b.priority-a.priority||a.createdAt.localeCompare(b.createdAt))}
  async function saveRule(value:Partial<GovernanceRule>&Pick<GovernanceRule,'name'|'pathPattern'|'actions'>){const now=new Date().toISOString(),rule:GovernanceRule={uid:value.uid||uuid(),name:value.name,enabled:value.enabled!==false,priority:value.priority||0,sourceRoot:value.sourceRoot,pathPattern:value.pathPattern,actions:value.actions,autoRun:Boolean(value.autoRun),createdAt:value.createdAt||now,updatedAt:now};await(await database()).put('rules',rule);return rule}
  async function removeRule(uid:string){await(await database()).delete('rules',uid)}
  async function batches(){const values=await(await database()).getAll('batches') as GovernanceBatch[];return values.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,30)}
  async function recordBatch(label:string,changes:GovernanceBatch['changes']){const value:GovernanceBatch={uid:uuid(),label,changes,createdAt:new Date().toISOString()};await(await database()).put('batches',value);return value}
  async function markUndone(uid:string){const db=await database(),current=await db.get('batches',uid) as GovernanceBatch|undefined;if(current)await db.put('batches',{...current,undoneAt:new Date().toISOString()})}
  return{register,refreshCandidates,backfill,items,candidates,setCandidate,setRole,sourceNodes,saveSourceNode,ignoreIssue,rules,saveRule,removeRule,batches,recordBatch,markUndone}
}

