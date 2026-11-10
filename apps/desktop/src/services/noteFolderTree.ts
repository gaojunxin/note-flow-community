import {compareOrderedNames} from '@note-flow/core/natural-name-sort'
import type {FolderEntity} from './folders'
import type {AreaEntity} from './workspace'
import type {WorkspaceTreeNode} from '../components/WorkspaceTree.vue'

export interface NoteAreaGroup {uid:string;label:string;count:number;folders:FolderEntity[]}
export const areaTreeId=(uid:string)=>`area:${uid}`
export const selectedTreeArea=(id:number|string):string|undefined=>typeof id==='string'&&id.startsWith('area:')?id.slice(5):undefined

/** Presentation only: keep real folder identities and parent links for editing. */
export function projectVisibleFolders(folders:FolderEntity[],project?:{uid:string;name:string}):FolderEntity[]{
  if(!project?.uid||!project.name)return folders
  const roots=folders.filter(folder=>folder.projectUid===project.uid&&folder.name===project.name)
  if(!roots.length)return folders
  const byId=new Map(folders.map(folder=>[folder.id,folder]))
  const byUid=new Map(folders.map(folder=>[folder.uid,folder]))
  const hidden=new Set<number>()
  const rootIds=new Set(roots.map(folder=>folder.id))
  for(const root of roots){
    let current:FolderEntity|undefined=root
    const chain=new Set<number>();let nested=false
    while(current){
      if(chain.has(current.id))return folders
      if(current.projectUid&&current.projectUid!==project.uid)return folders
      if(current.id!==root.id&&rootIds.has(current.id))nested=true
      chain.add(current.id)
      current=(current.parentUid?byUid.get(current.parentUid):undefined)??(current.parentId==null?undefined:byId.get(current.parentId))
    }
    if(!nested)for(const id of chain)hidden.add(id)
  }
  return folders.filter(folder=>!hidden.has(folder.id))
}

export function buildFolderNodes(folders:FolderEntity[]):WorkspaceTreeNode[]{
  const byId=new Map(folders.map(folder=>[folder.id,folder])),children=new Map<number|null,FolderEntity[]>()
  for(const folder of folders){const parent=folder.parentId==null?undefined:byId.get(folder.parentId);const parentId=parent&&(parent.areaUid||'')===(folder.areaUid||'')?parent.id:null;children.set(parentId,[...(children.get(parentId)||[]),folder])}
  const visited=new Set<number>()
  const append=(values:FolderEntity[]):WorkspaceTreeNode[]=>[...values].sort(compareOrderedNames).flatMap(folder=>{
    if(visited.has(folder.id))return[]
    visited.add(folder.id)
    return[{id:folder.id,label:folder.name,kind:'folder',raw:folder,children:append(children.get(folder.id)||[])}]
  })
  const roots=append(children.get(null)||[])
  return[...roots,...append(folders.filter(folder=>!visited.has(folder.id)))]
}

export function buildNoteAreaGroups(areas:AreaEntity[],folders:FolderEntity[],counts:Map<string,number>):NoteAreaGroup[]{
  const foldersByArea=new Map<string,FolderEntity[]>()
  for(const folder of folders){const uid=folder.areaUid||'';foldersByArea.set(uid,[...(foldersByArea.get(uid)||[]),folder])}
  const groups:NoteAreaGroup[]=[...areas].filter(area=>!area.archived||foldersByArea.has(area.uid)||counts.has(area.uid)).sort((a,b)=>Number(a.sortOrder||0)-Number(b.sortOrder||0)||a.name.localeCompare(b.name,'zh-CN')).map(area=>({uid:area.uid,label:area.name,count:counts.get(area.uid)||0,folders:foldersByArea.get(area.uid)||[]}))
  const known=new Set(groups.map(group=>group.uid))
  for(const uid of new Set([...foldersByArea.keys(),...counts.keys()])){
    if(uid&&!known.has(uid))groups.push({uid,label:'领域信息待同步',count:counts.get(uid)||0,folders:foldersByArea.get(uid)||[]})
  }
  if(foldersByArea.has('')||counts.has(''))groups.push({uid:'',label:'未归属领域',count:counts.get('')||0,folders:foldersByArea.get('')||[]})
  return groups
}

export function expandedNoteAreas(groups:NoteAreaGroup[],remembered:Record<string,boolean>,preferredUid:string){
  const initial=groups.some(group=>group.uid===preferredUid)?preferredUid:groups[0]?.uid
  return groups.filter(group=>remembered[areaTreeId(group.uid)]??group.uid===initial).map(group=>areaTreeId(group.uid))
}
