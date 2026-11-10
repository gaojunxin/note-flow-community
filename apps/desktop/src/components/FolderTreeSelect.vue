<script setup lang="ts">
import {compareOrderedNames} from '@note-flow/core/natural-name-sort'
import {computed} from 'vue'
import {ElTreeSelect} from 'element-plus'
import 'element-plus/es/components/tree-select/style/css'
import type {FolderEntity} from '../services/folders'
import {folderPath} from '../services/folderDestinations'
const props=withDefaults(defineProps<{modelValue:string;folders:FolderEntity[];disabled?:boolean;placeholder?:string;ariaLabel?:string}>(),{placeholder:'不指定目录',ariaLabel:'目录'})
const emit=defineEmits<{'update:modelValue':[value:string]}>()
type Node={value:string;label:string;name:string;children:Node[]}
const tree=computed(()=>{
 const rows=[...props.folders].sort(compareOrderedNames),nodes=new Map(rows.map(row=>[row.uid,{value:row.uid,label:folderPath(row,rows),name:row.name,children:[]} as Node])),roots:Node[]=[]
 const parent=(row:FolderEntity)=>rows.find(value=>row.parentUid?value.uid===row.parentUid:row.parentId!=null&&value.id===row.parentId)
 for(const row of rows){const node=nodes.get(row.uid)!,seen=new Set([row.uid]);let ancestor=parent(row),cycle=false;while(ancestor){if(seen.has(ancestor.uid)){cycle=true;break}seen.add(ancestor.uid);ancestor=parent(ancestor)}const target=parent(row);if(target&&!cycle)nodes.get(target.uid)!.children.push(node);else roots.push(node)}
 return roots
})
</script>
<template><ElTreeSelect :model-value="modelValue||undefined" :data="tree" :disabled="disabled" check-strictly clearable filterable :render-after-expand="false" :teleported="false" :placeholder="placeholder" :aria-label="ariaLabel" @update:model-value="emit('update:modelValue',$event||'')"><template #default="{data}"><span :title="data.label">{{data.name}}</span></template></ElTreeSelect></template>
