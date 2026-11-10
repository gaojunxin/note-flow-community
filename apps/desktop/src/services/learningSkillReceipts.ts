import {openDB} from 'idb'
export interface LearningSkillReceipt {key:string;summary:string;completedAt:string}
const database=()=>openDB('note-flow-learning-skills',1,{upgrade(db){db.createObjectStore('receipts',{keyPath:'key'})}})
export const learningSkillKey=(scope:string,sessionUid:string,messageUid:string)=>JSON.stringify([scope,sessionUid,messageUid])
export async function readLearningSkillReceipt(key:string):Promise<LearningSkillReceipt|undefined>{const db=await database();try{return await db.get('receipts',key)}finally{db.close()}}
export async function completeLearningSkill(key:string,summary:string){const db=await database();try{const tx=db.transaction('receipts','readwrite');if(!await tx.store.get(key))await tx.store.add({key,summary,completedAt:new Date().toISOString()});await tx.done}finally{db.close()}}
