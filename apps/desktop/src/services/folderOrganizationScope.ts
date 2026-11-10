import type {NoteEntity} from '@note-flow/core'
import type {FolderEntity} from '@note-flow/core/contracts'
import {folderDescendants,sameFolderScope} from './folderDestinations'
import {consolidationEligible} from './noteConsolidation'
import {directorySources} from './folderOrganization'
interface NamedEntity {uid:string;name:string}
export interface DirectoryScope {key:string;areaUid:string|null;projectUid:string|null;areaName:string;projectName:string;label:string;folderCount:number;noteCount:number}
const identity=(value:{areaUid?:string|null;projectUid?:string|null})=>({areaUid:value.areaUid||null,projectUid:value.projectUid||null})
const stamp=(value:string)=>{let hash=2166136261;for(const char of value){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}return(hash>>>0).toString(16).padStart(8,'0')}
export function directoryScopeOptions(folders:FolderEntity[],notes:NoteEntity[],areas:NamedEntity[],projects:NamedEntity[]):DirectoryScope[]{
 const map=new Map<string,DirectoryScope>(),active=notes.filter(n=>consolidationEligible(n)&&n.status!=='archived')
 for(const row of [...folders,...active]){
  const scope=identity(row),key=JSON.stringify([scope.areaUid,scope.projectUid]);if(map.has(key))continue
  const areaName=scope.areaUid?(areas.find(a=>a.uid===scope.areaUid)?.name||`未加载领域 · ${scope.areaUid}`):'未指定领域'
  const projectName=scope.projectUid?(projects.find(p=>p.uid===scope.projectUid)?.name||`未加载项目 · ${scope.projectUid}`):'未关联项目'
  map.set(key,{key,...scope,areaName,projectName,label:`${areaName} / ${projectName}`,folderCount:folders.filter(f=>sameFolderScope(f,scope)).length,noteCount:directorySources(active,scope).length})
 }
 const options=[...map.values()],areaIds=new Map<string,Set<string>>();for(const row of options){const ids=areaIds.get(row.areaName)||new Set<string>();ids.add(row.areaUid||'');areaIds.set(row.areaName,ids)}
 for(const row of options)if((areaIds.get(row.areaName)?.size||0)>1){row.areaName=`${row.areaName}（${stamp(row.areaUid||'unassigned')}）`;row.label=`${row.areaName} / ${row.projectName}`}
 const counts=new Map<string,number>();for(const row of options)counts.set(row.label,(counts.get(row.label)||0)+1)
 const used=new Set<string>()
 for(const row of options){const base=(counts.get(row.label)||0)>1?`${row.label}（${stamp(row.key)}）`:row.label;let label=base,index=2;while(used.has(label))label=`${base} · ${index++}`;row.label=label;used.add(label)}
 return options.sort((a,b)=>a.areaName.localeCompare(b.areaName,'zh-CN')||a.projectName.localeCompare(b.projectName,'zh-CN')||a.key.localeCompare(b.key))
}
export function directoryScopeRange(folders:FolderEntity[],notes:NoteEntity[],scope:{areaUid?:string|null;projectUid?:string|null}|undefined,rootUid='',includeChildren=true){
 if(!scope)return{folders:[],notes:[]}
 const scopedFolders=folders.filter(f=>sameFolderScope(f,scope)),scopedNotes=directorySources(notes,scope)
 if(!rootUid)return{folders:scopedFolders,notes:scopedNotes}
 const root=scopedFolders.find(f=>f.uid===rootUid);if(!root)return{folders:[],notes:[]}
 const included=includeChildren?folderDescendants(root,scopedFolders):[root],uids=new Set(included.map(f=>f.uid)),ids=new Set(included.map(f=>f.id))
 return{folders:included,notes:scopedNotes.filter(n=>n.folderUid?uids.has(n.folderUid):n.folderId!=null&&ids.has(n.folderId))}
}
