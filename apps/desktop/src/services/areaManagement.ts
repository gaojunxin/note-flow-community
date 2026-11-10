import type {AreaEntity} from '@note-flow/core'
export function areaChanges(name:string,color:string){
 const trimmed=name.trim()
 if(!trimmed||trimmed.length>80)throw Error('领域名称应为 1–80 个字符')
 if(color&&!/^#[0-9a-f]{6}$/i.test(color))throw Error('请选择有效的领域颜色')
 return {name:trimmed,color:color||null}
}
export function activeAreas(values:AreaEntity[]){return values.filter(value=>!value.deleted&&!value.archived).sort((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name))}
export function assertEmptyArea(references:Array<{label:string;count:number}>){
 const occupied=references.filter(value=>value.count>0)
 if(occupied.length)throw Error(`领域仍有关联内容（${occupied.map(value=>`${value.label} ${value.count}`).join('、')}），请先迁移内容，或改用归档。回收站内容也会保留归属。`)
}
