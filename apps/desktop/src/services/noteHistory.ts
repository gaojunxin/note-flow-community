import {reviewRepository,reviewBinding,type ReviewRow} from './reviewRepository'
import {openDB,type DBSchema,type IDBPObjectStore} from 'idb'
import {isRegularNote,type NoteEntity} from '@note-flow/core'

export interface NoteRevision {id:string;scope:string;noteUid:string;createdAt:string;title:string;content:string;summary:string|null;sourceVersion:number|null;reason:'edit'|'delete'|'restore'|'remote'}
export interface RevisionStorage {list(scope:string,uid:string):Promise<NoteRevision[]>;append(value:NoteRevision,limit:number):Promise<void>;clear(scope:string,uid:string):Promise<void>}
interface HistoryDatabase extends DBSchema {revisions:{key:string;value:NoteRevision;indexes:{note:[string,string]}}}
const database=()=>openDB<HistoryDatabase>('note-flow-note-history',1,{upgrade(db){db.createObjectStore('revisions',{keyPath:'id'}).createIndex('note',['scope','noteUid'])}})
const scopeRange=(scope:string)=>IDBKeyRange.bound([scope],[scope,[]])
type HistoryStore=IDBPObjectStore<HistoryDatabase,['revisions'],'revisions','readwrite'>
/** Web同样使用真实事务；包括守卫失败在内的任何异常均回滚，不能留下部分追加/删除。 */
async function writeHistory(check:()=>void,action:(store:HistoryStore)=>Promise<void>){
 const db=await database()
 try{check();const tx=db.transaction('revisions','readwrite')
  try{await action(tx.store);check();await tx.done;check()}catch(error){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw error}
 }finally{db.close()}
}
async function historySnapshot(scope:string):Promise<NoteRevision[]>{
 const db=await database()
 try{const tx=db.transaction('revisions','readonly'),[total,indexed,rows]=await Promise.all([tx.store.count(),tx.store.index('note').count(),tx.store.index('note').getAll(scopeRange(scope))]);await tx.done
  // 缺失noteUid的旧行不会进入复合索引；只比较数量即可发现缺口，不读取其他账号正文。
  if(total!==indexed)throw Error('笔记历史索引不完整，原始数据已保留')
  return rows
 }finally{db.close()}
}
async function historyRepository(scope:string,staged=false){
 const binding=reviewBinding(scope,staged)
 return reviewRepository('history',scope,async()=>(await historySnapshot(scope)).map(value=>({uid:value.id,value:JSON.stringify(value)})),rows=>validateNoteHistoryArchive({schema:'note-flow-note-history/1',scope,revisions:rows.map(row=>JSON.parse(row.value))},scope),binding)
}
export const revisionStorage:RevisionStorage={
 async list(scope,uid){
  const port=await historyRepository(scope);let revisions:NoteRevision[]
  if(port.native){const rows=await port.invoke<ReviewRow[]>('list',{group:uid});revisions=rows.map(row=>{const value=JSON.parse(row.value);if(value.id!==row.uid)throw Error('笔记历史身份损坏');return value})}
  else{const db=await database();try{revisions=await db.getAllFromIndex('revisions','note',[scope,uid])}finally{db.close()}}
  port.check();validateNoteHistoryArchive({schema:'note-flow-note-history/1',scope,revisions},scope);if(revisions.some(row=>row.noteUid!==uid))throw Error('笔记历史不属于当前笔记');return revisions
 },
 async append(source,limit){
  let value:NoteRevision=JSON.parse(JSON.stringify(source));if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('历史保留数量无效')
  validateNoteHistoryArchive({schema:'note-flow-note-history/1',scope:value.scope,revisions:[value]},value.scope)
  const port=await historyRepository(value.scope)
  if(port.native){await port.invoke('append',{rows:[{uid:value.id,value:JSON.stringify(value)}],limit});return}
  await writeHistory(port.check,async store=>{
   const existing=await store.get(value.id);if(existing){if(existing.scope!==value.scope||existing.noteUid!==value.noteUid||!sameRevision(existing,value))throw Error('历史版本标识冲突');return}
   const rows=await store.index('note').getAll([value.scope,value.noteUid]),latest=rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]
   if(latest&&sameRevision(latest,value))return
   if(latest&&value.createdAt<=latest.createdAt)value={...value,createdAt:new Date(Date.parse(latest.createdAt)+1).toISOString()}
   port.check();await store.add(value)
   const kept=[...rows,value].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));for(const row of kept.slice(limit)){port.check();await store.delete(row.id)}
  })
 },
 async clear(scope,uid){
  const port=await historyRepository(scope);if(port.native){await port.invoke('clear',{group:uid});return}
  await writeHistory(port.check,async store=>{for(const key of await store.index('note').getAllKeys([scope,uid])){port.check();await store.delete(key)}})
 },
}
const sameRevision=(a:Pick<NoteRevision,'title'|'content'|'summary'>,b:Pick<NoteRevision,'title'|'content'|'summary'>)=>a.title===b.title&&a.content===b.content&&a.summary===b.summary
const fields=(note:NoteEntity)=>({title:note.title||'',content:note.content||'',summary:note.summary??null})
/** 绑定当前账号/世代的历史入口；恢复回调仍须负责笔记领域的并发校验，历史提交不代表云端确认。 */
export function createNoteHistory(scope:string,storage:RevisionStorage=revisionStorage,now=()=>new Date().toISOString()){
 const binding=reviewBinding(scope)
 return {
  async list(uid:string){binding.check();const rows=await storage.list(scope,uid);binding.check();return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))},
  async capture(note:NoteEntity,reason:NoteRevision['reason']='edit'){
   binding.check()
   if(!isRegularNote(note))return
   await storage.append({id:Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join(''),scope,noteUid:note.uid,createdAt:now(),...fields(note),sourceVersion:note.version??null,reason},50);binding.check()
  },
  async beforeChange(before:NoteEntity|undefined,after:NoteEntity,reason:NoteRevision['reason']='edit'){
   if(before&&(!sameRevision(fields(before),fields(after))||before.deleted!==after.deleted))await this.capture(before,reason)
  },
  async restore(current:NoteEntity,revisionId:string,expected:string,update:(note:NoteEntity)=>Promise<NoteEntity>){
   binding.check()
   if(historyStamp(current)!==expected||current.deleted)throw Error('笔记已变化，请重新打开历史版本')
   const revision=(await storage.list(scope,current.uid)).find(row=>row.id===revisionId)
   if(!revision)throw Error('历史版本已不存在，请刷新列表')
   await this.capture(current,'restore')
   binding.check();const saved=await update({...current,title:revision.title,content:revision.content,summary:revision.summary});binding.check();return saved
  },
  async clear(uid:string){binding.check();await storage.clear(scope,uid);binding.check()}
 }
}
export const historyStamp=(note:NoteEntity)=>JSON.stringify([note.uid,note.title,note.content,note.summary,note.version,note.updatedAt,note.deleted,note.syncStatus])


export async function clearNoteHistoryScope(scope:string){
 const port=await historyRepository(scope);if(port.native){await port.invoke('clear');return}
 await writeHistory(port.check,async store=>{for(const key of await store.index('note').getAllKeys(scopeRange(scope))){port.check();await store.delete(key)}})
}

export interface NoteHistoryArchive {schema:'note-flow-note-history/1';scope:string;revisions:NoteRevision[]}
export async function exportNoteHistoryScope(scope:string):Promise<NoteHistoryArchive>{const port=await historyRepository(scope);if(port.native){const rows=await port.invoke<ReviewRow[]>('list'),archive:NoteHistoryArchive={schema:'note-flow-note-history/1',scope,revisions:rows.map(row=>JSON.parse(row.value))};validateNoteHistoryArchive(archive,scope);return archive}const revisions=await historySnapshot(scope);port.check();const archive:NoteHistoryArchive={schema:'note-flow-note-history/1',scope,revisions};validateNoteHistoryArchive(archive,scope);return archive}
export function validateNoteHistoryArchive(value:unknown,scope:string):asserts value is NoteHistoryArchive{
 const archive=value as NoteHistoryArchive
 if(!archive||archive.schema!=='note-flow-note-history/1'||archive.scope!==scope||!Array.isArray(archive.revisions)||archive.revisions.some(row=>!row||row.scope!==scope||typeof row.id!=='string'||!row.id||typeof row.noteUid!=='string'||!row.noteUid||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt))||typeof row.title!=='string'||typeof row.content!=='string'||row.summary!==null&&typeof row.summary!=='string'||!['edit','delete','restore','remote'].includes(row.reason)))throw Error('笔记历史备份格式无效或属于其他空间')
 if(new Set(archive.revisions.map(row=>row.id)).size!==archive.revisions.length)throw Error('笔记历史备份标识重复')
}

export async function importNoteHistoryScope(source:unknown,scope:string,staged=false){
 validateNoteHistoryArchive(source,scope);const value:NoteHistoryArchive=JSON.parse(JSON.stringify(source)),port=await historyRepository(scope,staged)
 if(port.native){await port.invoke('restore',{fresh:staged,rows:value.revisions.map(row=>({uid:row.id,value:JSON.stringify(row)}))});return}
 await writeHistory(port.check,async store=>{
  if(staged&&(await store.index('note').getAllKeys(scopeRange(scope))).length)throw Error('历史恢复目标不是空空间')
  const notes=new Set<string>()
  for(const row of value.revisions){const existing=await store.get(row.id);if(existing&&(existing.scope!==scope||existing.noteUid!==row.noteUid))throw Error('历史版本标识冲突，已取消恢复');port.check();if(!existing)await store.add(row);notes.add(row.noteUid)}
  for(const uid of notes){const rows=await store.index('note').getAll([scope,uid]);rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));for(const row of rows.slice(50)){port.check();await store.delete(row.id)}}
 })
}
