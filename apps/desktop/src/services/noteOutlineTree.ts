import {computed,ref,watch,type Ref} from 'vue'
export interface OutlineHeading {text:string;level:number}
export interface OutlineRow extends OutlineHeading {index:number;key:string;parent:number;depth:number;hasChildren:boolean}
export function buildOutlineRows(headings:readonly OutlineHeading[]):OutlineRow[]{
 const rows:OutlineRow[]=[],stack:OutlineRow[]=[],counts=new Map<string,number>()
 headings.forEach((heading,index)=>{
  while(stack.length&&stack.at(-1)!.level>=heading.level)stack.pop()
  const parent=stack.at(-1),base=JSON.stringify([parent?.key||'',heading.level,heading.text]),occurrence=counts.get(base)||0
  counts.set(base,occurrence+1)
  const row={...heading,index,key:JSON.stringify([base,occurrence]),parent:parent?.index??-1,depth:stack.length,hasChildren:false}
  if(parent)parent.hasChildren=true
  rows.push(row);stack.push(row)
 })
 return rows
}
export function useNoteOutline(headings:Ref<OutlineHeading[]>,noteKey:Ref<string>,active:Ref<number>){
 const saved=new Map<string,Set<string>>(),collapsed=ref(new Set<string>())
 watch(noteKey,(key,previous)=>{if(previous)saved.set(previous,new Set(collapsed.value));collapsed.value=new Set(saved.get(key)||[])},{immediate:true,flush:'sync'})
 const rows=computed(()=>buildOutlineRows(headings.value))
 const visibleRows=computed(()=>{
  const hidden=new Set<number>()
  return rows.value.filter(row=>{if(row.parent>=0&&(hidden.has(row.parent)||collapsed.value.has(rows.value[row.parent].key))){hidden.add(row.index);return false}return true})
 })
 const activeIndex=computed(()=>{
  let row=rows.value[active.value]
  const visible=new Set(visibleRows.value.map(item=>item.index))
  while(row&&!visible.has(row.index))row=rows.value[row.parent]
  return row?.index??-1
 })
 function toggle(row:OutlineRow){const next=new Set(collapsed.value);if(next.has(row.key))next.delete(row.key);else next.add(row.key);collapsed.value=next}
 function expandAll(){collapsed.value=new Set()}
 function collapseAll(){collapsed.value=new Set(rows.value.filter(row=>row.hasChildren).map(row=>row.key))}
 return {rows,visibleRows,collapsed,activeIndex,toggle,expandAll,collapseAll}
}
