<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { ElTree } from 'element-plus'
import 'element-plus/es/components/tree/style/css'
import 'element-plus/es/components/icon/style/css'

export interface WorkspaceTreeNode { id:string|number;label:string;children?:WorkspaceTreeNode[];raw?:unknown;count?:number;kind?:string;loading?:boolean }
type TreeHandle={filter:(value:string)=>void;setCurrentKey:(key?:string|number)=>void;getNode:(key:string|number)=>{expanded:boolean}|undefined}
const props=withDefaults(defineProps<{nodes:WorkspaceTreeNode[];selectedId?:string|number;expandedIds?:Array<string|number>;query?:string;indent?:number;emptyText?:string}>(),{expandedIds:()=>[],query:'',indent:15,emptyText:'暂无内容'})
const emit=defineEmits<{select:[node:WorkspaceTreeNode];expand:[node:WorkspaceTreeNode];collapse:[node:WorkspaceTreeNode];menu:[event:MouseEvent,node:WorkspaceTreeNode]}>()
// 初次渲染（含SSR）使用初始展开键；后续只走一次受控同步，避免ElTree重复展开祖先。
const initialExpandedIds=[...props.expandedIds]
const tree=ref<TreeHandle>()
const filterNode=(query:string,data:Record<string,unknown>)=>!query||String(data.label||'').toLocaleLowerCase().includes(query.toLocaleLowerCase())
const openMenu=(event:Event,node:WorkspaceTreeNode)=>emit('menu',event as MouseEvent,node)
watch(()=>props.selectedId,value=>tree.value?.setCurrentKey(value),{flush:'post'})
let filteredQuery='',filteredNodes:WorkspaceTreeNode[]|undefined
/** 调用方用新数组提交目录投影；折叠只改展开集合，不触发整树异步过滤或遍历业务正文。 */
function syncTreeState(){
  const query=props.query.trim()
  if(query!==filteredQuery||(query&&props.nodes!==filteredNodes))tree.value?.filter(query)
  filteredQuery=query;filteredNodes=props.nodes
  if(query)return // 搜索临时展开匹配祖先，不改调用方保存的展开状态。
  const expanded=new Set(props.expandedIds)
  // 收起祖先即停止访问隐藏后代，避免上千个已挂载行同时更新；重开时再按受控集合校正。
  const visit=(nodes:WorkspaceTreeNode[])=>{for(const node of nodes){const target=tree.value?.getNode(node.id);if(target&&target.expanded!==expanded.has(node.id))target.expanded=expanded.has(node.id);if(node.children&&expanded.has(node.id))visit(node.children)}}
  visit(props.nodes)
}
watch([()=>props.expandedIds,()=>props.nodes,()=>props.query],syncTreeState,{flush:'post'})
onMounted(syncTreeState)
</script>
<template><ElTree ref="tree" class="workspace-tree" :data="nodes" node-key="id" :props="{label:'label',children:'children'}" :current-node-key="selectedId" :default-expanded-keys="initialExpandedIds" :auto-expand-parent="false" :expand-on-click-node="false" :highlight-current="true" :filter-node-method="filterNode" :indent="indent" :empty-text="emptyText" @node-click="node=>emit('select',node)" @node-expand="node=>emit('expand',node)" @node-collapse="node=>emit('collapse',node)" @node-contextmenu="openMenu"><template #default="{data}"><slot name="node" :node="data"><div class="workspace-tree-default"><span>{{data.label}}</span><small v-if="data.count!=null">{{data.count}}</small></div></slot></template></ElTree></template>
<style scoped>
.workspace-tree{--el-tree-node-hover-bg-color:#f2f7f4;--el-fill-color-light:#edf5f0;--el-color-primary:var(--pc-primary);background:transparent;color:var(--pc-text)}.workspace-tree-default{display:flex;min-width:0;flex:1;gap:7px;padding:6px 3px;font-size:10px}.workspace-tree-default span{min-width:0;flex:1;overflow-wrap:anywhere}.workspace-tree-default small{flex:none;color:var(--pc-muted)}
:deep(.el-tree-node__content){height:auto;min-height:26px;border-radius:6px;align-items:center}:deep(.el-tree-node__content>.el-tree-node__expand-icon){box-sizing:border-box;display:inline-flex;flex:0 0 22px;align-items:center;justify-content:center;width:22px;height:22px;margin:0;padding:5px;font-size:12px}:deep(.el-tree-node__expand-icon svg){width:12px;height:12px;flex:none}:deep(.el-tree-node.is-current>.el-tree-node__content){background:var(--pc-primary-soft);color:var(--pc-primary)}:deep(.el-tree__empty-text){font-size:9px;color:var(--pc-muted)}
</style>
