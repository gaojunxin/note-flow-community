import {openDB} from 'idb'
import {isRegularNote,type NoteEntity} from '@note-flow/core'

export interface NoteRevision {id:string;scope:string;noteUid:string;createdAt:string;title:string;content:string;summary:string|null;sourceVersion:number|null;reason:'edit'|'delete'|'restore'|'remote'}
export interface RevisionStorage {list(scope:string,uid:string):Promise<NoteRevision[]>;append(value:NoteRevision,limit:number):Promise<void>;clear(scope:string,uid:string):Promise<void>}
const database=()=>openDB('note-flow-note-history',1,{upgrade(db){const store=db.createObjectStore('revisions',{keyPath:'id'});store.createIndex('note',['scope','noteUid'])}})
export const revisionStorage:RevisionStorage={
 async list(scope,uid){const db=await database();try{return await db.getAllFromIndex('revisions','note',[scope,uid])}finally{db.close()}},
 async append(value,limit){const db=await database();try{const tx=db.transaction('revisions','readwrite'),rows=await tx.store.index('note').getAll([value.scope,value.noteUid]);const latest=rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0] as NoteRevision|undefined;if(!latest||!sameRevision(latest,value)){if(latest&&value.createdAt<=latest.createdAt)value={...value,createdAt:new Date(Date.parse(latest.createdAt)+1).toISOString()};await tx.store.put(value);const kept=[...rows,value].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));for(const row of kept.slice(limit))await tx.store.delete(row.id)}await tx.done}finally{db.close()}},
 async clear(scope,uid){const db=await database();try{const tx=db.transaction('revisions','readwrite');for(const key of await tx.store.index('note').getAllKeys([scope,uid]))await tx.store.delete(key);await tx.done}finally{db.close()}}
}
const sameRevision=(a:Pick<NoteRevision,'title'|'content'|'summary'>,b:Pick<NoteRevision,'title'|'content'|'summary'>)=>a.title===b.title&&a.content===b.content&&a.summary===b.summary
const fields=(note:NoteEntity)=>({title:note.title||'',content:note.content||'',summary:note.summary??null})
export function createNoteHistory(scope:string,storage:RevisionStorage=revisionStorage,now=()=>new Date().toISOString()){
 return {
  async list(uid:string){return (await storage.list(scope,uid)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))},
  async capture(note:NoteEntity,reason:NoteRevision['reason']='edit'){
   if(!isRegularNote(note))return
   await storage.append({id:Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join(''),scope,noteUid:note.uid,createdAt:now(),...fields(note),sourceVersion:note.version??null,reason},50)
  },
  async beforeChange(before:NoteEntity|undefined,after:NoteEntity,reason:NoteRevision['reason']='edit'){
   if(before&&(!sameRevision(fields(before),fields(after))||before.deleted!==after.deleted))await this.capture(before,reason)
  },
  async restore(current:NoteEntity,revisionId:string,expected:string,update:(note:NoteEntity)=>Promise<NoteEntity>){
   if(historyStamp(current)!==expected||current.deleted)throw Error('笔记已变化，请重新打开历史版本')
   const revision=(await storage.list(scope,current.uid)).find(row=>row.id===revisionId)
   if(!revision)throw Error('历史版本已不存在，请刷新列表')
   await this.capture(current,'restore')
   return update({...current,title:revision.title,content:revision.content,summary:revision.summary})
  },
  clear:(uid:string)=>storage.clear(scope,uid)
 }
}
export const historyStamp=(note:NoteEntity)=>JSON.stringify([note.uid,note.title,note.content,note.summary,note.version,note.updatedAt,note.deleted,note.syncStatus])

export async function clearNoteHistoryScope(scope:string){const db=await database();try{const tx=db.transaction('revisions','readwrite');let cursor=await tx.store.index('note').openKeyCursor(IDBKeyRange.bound([scope],[scope,[]]));while(cursor){await tx.store.delete(cursor.primaryKey);cursor=await cursor.continue()}await tx.done}finally{db.close()}}

export interface NoteHistoryArchive {schema:'note-flow-note-history/1';scope:string;revisions:NoteRevision[]}
export async function exportNoteHistoryScope(scope:string):Promise<NoteHistoryArchive>{const db=await database();try{return{schema:'note-flow-note-history/1',scope,revisions:await db.getAllFromIndex('revisions','note',IDBKeyRange.bound([scope],[scope,[]]))}}finally{db.close()}}
export function validateNoteHistoryArchive(value:unknown,scope:string):asserts value is NoteHistoryArchive{
 const archive=value as NoteHistoryArchive
 if(!archive||archive.schema!=='note-flow-note-history/1'||archive.scope!==scope||!Array.isArray(archive.revisions)||archive.revisions.some(row=>!row||row.scope!==scope||typeof row.id!=='string'||!row.id||typeof row.noteUid!=='string'||!row.noteUid||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt))||typeof row.title!=='string'||typeof row.content!=='string'||row.summary!==null&&typeof row.summary!=='string'||!['edit','delete','restore','remote'].includes(row.reason)))throw Error('笔记历史备份格式无效或属于其他空间')
}
export async function importNoteHistoryScope(value:unknown,scope:string){
 validateNoteHistoryArchive(value,scope)
 const db=await database(),tx=db.transaction('revisions','readwrite')
 try{
  const notes=new Set<string>()
  for(const row of value.revisions){
   const existing=await tx.store.get(row.id)
   if(existing&&(existing.scope!==scope||existing.noteUid!==row.noteUid))throw Error('历史版本标识冲突，已取消恢复')
   if(!existing)await tx.store.put(row)
   notes.add(row.noteUid)
  }
  for(const uid of notes){const rows=await tx.store.index('note').getAll([scope,uid]);rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));for(const row of rows.slice(50))await tx.store.delete(row.id)}
  await tx.done
 }catch(error){try{tx.abort()}catch{/* The transaction may already have aborted. */}await tx.done.catch(()=>undefined);throw error}finally{db.close()}
}
