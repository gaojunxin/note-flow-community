import {base64ToBytes} from './vault'
import {openDB} from 'idb'
import {WORKSPACE_OBJECT_SCHEMA,validateWorkspaceKeyEnvelope,unlockWorkspaceKey,encryptWorkspaceObject,decryptWorkspaceObject,type WorkspaceKeyEnvelope,type EncryptedWorkspaceObject} from './workspaceEncryption'
export interface WorkspaceKeyRecord{storageKey:string;workspaceUid:string;revision:number;keyGeneration:number;operationUid:string;envelope:WorkspaceKeyEnvelope;proof:EncryptedWorkspaceObject}
const proofIdentity=(record:{workspaceUid:string;keyGeneration:number})=>({workspaceUid:record.workspaceUid,kind:'key-proof',uid:record.workspaceUid,version:0,keyGeneration:record.keyGeneration})
const operation=(uid:string)=>{if(typeof uid!=='string'||! /^[a-zA-Z0-9_-]{1,128}$/.test(uid))throw Error('密钥操作标识无效')}
export type WorkspaceKeyCredentials=(workspaceUid:string)=>Promise<{secret:string;kind?:'password'|'recovery'|'auto'}>
export interface WorkspaceKeyArchive{schema:'note-flow-workspace-key-archive/1';scope:string;records:WorkspaceKeyRecord[]}
function normalizedRecord(value:WorkspaceKeyRecord,scope:string):WorkspaceKeyRecord{
 if(!value||typeof value.workspaceUid!=='string'||value.storageKey!==JSON.stringify([scope,value.workspaceUid])||!Number.isSafeInteger(value.revision)||value.revision<1||!Number.isSafeInteger(value.keyGeneration)||value.keyGeneration<1)throw Error('密钥存储记录无效')
 operation(value.operationUid);const envelope=validateWorkspaceKeyEnvelope(value.envelope),expected=proofIdentity(value),proof=value.proof
 if(envelope.workspaceUid!==value.workspaceUid||proof?.schema!==WORKSPACE_OBJECT_SCHEMA||!proof.identity||Object.entries(expected).some(([field,item])=>proof.identity[field as keyof typeof expected]!==item)||typeof proof.iv!=='string'||proof.iv.length!==16||base64ToBytes(proof.iv).length!==12||typeof proof.ciphertext!=='string'||proof.ciphertext.length>8192||base64ToBytes(proof.ciphertext).length<16)throw Error('密钥证明格式无效')
 return{storageKey:value.storageKey,workspaceUid:value.workspaceUid,revision:value.revision,keyGeneration:value.keyGeneration,operationUid:value.operationUid,envelope,proof:{schema:WORKSPACE_OBJECT_SCHEMA,identity:expected,iv:proof.iv,ciphertext:proof.ciphertext}}
}
export function validateWorkspaceKeyArchive(source:unknown,scope:string):WorkspaceKeyArchive{
 const value=source as WorkspaceKeyArchive
 if(value?.schema!=='note-flow-workspace-key-archive/1'||value.scope!==scope||!Array.isArray(value.records)||value.records.length>1000)throw Error('密钥备份格式无效或账号空间不匹配')
 const records=value.records.map(row=>normalizedRecord(row,scope)),uids=new Set<string>()
 for(const row of records){if(uids.has(row.workspaceUid))throw Error('密钥备份包含重复空间');uids.add(row.workspaceUid)}
 return{schema:'note-flow-workspace-key-archive/1',scope,records}
}
/** Stores wrapped keys and an encrypted proof only; never persists a CryptoKey. */
export function createWorkspaceKeyStore(options:{scope():string;generation():number;databaseName?:string}){
 const database=openDB(options.databaseName||'note-flow-workspace-key-envelopes',1,{upgrade(db){db.createObjectStore('keys',{keyPath:'storageKey'})}})
 const capture=(workspaceUid:string)=>{const scope=options.scope(),generation=options.generation();if(!scope||!workspaceUid)throw Error('加密空间不可用');return{scope,key:JSON.stringify([scope,workspaceUid]),assert:()=>{if(scope!==options.scope()||generation!==options.generation())throw Error('账号或空间已切换，已停止密钥操作')}}}
 async function verify(record:Pick<WorkspaceKeyRecord,'workspaceUid'|'keyGeneration'|'proof'>,key:CryptoKey){const value=await decryptWorkspaceObject<{marker:string}>(key,proofIdentity(record),record.proof);if(value.marker!=='workspace-key-proof/1')throw Error('数据密钥与现有空间不匹配')}
 async function read(workspaceUid:string){const binding=capture(workspaceUid),db=await database;binding.assert();const value=await db.get('keys',binding.key) as WorkspaceKeyRecord|undefined;binding.assert();return value?normalizedRecord(value,binding.scope):undefined}
 async function atomic(workspaceUid:string,change:(value:WorkspaceKeyRecord|undefined,storageKey:string)=>WorkspaceKeyRecord|undefined){
  const binding=capture(workspaceUid),db=await database;binding.assert();const tx=db.transaction('keys','readwrite')
  try{const stored=await tx.store.get(binding.key) as WorkspaceKeyRecord|undefined;binding.assert();const previous=stored?normalizedRecord(stored,binding.scope):undefined,next=change(previous,binding.key);if(next)await tx.store.put(next);await tx.done;binding.assert();return next||previous}catch(error){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw error}
 }
 async function prepareArchiveRestore(source:unknown,credentials:WorkspaceKeyCredentials){
   const binding=capture('archive'),archive=validateWorkspaceKeyArchive(source,binding.scope),prepared:Array<{record:WorkspaceKeyRecord;existing:WorkspaceKeyRecord|undefined}>=[]
   for(const record of archive.records){
    binding.assert();const existing=await read(record.workspaceUid);binding.assert()
    if(existing&&existing.keyGeneration!==record.keyGeneration)throw Error('备份密钥世代与当前空间不同，不能直接合并')
    const credential=await credentials(record.workspaceUid);binding.assert();let key:CryptoKey
    const unlock=async(envelope:WorkspaceKeyEnvelope)=>{if(credential.kind!=='auto')return unlockWorkspaceKey(envelope,record.workspaceUid,credential.secret,credential.kind||'password');try{return await unlockWorkspaceKey(envelope,record.workspaceUid,credential.secret)}catch{binding.assert();return unlockWorkspaceKey(envelope,record.workspaceUid,credential.secret,'recovery')}}
    try{key=await unlock(record.envelope)}catch(error){binding.assert();if(!existing)throw error;key=await unlock(existing.envelope)}
    binding.assert();await verify(record,key);binding.assert()
    if(existing){await verify(existing,key);binding.assert()}
    prepared.push({record,existing})
   }
   let disposed=false
   const assertActive=()=>{binding.assert();if(disposed)throw Error('密钥恢复计划已释放，请重新验证备份')}
   return{dispose(){disposed=true;prepared.length=0},commit:async()=>{
   assertActive();const db=await database;assertActive();const tx=db.transaction('keys','readwrite');let imported=0,preserved=0
   try{
    for(const item of prepared){const stored=await tx.store.get(item.record.storageKey);assertActive();const current=stored?normalizedRecord(stored,binding.scope):undefined;if(!item.existing&&JSON.stringify(current)===JSON.stringify(item.record)){preserved++;continue}if(JSON.stringify(current)!==JSON.stringify(item.existing))throw Error('恢复期间密钥元数据已变化，请重新检查');if(current)preserved++;else{await tx.store.put(item.record);imported++}}
    assertActive();await tx.done;assertActive();return{imported,preserved}
   }catch(error){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw error}
   }}
  }
 return{
  read,
  async initialize(envelope:WorkspaceKeyEnvelope,password:string,recoveryCode:string,operationUid:string){
   operation(operationUid);const snapshot=validateWorkspaceKeyEnvelope(envelope),binding=capture(snapshot.workspaceUid),key=await unlockWorkspaceKey(snapshot,snapshot.workspaceUid,password),recoveryKey=await unlockWorkspaceKey(snapshot,snapshot.workspaceUid,recoveryCode,'recovery');binding.assert();const proof=await encryptWorkspaceObject(key,proofIdentity({workspaceUid:snapshot.workspaceUid,keyGeneration:1}),{marker:'workspace-key-proof/1'});await verify({workspaceUid:snapshot.workspaceUid,keyGeneration:1,proof},recoveryKey);binding.assert()
   const record=await atomic(snapshot.workspaceUid,(existing,storageKey)=>{if(existing){if(existing.operationUid===operationUid&&existing.revision===1&&JSON.stringify(existing.envelope)===JSON.stringify(snapshot))return;throw Error('空间已存在密钥，请重新读取当前状态')}return{storageKey,workspaceUid:snapshot.workspaceUid,revision:1,keyGeneration:1,operationUid,envelope:snapshot,proof}})
   await verify(record!,key);binding.assert();return record!
  },
  async verifyKey(workspaceUid:string,key:CryptoKey){const binding=capture(workspaceUid),record=await read(workspaceUid);if(!record)throw Error('空间密钥不存在');await verify(record,key);binding.assert();return record},
  async replace(envelope:WorkspaceKeyEnvelope,secret:string,expectedRevision:number,operationUid:string,kind:'password'|'recovery'='password'){
   operation(operationUid);if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw Error('密钥版本无效')
   const snapshot=validateWorkspaceKeyEnvelope(envelope),binding=capture(snapshot.workspaceUid),previous=await read(snapshot.workspaceUid);binding.assert();if(!previous)throw Error('空间密钥不存在')
   const key=await unlockWorkspaceKey(snapshot,snapshot.workspaceUid,secret,kind);binding.assert();await verify(previous,key);binding.assert()
   return atomic(snapshot.workspaceUid,current=>{
    if(current?.operationUid===operationUid&&current.revision===expectedRevision+1&&JSON.stringify(current.envelope)===JSON.stringify(snapshot))return
    if(current?.operationUid===operationUid)throw Error('操作标识已用于不同密钥更新')
    if(!current||current.revision!==expectedRevision||JSON.stringify(current.proof)!==JSON.stringify(previous.proof)||JSON.stringify(current.envelope)!==JSON.stringify(previous.envelope))throw Error('密钥元数据已更新，请重新读取后再操作')
    return{...current,revision:current.revision+1,operationUid,envelope:snapshot}
   })
  },
  async exportArchive():Promise<WorkspaceKeyArchive>{
   const binding=capture('archive'),db=await database;binding.assert()
   const prefix=JSON.stringify([binding.scope]).slice(0,-1)+',',rows=await db.getAll('keys',IDBKeyRange.bound(prefix,prefix+'\uffff'),1001) as WorkspaceKeyRecord[];binding.assert()
   return validateWorkspaceKeyArchive({schema:'note-flow-workspace-key-archive/1',scope:binding.scope,records:rows},binding.scope)
  },
  prepareArchiveRestore,
  async restoreArchive(source:unknown,credentials:WorkspaceKeyCredentials){const plan=await prepareArchiveRestore(source,credentials);try{return await plan.commit()}finally{plan.dispose()}},
  async close(){(await database).close()},
 }
}
