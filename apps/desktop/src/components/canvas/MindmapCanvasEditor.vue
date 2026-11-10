<template>
  <section class="mindmap-editor">
    <header>
      <div><strong>思维导图</strong><small v-if="linked">关联笔记投影 · 只读</small><small v-else>独立脑图 · 自动布局</small></div>
      <div class="actions"><button :disabled="readonly||!canUndo" title="撤销" @click="undo">↶</button><button :disabled="readonly||!canRedo" title="重做" @click="redo">↷</button><button :disabled="readonly||!selectedId" @click="addChild">＋ 子主题</button><button :disabled="readonly||!canSibling" @click="addSibling">＋ 同级</button><button :disabled="readonly||!canDelete" class="danger" @click="remove">删除</button></div>
    </header>
    <div class="banner-slot"><p v-if="error" class="banner error">{{error}}</p><p v-else-if="stale" class="banner stale">源笔记已有更新，此投影可能已过期。重新生成后即可恢复最新结构。</p></div>
    <div class="stage" @contextmenu="stageContextMenu">
      <svg class="links" :width="canvasWidth" :height="canvasHeight"><path v-for="link in links" :key="link.id" :d="link.path"/></svg>
      <button v-for="position in positions" :key="position.id" class="node" :data-node-id="position.id" :class="{selected:position.id===selectedId,root:position.id===document.rootId,dropTarget:dropTargetId===position.id}" :style="{left:`${position.x}px`,top:`${position.y}px`}" :draggable="!readonly&&position.id!==document.rootId" @dragstart="startDrag(position.id,$event)" @dragover.prevent="dragOver(position.id)" @dragleave="dropTargetId=''" @drop.prevent="dropOn(position.id)" @dragend="finishDrag" @click="selectedId=position.id" @dblclick="beginRename(position.id)" @keydown="nodeKeydown(position.id,$event)" @contextmenu="nodeContextMenu($event,position.id)">
        <span>{{nodeById.get(position.id)?.text}}</span><i v-if="hasChildren(position.id)" title="展开或折叠" @click.stop="toggle(position.id)">{{collapsed.has(position.id)?'＋':'－'}}</i>
      </button>
      <div v-if="editingId" class="rename" :style="renameStyle"><input ref="renameInput" v-model="editingText" @keydown.enter="commitRename" @keydown.esc="editingId=''" @blur="commitRename"/></div>
    </div>
    <footer><span>{{document.nodes.length}} 个节点</span><span>{{readonly?'关联投影不复制笔记正文':'Tab 子主题 · Enter 同级 · F2 重命名 · Delete 删除 · 方向键导航 · 右键更多'}}</span></footer>
  </section>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {addMindmapChild,addMindmapSibling,commitMindmapHistory,createMindmapHistory,deleteMindmapBranch,isLinkedProjectionStale,layoutMindmap,parseMindmapEditorDocument,redoMindmapHistory,renameMindmapNode,reparentMindmapNode,undoMindmapHistory} from '../../canvas/mindmapEditor'
import type {MindmapDocumentV1} from '../../services/mindmap'
import {openContextMenu} from '../../services/contextMenu'
const props=defineProps<{documentData:string;canvasType?:string;sourceMode?:'independent'|'linked';sourceNoteUid?:string|null}>(),emit=defineEmits<{change:[value:string]}>()
const parsed=ref(parseMindmapEditorDocument(props.documentData)),document=ref<MindmapDocumentV1>(parsed.value.document),history=ref(createMindmapHistory(document.value)),selectedId=ref(document.value.rootId),collapsed=ref(new Set<string>()),editingId=ref(''),editingText=ref(''),renameInput=ref<HTMLInputElement>(),draggedId=ref(''),dropTargetId=ref('')
watch(()=>props.documentData,value=>{const next=parseMindmapEditorDocument(value);parsed.value=next;if(JSON.stringify(next.document)!==JSON.stringify(document.value)){document.value=next.document;history.value=createMindmapHistory(next.document)}if(!document.value.nodes.some(node=>node.id===selectedId.value))selectedId.value=document.value.rootId})
const linked=computed(()=>parsed.value.linked),readonly=computed(()=>props.sourceMode==='linked'||Boolean(linked.value)),error=computed(()=>parsed.value.error),stale=computed(()=>isLinkedProjectionStale(linked.value))
const nodeById=computed(()=>new Map(document.value.nodes.map(node=>[node.id,node]))),positions=computed(()=>layoutMindmap(document.value,collapsed.value)),positionById=computed(()=>new Map(positions.value.map(item=>[item.id,item])))
const canvasWidth=computed(()=>Math.max(800,...positions.value.map(item=>item.x+260))),canvasHeight=computed(()=>Math.max(520,...positions.value.map(item=>item.y+100)))
const links=computed(()=>positions.value.flatMap(position=>{const node=nodeById.value.get(position.id),parent=node?.parentId?positionById.value.get(node.parentId):undefined;return parent?[{id:position.id,path:`M ${parent.x+174} ${parent.y+25} C ${parent.x+194} ${parent.y+25}, ${position.x-20} ${position.y+25}, ${position.x} ${position.y+25}`}]:[]}))
const canDelete=computed(()=>selectedId.value!==document.value.rootId),canSibling=computed(()=>Boolean(nodeById.value.get(selectedId.value)?.parentId))
const canUndo=computed(()=>history.value.past.length>0),canRedo=computed(()=>history.value.future.length>0)
const renameStyle=computed(()=>{const position=positionById.value.get(editingId.value);return position?{left:`${position.x}px`,top:`${position.y}px`}:{display:'none'}})
const serialize=()=>parsed.value.linked?JSON.stringify({...parsed.value.linked,document:document.value}):JSON.stringify(document.value)
const persist=(next:MindmapDocumentV1)=>{history.value=commitMindmapHistory(history.value,next);document.value=history.value.present;emit('change',serialize())}
function addChild(){if(!readonly.value){const next=addMindmapChild(document.value,selectedId.value);persist(next);selectedId.value=next.nodes[next.nodes.length-1].id}}
function addSibling(){if(!readonly.value){const next=addMindmapSibling(document.value,selectedId.value);persist(next);selectedId.value=next.nodes[next.nodes.length-1].id}}
function remove(){if(!readonly.value&&canDelete.value){const parent=nodeById.value.get(selectedId.value)?.parentId||document.value.rootId;persist(deleteMindmapBranch(document.value,selectedId.value));selectedId.value=parent}}
function hasChildren(id:string){return document.value.nodes.some(node=>node.parentId===id)}
function toggle(id:string){const next=new Set(collapsed.value);next.has(id)?next.delete(id):next.add(id);collapsed.value=next}
async function beginRename(id:string){if(readonly.value)return;editingId.value=id;editingText.value=nodeById.value.get(id)?.text||'';await nextTick();renameInput.value?.focus();renameInput.value?.select()}
function commitRename(){if(!editingId.value)return;persist(renameMindmapNode(document.value,editingId.value,editingText.value));editingId.value=''}
function undo(){history.value=undoMindmapHistory(history.value);document.value=history.value.present;emit('change',serialize())}
function redo(){history.value=redoMindmapHistory(history.value);document.value=history.value.present;emit('change',serialize())}
function startDrag(id:string,event:DragEvent){draggedId.value=id;event.dataTransfer?.setData('text/plain',id);if(event.dataTransfer)event.dataTransfer.effectAllowed='move'}
function dragOver(id:string){if(id!==draggedId.value)dropTargetId.value=id}
function dropOn(parentId:string){if(readonly.value||!draggedId.value)return;const next=reparentMindmapNode(document.value,draggedId.value,parentId);if(next!==document.value)persist(next);finishDrag()}
function finishDrag(){draggedId.value='';dropTargetId.value=''}
function selectNode(id:string){if(!nodeById.value.has(id))return;selectedId.value=id;void nextTick(()=>[...globalThis.document.querySelectorAll<HTMLButtonElement>('.mindmap-editor .node')].find(node=>node.dataset.nodeId===id)?.focus())}
function nodeKeydown(id:string,event:KeyboardEvent){
  if(event.target instanceof HTMLInputElement)return
  selectNode(id)
  const node=nodeById.value.get(id),siblings=document.value.nodes.filter(item=>item.parentId===node?.parentId).sort((a,b)=>a.order-b.order),index=siblings.findIndex(item=>item.id===id),children=document.value.nodes.filter(item=>item.parentId===id).sort((a,b)=>a.order-b.order)
  if(event.key==='ArrowLeft'&&node?.parentId){event.preventDefault();selectNode(node.parentId)}
  else if(event.key==='ArrowRight'&&children[0]){event.preventDefault();selectNode(children[0].id)}
  else if(event.key==='ArrowUp'&&siblings[index-1]){event.preventDefault();selectNode(siblings[index-1].id)}
  else if(event.key==='ArrowDown'&&siblings[index+1]){event.preventDefault();selectNode(siblings[index+1].id)}
  else if(!readonly.value&&event.key==='Tab'){event.preventDefault();addChild()}
  else if(!readonly.value&&event.key==='Enter'){event.preventDefault();id===document.value.rootId?addChild():addSibling()}
  else if(!readonly.value&&event.key==='F2'){event.preventDefault();void beginRename(id)}
  else if(!readonly.value&&(event.key==='Delete'||event.key==='Backspace')&&id!==document.value.rootId){event.preventDefault();remove()}
  else if((event.key===' '||event.key==='Spacebar')&&hasChildren(id)){event.preventDefault();toggle(id)}
}
function nodeContextMenu(event:MouseEvent,id:string){selectNode(id);openContextMenu(event,[
  {id:'mindmap-child',label:'添加子主题',icon:'＋',disabled:readonly.value,run:addChild},
  {id:'mindmap-sibling',label:'添加同级主题',icon:'↳',disabled:readonly.value||id===document.value.rootId,run:addSibling},
  {id:'mindmap-rename',label:'重命名',icon:'✎',disabled:readonly.value,run:()=>beginRename(id)},
  {id:'mindmap-collapse',label:collapsed.value.has(id)?'展开分支':'折叠分支',icon:collapsed.value.has(id)?'＋':'－',disabled:!hasChildren(id),separator:true,run:()=>toggle(id)},
  {id:'mindmap-delete',label:'删除分支',icon:'×',danger:true,disabled:readonly.value||id===document.value.rootId,separator:true,run:remove},
])}
function stageContextMenu(event:MouseEvent){openContextMenu(event,[
  {id:'mindmap-stage-child',label:'为当前节点添加子主题',icon:'＋',disabled:readonly.value,run:addChild},
  {id:'mindmap-stage-sibling',label:'添加同级主题',icon:'↳',disabled:readonly.value||!canSibling.value,run:addSibling},
  {id:'mindmap-stage-rename',label:'重命名当前节点',icon:'✎',disabled:readonly.value,run:()=>beginRename(selectedId.value)},
  {id:'mindmap-stage-undo',label:'撤销',icon:'↶',disabled:readonly.value||!canUndo.value,separator:true,run:undo},
  {id:'mindmap-stage-redo',label:'重做',icon:'↷',disabled:readonly.value||!canRedo.value,run:redo},
  {id:'mindmap-stage-expand',label:'全部展开',icon:'＋',separator:true,disabled:collapsed.value.size===0,run:()=>{collapsed.value=new Set()}},
  {id:'mindmap-stage-collapse',label:'折叠除当前分支',icon:'－',disabled:!hasChildren(selectedId.value),run:()=>{collapsed.value=new Set([selectedId.value])}},
])}
function keyboardHistory(event:KeyboardEvent){if(readonly.value||!(event.ctrlKey||event.metaKey)||event.key.toLowerCase()!=='z'||event.target instanceof HTMLInputElement)return;event.preventDefault();event.shiftKey?redo():undo()}
onMounted(()=>window.addEventListener('keydown',keyboardHistory))
function flush(){if(editingId.value)commitRename()}
defineExpose({flush})
onBeforeUnmount(()=>window.removeEventListener('keydown',keyboardHistory))
</script>
<style scoped>
.mindmap-editor{display:grid;height:100%;grid-template-rows:auto auto minmax(0,1fr) auto;background:#f8faf8;color:#244438}.mindmap-editor header,.mindmap-editor footer{display:flex;align-items:center;justify-content:space-between;padding:11px 16px;border-bottom:1px solid #e2e9e5;background:#fff}.mindmap-editor header>div:first-child{display:grid;gap:2px}.mindmap-editor strong{font-size:13px}.mindmap-editor small,.mindmap-editor footer{color:#819088;font-size:10px}.actions{display:flex;gap:6px}.actions button{padding:6px 10px;border:1px solid #d8e3dd;border-radius:8px;background:#fff;color:#315a49;font-size:10px;cursor:pointer}.actions button:hover:not(:disabled){background:#edf6f1}.actions button:disabled{cursor:not-allowed;opacity:.45}.actions .danger{color:#a34941}.banner{margin:0;padding:8px 16px;font-size:11px}.banner.error{background:#fff0ee;color:#a1433b}.banner.stale{background:#fff7dc;color:#765d16}.stage{position:relative;overflow:auto;background-color:#fbfcfb;background-image:radial-gradient(#d7e1dc 1px,transparent 1px);background-size:18px 18px}.links{position:absolute;top:0;left:0;overflow:visible;pointer-events:none}.links path{fill:none;stroke:#9dbbad;stroke-width:2}.node{position:absolute;display:flex;width:176px;min-height:50px;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;border:1px solid #cee0d6;border-radius:11px;background:#fff;color:#294b3e;text-align:left;box-shadow:0 4px 14px #284b3c12;cursor:pointer}.node.selected{border-color:#34785d;box-shadow:0 0 0 3px #cfe7dc}.node.root{background:#194e3b;color:#fff}.node span{overflow:hidden;font-size:11px;font-weight:650;text-overflow:ellipsis}.node i{display:grid;width:19px;height:19px;flex:0 0 auto;place-items:center;border-radius:50%;background:#e4efe9;color:#35634f;font-size:12px;font-style:normal}.node.root i{background:#ffffff24;color:#fff}.rename{position:absolute;z-index:5;width:176px;padding:7px}.rename input{box-sizing:border-box;width:100%;padding:7px;border:1px solid #34785d;border-radius:7px;outline:3px solid #cfe7dc;font:11px inherit}.mindmap-editor footer{border-top:1px solid #e2e9e5;border-bottom:0}
.node.dropTarget{border-color:#d18b31;box-shadow:0 0 0 4px #f9dfb5}
</style>
