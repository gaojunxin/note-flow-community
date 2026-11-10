import {openDB} from 'idb'
import {encryptWorkspaceObject,decryptWorkspaceObject,type EncryptedWorkspaceObject} from './workspaceEncryption'
export interface AttachmentIndexSource {workspaceUid:string;attachmentUid:string;version:number;keyGeneration:number;sha256:string;extractorVersion:number}
interface StoredIndex {storageKey:string;revision:number;deleted?:true;encrypted?:EncryptedWorkspaceObject}
interface IndexText {schema:'attachment-text-index/1';sha256:string;extractorVersion:number;text:string}
function checkedSource(source:AttachmentIndexSource):AttachmentIndexSource{
 if(!source||typeof source.workspaceUid!=='string'||!source.workspaceUid||source.workspaceUid.length>128||typeof source.attachmentUid!=='string'||!source.attachmentUid||source.attachmentUid.length>96||!Number.isSafeInteger(source.version)||source.version<0||!Number.isSafeInteger(source.keyGeneration)||source.keyGeneration<1||!Number.isSafeInteger(source.extractorVersion)||source.extractorVersion<1||!/^[a-f0-9]{64}$/i.test(source.sha256))throw Error('附件索引来源无效')
 return{workspaceUid:source.workspaceUid,attachmentUid:source.attachmentUid,version:source.version,keyGeneration:source.keyGeneration,sha256:source.sha256.toLowerCase(),extractorVersion:source.extractorVersion}
}
function checkedRecord(source:StoredIndex|undefined,storageKey:string){
 if(source&&(!Number.isSafeInteger(source.revision)||source.revision<1||source.storageKey!==storageKey||(source.deleted===true?Boolean(source.encrypted):!source.encrypted)))throw Error('附件索引存储无效')
 return source
}
/** Disposable encrypted index. Keys and plaintext never enter IndexedDB.
 * generation must advance on account/workspace changes AND every lock/unlock. */
export function createAttachmentTextIndex(options:{scope():string;generation():number;locked():boolean;databaseName?:string}){
 const database=openDB(options.databaseName||'note-flow-encrypted-attachment-index',2,{upgrade(db,oldVersion){if(oldVersion<1)db.createObjectStore('documents',{keyPath:'storageKey'});if(oldVersion<2)db.createObjectStore('epochs')}})
 function captureScope(){
  const scope=options.scope(),generation=options.generation()
  if(!scope||scope.length>128)throw Error('附件索引作用域无效')
  const assert=()=>{if(options.locked()||scope!==options.scope()||generation!==options.generation())throw Error('账号、空间或锁定状态已变化，已停止索引操作')}
  assert();return{scope,assert}
 }
 function capture(source:AttachmentIndexSource){
  const ref=checkedSource(source),{scope,assert}=captureScope()
  const storageKey=JSON.stringify([scope,ref.workspaceUid,ref.attachmentUid]),identity={workspaceUid:ref.workspaceUid,kind:'attachment-index',uid:JSON.stringify([scope,ref.attachmentUid]),version:ref.version,keyGeneration:ref.keyGeneration}
  return{ref,storageKey,identity,assert,scope}
 }
 async function begin(source:AttachmentIndexSource){const binding=capture(source),db=await database;binding.assert();const epoch=await db.get('epochs',binding.scope)||0;binding.assert();return{...binding,epoch}}
 async function write(binding:Awaited<ReturnType<typeof begin>>,expectedRevision:number,encrypted?:EncryptedWorkspaceObject){
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('附件索引修订无效')
  const db=await database;binding.assert();const tx=db.transaction(['documents','epochs'],'readwrite')
  try{
   if((await tx.objectStore('epochs').get(binding.scope)||0)!==binding.epoch)throw Error('附件索引已重置，请重新操作')
   const current=checkedRecord(await tx.objectStore('documents').get(binding.storageKey),binding.storageKey);binding.assert()
   if((current?.revision||0)!==expectedRevision)throw Error('附件索引已更新，请重新读取')
   const revision=expectedRevision+1
   if(!Number.isSafeInteger(revision))throw Error('附件索引修订无效')
   await tx.objectStore('documents').put(encrypted?{storageKey:binding.storageKey,revision,encrypted}:{storageKey:binding.storageKey,revision,deleted:true})
   await tx.done;binding.assert();return revision
  }catch(error){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw error}
 }
 return{
  async read(source:AttachmentIndexSource,key:CryptoKey):Promise<{revision:number;text?:string;searchText?:string}>{
   const binding=await begin(source),db=await database;binding.assert()
   const record=checkedRecord(await db.get('documents',binding.storageKey),binding.storageKey);binding.assert()
   if(!record)return{revision:0}
   if(record.deleted)return{revision:record.revision}
   const identity=record.encrypted!.identity
   if(identity?.version!==binding.ref.version||identity?.keyGeneration!==binding.ref.keyGeneration)return{revision:record.revision}
   const value=await decryptWorkspaceObject<IndexText>(key,binding.identity,record.encrypted!);binding.assert()
   if(value?.schema!=='attachment-text-index/1'||typeof value.text!=='string'||value.text.length>2*1024*1024)throw Error('附件索引内容无效')
   const tx=db.transaction(['documents','epochs'],'readonly'),latest=checkedRecord(await tx.objectStore('documents').get(binding.storageKey),binding.storageKey),epoch=await tx.objectStore('epochs').get(binding.scope)||0;await tx.done;binding.assert()
   if(epoch!==binding.epoch)throw Error('附件索引已重置，请重新操作')
   if(latest?.revision!==record.revision)return{revision:latest?.revision||0}
   if(value.sha256!==binding.ref.sha256||value.extractorVersion!==binding.ref.extractorVersion)return{revision:record.revision}
   return{revision:record.revision,text:value.text,searchText:value.text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim()}
  },
  async revision(source:AttachmentIndexSource){const binding=await begin(source),db=await database;binding.assert();const record=checkedRecord(await db.get('documents',binding.storageKey),binding.storageKey);binding.assert();return record?.revision||0},
  async put(source:AttachmentIndexSource,key:CryptoKey,text:string,expectedRevision:number,expectedScopeEpoch?:number){
   const binding=await begin(source)
   if(expectedScopeEpoch!==undefined&&binding.epoch!==expectedScopeEpoch)throw Error('附件索引已重置，请重新操作')
   if(typeof text!=='string'||text.length>2*1024*1024)throw Error('附件索引文本过大或无效')
   const encrypted=await encryptWorkspaceObject(key,binding.identity,{schema:'attachment-text-index/1',sha256:binding.ref.sha256,extractorVersion:binding.ref.extractorVersion,text});binding.assert()
   return write(binding,expectedRevision,encrypted)
  },
  async remove(source:AttachmentIndexSource,expectedRevision:number){return write(await begin(source),expectedRevision)},
  async epoch(){const binding=captureScope(),db=await database;binding.assert();const epoch=await db.get('epochs',binding.scope)||0;binding.assert();return epoch as number},
  async clearScope(){
   const binding=captureScope(),db=await database;binding.assert()
   const tx=db.transaction(['documents','epochs'],'readwrite');let cleared=0
   try{
    const epoch=(await tx.objectStore('epochs').get(binding.scope)||0)+1
    if(!Number.isSafeInteger(epoch))throw Error('附件索引世代无效')
    await tx.objectStore('epochs').put(epoch,binding.scope)
    const prefix=JSON.stringify([binding.scope]).slice(0,-1)+','
    let cursor=await tx.objectStore('documents').openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'))
    while(cursor){binding.assert();const row=checkedRecord(cursor.value,cursor.primaryKey as string)!;if(!row.deleted){if(!Number.isSafeInteger(row.revision+1))throw Error('附件索引修订无效');await cursor.update({storageKey:row.storageKey,revision:row.revision+1,deleted:true});cleared++}cursor=await cursor.continue()}
    await tx.done;binding.assert();return{cleared}
   }catch(error){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw error}
  },
  async close(){(await database).close()}
 }
}
