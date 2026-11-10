import type {NoteEntity} from '@note-flow/core'
export function captureRemoteNoteSnapshot(_assertSource:()=>void){return{async get(_uid:string):Promise<NoteEntity>{throw Error('社区版不提供服务器版本读取')}}}
