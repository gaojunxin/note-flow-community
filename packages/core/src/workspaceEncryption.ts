import {deriveVaultKey,encryptVaultValue,decryptVaultValue,bytesToBase64,base64ToBytes} from './vault'
export const WORKSPACE_KEY_ITERATIONS=600_000
export const WORKSPACE_ENCRYPTION_SCHEMA='note-flow-workspace-encryption/1' as const
interface WrappedKey{salt:string;iv:string;ciphertext:string}
export interface WorkspaceKeyEnvelope{schema:typeof WORKSPACE_ENCRYPTION_SCHEMA;workspaceUid:string;iterations:number;password:WrappedKey;recovery:WrappedKey}
const aad=(workspaceUid:string,kind:string)=>`${WORKSPACE_ENCRYPTION_SCHEMA}:${workspaceUid}:${kind}`
const requireCrypto=()=>{if(!globalThis.crypto?.subtle)throw Error('当前环境不支持知识库加密，请使用 HTTPS 或桌面应用');return crypto.subtle}
const importDataKey=(bytes:Uint8Array)=>requireCrypto().importKey('raw',bytes as Uint8Array<ArrayBuffer>,{name:'AES-GCM'},false,['encrypt','decrypt'])
async function wrap(workspaceUid:string,kind:string,secret:string,raw:Uint8Array):Promise<WrappedKey>{
 const salt=crypto.getRandomValues(new Uint8Array(16)),key=await deriveVaultKey(secret,salt,WORKSPACE_KEY_ITERATIONS)
 return{salt:bytesToBase64(salt),...await encryptVaultValue(key,{key:bytesToBase64(raw)},aad(workspaceUid,kind))}
}
/** 随机数据密钥分别由口令和恢复码封装；两者保护同一密钥，不各自生成一份业务密文。 */
export async function createWorkspaceKeyEnvelope(workspaceUid:string,password:string){
 requireCrypto();if(!workspaceUid||workspaceUid.length>128||password.length<12)throw Error('请输入有效空间标识和至少 12 字符的加密口令')
 const raw=crypto.getRandomValues(new Uint8Array(32)),recoveryCode=bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
 try{
  const envelope:WorkspaceKeyEnvelope={schema:WORKSPACE_ENCRYPTION_SCHEMA,workspaceUid,iterations:WORKSPACE_KEY_ITERATIONS,password:await wrap(workspaceUid,'password',password,raw),recovery:await wrap(workspaceUid,'recovery',recoveryCode,raw)}
  return{envelope,key:await importDataKey(raw),recoveryCode}
 }finally{raw.fill(0)}
}
async function openWorkspaceKeyBytes(envelope:WorkspaceKeyEnvelope,workspaceUid:string,secret:string,kind:'password'|'recovery'){
 requireCrypto()
 if(envelope?.schema!==WORKSPACE_ENCRYPTION_SCHEMA||envelope.workspaceUid!==workspaceUid||envelope.iterations!==WORKSPACE_KEY_ITERATIONS||!['password','recovery'].includes(kind))throw Error('知识库加密元数据无效或空间不匹配')
 const item={...envelope[kind]}
 let raw:Uint8Array|undefined
 try{
  if(typeof item?.salt!=='string'||item.salt.length!==24||typeof item.iv!=='string'||item.iv.length!==16||typeof item.ciphertext!=='string'||item.ciphertext.length>1400)throw Error()
  const salt=base64ToBytes(item.salt),iv=base64ToBytes(item.iv)
  if(salt.length!==16||iv.length!==12||base64ToBytes(item.ciphertext).length>1024)throw Error()
  const wrapping=await deriveVaultKey(secret,salt,envelope.iterations),value=await decryptVaultValue<{key:string}>(wrapping,item.iv,item.ciphertext,aad(workspaceUid,kind))
  raw=base64ToBytes(value.key);if(raw.length!==32)throw Error()
  return raw
 }catch{raw?.fill(0);throw Error('口令或恢复码不正确，或加密数据已损坏')}
}
export async function unlockWorkspaceKey(envelope:WorkspaceKeyEnvelope,workspaceUid:string,secret:string,kind:'password'|'recovery'='password'){
 const raw=await openWorkspaceKeyBytes(envelope,workspaceUid,secret,kind)
 try{return await importDataKey(raw)}finally{raw.fill(0)}
}
export async function changeWorkspacePassword(envelope:WorkspaceKeyEnvelope,workspaceUid:string,secret:string,newPassword:string,kind:'password'|'recovery'='password'){
 if(typeof newPassword!=='string'||newPassword.length<12||newPassword.length>4096)throw Error('请输入 12～4096 字符的新加密口令')
 const snapshot=structuredClone(envelope),raw=await openWorkspaceKeyBytes(snapshot,workspaceUid,secret,kind)
 try{return{...snapshot,password:await wrap(workspaceUid,'password',newPassword,raw)}}finally{raw.fill(0)}
}
export async function replaceWorkspaceRecoveryCode(envelope:WorkspaceKeyEnvelope,workspaceUid:string,secret:string,kind:'password'|'recovery'='password'){
 const snapshot=structuredClone(envelope),raw=await openWorkspaceKeyBytes(snapshot,workspaceUid,secret,kind)
 try{const recoveryCode=bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));return{envelope:{...snapshot,recovery:await wrap(workspaceUid,'recovery',recoveryCode,raw)},recoveryCode}}finally{raw.fill(0)}
}

export const WORKSPACE_OBJECT_SCHEMA='note-flow-encrypted-object/1' as const
const MAX_OBJECT_BYTES=16*1024*1024
export interface WorkspaceObjectIdentity{workspaceUid:string;kind:string;uid:string;version:number;keyGeneration:number}
export interface EncryptedWorkspaceObject{schema:typeof WORKSPACE_OBJECT_SCHEMA;identity:WorkspaceObjectIdentity;iv:string;ciphertext:string}
function checkedIdentity(source:WorkspaceObjectIdentity):WorkspaceObjectIdentity{
 if(!source||typeof source.workspaceUid!=='string'||!source.workspaceUid||source.workspaceUid.length>128||typeof source.uid!=='string'||!source.uid||source.uid.length>256||typeof source.kind!=='string'||! /^[a-z][a-z0-9_-]{0,63}$/.test(source.kind)||!Number.isSafeInteger(source.version)||source.version<0||!Number.isSafeInteger(source.keyGeneration)||source.keyGeneration<1)throw Error('加密对象标识或版本无效')
 return{workspaceUid:source.workspaceUid,kind:source.kind,uid:source.uid,version:source.version,keyGeneration:source.keyGeneration}
}
// 将空间、对象身份、版本与密钥代次纳入AAD，防止合法密文被调换到另一对象或版本下使用。
const objectAad=(value:WorkspaceObjectIdentity)=>JSON.stringify([WORKSPACE_OBJECT_SCHEMA,value.workspaceUid,value.kind,value.uid,value.version,value.keyGeneration])
export async function encryptWorkspaceObject(key:CryptoKey,identity:WorkspaceObjectIdentity,value:unknown):Promise<EncryptedWorkspaceObject>{
 requireCrypto();const captured=checkedIdentity(identity)
 let snapshot:unknown
 try{const json=JSON.stringify(value);if(typeof json!=='string'||new TextEncoder().encode(json).length>MAX_OBJECT_BYTES)throw Error();snapshot=JSON.parse(json)}catch{throw Error('加密对象内容无效或过大，请使用分块附件格式')}
 return{schema:WORKSPACE_OBJECT_SCHEMA,identity:captured,...await encryptVaultValue(key,snapshot,objectAad(captured))}
}
/** Expected identity comes from the caller's trusted routing/version context. */
export async function decryptWorkspaceObject<T>(key:CryptoKey,expected:WorkspaceObjectIdentity,source:EncryptedWorkspaceObject):Promise<T>{
 requireCrypto();const captured=checkedIdentity(expected)
 try{
  if(source?.schema!==WORKSPACE_OBJECT_SCHEMA||objectAad(checkedIdentity(source.identity))!==objectAad(captured)||typeof source.iv!=='string'||source.iv.length!==16||typeof source.ciphertext!=='string'||source.ciphertext.length>Math.ceil((MAX_OBJECT_BYTES+16)/3)*4)throw Error()
  if(base64ToBytes(source.iv).length!==12)throw Error()
  return await decryptVaultValue<T>(key,source.iv,source.ciphertext,objectAad(captured))
 }catch{throw Error('加密对象校验失败，内容、归属或版本不匹配')}
}

export const WORKSPACE_ATTACHMENT_SCHEMA='note-flow-encrypted-attachment/1' as const
interface AttachmentManifest{schema:typeof WORKSPACE_ATTACHMENT_SCHEMA;transferUid:string;chunkSize:number;totalBytes:number;chunkCount:number}
export interface EncryptedAttachmentChunk{index:number;iv:Uint8Array;ciphertext:Uint8Array}
// 分块还绑定传输批次、索引和总长度，避免单块认证通过却被跨附件拼接或调序。
const chunkAad=(identity:WorkspaceObjectIdentity,manifest:AttachmentManifest,index:number)=>new TextEncoder().encode(JSON.stringify([WORKSPACE_ATTACHMENT_SCHEMA,objectAad(identity),manifest.transferUid,index,manifest.chunkCount,manifest.totalBytes,manifest.chunkSize]))
function checkManifest(value:AttachmentManifest){
 if(value?.schema!==WORKSPACE_ATTACHMENT_SCHEMA||typeof value.transferUid!=='string'||value.transferUid.length!==24||base64ToBytes(value.transferUid).length!==16||!Number.isSafeInteger(value.chunkSize)||value.chunkSize<65536||value.chunkSize>4*1024*1024||!Number.isSafeInteger(value.totalBytes)||value.totalBytes<0||!Number.isSafeInteger(value.chunkCount)||value.chunkCount!==Math.ceil(value.totalBytes/value.chunkSize)||value.chunkCount>1_000_000)throw Error('附件加密清单无效')
}
export async function prepareEncryptedAttachment(key:CryptoKey,identity:WorkspaceObjectIdentity,file:Blob,chunkSize=1024*1024){
 const subtle=requireCrypto(),captured=checkedIdentity(identity)
 const header:AttachmentManifest={schema:WORKSPACE_ATTACHMENT_SCHEMA,transferUid:bytesToBase64(crypto.getRandomValues(new Uint8Array(16))),chunkSize,totalBytes:file.size,chunkCount:Math.ceil(file.size/chunkSize)}
 checkManifest(header)
 const manifest=await encryptWorkspaceObject(key,captured,header)
 async function* chunks():AsyncGenerator<EncryptedAttachmentChunk>{
  for(let index=0;index<header.chunkCount;index++){
   const raw=new Uint8Array(await file.slice(index*chunkSize,Math.min(file.size,(index+1)*chunkSize)).arrayBuffer()),iv=crypto.getRandomValues(new Uint8Array(12))
   let ciphertext:Uint8Array
   try{ciphertext=new Uint8Array(await subtle.encrypt({name:'AES-GCM',iv,additionalData:chunkAad(captured,header,index)},key,raw))}finally{raw.fill(0)}
   yield{index,iv,ciphertext}
  }
 }
 return{manifest,chunks:chunks()}
}
/** Yielded plaintext is provisional: publish only after the iterator completes. */
export async function* decryptAttachmentChunks(key:CryptoKey,expected:WorkspaceObjectIdentity,manifest:EncryptedWorkspaceObject,chunks:AsyncIterable<EncryptedAttachmentChunk>|Iterable<EncryptedAttachmentChunk>):AsyncGenerator<Uint8Array>{
 const subtle=requireCrypto(),captured=checkedIdentity(expected),header=await decryptWorkspaceObject<AttachmentManifest>(key,captured,manifest)
 try{checkManifest(header)}catch{throw Error('附件加密清单校验失败')}
 let index=0
 for await(const chunk of chunks){
  const length=Math.min(header.chunkSize,header.totalBytes-index*header.chunkSize)
  try{
   if(index>=header.chunkCount||chunk.index!==index||!(chunk.iv instanceof Uint8Array)||chunk.iv.length!==12||!(chunk.ciphertext instanceof Uint8Array)||chunk.ciphertext.length!==length+16)throw Error()
   const plain=await subtle.decrypt({name:'AES-GCM',iv:chunk.iv as Uint8Array<ArrayBuffer>,additionalData:chunkAad(captured,header,index)},key,chunk.ciphertext as Uint8Array<ArrayBuffer>)
   index++;yield new Uint8Array(plain)
  }catch{throw Error('附件分块校验失败，分块缺失、顺序错误或数据已损坏')}
 }
 if(index!==header.chunkCount)throw Error('附件分块缺失，不能发布恢复文件')
}

export interface AttachmentRestoreDescriptor{identity:WorkspaceObjectIdentity;manifestHash:string;sizeBytes:number}
export interface AttachmentRestoreReceipt extends AttachmentRestoreDescriptor{operationUid:string;contentSha256:string}
/** Host methods are bound to the original space; abort deletes staging only. */
export interface AttachmentRestoreSink{
 receipt(operationUid:string):Promise<AttachmentRestoreReceipt|undefined>
 verify(receipt:AttachmentRestoreReceipt):Promise<boolean>
 begin(operationUid:string,descriptor:AttachmentRestoreDescriptor,attemptUid:string):Promise<void>
 append(operationUid:string,offset:number,bytes:Uint8Array,attemptUid:string):Promise<void>
 commit(operationUid:string,attemptUid:string):Promise<AttachmentRestoreReceipt>
 abort(operationUid:string,attemptUid:string):Promise<void>
}
export class AttachmentRestoreFailure extends Error{
 constructor(public readonly phase:string,public readonly cleanupPending:boolean,public readonly publishUncertain:boolean){super(cleanupPending?'附件恢复未完成，暂存清理尚未确认，请保留原备份。':'附件恢复未完成，请保留原备份并使用同一操作重试。');this.name='AttachmentRestoreFailure'}
}
export async function restoreEncryptedAttachment(options:{key:CryptoKey;expected:WorkspaceObjectIdentity;manifest:EncryptedWorkspaceObject;chunks:AsyncIterable<EncryptedAttachmentChunk>|Iterable<EncryptedAttachmentChunk>;operationUid:string;sink:AttachmentRestoreSink;assertCurrent():void}):Promise<AttachmentRestoreReceipt>{
 const {key,chunks,operationUid,sink,assertCurrent}=options
 if(typeof operationUid!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(operationUid))throw Error('附件恢复操作标识无效')
 requireCrypto();const attemptUid=crypto.randomUUID()
 let phase='validate',staging=false,publishing=false
 try{
  assertCurrent();const expected=checkedIdentity(options.expected),source=options.manifest
  if(source?.schema!==WORKSPACE_OBJECT_SCHEMA||typeof source.ciphertext!=='string'||source.ciphertext.length>8192)throw Error()
  const manifest:EncryptedWorkspaceObject={schema:source.schema,identity:checkedIdentity(source.identity),iv:source.iv,ciphertext:source.ciphertext}
  const header=await decryptWorkspaceObject<AttachmentManifest>(key,expected,manifest);checkManifest(header);assertCurrent()
  const digest=new Uint8Array(await requireCrypto().digest('SHA-256',new TextEncoder().encode(JSON.stringify(manifest)))),descriptor:AttachmentRestoreDescriptor={identity:expected,manifestHash:[...digest].map(value=>value.toString(16).padStart(2,'0')).join(''),sizeBytes:header.totalBytes}
  const validReceipt=(receipt:AttachmentRestoreReceipt)=>receipt?.operationUid===operationUid&&typeof receipt.contentSha256==='string'&&/^[a-f0-9]{64}$/.test(receipt.contentSha256)&&receipt.manifestHash===descriptor.manifestHash&&receipt.sizeBytes===descriptor.sizeBytes&&objectAad(checkedIdentity(receipt.identity))===objectAad(expected)
  phase='receipt';const existing=await sink.receipt(operationUid);assertCurrent()
  if(existing){if(!validReceipt(existing)||!await sink.verify(existing))throw Error();assertCurrent();return existing}
  phase='prepare';staging=true;await sink.begin(operationUid,descriptor,attemptUid);assertCurrent()
  let offset=0;phase='decrypt'
  for await(const bytes of decryptAttachmentChunks(key,expected,manifest,chunks)){
   try{assertCurrent();phase='write';await sink.append(operationUid,offset,bytes,attemptUid);assertCurrent();offset+=bytes.length;phase='decrypt'}finally{bytes.fill(0)}
  }
  if(offset!==descriptor.sizeBytes)throw Error()
  assertCurrent();phase='publish';publishing=true
  const receipt=await sink.commit(operationUid,attemptUid);assertCurrent()
  if(!validReceipt(receipt)||!await sink.verify(receipt))throw Error()
  assertCurrent()
  return receipt
 }catch{
  let cleanupPending=false
  if(staging)try{await sink.abort(operationUid,attemptUid)}catch{cleanupPending=true}
  throw new AttachmentRestoreFailure(phase,cleanupPending,publishing)
 }
}

export function validateWorkspaceKeyEnvelope(source:WorkspaceKeyEnvelope):WorkspaceKeyEnvelope{
 if(source?.schema!==WORKSPACE_ENCRYPTION_SCHEMA||typeof source.workspaceUid!=='string'||!source.workspaceUid||source.workspaceUid.length>128||source.iterations!==WORKSPACE_KEY_ITERATIONS)throw Error('知识库加密元数据无效')
 const slot=(value:WrappedKey):WrappedKey=>{
  try{if(typeof value?.salt!=='string'||value.salt.length!==24||base64ToBytes(value.salt).length!==16||typeof value.iv!=='string'||value.iv.length!==16||base64ToBytes(value.iv).length!==12||typeof value.ciphertext!=='string'||value.ciphertext.length>1400)throw Error();const size=base64ToBytes(value.ciphertext).length;if(size<16||size>1024)throw Error();return{salt:value.salt,iv:value.iv,ciphertext:value.ciphertext}}catch{throw Error('知识库密钥封装格式无效')}
 }
 return{schema:WORKSPACE_ENCRYPTION_SCHEMA,workspaceUid:source.workspaceUid,iterations:source.iterations,password:slot(source.password),recovery:slot(source.recovery)}
}
