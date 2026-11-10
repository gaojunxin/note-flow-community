import type {NoteEntity} from './contracts/notes'
import type {FolderEntity} from './contracts/folders'

export type NoteLinkResolution = {state:'resolved';uid:string;fragment:string}|{state:'missing'|'ambiguous'|'invalid'}
/** Relative Markdown paths are note links; external URLs, images and attachments are not. */
export function isImportedNoteLink(href:string){
 return /^\/notes\?note=[^&#]+(?:#[^]*)?$/.test(href)||(!/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)&&/\.(?:md|markdown)(?:#[^]*)?$/i.test(href))
}
export const noteHeadingSlug=(text:string)=>text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu,'').replace(/\s/g,'-')
const scope=(value:{areaUid?:string|null;projectUid?:string|null})=>`${value.areaUid||''}:${value.projectUid||''}`
function folderPath(note:Pick<NoteEntity,'folderUid'|'folderId'>,folders:FolderEntity[]):string[]|undefined{
 let folder=note.folderUid?folders.find(row=>row.uid===note.folderUid):note.folderId!=null?folders.find(row=>row.id===note.folderId):undefined
 if(!folder)return note.folderUid||note.folderId!=null?undefined:[]
 const path:string[]=[],seen=new Set<string>()
 while(folder){
  if(seen.has(folder.uid))return undefined
  seen.add(folder.uid);path.unshift(folder.name)
  if(!folder.parentUid&&folder.parentId==null)break
  folder=folder.parentUid?folders.find(row=>row.uid===folder!.parentUid):folders.find(row=>row.id===folder!.parentId)
  if(!folder)return undefined
 }
 return path
}
export function resolveImportedNoteLink(href:string,source:NoteEntity,notes:NoteEntity[],folders:FolderEntity[]):NoteLinkResolution{
 if(!isImportedNoteLink(href))return{state:'invalid'}
 const [raw,hash='']=href.split('#',2)
 let fragment:string
 try{fragment=decodeURIComponent(hash)}catch{return{state:'invalid'}}
 if(raw.startsWith('/notes?note=')){
  const uid=new URLSearchParams(raw.slice('/notes?'.length)).get('note')
  const found=notes.filter(note=>!note.deleted&&note.uid===uid)
  return found.length===1?{state:'resolved',uid:found[0].uid,fragment}:{state:'missing'}
 }
 const base=folderPath(source,folders)
 if(!base)return{state:'missing'}
 let path:string
 try{path=decodeURIComponent(raw)}catch{return{state:'invalid'}}
 if(/[\\\x00-\x1f]/.test(path))return{state:'invalid'}
 const parts=[...base]
 for(const part of path.split('/')){
  if(!part||part==='.')continue
  if(part==='..'){if(!parts.length)return{state:'invalid'};parts.pop()}else parts.push(part)
 }
 const filename=parts.pop()!,directory=JSON.stringify(parts)
 const matches=notes.filter(note=>{
  if(note.deleted||note.type!=='note'||note.captureSource!=='folder_import'||scope(note)!==scope(source))return false
  const folder=folderPath(note,folders)
  if(!folder||JSON.stringify(folder)!==directory)return false
  if(note.fileName)return note.fileName===filename
  // Older folder imports discarded the original filename. Never match by title across directories.
  return filename.replace(/\.(md|markdown)$/i,'')===note.title
 })
 return matches.length===1?{state:'resolved',uid:matches[0].uid,fragment}:matches.length?{state:'ambiguous'}:{state:'missing'}
}
