import type {NoteEntity} from '@note-flow/core'

export function noteStamp(note:NoteEntity){return JSON.stringify([note.uid,note.title,note.content,note.version,note.updatedAt,note.folderUid,note.areaUid,note.projectUid,note.tagUids,note.tagIds,note.status,note.deleted,note.aiPolicy])}
export function consolidationEligible(note:NoteEntity){return note.type==='note'&&!note.deleted&&note.aiPolicy!=='excluded'&&!note.reportGeneratedAt&&!note.journalSeriesUid}
export function consolidationInput(notes:NoteEntity[]){
 if(notes.length<2||notes.length>20||new Set(notes.map(note=>note.uid)).size!==notes.length||notes.some(note=>!consolidationEligible(note)))throw Error('请选择 2 至 20 篇允许 AI 处理的普通笔记')
 const input=notes.map((note,index)=>`<source index="${index+1}">\n标题：${note.title}\n${note.content||''}\n</source>`).join('\n\n')
 // Refuse oversized input rather than silently omit part of a source.
 if(input.length>30000)throw Error('所选内容超过本次整合上限（30,000 字符），请分批选择；本次没有发送正文')
 return input
}
