import {normalizedReadingPosition,type ReadingPosition,type ReadingProgressRow} from './readingProgress'
export interface ReadingProgressStore {read(sha:string):Promise<ReadingProgressRow|null>;compare(sha:string,expected:ReadingProgressRow|null,value:ReadingProgressRow):Promise<void>;check():void}
/** 社区阅读器只保存本机位置；远端同步由官方私有装配提供，不在此执行。 */
export function createLocalReadingProgress(store:ReadingProgressStore){
 let tail=Promise.resolve()
 const read=async(sha:string)=>{store.check();const value=await store.read(sha);store.check();return value}
 return{read,open:read,cloudEnabled:false,save(sha:string,value:ReadingPosition){const position=normalizedReadingPosition(value),operationId=crypto.randomUUID();const work=tail.catch(()=>{}).then(async()=>{const previous=await read(sha),row={...position,version:previous?.version||0,operationId,dirty:true};await store.compare(sha,previous,row);store.check();return row});tail=work.then(()=>{},()=>{});return work},async sync(_sha:string){store.check()},conflict:()=>null,resolve:(sha:string,_useCloud:boolean)=>read(sha)}
}
