import {computed,ref,shallowRef} from 'vue'
import {pbkdf2Async} from '@noble/hashes/pbkdf2.js'
import {sha256} from '@noble/hashes/sha2.js'

export const APP_LOCK_KEY='note-flow-app-lock:v1'
export const APP_LOCK_SIGNAL='note-flow-app-lock-signal:v1'
const ATTEMPTS_KEY=APP_LOCK_KEY+':attempts',ITERATIONS=210000
export const APP_LOCK_IDLE_OPTIONS=[0,1,5,10,15,30,60] as const
export interface AppLockRecord{version:1;salt:string;hash:string;recoverySalt:string;recoveryHash:string;idleMinutes:number;lockOnBackground:boolean}
const hex=(bytes:Uint8Array)=>Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('')
const unhex=(value:string)=>Uint8Array.from(value.match(/../g)||[],value=>parseInt(value,16))
function parse(raw:string|null):AppLockRecord|null{
 if(!raw)return null
 try{const value=JSON.parse(raw);if(value.version!==1||![value.salt,value.recoverySalt].every(x=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x))||![value.hash,value.recoveryHash].every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x))||!APP_LOCK_IDLE_OPTIONS.includes(value.idleMinutes)||typeof value.lockOnBackground!=='boolean')return null;return value}catch{return null}
}
function validatePin(pin:string){if(!/^\d{6,12}$/.test(pin))throw Error('PIN 需为 6 至 12 位数字')}
async function derive(secret:string,salt:string){return hex(await pbkdf2Async(sha256,new TextEncoder().encode(secret),unhex(salt),{c:ITERATIONS,dkLen:32,asyncTick:10}))}
function equal(a:string,b:string){let difference=a.length^b.length;for(let i=0;i<64;i++)difference|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return difference===0}
export function createAppLock(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>|null,now=()=>Date.now()){
 const read=()=>storage?.getItem(APP_LOCK_KEY)??null
 const raw=ref(read()),config=shallowRef(parse(raw.value)),locked=ref(raw.value!==null),enabled=computed(()=>raw.value!==null)
 let verifying=false,generation=0
 function persist(record:AppLockRecord){if(!storage)throw Error('当前环境无法保存软件锁设置');const next=JSON.stringify(record);storage.setItem(APP_LOCK_KEY,next);raw.value=next;config.value=record}
 function refresh(){generation++;raw.value=read();config.value=parse(raw.value);locked.value=enabled.value}
 function remainingSeconds(){try{return Math.max(0,Math.ceil((JSON.parse(storage?.getItem(ATTEMPTS_KEY)||'{}').until-now())/1000))||0}catch{return 0}}
 async function verify(secret:string,recovery=false){
  if(verifying)throw Error('正在校验，请稍候')
  const captured=read(),record=parse(captured);if(!record)throw Error('软件锁设置无法读取，请检查本机设置')
  const wait=remainingSeconds();if(wait)throw Error(`尝试过于频繁，请 ${wait} 秒后重试`)
  verifying=true
  try{
   const input=recovery?secret.replace(/[\s-]/g,'').toLowerCase():secret
   const valid=equal(await derive(input,recovery?record.recoverySalt:record.salt),recovery?record.recoveryHash:record.hash)
   if(read()!==captured)throw Error('软件锁设置已变化，请重新解锁')
   if(!valid){let count=0;try{count=Number(JSON.parse(storage?.getItem(ATTEMPTS_KEY)||'{}').count)||0}catch{/* damaged attempt metadata */}count=Math.min(1000,count+1);const delay=count>=5?Math.min(300,30*2**Math.floor((count-5)/5))*1000:0;storage?.setItem(ATTEMPTS_KEY,JSON.stringify({count,until:now()+delay}));throw Error(recovery?'恢复码不正确':'PIN 不正确')}
   storage?.removeItem(ATTEMPTS_KEY);return captured
  }finally{verifying=false}
 }
 return {config,locked,enabled,remainingSeconds,refresh,revision:()=>generation,
  async prepare(pin:string){validatePin(pin);if(enabled.value)throw Error('软件锁已经启用');const salt=hex(crypto.getRandomValues(new Uint8Array(16))),recoverySalt=hex(crypto.getRandomValues(new Uint8Array(16))),code=hex(crypto.getRandomValues(new Uint8Array(16)));const [hash,recoveryHash]=await Promise.all([derive(pin,salt),derive(code,recoverySalt)]);return{record:{version:1,salt,hash,recoverySalt,recoveryHash,idleMinutes:5,lockOnBackground:false} as AppLockRecord,recoveryCode:code.match(/.{4}/g)!.join('-')}},
  enable(record:AppLockRecord){if(read()!==null)throw Error('软件锁已经启用');if(!parse(JSON.stringify(record)))throw Error('软件锁设置无效');persist(record);locked.value=false},
  lock(broadcast=true){if(!enabled.value)return;generation++;locked.value=true;if(broadcast)storage?.setItem(APP_LOCK_SIGNAL,`${now()}:${Math.random()}`)},
  async unlock(secret:string,recovery=false){const captured=generation;await verify(secret,recovery);if(captured!==generation)throw Error('锁定状态已变化，请重新解锁');locked.value=false},
  async changePin(current:string,next:string,recovery=false){validatePin(next);const epoch=generation,captured=await verify(current,recovery);const record=parse(captured)!;const salt=hex(crypto.getRandomValues(new Uint8Array(16))),hash=await derive(next,salt);if(read()!==captured||epoch!==generation)throw Error('软件锁设置已变化，请重试');persist({...record,salt,hash})},
  async disable(secret:string,recovery=false){const captured=generation;await verify(secret,recovery);if(captured!==generation)throw Error('锁定状态已变化，请重试');storage?.removeItem(APP_LOCK_KEY);raw.value=null;config.value=null;locked.value=false},
  policy(idleMinutes:number,lockOnBackground:boolean){if(!config.value||!APP_LOCK_IDLE_OPTIONS.includes(idleMinutes as any))throw Error('锁定设置无效');persist({...config.value,idleMinutes,lockOnBackground})}
 }
}
export const appLock=createAppLock(typeof localStorage==='undefined'?null:localStorage)
