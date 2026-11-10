import type {NoteEntity} from '@note-flow/core'
import type {FolderEntity} from './folders'
export interface NoteListPreview {before:string;match:string;after:string}
function plainText(value:string,title=''){
 return value.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,'').split(/\r?\n/)
  .filter(line=>line.replace(/^#{1,6}\s+/,'').trim()!==title.trim()&&!/^\s*```|^\s*~~~/.test(line))
  .join(' ').replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/<[^>]+>/g,' ').replace(/[#*_>`~]/g,'').replace(/\s+/g,' ').trim()
}
/** Search previews center the actual match; ordinary browsing has no preview by default. */
export function noteListPreview(note:Pick<NoteEntity,'title'|'content'|'summary'|'fileName'>,query:string,showSummary:boolean):NoteListPreview|undefined{
 if(query.trim()){
  const needle=query.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim()
  for(const source of [note.content,note.summary,note.fileName]){
   const text=plainText(source||'').normalize('NFKC'),index=text.toLocaleLowerCase().indexOf(needle)
   if(index<0)continue
   const start=Math.max(0,index-12),end=Math.min(text.length,Math.max(start+110,index+needle.length+30))
   return{before:(start?'…':'')+text.slice(start,index),match:text.slice(index,index+needle.length),after:text.slice(index+needle.length,end)+(end<text.length?'…':'')}
  }
  return undefined
 }
 if(!showSummary)return undefined
 const text=plainText(note.summary||note.content||'',note.title)
 return text?{before:text.slice(0,110)+(text.length>110?'…':''),match:'',after:''}:undefined
}
export function noteDirectoryPath(note:Pick<NoteEntity,'folderUid'|'folderId'>,folders:FolderEntity[]){
 let folder=folders.find(value=>note.folderUid?value.uid===note.folderUid:value.id===note.folderId)
 const names:string[]=[],seen=new Set<string>()
 while(folder&&!seen.has(folder.uid)){seen.add(folder.uid);names.unshift(folder.name);const parentUid=folder.parentUid,parentId=folder.parentId;folder=folders.find(value=>parentUid?value.uid===parentUid:parentId!=null&&value.id===parentId)}
 return names.join(' / ')
}

export function noteListUpdatedDate(value?:string|null){
 if(!value)return ''
 const date=new Date(value)
 if(!Number.isFinite(date.getTime()))return ''
 const pad=(part:number)=>String(part).padStart(2,'0')
 return `${pad(date.getMonth()+1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
