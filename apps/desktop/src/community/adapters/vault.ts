import {applyVaultBulkPatch, type VaultBulkChange} from '../../services/vaultBulkEditing'
import {vaultSessionRevision} from '../../services/vaultSession'
import {toRaw} from 'vue'
import {VAULT_SCHEMA,VAULT_VERSION,VAULT_ITERATIONS,deriveVaultKey,encryptVaultValue,decryptVaultValue,unlockVaultBackup,decryptVaultItems,bytesToBase64,base64ToBytes,normalizeVaultItem,normalizeVaultUrls} from '@note-flow/core/vault'
import type {VaultBackup,VaultItem} from '@note-flow/core/vault'
import type {LocalWorkspaceSnapshot} from '@note-flow/core/contracts'
import {createLocalEntityRepository,decodePortableValue} from '@note-flow/core/community'
import {getCommunityWorkspace} from '../runtime'
import {COMMUNITY_PROFILE_KEY} from '../workspace'
export type {VaultBackup,VaultItem} from '@note-flow/core/vault'
export {normalizeVaultUrls}
export interface VaultAttachment {uid:string;itemUid:string;name:string;mediaType:string;size:number;createdAt:string}
interface AttachmentPayload extends VaultAttachment {base64:string}
interface VaultEntity {uid:string;backup?:VaultBackup;cleared?:boolean}
function validate(backup:VaultBackup){
 if(backup?.schema!==VAULT_SCHEMA||backup.version!==VAULT_VERSION||typeof backup.ownerId!=='string'||!backup.ownerId||backup.meta?.ownerId!==backup.ownerId||!Array.isArray(backup.items)||!Array.isArray(backup.attachments||[]))throw Error('保险箱备份结构无效')
 const valid=(text:unknown,size:number,exact=false)=>{try{const length=base64ToBytes(String(text)).length;return exact?length===size:length>=size}catch{return false}}
 if(!Number.isSafeInteger(backup.meta.iterations)||backup.meta.iterations<1||backup.meta.iterations>VAULT_ITERATIONS||!valid(backup.meta.salt,16,true)||!valid(backup.meta.verifierIv,12,true)||!valid(backup.meta.verifier,16))throw Error('保险箱密钥参数或密文无效')
 const ids=new Set<string>(),attachments=new Set<string>()
 for(const item of backup.items){if(!item.uid||ids.has(item.uid)||item.ownerId!==backup.ownerId||item.key!==`${backup.ownerId}:${item.uid}`||!valid(item.iv,12,true)||!valid(item.ciphertext,16))throw Error('保险箱条目归属或密文无效');ids.add(item.uid)}
 for(const item of backup.attachments||[]){if(!item.uid||attachments.has(item.uid)||item.ownerId!==backup.ownerId||item.key!==`${backup.ownerId}:${item.uid}`||!item.itemKey.startsWith(`${backup.ownerId}:`)||!ids.has(item.itemKey.slice(backup.ownerId.length+1))||!valid(item.iv,12,true)||!valid(item.ciphertext,16))throw Error('保险箱附件归属或密文无效');attachments.add(item.uid)}
 return backup
}
export function validateCommunityVaultBackup(source:unknown):VaultBackup{return validate(source as VaultBackup)}
export function validateCommunityVaultSnapshot(snapshot:LocalWorkspaceSnapshot){
 if(!Array.isArray(snapshot?.entities))throw Error('保险箱所在空间备份格式无效')
 for(const row of snapshot.entities){
  if(row.deleted)continue
  if(row.entityType==='vault'&&row.entityUid==='vault'&&row.value?.cleared!==true)validateCommunityVaultBackup(row.value?.backup)
  if(row.entityType==='vault_backup'&&row.value?.backup!==undefined)validateCommunityVaultBackup(row.value.backup)
 }
}
async function assertProfile(ownerId:string){const w=await getCommunityWorkspace();if(ownerId!==w.context.profileId)throw Error('本地空间已切换，请重新打开保险箱');return w}
async function binding(ownerId:string){
 const revision=vaultSessionRevision(),workspace=await assertProfile(ownerId)
 const assertCurrent=()=>{if(revision!==vaultSessionRevision())throw Error('保险箱已锁定或会话变化，请重新解锁');if(localStorage.getItem(COMMUNITY_PROFILE_KEY)!==ownerId)throw Error('本地空间已切换，请重新打开保险箱')}
 assertCurrent();return{workspace,assertCurrent}
}
async function load(ownerId:string){
 const bound=await binding(ownerId),{workspace,assertCurrent}=bound
 const row=await createLocalEntityRepository(workspace.host,workspace.context,'vault').get('vault',true);assertCurrent()
 if(row){if(row.deleted||row.entity.cleared)return{...bound,row,backup:undefined};return{...bound,row,backup:validate(row.entity.backup as VaultBackup)}}
 async function list(type:string){const repository=createLocalEntityRepository(workspace.host,workspace.context,type),items:Record<string,unknown>[]=[];let afterKey:string|undefined
  do{assertCurrent();const page=await repository.list({limit:200,afterKey});assertCurrent();items.push(...page.items.map(value=>value.entity));afterKey=page.hasMore?page.nextKey:undefined}while(afterKey)
  return items
 }
 const retained=(await list('vault_backup')).map(v=>v.backup).filter((v):v is VaultBackup=>Boolean(v))
 const transfers=await list('edition_transfer')
 for(const entry of transfers){const transfer=entry.transfer as {preserved:Parameters<typeof decodePortableValue>[0]};const envelope=decodePortableValue(transfer.preserved) as {vault?:VaultBackup|null};if(envelope?.vault)retained.push(envelope.vault)}
 const unique=new Map<string,VaultBackup>();for(const backup of retained){validate(backup);unique.set(JSON.stringify({ownerId:backup.ownerId,meta:backup.meta,items:backup.items,attachments:backup.attachments||[]}),backup)}
 if(unique.size>1)throw Error('空间包含多个不同的原保险箱备份，请先导出完整空间并明确选择要恢复的加密备份')
 assertCurrent();return{...bound,row:undefined,backup:unique.values().next().value as VaultBackup|undefined}
}
async function write(ownerId:string,loaded:Awaited<ReturnType<typeof load>>,backup?:VaultBackup){
 loaded.assertCurrent();const current=await assertProfile(ownerId);loaded.assertCurrent()
 if(current!==loaded.workspace)throw Error('本地空间已重新加载，请重新打开保险箱')
 const {workspace}=loaded,now=new Date().toISOString(),value:VaultEntity={uid:'vault',cleared:!backup,...(backup?{backup:structuredClone(backup)}:{cleared:true})}
 const guardedHost:typeof workspace.host={...workspace.host,async transaction(context,work){return workspace.host.transaction(context,async tx=>{loaded.assertCurrent();const result=await work(tx);loaded.assertCurrent();return result})}}
 const repository=createLocalEntityRepository(guardedHost,workspace.context,'vault')
 if(loaded.row)await repository.update({...loaded.row.entity,...value,version:Number(loaded.row.entity.version||0)+1,updatedAt:now},loaded.row.revision)
 else await repository.create({...value,id:Date.now()*1000,userId:ownerId,version:0,createdAt:now,updatedAt:now,deleted:false})
 loaded.assertCurrent()
}
async function required(ownerId:string,key?:CryptoKey){const loaded=await load(ownerId);loaded.assertCurrent();if(!loaded.backup)throw Error('保险箱尚未创建');if(key){const b=loaded.backup;const verifier=await decryptVaultValue<{marker:string}>(toRaw(key),b.meta.verifierIv,b.meta.verifier,`${b.ownerId}:meta`);loaded.assertCurrent();if(verifier.marker!=='jiyu-vault-verifier-v1')throw Error('保险箱已变化，请重新解锁')}loaded.assertCurrent();return loaded as typeof loaded&{backup:VaultBackup}}
export async function hasVault(ownerId:string){const loaded=await load(ownerId);loaded.assertCurrent();return Boolean(loaded.backup)}
export async function createVault(ownerId:string,password:string){if(password.length<12)throw Error('主密码至少需要 12 个字符');const loaded=await load(ownerId);if(loaded.backup)throw Error('保险箱已经存在');const salt=crypto.getRandomValues(new Uint8Array(16)),key=await deriveVaultKey(password,salt),aadOwner=`community:${ownerId}`,verifier=await encryptVaultValue(key,{marker:'jiyu-vault-verifier-v1'},`${aadOwner}:meta`),backup:VaultBackup={schema:VAULT_SCHEMA,version:VAULT_VERSION,ownerId:aadOwner,exportedAt:new Date().toISOString(),meta:{ownerId:aadOwner,salt:bytesToBase64(salt),verifierIv:verifier.iv,verifier:verifier.ciphertext,iterations:VAULT_ITERATIONS},items:[],attachments:[]};await write(ownerId,loaded,backup);loaded.assertCurrent();return key}
export async function unlockVault(ownerId:string,password:string){const loaded=await required(ownerId),key=await unlockVaultBackup(loaded.backup,loaded.backup.ownerId,password);loaded.assertCurrent();return key}
export async function listVaultItems(ownerId:string,key:CryptoKey){const loaded=await required(ownerId,key),backup=loaded.backup,items=await decryptVaultItems(backup,backup.ownerId,toRaw(key));loaded.assertCurrent();return items.map(item=>{const urls=normalizeVaultUrls(item.urls,item.url);return{...item,urls,url:urls[0]?.url||''}})}
export async function saveVaultItem(ownerId:string,key:CryptoKey,input:Partial<VaultItem>&Pick<VaultItem,'title'|'password'>){const loaded=await required(ownerId,key),backup=loaded.backup,prior=input.uid?backup.items.find(v=>v.uid===input.uid):undefined,old=prior?await decryptVaultValue<VaultItem>(toRaw(key),prior.iv,prior.ciphertext,`${backup.ownerId}:${prior.uid}`):undefined,item=normalizeVaultItem({...old,...toRaw(input)}),sealed=await encryptVaultValue(toRaw(key),item,`${backup.ownerId}:${item.uid}`);await write(ownerId,loaded,{...backup,items:[...backup.items.filter(v=>v.uid!==item.uid),{...prior,key:`${backup.ownerId}:${item.uid}`,ownerId:backup.ownerId,uid:item.uid,...sealed,updatedAt:item.updatedAt}]});loaded.assertCurrent();return item}
/** 社区版以整份加密保险箱的仓储版本提交，冲突时整批拒绝。 */
export async function saveVaultMetadataBatch(ownerId:string,key:CryptoKey,changes:VaultBulkChange[],assertCurrent:()=>void=()=>{}) {
 const loaded=await required(ownerId,key),backup=loaded.backup
 if(new Set(changes.map(change=>change.uid)).size!==changes.length)throw Error('批量记录重复')
 const entries=await Promise.all(changes.map(async change=>{
  const record=backup.items.find(item=>item.uid===change.uid)
  if(!record||record.updatedAt!==change.expectedUpdatedAt)throw Error('记录已变化，请重新打开批量编辑')
  const original=await decryptVaultValue<VaultItem>(toRaw(key),record.iv,record.ciphertext,`${backup.ownerId}:${record.uid}`)
  const item=applyVaultBulkPatch(original,change.patch)
  return {item,record:{...record,...await encryptVaultValue(toRaw(key),item,`${backup.ownerId}:${record.uid}`),updatedAt:item.updatedAt}}
 }))
 assertCurrent();loaded.assertCurrent()
 const replacements=new Map(entries.map(entry=>[entry.item.uid,entry.record]))
 await write(ownerId,loaded,{...backup,items:backup.items.map(record=>replacements.get(record.uid)||record)})
 return entries.map(entry=>entry.item)
}
export async function deleteVaultItem(ownerId:string,uid:string){const loaded=await required(ownerId),b=loaded.backup;await write(ownerId,loaded,{...b,items:b.items.filter(v=>v.uid!==uid),attachments:(b.attachments||[]).filter(v=>v.itemKey!==`${b.ownerId}:${uid}`)})}
export async function clearVault(ownerId:string){await write(ownerId,await load(ownerId))}
export async function exportVault(ownerId:string):Promise<VaultBackup>{const loaded=await required(ownerId);loaded.assertCurrent();return structuredClone({...loaded.backup,exportedAt:new Date().toISOString()})}
export async function captureEditionVault(ownerId:string):Promise<VaultBackup|null>{return(await load(ownerId)).backup?exportVault(ownerId):null}
export async function importVault(ownerId:string,source:VaultBackup){const bound=await binding(ownerId),backup=structuredClone(toRaw(source));validate(backup);const row=await createLocalEntityRepository(bound.workspace.host,bound.workspace.context,'vault').get('vault',true);bound.assertCurrent();await write(ownerId,{...bound,row,backup:undefined},backup)}
export async function saveVaultAttachment(ownerId:string,itemUid:string,key:CryptoKey,file:File):Promise<VaultAttachment>{if(file.size>10*1024*1024)throw Error('单个保险箱附件不能超过 10 MB');const loaded=await required(ownerId,key),b=loaded.backup;if(!b.items.some(v=>v.uid===itemUid))throw Error('凭据不存在');const uid=crypto.randomUUID(),createdAt=new Date().toISOString(),payload:AttachmentPayload={uid,itemUid,name:file.name,mediaType:file.type||'application/octet-stream',size:file.size,createdAt,base64:bytesToBase64(new Uint8Array(await file.arrayBuffer()))},itemKey=`${b.ownerId}:${itemUid}`,sealed=await encryptVaultValue(toRaw(key),payload,`${itemKey}:attachment:${uid}`);await write(ownerId,loaded,{...b,attachments:[...(b.attachments||[]),{key:`${b.ownerId}:${uid}`,ownerId:b.ownerId,itemKey,uid,...sealed,updatedAt:createdAt}]});const{base64:_,...metadata}=payload;loaded.assertCurrent();return metadata}
export async function readVaultAttachment(ownerId:string,itemUid:string,uid:string,key:CryptoKey){const loaded=await required(ownerId,key),b=loaded.backup,record=(b.attachments||[]).find(v=>v.uid===uid&&v.itemKey===`${b.ownerId}:${itemUid}`);if(!record)throw Error('附件不存在');const payload=await decryptVaultValue<AttachmentPayload>(toRaw(key),record.iv,record.ciphertext,`${record.itemKey}:attachment:${uid}`);loaded.assertCurrent();if(payload.uid!==uid||payload.itemUid!==itemUid)throw Error('附件身份校验失败');const{base64,...metadata}=payload,bytes=base64ToBytes(base64);if(bytes.length!==payload.size)throw Error('附件大小校验失败');return{metadata,bytes}}
export async function listVaultAttachments(ownerId:string,itemUid:string,key:CryptoKey){const loaded=await required(ownerId,key),b=loaded.backup;loaded.assertCurrent();const files=await Promise.all((b.attachments||[]).filter(v=>v.itemKey===`${b.ownerId}:${itemUid}`).map(async v=>(await readVaultAttachment(ownerId,itemUid,v.uid,key)).metadata));loaded.assertCurrent();return files}
export async function deleteVaultAttachment(ownerId:string,itemUid:string,uid:string){const loaded=await required(ownerId),b=loaded.backup;await write(ownerId,loaded,{...b,attachments:(b.attachments||[]).filter(v=>v.uid!==uid||v.itemKey!==`${b.ownerId}:${itemUid}`)})}
export async function changeVaultMasterPassword(ownerId:string,current:string,next:string){if(next.length<12)throw Error('新主密码至少需要 12 个字符');const loaded=await required(ownerId),b=loaded.backup,old=await unlockVaultBackup(b,b.ownerId,current),salt=crypto.getRandomValues(new Uint8Array(16)),key=await deriveVaultKey(next,salt),verifier=await encryptVaultValue(key,{marker:'jiyu-vault-verifier-v1'},`${b.ownerId}:meta`);const items=await Promise.all(b.items.map(async record=>({...record,...await encryptVaultValue(key,await decryptVaultValue(old,record.iv,record.ciphertext,`${b.ownerId}:${record.uid}`),`${b.ownerId}:${record.uid}`)}))),attachments=await Promise.all((b.attachments||[]).map(async record=>({...record,...await encryptVaultValue(key,await decryptVaultValue(old,record.iv,record.ciphertext,`${record.itemKey}:attachment:${record.uid}`),`${record.itemKey}:attachment:${record.uid}`)})));await write(ownerId,loaded,{...b,meta:{...b.meta,salt:bytesToBase64(salt),iterations:VAULT_ITERATIONS,verifierIv:verifier.iv,verifier:verifier.ciphertext},items,attachments});loaded.assertCurrent();return key}
export const vaultCrypto={deriveKey:deriveVaultKey,encrypt:encryptVaultValue,decrypt:decryptVaultValue}
