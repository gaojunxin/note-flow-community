/** 阅读位置独立于文件缓存；只记录文档摘要及位置，不修改笔记正文。 */
/** 页码从1开始；offset为页面滚动范围内的0～1位置；缩放优先由各设备恢复。 */
export interface ReadingPosition {page:number;pages:number;offset:number;zoom:number}
export interface RemoteReadingPosition extends ReadingPosition {version:number;operationId:string}
/** version是已观察到的服务端基线；dirty表示本机位置尚未收到成功回执。 */
export interface ReadingProgressRow extends ReadingPosition {version:number;operationId:string;dirty:boolean}
export interface ReadingProgressRemote {
 read(sha256:string):Promise<RemoteReadingPosition|null>
 write(sha256:string,value:ReadingProgressRow):Promise<{conflict:boolean;value:RemoteReadingPosition}>
}
export function normalizedReadingPosition(value:Partial<ReadingPosition>,pages=Number(value.pages)||1):ReadingPosition{
 pages=Math.max(1,Math.floor(pages))
 return {page:Math.max(1,Math.min(pages,Math.floor(Number(value.page)||1))),pages,offset:Math.max(0,Math.min(1,Number(value.offset)||0)),zoom:Math.max(.25,Math.min(3,Number(value.zoom)||1))}
}
/** 每个文档阅读器独立创建实例，绑定账号/服务器及生命周期代次；旧回执不能覆盖新账号或后续翻页。 */
export function createReadingProgress({storage,scope,remote}:{storage:Pick<Storage,'getItem'|'setItem'>;scope:()=>string;remote?:ReadingProgressRemote}){
 const bound=scope(),current=()=>scope()===bound
 let running:Promise<void>|undefined,conflict:RemoteReadingPosition|null=null
 const key=(sha:string)=>`note-flow-reading:${encodeURIComponent(bound)}:${sha}`
 function read(sha:string):ReadingProgressRow|null{if(!current())return null;try{const row=JSON.parse(storage.getItem(key(sha))||'null');return row&&typeof row.operationId==='string'?{...row,...normalizedReadingPosition(row)}:null}catch{return null}}
 function put(sha:string,row:ReadingProgressRow){if(!current())throw Error('阅读账号已切换');storage.setItem(key(sha),JSON.stringify(row))}
 return {
  read,cloudEnabled:Boolean(remote),
  save(sha:string,value:ReadingPosition){const previous=read(sha);const row={...normalizedReadingPosition(value),version:previous?.version||0,operationId:crypto.randomUUID(),dirty:true};put(sha,row);return row},
  async open(sha:string){
   const local=read(sha);if(!remote||!current())return local
   const cloud=await remote.read(sha);if(!current())return null
   const latest=read(sha)
   if(latest?.dirty){if(cloud?.operationId===latest.operationId){put(sha,{...cloud,...normalizedReadingPosition(cloud),dirty:false});return read(sha)}if(cloud&&cloud.version!==latest.version)conflict=cloud;return latest}
   // 网络等待期间可能已翻页；只有未产生新本地位置时才接纳云端位置。
   if(cloud&&latest?.operationId===local?.operationId){const row={...cloud,...normalizedReadingPosition(cloud),dirty:false};put(sha,row);return row}
   return latest
  },
  sync(sha:string){
   if(running)return running
   running=(async()=>{
    if(!remote||!current()||conflict)return
    const row=read(sha);if(!row?.dirty)return
    const result=await remote.write(sha,row);if(!current())return
    if(result.conflict){conflict=result.value;return}
    if(result.value?.operationId!==row.operationId||result.value.version<=row.version)throw Error('阅读进度回执无效，请重试')
    const latest=read(sha)
    if(latest?.operationId===row.operationId)put(sha,{...result.value,dirty:false})
    else if(latest)put(sha,{...latest,version:result.value.version})
   })().finally(()=>{running=undefined})
   return running
  },
  conflict:()=>conflict,
  resolve(sha:string,useCloud:boolean){if(!conflict)return read(sha);const local=read(sha),cloud=conflict;conflict=null;if(useCloud){put(sha,{...cloud,dirty:false})}else if(local){put(sha,{...local,version:cloud.version,operationId:crypto.randomUUID(),dirty:true})}return read(sha)}
 }
}

/** 仅账号云端重置时清理该空间位置；普通附件缓存清理不得调用此函数。 */
export function clearStoredReadingProgress(storage:Pick<Storage,'length'|'key'|'removeItem'>,scope:string){
 const prefix=`note-flow-reading:${encodeURIComponent(scope)}:`
 for(let index=storage.length-1;index>=0;index--){const key=storage.key(index);if(key?.startsWith(prefix))storage.removeItem(key)}
}
