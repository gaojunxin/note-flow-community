<script setup lang="ts">
import {saveLocalExport} from '../services/localFileExport'
import MoreIcon from './MoreIcon.vue'
import {ElButton} from 'element-plus'
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {useRouter} from 'vue-router'
import {workspaceService,type ProjectEntity} from '../services/workspace'
import {useAuthStore} from '../stores/auth'
import {readProjectShortcutPreferences,writeProjectShortcutPreferences,recordRecentProject} from '../services/projectShortcuts'
import {scopedPreferenceKey} from '../services/clientContext'
import WorkspaceTree,{type WorkspaceTreeNode} from './WorkspaceTree.vue'

const props=defineProps<{projects:ProjectEntity[];selectedUid?:string;areaUid:string;areaName?:string;selectedAreaName?:string}>()
const emit=defineEmits<{select:[uid:string];create:[];collapse:[];all:[]}>()
const auth=useAuthStore()
const router=useRouter()
const ownerId=computed(()=>String(auth.user?.userId||'anonymous'))
const preferences=ref(readProjectShortcutPreferences(ownerId.value))
const collapseStorageKey=computed(()=>scopedPreferenceKey('note-flow-project-groups',ownerId.value))
const defaultCollapsedGroups=['paused','completed','archived']
const readCollapsed=()=>{const stored=localStorage.getItem(collapseStorageKey.value);if(stored===null)return new Set<string>(defaultCollapsedGroups);try{const value=JSON.parse(stored);return new Set<string>(Array.isArray(value)?value:defaultCollapsedGroups)}catch{return new Set<string>(defaultCollapsedGroups)}}
const collapsed=ref(readCollapsed())
const query=ref('')
const menu=ref<{project:ProjectEntity;x:number;y:number}>()
const actionBusy=ref(false)
const selectedOutsideArea=computed(()=>Boolean(props.areaUid&&props.selectedUid&&props.projects.some(project=>project.uid===props.selectedUid&&project.areaUid!==props.areaUid)))
const scopedProjects=computed(()=>props.projects.filter(project=>!project.deleted&&(!props.areaUid||project.areaUid===props.areaUid||project.uid===props.selectedUid)))
const visibleProjects=computed(()=>{const value=query.value.trim().toLocaleLowerCase();return value?scopedProjects.value.filter(project=>`${project.name} ${project.description||''}`.toLocaleLowerCase().includes(value)):scopedProjects.value})
const pinnedSet=computed(()=>new Set(preferences.value.pinnedUids))
const groups=computed(()=>{
  const pinned=visibleProjects.value.filter(project=>pinnedSet.value.has(project.uid))
  const recent=visibleProjects.value.filter(project=>!pinnedSet.value.has(project.uid)&&preferences.value.recent[project.uid]!=null).sort((a,b)=>preferences.value.recent[b.uid]-preferences.value.recent[a.uid]).slice(0,5)
  const regular=visibleProjects.value.filter(project=>!pinnedSet.value.has(project.uid))
  return [
    {key:'recent',label:'最近访问',projects:recent},
    {key:'pinned',label:'置顶',projects:pinned},
    {key:'active',label:'进行中',projects:regular.filter(project=>project.status==='active'||project.status==='planning')},
    {key:'paused',label:'已暂停',projects:regular.filter(project=>project.status==='paused')},
    {key:'completed',label:'已完成',projects:regular.filter(project=>project.status==='completed')},
    {key:'archived',label:'已归档',projects:regular.filter(project=>project.status==='archived')}
  ]
})
const targetLabel=(value:string)=>`目标 ${new Date(`${value}T12:00:00`).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})}`
const treeNodes=computed<WorkspaceTreeNode[]>(()=>groups.value.map(group=>({id:`group:${group.key}`,label:group.label,kind:'group',count:group.projects.length,raw:group.key,children:group.projects.map(project=>({id:group.key==='recent'?`recent:${project.uid}`:project.uid,label:project.name,kind:'project',raw:project}))})))
const selectedTreeId=computed(()=>groups.value.find(group=>group.key==='recent')?.projects.some(project=>project.uid===props.selectedUid)?`recent:${props.selectedUid}`:props.selectedUid)
const expandedIds=computed(()=>groups.value.filter(group=>query.value.trim()||!collapsed.value.has(group.key)).map(group=>`group:${group.key}`))
const projectOf=(node:WorkspaceTreeNode)=>node.raw as ProjectEntity
function setGroupCollapsed(node:WorkspaceTreeNode,value:boolean){if(node.kind!=='group')return;const next=new Set(collapsed.value);value?next.add(String(node.raw)):next.delete(String(node.raw));collapsed.value=next;localStorage.setItem(collapseStorageKey.value,JSON.stringify([...next]))}
function selectNode(node:WorkspaceTreeNode){if(node.kind==='project'){preferences.value=recordRecentProject(ownerId.value,projectOf(node).uid);emit('select',projectOf(node).uid)}else setGroupCollapsed(node,!collapsed.value.has(String(node.raw)))}
function treeMenu(event:MouseEvent,node:WorkspaceTreeNode){if(node.kind==='project')openMenu(projectOf(node),event)}
function togglePinned(uid:string){const values=preferences.value.pinnedUids,next=values.includes(uid)?values.filter(value=>value!==uid):[...values,uid];preferences.value={...preferences.value,pinnedUids:next};writeProjectShortcutPreferences(ownerId.value,preferences.value)}
function openMenu(project:ProjectEntity,event:MouseEvent){event.preventDefault();event.stopPropagation();const width=184,height=310;menu.value={project,x:Math.min(event.clientX,window.innerWidth-width-8),y:Math.min(event.clientY,window.innerHeight-height-8)}}
function closeMenu(){menu.value=undefined}
function closeMenuOnEscape(event:KeyboardEvent){if(event.key==='Escape')closeMenu()}
async function setProjectStatus(project:ProjectEntity,status:ProjectEntity['status']){actionBusy.value=true;try{await workspaceService.updateProject(project,{status});window.dispatchEvent(new Event('note-flow:workspace-change'));closeMenu()}finally{actionBusy.value=false}}
async function restore(project:ProjectEntity){actionBusy.value=true;try{await workspaceService.restoreProject(project,'paused');window.dispatchEvent(new Event('note-flow:workspace-change'));closeMenu()}finally{actionBusy.value=false}}
function openAction(project:ProjectEntity,action?:'archive'|'move'){closeMenu();void router.push({path:`/projects/${project.uid}/tasks`,query:action?{action,request:crypto.randomUUID()}:undefined})}
async function exportProject(project:ProjectEntity){await saveLocalExport(new Blob([JSON.stringify({exportedAt:new Date().toISOString(),project},null,2)],{type:'application/json'}),`${project.name}-项目归档.json`);closeMenu()}
watch(ownerId,()=>{preferences.value=readProjectShortcutPreferences(ownerId.value);collapsed.value=readCollapsed()})
watch(()=>[props.selectedUid,props.projects] as const,([uid])=>{if(uid)preferences.value=recordRecentProject(ownerId.value,uid);const group=groups.value.find(value=>value.projects.some(project=>project.uid===uid));if(group&&collapsed.value.has(group.key)){const next=new Set(collapsed.value);next.delete(group.key);collapsed.value=next}},{immediate:true})
onMounted(()=>{window.addEventListener('pointerdown',closeMenu);window.addEventListener('blur',closeMenu);window.addEventListener('keydown',closeMenuOnEscape)})
onBeforeUnmount(()=>{window.removeEventListener('pointerdown',closeMenu);window.removeEventListener('blur',closeMenu);window.removeEventListener('keydown',closeMenuOnEscape)})
</script>

<template>
  <aside class="project-list-panel">
    <header><strong>切换项目</strong><span class="project-list-header-actions"><ElButton text size="small" aria-label="新建项目" @click="emit('create')">＋ 新建</ElButton></span></header>
    <label class="project-list-search"><span>⌕</span><input v-model="query" type="search" placeholder="搜索项目" aria-label="搜索项目"/><button v-if="query" type="button" aria-label="清空项目搜索" @click="query=''">×</button></label>
    <p v-if="selectedOutsideArea" class="project-area-context-note">当前项目属于「{{selectedAreaName||'其他领域'}}」，全局范围仍为「{{areaName||'当前领域'}}」。</p>
    <WorkspaceTree class="project-navigation-tree" :nodes="treeNodes" :selected-id="selectedTreeId" :expanded-ids="expandedIds" :indent="15" :empty-text="query.trim()?'没有匹配的项目':'还没有项目'" @select="selectNode" @expand="node=>setGroupCollapsed(node,false)" @collapse="node=>setGroupCollapsed(node,true)" @menu="treeMenu">
      <template #node="{node}">
        <div class="project-tree-item" :class="{'project-tree-group':node.kind==='group'}" :title="node.kind==='project'&&projectOf(node).targetDate?`${node.label} · ${targetLabel(projectOf(node).targetDate!)}`:node.label">
          <svg class="project-tree-icon" viewBox="0 0 20 20" aria-hidden="true"><path v-if="node.kind==='group'" d="M2.5 6.5V4.5h5l2 2h8v10h-15z"/><g v-else><rect x="3" y="5" width="14" height="12" rx="2"/><path d="M7 5V3h6v2M3 9h14M8 9v3h4V9"/></g></svg>
          <span>{{node.label}}</span>
          <small v-if="node.kind==='group'">{{node.count}}</small>
          <small v-else-if="projectOf(node).targetDate" class="project-tree-date">{{targetLabel(projectOf(node).targetDate!)}}</small>
          <button v-if="node.kind==='project'" type="button" :aria-label="`${node.label}的更多操作`" @click.stop="openMenu(projectOf(node),$event)" class="pc-more-trigger"><MoreIcon/></button><i v-else class="project-tree-action-space"/>
        </div>
      </template>
    </WorkspaceTree>
    <p v-if="query.trim()&&!visibleProjects.length" class="project-list-no-result">没有匹配的项目</p>
    <footer class="project-switcher-footer"><ElButton text size="small" @click="emit('all')">全部项目 →</ElButton><ElButton text size="small" @click="emit('collapse')">关闭</ElButton></footer>
    <Teleport to="body"><menu v-if="menu" class="project-context-menu pc-menu" :style="{left:`${menu.x}px`,top:`${menu.y}px`}" @pointerdown.stop><strong>{{menu.project.name}}</strong><button class="pc-menu__item" @click="openAction(menu.project)">打开项目</button><button class="pc-menu__item" @click="togglePinned(menu.project.uid);closeMenu()">{{pinnedSet.has(menu.project.uid)?'取消置顶':'置顶项目'}}</button><hr/><section v-if="menu.project.status!=='archived'" class="project-status-menu-group"><small>修改状态</small><div><button class="pc-menu__item" :class="{active:menu.project.status==='active'||menu.project.status==='planning'}" :disabled="actionBusy||menu.project.status==='active'" @click="setProjectStatus(menu.project,'active')">进行中</button><button class="pc-menu__item" :class="{active:menu.project.status==='paused'}" :disabled="actionBusy||menu.project.status==='paused'" @click="setProjectStatus(menu.project,'paused')">已暂停</button><button class="pc-menu__item" :class="{active:menu.project.status==='completed'}" :disabled="actionBusy||menu.project.status==='completed'" @click="setProjectStatus(menu.project,'completed')">已完成</button></div></section><button class="pc-menu__item" @click="openAction(menu.project,'move')">移动到其他领域</button><button class="pc-menu__item" v-if="menu.project.status!=='archived'" @click="openAction(menu.project,'archive')">归档项目…</button><button class="pc-menu__item" v-else :disabled="actionBusy" @click="restore(menu.project)">恢复为已暂停</button><hr/><button class="pc-menu__item" @click="exportProject(menu.project)">导出项目</button></menu></Teleport>
  </aside>
</template>

<style scoped>
.project-list-header-actions{display:flex;align-items:center;gap:4px}
.project-list-header-actions>button{display:grid;place-items:center;min-width:28px;height:28px;padding:0;cursor:pointer}
.project-list-header-actions>button:hover{background:var(--pc-primary-soft);border-radius:6px}
.project-list-header-actions svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.project-navigation-tree{padding:2px 0 7px}
.project-navigation-tree :deep(.el-tree-node__content){height:26px;min-height:26px;align-items:center}
.project-tree-item{display:flex;min-width:0;flex:1;height:26px;align-items:center;gap:6px;padding:0 2px;font-size:10px;line-height:16px}
.project-tree-item>span{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.project-tree-item>small{flex:none;min-width:18px;color:var(--pc-muted);font-size:9px;text-align:right}
.project-tree-item>.project-tree-date{font-size:8px;white-space:nowrap}
.project-tree-item>button{visibility:hidden;display:inline-flex;flex:none;align-items:center;justify-content:center;width:20px;height:20px;margin:0;padding:0;border:0;border-radius:5px;background:transparent;color:#849189;font-size:14px;line-height:1}
.project-tree-item:hover>button,.project-tree-item>button:focus-visible{visibility:visible}
.project-tree-item>button:hover{background:#e5efe9;color:var(--pc-primary)}
.project-tree-icon{display:block;flex:0 0 14px;width:14px;height:14px;fill:none;stroke:#8b9b92;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.project-tree-group{font-weight:650}.project-tree-group .project-tree-icon{stroke:var(--pc-primary)}.project-tree-action-space{flex:0 0 20px}
.project-navigation-tree :deep(.el-tree-node.is-current>.el-tree-node__content .project-tree-icon){stroke:var(--pc-primary)}
:global(.project-context-menu .project-status-menu-group){display:grid;gap:6px;padding:5px 7px 8px}
:global(.project-context-menu .project-status-menu-group>small){color:#829087;font-size:9px;font-weight:700}
:global(.project-context-menu .project-status-menu-group>div){display:grid;grid-template-columns:repeat(3,1fr);gap:4px}
:global(.project-context-menu .project-status-menu-group button){min-width:0;padding:6px 4px;border:1px solid #dde5e0;border-radius:6px;background:#f8faf9;color:#52665d;font-size:9px;text-align:center}
:global(.project-context-menu .project-status-menu-group button.active){border-color:#9fc8b4;background:#e7f3ec;color:#216447;font-weight:700}
:global(.project-context-menu .project-status-menu-group button:disabled){cursor:default;opacity:1}
</style>
