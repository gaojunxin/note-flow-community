import {captureFileExportBoundary} from './fileExportBoundary'
import type {NoteEntity} from '@note-flow/core'
import type {FolderEntity} from './folders'
import {buildAiDownloadArchive,descendantUids,downloadAiArchive,type DownloadDirectory,type DownloadAsset} from './aiDownloadArchive'
import {cachedAttachment,listAttachments} from './attachments'
export {downloadKnowledge} from './knowledgeDownload'

async function assetsFor(ownerId:string,documents:{uid:string}[]){const assets:DownloadAsset[]=[];for(const document of documents)for(const item of await listAttachments(document.uid))assets.push({uid:item.uid,name:item.originalFilename,documentUid:document.uid,blob:await cachedAttachment(ownerId,item)});return assets}
export async function downloadNotes(ownerId:string,notes:NoteEntity[],folders:FolderEntity[],get:(uid:string)=>Promise<NoteEntity|undefined>,scope?:{folderUid?:string;noteUid?:string}){
 const assertCurrent=captureFileExportBoundary();assertCurrent()
 const directories:DownloadDirectory[]=folders.map(value=>({uid:value.uid,parentUid:value.parentUid||(folders.find(parent=>parent.id===value.parentId)?.uid),name:value.name,metadata:value}))
 const included=scope?.folderUid?descendantUids(directories,scope.folderUid):undefined
 const selected=notes.filter(value=>!value.deleted&&(!scope?.noteUid||value.uid===scope.noteUid)&&(!included||included.has(value.folderUid||folders.find(folder=>folder.id===value.folderId)?.uid||'')))
 const documents=[]
 for(const value of selected){const note=await get(value.uid);assertCurrent();if(!note||typeof note.content!=='string')throw Error(`无法读取笔记正文：${value.title}`);const {content,...metadata}=note;documents.push({uid:note.uid,directoryUid:scope?.noteUid?undefined:note.folderUid||folders.find(folder=>folder.id===note.folderId)?.uid,title:note.title,content,metadata})}
 const exported=scope?.noteUid?[]:directories.filter(value=>!included||included.has(value.uid)).map(value=>({...value,parentUid:value.uid===scope?.folderUid?undefined:value.parentUid}))
 return downloadAiArchive(await buildAiDownloadArchive(exported,documents,await assetsFor(ownerId,documents)),scope?.noteUid?selected[0]?.title||'笔记':folders.find(value=>value.uid===scope?.folderUid)?.name||'笔记库',assertCurrent)
}
