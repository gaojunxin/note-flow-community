import type {NoteEntity} from '@note-flow/core'
import type {LearningReference} from '@note-flow/core/ai-learning'
import {consolidationInput} from './noteConsolidation'

/** Reference snapshots may be truncated. Always reload whole notes before the separate consent step. */
export async function resolveConsolidationNotes(references:LearningReference[],read:(uid:string)=>Promise<NoteEntity|undefined>){
 const uids=[...new Set(references.filter(item=>item.kind==='note').map(item=>item.uid))]
 if(uids.length<2)throw Error('请先通过“添加引用”选择至少两篇笔记')
 const notes=await Promise.all(uids.map(async uid=>{const note=await read(uid);if(!note)throw Error('引用笔记已不可用，请重新选择');return note}))
 consolidationInput(notes)
 return notes
}
