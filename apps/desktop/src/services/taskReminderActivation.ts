export interface ReminderTarget {ownerId:string;taskUid:string}
/** 激活只打开当前空间实体；锁屏/登录阶段保留目标，异步换号后不继续导航。 */
export function createTaskReminderActivation(host:{take:()=>Promise<ReminderTarget|null>;ready:()=>boolean;owner:()=>string;revision:()=>number;open:(uid:string,current:()=>boolean)=>Promise<void>;unavailable:(message:string)=>void}){
 let pending:ReminderTarget|null=null,running=false,again=false,stopped=false
 async function drain(){
   if(stopped)return
   if(running){again=true;return}
   if(!host.ready())return
   running=true
   try{
    do{
     again=false
     const revision=host.revision(),owner=host.owner(),current=()=>!stopped&&host.ready()&&revision===host.revision()&&owner===host.owner()
     const activated=await host.take();if(activated)pending=activated
     if(!current())return
     if(!pending)return
     if(pending.ownerId!==owner){host.unavailable('此提醒属于其他本机空间，请切换到对应空间后再打开');return}
     const target=pending;pending=null
     await host.open(target.taskUid,current)
    }while(again&&host.ready())
   }finally{running=false;if(again&&!stopped&&host.ready()){again=false;queueMicrotask(()=>{void drain().catch(()=>{})})}}
 }
 return {drain,stop(){stopped=true;pending=null}}
}
