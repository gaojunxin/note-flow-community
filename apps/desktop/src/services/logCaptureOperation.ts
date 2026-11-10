/** Keep the successful content commit and resume only unfinished attachments. */
export function createLogCaptureOperation<T>(options:{create():Promise<T>;files:File[];enqueue(note:T,file:File,operationUid:string):Promise<unknown>;assertCurrent():void;operationUids?:string[]}){
 const files=[...options.files],operationUids=options.operationUids?[...options.operationUids]:files.map(()=>crypto.randomUUID())
 if(operationUids.length!==files.length||new Set(operationUids).size!==files.length)throw Error('附件恢复标识不完整')
 let note:T|undefined,created=false,next=0,flight:Promise<T>|undefined
 async function run(){
  options.assertCurrent()
  if(!created){note=await options.create();created=true;options.assertCurrent()}
  while(next<files.length){options.assertCurrent();await options.enqueue(note!,files[next],operationUids[next]);next++;options.assertCurrent()}
  return note!
 }
 return {
  get created(){return created},get remaining(){return files.length-next},
  run(){return flight??=(run().finally(()=>{flight=undefined}))}
 }
}
