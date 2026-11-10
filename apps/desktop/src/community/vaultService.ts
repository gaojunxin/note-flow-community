import {VAULT_SCHEMA,VAULT_VERSION,VAULT_ITERATIONS,bytesToBase64,base64ToBytes,deriveVaultKey,encryptVaultValue,decryptVaultValue,unlockVaultBackup,decryptVaultItems} from '@note-flow/core/vault'
import type {VaultBackup,VaultItem} from '@note-flow/core/vault'
import type {CoreContext,LocalReadHost,LocalTransactionHost} from '@note-flow/core/contracts'
import {createLocalEntityRepository} from '@note-flow/core/community'

export function createCommunityVault(host:LocalReadHost&LocalTransactionHost,context:CoreContext){
 let ownerId=`community:${context.profileId}`
 const repo=createLocalEntityRepository(host,context,'vault')
 let key:CryptoKey|undefined
 const required=()=>{if(!key)throw new Error('保险箱已锁定');return key}
 const load=async()=>{const row=await repo.get('vault');if(!row)return undefined;const backup=row.entity.backup as unknown as VaultBackup;ownerId=backup.ownerId;return {row,backup}}
 const save=async(backup:VaultBackup,revision?:string)=>{
  const entity={uid:'vault',backup};return revision?repo.update(entity,revision):repo.create(entity)
 }
 const unlocked=async()=>{const value=await load();if(!value)throw new Error('保险箱尚未创建');required();return value}
 const validate=async(backup:VaultBackup,password:string)=>{
  if(backup.meta?.iterations!==VAULT_ITERATIONS)throw new Error('备份密钥参数不兼容')
  const next=await unlockVaultBackup(backup,ownerId,password);const items=await decryptVaultItems(backup,ownerId,next)
  const ids=new Set(items.map(item=>item.uid))
  if(ids.size!==items.length||items.some((item,index)=>item.uid!==backup.items[index]?.uid))throw new Error('凭据标识无效')
  for(const record of backup.attachments||[]){
   if(record.ownerId!==ownerId||record.key!==`${ownerId}:${record.uid}`||!ids.has(record.itemKey.slice(ownerId.length+1))||!record.itemKey.startsWith(`${ownerId}:`))throw new Error('附件归属无效')
   await decryptVaultValue(next,record.iv,record.ciphertext,`${record.itemKey}:attachment:${record.uid}`)
  }
  return next
 }
 return {get ownerId(){return ownerId},lock(){key=undefined},async exists(){return Boolean(await load())},
  async create(password:string){if(password.length<12)throw new Error('主密码至少需要12个字符');if(await load())throw new Error('保险箱已存在');const salt=crypto.getRandomValues(new Uint8Array(16)),next=await deriveVaultKey(password,salt),verifier=await encryptVaultValue(next,{marker:'jiyu-vault-verifier-v1'},`${ownerId}:meta`);await save({schema:VAULT_SCHEMA,version:VAULT_VERSION,ownerId,exportedAt:new Date().toISOString(),meta:{ownerId,salt:bytesToBase64(salt),verifierIv:verifier.iv,verifier:verifier.ciphertext,iterations:VAULT_ITERATIONS},items:[],attachments:[]});key=next},
  async unlock(password:string){const value=await load();if(!value)throw new Error('保险箱尚未创建');key=await validate(value.backup,password)},
  async list(){const {backup}=await unlocked();return decryptVaultItems(backup,ownerId,required())},
  async put(input:Partial<VaultItem>&Pick<VaultItem,'title'|'password'>){const {row,backup}=await unlocked();const now=new Date().toISOString(),item={...input,uid:input.uid||crypto.randomUUID(),title:input.title.trim(),password:input.password,url:input.url||'',username:input.username||'',notes:input.notes||'',category:input.category||'登录账号',createdAt:input.createdAt||now,updatedAt:now} as VaultItem;if(!item.title||!(item.password||item.secretContent||item.totpSecret))throw new Error('名称与凭据不能为空');const sealed=await encryptVaultValue(required(),item,`${ownerId}:${item.uid}`);await save({...backup,items:[...backup.items.filter(value=>value.uid!==item.uid),{key:`${ownerId}:${item.uid}`,ownerId,uid:item.uid,...sealed,updatedAt:now}]},row.revision);return item},
  async remove(uid:string){const {row,backup}=await unlocked();await save({...backup,items:backup.items.filter(item=>item.uid!==uid),attachments:(backup.attachments||[]).filter(item=>item.itemKey!==`${ownerId}:${uid}`)},row.revision)},
  async attach(itemUid:string,file:File){if(file.size>10*1024*1024)throw new Error('附件不能超过10MB');const {row,backup}=await unlocked();if(!backup.items.some(item=>item.uid===itemUid))throw new Error('凭据不存在');const uid=crypto.randomUUID(),itemKey=`${ownerId}:${itemUid}`,now=new Date().toISOString(),payload={uid,itemUid,name:file.name,mediaType:file.type||'application/octet-stream',size:file.size,createdAt:now,base64:bytesToBase64(new Uint8Array(await file.arrayBuffer()))},sealed=await encryptVaultValue(required(),payload,`${itemKey}:attachment:${uid}`);await save({...backup,attachments:[...(backup.attachments||[]),{key:`${ownerId}:${uid}`,ownerId,itemKey,uid,...sealed,updatedAt:now}]},row.revision)},
  async attachments(itemUid:string){const {backup}=await unlocked();return Promise.all((backup.attachments||[]).filter(item=>item.itemKey===`${ownerId}:${itemUid}`).map(async item=>{const data=await decryptVaultValue<{uid:string;name:string;mediaType:string;base64:string}>(required(),item.iv,item.ciphertext,`${item.itemKey}:attachment:${item.uid}`);return {...data,bytes:base64ToBytes(data.base64)}}))},
  async removeAttachment(uid:string){const {row,backup}=await unlocked();await save({...backup,attachments:(backup.attachments||[]).filter(item=>item.uid!==uid)},row.revision)},
  async export(){const value=await load();if(!value)throw new Error('保险箱尚未创建');return {...value.backup,exportedAt:new Date().toISOString()}},
  async restore(backup:VaultBackup,password:string){const value=await load(),next=await validate(backup,password);await save(structuredClone(backup),value?.row.revision);key=next},
  async changePassword(current:string,nextPassword:string){if(nextPassword.length<12)throw new Error('新主密码至少需要12个字符');const {row,backup}=await unlocked(),old=await validate(backup,current),items=await decryptVaultItems(backup,ownerId,old),salt=crypto.getRandomValues(new Uint8Array(16)),next=await deriveVaultKey(nextPassword,salt),verifier=await encryptVaultValue(next,{marker:'jiyu-vault-verifier-v1'},`${ownerId}:meta`);const sealedItems=await Promise.all(items.map(async item=>({...backup.items.find(record=>record.uid===item.uid)!,...await encryptVaultValue(next,item,`${ownerId}:${item.uid}`)})));const attachments=await Promise.all((backup.attachments||[]).map(async item=>({...item,...await encryptVaultValue(next,await decryptVaultValue(old,item.iv,item.ciphertext,`${item.itemKey}:attachment:${item.uid}`),`${item.itemKey}:attachment:${item.uid}`)})));await save({...backup,meta:{ownerId,salt:bytesToBase64(salt),iterations:VAULT_ITERATIONS,verifierIv:verifier.iv,verifier:verifier.ciphertext},items:sealedItems,attachments},row.revision);key=next},
 }
}
