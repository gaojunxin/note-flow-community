export async function resolveConflictBatch<T extends {conflictId:string}>(items:T[],resolve:(item:T)=>Promise<void>,onProgress:(completed:number,total:number)=>void=()=>{}){
  const succeeded:string[]=[],failed:Array<{conflictId:string;reason:string}>=[]
  const unique=[...new Map(items.map(item=>[item.conflictId,item])).values()]
  onProgress(0,unique.length)
  for(const [index,item] of unique.entries()){
    try{await resolve(item);succeeded.push(item.conflictId)}catch(error){failed.push({conflictId:item.conflictId,reason:error instanceof Error?error.message:String(error)})}
    onProgress(index+1,unique.length)
  }
  return {succeeded,failed}
}
