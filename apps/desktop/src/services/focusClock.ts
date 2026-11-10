import type {FocusSession} from './contracts/localPersonal'
export interface FocusClockHost {
 now():number;uid():string;context():{key:string;binding:string};
 storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;
 save(session:FocusSession,binding:string):Promise<void>;
}
/** Active checkpoints stay local. Only an explicit or natural completion is saved. */
export class FocusClock {
 session:FocusSession|null=null;elapsedMs=0;running=false;saving=false;error='';kind='focus';taskUid='';noteUid='';
 durations=[25,5,15];autoBreak=false;roundInterval=4;rounds=0;
 private key='';private binding='';private last=0;
 constructor(private host:FocusClockHost){}
 get plannedSeconds(){return this.session?.plannedSeconds??this.durations[this.kind==='short_break'?1:this.kind==='long_break'?2:0]*60}
 get remainingSeconds(){return Math.max(0,this.plannedSeconds-Math.floor(this.elapsedMs/1000))}
 get pending(){return Boolean(this.session?.endedAt)}
 enter(){
  const context=this.host.context();if(context.binding===this.binding&&context.key===this.key)return;
  this.pause();this.key=context.key;this.binding=context.binding;this.session=null;this.elapsedMs=0;this.running=false;this.error='';this.rounds=0;this.taskUid='';this.noteUid='';
  try{const raw=this.host.storage.getItem(this.key);if(!raw)return;const value=JSON.parse(raw),s=value.session;
   if(value.version!==1||!Number.isSafeInteger(value.rounds)||value.rounds<0)throw Error('专注检查点无效');this.rounds=value.rounds;
   if(!s)return;
   if(typeof s.uid!=='string'||!s.uid||!['focus','short_break','long_break'].includes(s.sessionType)||!Number.isFinite(Date.parse(s.startedAt))||!Number.isInteger(s.plannedSeconds)||s.plannedSeconds<60||s.plannedSeconds>86400||!Number.isFinite(value.elapsedMs)||value.elapsedMs<0||value.elapsedMs>s.plannedSeconds*1000||typeof s.endedAt!=='string'||s.endedAt&&!Number.isFinite(Date.parse(s.endedAt)))throw Error('专注检查点无效');
   this.session=s;this.kind=s.sessionType;this.elapsedMs=value.elapsedMs;this.taskUid=s.taskUid||'';this.noteUid=s.noteUid||'';
  }catch{this.error='无法恢复上次计时，请检查本机存储。'}
 }
 private persist(){
  if(!this.key)return;
  try{this.host.storage.setItem(this.key,JSON.stringify({version:1,session:this.session,elapsedMs:this.elapsedMs,rounds:this.rounds}));}
  catch{this.running=false;this.error='计时进度保存失败，请释放本机存储后重试。'}
 }
 toggle(){
  this.enter();if(this.saving||this.pending)return;
  if(this.running){this.pause();return;}
  this.error='';if(!this.session){this.elapsedMs=0;this.session={uid:this.host.uid(),taskUid:this.kind==='focus'?this.taskUid||undefined:undefined,noteUid:this.kind==='focus'?this.noteUid||undefined:undefined,sessionType:this.kind,status:'paused',plannedSeconds:this.plannedSeconds,actualSeconds:0,startedAt:new Date(this.host.now()).toISOString(),endedAt:''};}
  this.last=this.host.now();this.running=true;this.persist();
 }
 private advance(){if(!this.running||!this.session)return;const now=this.host.now();this.elapsedMs=Math.min(this.session.plannedSeconds*1000,this.elapsedMs+Math.max(0,now-this.last));this.last=now;this.session.actualSeconds=Math.floor(this.elapsedMs/1000);}
 pause(){if(!this.running)return;this.advance();this.running=false;this.persist();}
 tick(){
  const context=this.host.context();if(context.binding!==this.binding||context.key!==this.key){this.enter();return;}
  if(!this.running)return;const previous=Math.floor(this.elapsedMs/1000);this.advance();if(previous!==Math.floor(this.elapsedMs/1000))this.persist();
  if(this.running&&this.remainingSeconds===0)void this.finish(true);
 }
 async finish(natural=false){
  this.enter();if(!this.session||this.saving)return;this.pause();if(this.elapsedMs<1000){this.error='请至少专注 1 秒后再完成。';return;}
  const session=this.session,binding=this.binding;if(!session.endedAt){session.endedAt=new Date(this.host.now()).toISOString();session.status='completed';this.persist();}
  this.saving=true;this.error='';
  try{
   await this.host.save({...session},binding);
   if(this.host.context().binding!==binding||this.binding!==binding||this.session?.uid!==session.uid)return;
   if(session.sessionType==='focus')++this.rounds;
   this.session=null;this.elapsedMs=0;this.persist();
   if(natural&&this.autoBreak&&session.sessionType==='focus'){this.kind=this.rounds%this.roundInterval===0?'long_break':'short_break';this.saving=false;this.toggle();}
  }catch(error){if(this.binding===binding)this.error=error instanceof Error?error.message:'保存失败，请重试。';}
  finally{this.saving=false;}
 }
}
