export interface VaultAttribution { areaUid?:string|null; projectUid?:string|null }
export interface VaultProject { uid:string; areaUid?:string|null }

// Existing project links are evidence; unlinked legacy records must remain unassigned.
export function vaultAreaUid(item:VaultAttribution, projects:readonly VaultProject[]):string|null {
  const project=item.projectUid?projects.find(value=>value.uid===item.projectUid):undefined
  return project?.areaUid||item.areaUid||null
}

export function vaultMatchesContext(item:VaultAttribution, projects:readonly VaultProject[], areaUid='', projectUid='') {
  if(projectUid)return item.projectUid===projectUid
  return !areaUid||vaultAreaUid(item,projects)===areaUid
}

export function newVaultAttribution(areaUid:string, projects:readonly VaultProject[], projectContext='') {
  return {areaUid:projectContext?(projects.find(project=>project.uid===projectContext)?.areaUid||null):(areaUid||null),projectUid:null}
}

export function batchVaultAttribution(item:VaultAttribution, projects:readonly VaultProject[], mode:'keep'|'project'|'personal', projectUid='') {
  if(mode==='keep')return {}
  if(mode==='personal')return {scopeType:'personal' as const,projectUid:null,areaUid:vaultAreaUid(item,projects)}
  const project=projects.find(value=>value.uid===projectUid)
  if(!project)throw new Error('请选择有效项目')
  return {scopeType:'project' as const,projectUid:project.uid,areaUid:project.areaUid||null}
}
