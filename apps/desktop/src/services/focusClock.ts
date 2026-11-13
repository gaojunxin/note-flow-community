import type {FocusSession} from './contracts/localPersonal'
/** 宿主须先加载恢复点，异步写入按键串行且提交后才完成；正式记录save须按稳定UID幂等。 */
export interface FocusClockHost {
 now():number;uid():string;context():{key:string;binding:string};
 storage:{getItem(key:string):string|null;setItem(key:string,value:string):void|Promise<void>;removeItem(key:string):void|Promise<void>};
 save(session:FocusSession,binding:string):Promise<void>;
}
export interface FocusCheckpoint {version:1;session:FocusSession|null;elapsedMs:number;rounds:number}
/** 迁移和恢复共用校验，损坏检查点不得被当成空计时覆盖。 */
export function validateFocusCheckpoint(source:unknown):FocusCheckpoint{
 const value=source as FocusCheckpoint,s=value?.session
 if(!value||value.version!==1||!Number.isSafeInteger(value.rounds)||value.rounds<0||!Number.isFinite(value.elapsedMs)||value.elapsedMs<0)throw Error('专注检查点无效')
 if(s&&(typeof s.uid!=='string'||!s.uid||!['focus','short_break','long_break'].includes(s.sessionType)||!Number.isFinite(Date.parse(s.startedAt))||!Number.isInteger(s.plannedSeconds)||s.plannedSeconds<60||s.plannedSeconds>86400||value.elapsedMs>s.plannedSeconds*1000||typeof s.endedAt!=='string'||s.endedAt&&!Number.isFinite(Date.parse(s.endedAt))))throw Error('专注检查点无效')
 return value
}
/** 活动检查点只保存在本机；完成检查点提交后才保存正式记录。 */
export class FocusClock {
 session:FocusSession|null=null;elapsedMs=0;running=false;saving=false;error='';kind='focus';taskUid='';noteUid='';
 durations=[25,5,15];autoBreak=false;roundInterval=4;rounds=0;
 private key='';private binding='';private last=0;private readable=false;
 constructor(private host:FocusClockHost){}
 get plannedSeconds(){return this.session?.plannedSeconds??this.durations[this.kind==='short_break'?1:this.kind==='long_break'?2:0]*60}
 get remainingSeconds(){return Math.max(0,this.plannedSeconds-Math.floor(this.elapsedMs/1000))}
 get pending(){return Boolean(this.session?.endedAt)}
 enter(){
  const context=this.host.context();if(context.binding===this.binding&&context.key===this.key&&this.readable)return true
  this.pause();this.key=context.key;this.binding=context.binding;this.session=null;this.elapsedMs=0;this.running=false;this.error='';this.rounds=0;this.taskUid='';this.noteUid='';this.readable=false
  try{const raw=this.host.storage.getItem(this.key);if(!raw){this.readable=true;return true}const value=validateFocusCheckpoint(JSON.parse(raw));this.rounds=value.rounds
   if(value.session){this.session=value.session;this.kind=value.session.sessionType;this.elapsedMs=value.elapsedMs;this.taskUid=value.session.taskUid||'';this.noteUid=value.session.noteUid||''}
   this.readable=true;return true
  }catch{this.error='无法恢复上次计时，请检查本机存储。';return false}
 }
 private persist():boolean|Promise<boolean>{
  if(!this.key)return true
  const key=this.key,binding=this.binding
  const failed=(source?:unknown)=>{if(this.key===key&&this.binding===binding&&this.host.context().binding===binding){this.running=false;this.error=source instanceof Error?'计时进度保存失败：'+source.message:'计时进度保存失败，请检查本机存储后重试。'}return false}
  try{const saved=this.host.storage.setItem(key,JSON.stringify({version:1,session:this.session,elapsedMs:this.elapsedMs,rounds:this.rounds}));if(saved&&typeof saved.then==='function')return saved.then(()=>true,failed);return true}catch(source){return failed(source)}
 }
 toggle(){
  if(!this.enter()||this.saving||this.pending)return
  if(this.running){this.pause();return}
  this.error='';if(!this.session){this.elapsedMs=0;this.session={uid:this.host.uid(),taskUid:this.kind==='focus'?this.taskUid||undefined:undefined,noteUid:this.kind==='focus'?this.noteUid||undefined:undefined,sessionType:this.kind,status:'paused',plannedSeconds:this.plannedSeconds,actualSeconds:0,startedAt:new Date(this.host.now()).toISOString(),endedAt:''}}
  this.last=this.host.now();this.running=true;void this.persist()
 }
 private advance(){if(!this.running||!this.session)return;const now=this.host.now();this.elapsedMs=Math.min(this.session.plannedSeconds*1000,this.elapsedMs+Math.max(0,now-this.last));this.last=now;this.session.actualSeconds=Math.floor(this.elapsedMs/1000)}
 pause(){if(!this.running)return;this.advance();this.running=false;void this.persist()}
 tick(){
  const context=this.host.context();if(context.binding!==this.binding||context.key!==this.key){this.enter();return}
  if(!this.running)return;const previous=Math.floor(this.elapsedMs/1000);this.advance();if(previous!==Math.floor(this.elapsedMs/1000))void this.persist()
  if(this.running&&this.remainingSeconds===0)void this.finish(true)
 }
 async finish(natural=false){
  if(!this.enter()||!this.session||this.saving)return;this.pause();if(this.elapsedMs<1000){this.error='请至少专注 1 秒后再完成。';return}
  const session=this.session,binding=this.binding,elapsed=this.elapsedMs,rounds=this.rounds
  if(!session.endedAt){session.endedAt=new Date(this.host.now()).toISOString();session.status='completed'}
  this.saving=true;this.error=''
  try{
   const checkpoint=this.persist();if(typeof checkpoint==='boolean'?!checkpoint:!await checkpoint)return
   if(this.host.context().binding!==binding||this.binding!==binding)return
   await this.host.save({...session},binding)
   if(this.host.context().binding!==binding||this.binding!==binding||this.session?.uid!==session.uid)return
   if(session.sessionType==='focus')++this.rounds
   this.session=null;this.elapsedMs=0
   const cleared=this.persist(),committed=typeof cleared==='boolean'?cleared:await cleared
   if(this.host.context().binding!==binding||this.binding!==binding)return
   // 正式记录可能已保存；清理检查点失败仍保留同一UID供幂等重试，不开始下一轮。
   if(!committed){this.session=session;this.elapsedMs=elapsed;this.rounds=rounds;return}
   this.error=''
   if(natural&&this.autoBreak&&session.sessionType==='focus'){this.kind=this.rounds%this.roundInterval===0?'long_break':'short_break';this.saving=false;this.toggle()}
  }catch(error){if(this.binding===binding&&this.host.context().binding===binding)this.error=error instanceof Error?error.message:'保存失败，请重试。'}
  finally{this.saving=false}
 }
}
