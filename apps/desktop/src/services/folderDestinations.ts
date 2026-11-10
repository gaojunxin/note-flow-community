import type {FolderEntity} from '@note-flow/core/contracts'
export const sameFolderScope=(a:{areaUid?:string|null;projectUid?:string|null},b:{areaUid?:string|null;projectUid?:string|null})=>(a.areaUid||'')===(b.areaUid||'')&&(a.projectUid||'')===(b.projectUid||'')
export function folderPath(folder:FolderEntity,rows:FolderEntity[]){const names=[folder.name],seen=new Set([folder.uid]);let current=folder;while(current.parentUid||current.parentId!=null){const parent=rows.find(row=>current.parentUid?row.uid===current.parentUid:row.id===current.parentId);if(!parent||seen.has(parent.uid))break;seen.add(parent.uid);names.unshift(parent.name);current=parent}return names.join(' / ')}
export function folderDescendants(folder:FolderEntity,rows:FolderEntity[]){const result=[folder],seen=new Set([folder.uid]);for(let index=0;index<result.length;index++)for(const child of rows)if((child.parentUid?child.parentUid===result[index].uid:child.parentId===result[index].id)&&!seen.has(child.uid)){seen.add(child.uid);result.push(child)}return result}
export function validateFolderMove(folder:FolderEntity,parent:FolderEntity|null,rows:FolderEntity[]){
 const current=rows.find(row=>row.uid===folder.uid&&!('deleted' in row&&row.deleted));if(!current)throw Error('目录不存在，请刷新后重试')
 const target=parent?rows.find(row=>row.uid===parent.uid&&!('deleted' in row&&row.deleted)):null
 if(parent&&!target)throw Error('目标目录不存在，请刷新后重试')
 if(target&&!sameFolderScope(current,target))throw Error('只能移动到同一领域和项目的目录')
 let ancestor=target;const visited=new Set<string>()
 while(ancestor){
  if(visited.has(ancestor.uid))throw Error('目标目录的祖先存在循环，请先修复目录结构')
  visited.add(ancestor.uid)
  if(!sameFolderScope(current,ancestor))throw Error('目标目录祖先不属于同一领域和项目')
  if(!ancestor.parentUid&&ancestor.parentId==null)break
  const next=rows.find(row=>ancestor!.parentUid?row.uid===ancestor!.parentUid:row.id===ancestor!.parentId)
  if(!next||('deleted' in next&&next.deleted))throw Error('目标目录的祖先不存在，请先修复目录结构')
  ancestor=next
 }
 if(target&&folderDescendants(current,rows).some(row=>row.uid===target.uid))throw Error('不能移动到自身或子目录')
 if(rows.some(row=>row.uid!==current.uid&&sameFolderScope(row,current)&&!('deleted' in row&&row.deleted)&&(target?(row.parentUid?row.parentUid===target.uid:row.parentId===target.id):!row.parentUid&&row.parentId==null)&&row.name.trim().toLocaleLowerCase()===current.name.trim().toLocaleLowerCase()))throw Error(`目标层级已存在同名目录“${current.name}”，请先重命名`)
 return {current,parent:target||null}
}
