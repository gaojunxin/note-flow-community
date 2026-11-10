import type {NoteEntity} from '@note-flow/core'
export async function purgeTrashBatch(items:NoteEntity[],purge:(note:NoteEntity)=>Promise<void>,progress:(completed:number,current:string)=>void){
  let removed=0
  const failures:Array<{uid:string;title:string;reason:string}>=[]
  let next=0,completed=0
  const active=new Map<string,string>()
  async function worker(){
    while(next<items.length){
      const note=items[next++];active.set(note.uid,note.title||'未命名笔记')
      progress(completed,[...active.values()].join('、'))
      try{await purge(note);removed++}catch(error){failures.push({uid:note.uid,title:note.title||'未命名笔记',reason:error instanceof Error?error.message:String(error)})}
      active.delete(note.uid);progress(++completed,[...active.values()].join('、'))
    }
  }
  await Promise.all(Array.from({length:Math.min(3,items.length)},()=>worker()))
  return {removed,failures}
}
