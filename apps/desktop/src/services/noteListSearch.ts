import {computed,onScopeDispose,ref,watch,type Ref} from 'vue'
import type {NoteEntity} from '@note-flow/core'
const normalize=(value:string)=>value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim()
/** Search the already loaded scope, including trash and unsynchronized notes. */
export function useNoteListSearch(notes:Ref<readonly NoteEntity[]>,query:Ref<string>){
 const applied=ref(normalize(query.value))
 const index=computed(()=>notes.value.map(note=>({note,text:normalize([note.title,note.content,note.summary,note.fileName].filter(Boolean).join(' '))})))
 const results=computed(()=>applied.value?index.value.filter(row=>row.text.includes(applied.value)).map(row=>row.note):notes.value)
 const searching=computed(()=>normalize(query.value)!==applied.value)
 let timer:ReturnType<typeof setTimeout>|undefined
 function run(){clearTimeout(timer);applied.value=normalize(query.value)}
 watch(query,()=>{clearTimeout(timer);if(!query.value.trim())run();else timer=setTimeout(run,200)},{flush:'sync'})
 onScopeDispose(()=>clearTimeout(timer))
 return {results,searching,run}
}
