import {unlockWorkspaceKey} from './workspaceEncryption'
import type {WorkspaceKeyRecord} from './workspaceKeyStore'
interface KeyRepository {read(workspaceUid:string):Promise<WorkspaceKeyRecord|undefined>;verifyKey(workspaceUid:string,key:CryptoKey):Promise<WorkspaceKeyRecord>}
/** Memory-only DEK leases. External generation must advance on account changes. */
export function createWorkspaceUnlockSession(options:{scope():string;generation():number;locked():boolean;keys:KeyRepository}){
 let epoch=0,context=JSON.stringify([options.scope(),options.generation(),options.locked()])
 const slots=new Map<string,{key:CryptoKey;record:WorkspaceKeyRecord}>()
 const lock=()=>{epoch++;slots.clear()}
 const sync=()=>{const next=JSON.stringify([options.scope(),options.generation(),options.locked()]);if(next!==context){context=next;lock()}}
 const same=(left:WorkspaceKeyRecord,right:WorkspaceKeyRecord)=>left.storageKey===right.storageKey&&left.revision===right.revision&&left.keyGeneration===right.keyGeneration&&left.operationUid===right.operationUid&&JSON.stringify(left.envelope)===JSON.stringify(right.envelope)&&JSON.stringify(left.proof)===JSON.stringify(right.proof)
 function capture(){sync();const current=epoch,scope=options.scope();if(!scope||options.locked())throw Error('请先解锁软件');return()=>{sync();if(current!==epoch||scope!==options.scope()||options.locked())throw Error('账号、空间或锁定状态已变化，已停止解锁操作')}}
 async function acquire(workspaceUid:string){
  const assertContext=capture(),slot=slots.get(workspaceUid)
  if(!slot)throw Error('请先解锁加密空间')
  const assertCurrent=()=>{assertContext();if(slots.get(workspaceUid)!==slot)throw Error('空间密钥会话已变化')}
  const verifyCurrent=async()=>{
   assertCurrent();const current=await options.keys.read(workspaceUid);assertCurrent()
   if(!current||!same(current,slot.record)){lock();throw Error('空间密钥已更新，请重新解锁')}
  }
  await verifyCurrent()
  return{key:slot.key,keyGeneration:slot.record.keyGeneration,assertCurrent,verifyCurrent}
 }
 return{
  lock,
  generation(){sync();return epoch},
  isUnlocked(workspaceUid:string){sync();return!options.locked()&&slots.has(workspaceUid)},
  async unlock(workspaceUid:string,secret:string,kind:'password'|'recovery'='password'){
   sync();lock();const assertCurrent=capture(),record=await options.keys.read(workspaceUid);assertCurrent()
   if(!record)throw Error('空间密钥不存在')
   const key=await unlockWorkspaceKey(record.envelope,workspaceUid,secret,kind);assertCurrent()
   const verified=await options.keys.verifyKey(workspaceUid,key);assertCurrent()
   if(!same(record,verified))throw Error('空间密钥已更新，请重新解锁')
   const latest=await options.keys.read(workspaceUid);assertCurrent()
   if(!latest||!same(record,latest))throw Error('空间密钥已更新，请重新解锁')
   slots.set(workspaceUid,{key,record});return{workspaceUid,keyGeneration:record.keyGeneration}
  },
  acquire,
  async withKey<T>(workspaceUid:string,work:(lease:Awaited<ReturnType<typeof acquire>>)=>Promise<T>){
   const lease=await acquire(workspaceUid),result=await work(lease);await lease.verifyCurrent();return result
  }
 }
}
