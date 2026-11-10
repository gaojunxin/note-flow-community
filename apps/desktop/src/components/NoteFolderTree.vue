<script setup lang="ts">
import MoreIcon from './MoreIcon.vue'
import {computed} from 'vue'
import type {FolderEntity} from '../services/folders'
import WorkspaceTree,{type WorkspaceTreeNode} from './WorkspaceTree.vue'
import {areaTreeId,buildFolderNodes,type NoteAreaGroup} from '../services/noteFolderTree'
const props=defineProps<{folders:FolderEntity[];selectedId?:number|string;collapsedIds:Set<number|string>;counts:Map<number,number>;query?:string;areaGroups?:NoteAreaGroup[];expandedAreaIds?:string[]}>()
const emit=defineEmits<{select:[folder:FolderEntity];toggle:[folder:FolderEntity,collapsed:boolean];menu:[event:MouseEvent,folder:FolderEntity];menuArea:[event:MouseEvent,area:NoteAreaGroup];selectArea:[uid:string];toggleArea:[uid:string,collapsed:boolean];dragFolder:[event:DragEvent,folder:FolderEntity];dropFolder:[event:DragEvent,folder:FolderEntity]}>()
const nodes=computed<WorkspaceTreeNode[]>(()=>props.areaGroups?props.areaGroups.map(group=>({id:areaTreeId(group.uid),label:group.label,kind:'area',count:group.count,raw:group,children:buildFolderNodes(group.folders)})):buildFolderNodes(props.folders))
const expandedIds=computed(()=>[...props.folders.filter(folder=>!props.collapsedIds.has(folder.id)).map(folder=>folder.id),...(props.expandedAreaIds||[])])
const folderOf=(node:WorkspaceTreeNode)=>node.raw as FolderEntity
const areaOf=(node:WorkspaceTreeNode)=>node.raw as NoteAreaGroup
function select(node:WorkspaceTreeNode){if(node.kind==='area')emit('selectArea',areaOf(node).uid);else emit('select',folderOf(node))}
function toggle(node:WorkspaceTreeNode,collapsed:boolean){if(node.kind==='area')emit('toggleArea',areaOf(node).uid,collapsed);else emit('toggle',folderOf(node),collapsed)}
function menu(event:MouseEvent,node:WorkspaceTreeNode){if(node.kind==='area')emit('menuArea',event,areaOf(node));else emit('menu',event,folderOf(node))}
</script>
<template><WorkspaceTree class="note-folder-tree" :nodes="nodes" :selected-id="selectedId" :expanded-ids="expandedIds" :query="query" :indent="15" empty-text="没有匹配的目录" @select="select" @expand="node=>toggle(node,false)" @collapse="node=>toggle(node,true)" @menu="menu"><template #node="{node}"><div v-if="node.kind==='area'" class="folder-node area-node" :title="`${node.label} · ${node.count} 篇笔记`"><svg class="folder-node-icon area-node-icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="5" height="5" rx="1"/><rect x="12" y="3" width="5" height="5" rx="1"/><rect x="3" y="12" width="5" height="5" rx="1"/><rect x="12" y="12" width="5" height="5" rx="1"/></svg><span>{{node.label}}</span><small>{{node.count}}</small><i class="area-action-space"/></div><div v-else class="folder-node" :title="node.label" draggable="true" @dragstart.stop="emit('dragFolder',$event,folderOf(node))" @dragover.prevent @drop.stop.prevent="emit('dropFolder',$event,folderOf(node))"><svg class="folder-node-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 6.5V4.5h5l2 2h8v10h-15z"/></svg><span>{{node.label}}</span><small>{{counts.get(Number(node.id))||0}}</small><button type="button" :aria-label="`${node.label}的更多操作`" @click.stop="emit('menu',$event,folderOf(node))" class="pc-more-trigger"><MoreIcon/></button></div></template></WorkspaceTree></template>
<style scoped>
.note-folder-tree{padding:2px 7px 7px}
.note-folder-tree :deep(.el-tree-node__content){height:26px;min-height:26px;align-items:center}
.folder-node{display:flex;min-width:0;flex:1;height:26px;align-items:center;gap:6px;padding:0 2px;font-size:10px;line-height:16px}
.folder-node>span{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.folder-node>small{flex:none;min-width:18px;color:var(--pc-muted);font-size:9px;text-align:right}
.folder-node>button{visibility:hidden;display:inline-flex;flex:none;align-items:center;justify-content:center;width:20px;height:20px;margin:0;padding:0;border:0;border-radius:5px;background:transparent;color:#849189;font-size:14px;line-height:1}
.folder-node:hover>button,.folder-node>button:focus-visible{visibility:visible}
.folder-node>button:hover{background:#e5efe9;color:var(--pc-primary)}
.folder-node-icon{display:block;flex:0 0 14px;width:14px;height:14px;fill:none;stroke:#8b9b92;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
:deep(.el-tree-node.is-current>.el-tree-node__content .folder-node-icon){stroke:var(--pc-primary)}
.area-node{font-weight:650}.area-node-icon{stroke:var(--pc-primary)}.area-action-space{flex:0 0 20px}
</style>
