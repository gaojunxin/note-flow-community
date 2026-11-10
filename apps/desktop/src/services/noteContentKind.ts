import type {NoteEntity} from '@note-flow/core'
/** Explicit content formats take precedence over provenance such as the original filename. */
export function isFileNote(note:Partial<NoteEntity>&{obsidianFileNode?:boolean}|null|undefined):boolean{
 if(!note)return false
 if(note.type==='file'||note.contentFormat==='file')return true
 if(note.contentFormat==='markdown')return false
 return Boolean(note.fileName||note.fileExtension||note.fileKind||note.attachmentUid||note.obsidianFileNode)||/^>\s*从 Obsidian 导入的目录文件/m.test(note.content||'')
}
