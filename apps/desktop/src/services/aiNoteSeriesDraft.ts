import {openDB} from 'idb'
import type {NoteSeries,SeriesProgress,SeriesScope} from './aiNoteSeries'
import type {FolderEntity} from './folders'
export interface SeriesDraft {key:string;scope:string;sessionUid:string;plan:NoteSeries;target:SeriesScope;base?:FolderEntity;progress:SeriesProgress;allowSameTitle:boolean;instruction:string;updatedAt:string}
const database=()=>openDB('note-flow-ai-series',1,{upgrade(db){db.createObjectStore('drafts',{keyPath:'key'})}})
export function seriesDraftStore(scope:string,sessionUid:string){const key=JSON.stringify([scope,sessionUid]);return {
 async read():Promise<SeriesDraft|undefined>{const db=await database();try{return await db.get('drafts',key)}finally{db.close()}},
 async save(value:Omit<SeriesDraft,'key'|'scope'|'sessionUid'|'updatedAt'>){const db=await database();try{await db.put('drafts',JSON.parse(JSON.stringify({...value,key,scope,sessionUid,updatedAt:new Date().toISOString()})))}finally{db.close()}},
 async clear(){const db=await database();try{await db.delete('drafts',key)}finally{db.close()}}
}}
