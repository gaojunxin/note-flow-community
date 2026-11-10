<template>
  <section class="canvas-page" :class="{'mobile-editor-open':mobileEditorOpen}">
    <nav v-if="isCommunityEdition" class="canvas-mobile-switch" aria-label="画布视图"><button type="button" :disabled="mobileSwitchBusy" :aria-pressed="!mobileEditorOpen" @click="backToCanvasList">画布列表</button><button type="button" :disabled="!selected||mobileSwitchBusy" :aria-pressed="mobileEditorOpen" @click="mobileEditorOpen=true">编辑画布</button><span role="status">{{errorMessage||statusText}}</span></nav>
    <aside class="canvas-sidebar">
      <div class="sidebar-heading"><div><span class="eyebrow">VISUAL THINKING</span><h1>画布</h1><p>{{scopedCanvases.length}} 个当前领域工作区<template v-if="scopedCanvases.length!==canvases.length"> · 共 {{canvases.length}} 个</template></p></div><button class="icon-button primary" title="新建画布" @click="createOpen=true">＋</button></div>
      <label class="search-box"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input v-model="query" placeholder="搜索标题或画布文字"/><kbd v-if="!query">{{visible.length}}</kbd></label>
      <div class="list-heading"><span>最近画布</span><span>{{visible.length}}</span></div>
      <div class="canvas-list">
        <div v-for="item in visible" :key="item.uid" class="canvas-card" :class="{active:item.uid===selected?.uid}" role="button" tabindex="0" @click="open(item.uid)" @keydown.enter="open(item.uid)" @contextmenu="canvasContextMenu($event,item)">
          <span class="canvas-thumb"><svg viewBox="0 0 24 24"><path d="M5 17 9 12l3 3 3-4 4 6"/><circle cx="8" cy="8" r="1.5"/></svg></span>
          <span class="card-copy"><strong>{{item.title||'未命名画布'}}</strong><small><b>{{adapterFor(item.canvasType)?.badge||'未知'}}</b>{{relativeTime(item.updatedAt)}} · v{{item.version}}</small></span><button class="pc-more-trigger card-menu" type="button" :aria-label="`${item.title||'未命名画布'}的更多操作`" title="更多操作" @click.stop="canvasContextMenu($event,item)"><MoreIcon/></button>
        </div>
        <div v-if="!visible.length" class="list-empty"><span>⌁</span><p>{{query?'没有匹配的画布':'还没有画布'}}</p><button v-if="!query" @click="createOpen=true">创建第一张画布</button></div>
      </div>
      <div v-if="recoverable.length" class="migration-card"><div class="migration-icon">↗</div><div><strong>发现 {{recoverable.length}} 个旧画布</strong><p>它们仍在笔记中，可安全迁移到独立 Canvas。</p></div><button :disabled="migrating" @click="repair">{{migrating?'正在迁移…':`迁移 ${recoverable.length} 项`}}</button></div>
    </aside>

    <main v-if="selected" class="canvas-workspace">
      <header class="workspace-toolbar">
        <div class="title-group"><span class="document-icon"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4zM8 15l3-4 3 3 2-2 2 3"/></svg></span><div><input :value="selected.title" aria-label="画布标题" @change="rename(($event.target as HTMLInputElement).value)"/><p>{{scopeLabel}}</p></div></div>
        <div class="toolbar-actions"><span class="save-state" :class="{failed:errorMessage}"><i></i>{{errorMessage||statusText}}</span><button v-if="errorMessage" type="button" @click="flushCanvas().catch(()=>undefined)">重试保存</button><span class="divider"></span><button v-if="selected?.canvasType==='excalidraw'" title="将全部内容缩放并居中到可视区域" @click="host?.fitToContent?.()"><svg viewBox="0 0 24 24"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/><path d="M8 8h8v8H8z"/></svg><span>适应内容</span></button><button title="查看版本历史" @click="openHistory"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg><span>历史</span></button><button v-if="selectedAdapter?.canExport" title="导出画布" @click="host?.download?.()"><svg viewBox="0 0 24 24"><path d="M12 3v12m-4-4 4 4 4-4M5 19h14"/></svg><span>导出</span></button><button class="more-button" title="移入回收状态" @click="removeCanvas()"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></button></div>
      </header>
      <div class="editor-shell"><component :is="selectedEditor" :key="`${selected.uid}:${editorGeneration}`" ref="host" :asset-path="isCommunityEdition?'/assets/excalidraw/':undefined" :document-data="selected.documentData||selected.sceneData" :canvas-type="selected.canvasType" :source-mode="selected.sourceMode" :source-note-uid="selected.sourceNoteUid" :title="selected.title" @change="saveScene"/></div>
      <Transition name="panel"><section v-if="historyOpen" class="history-panel"><header><div><span class="eyebrow">VERSION HISTORY</span><h2>画布历史</h2><p>恢复会生成新版本，当前内容仍会保留。</p></div><button class="icon-button" @click="historyOpen=false">×</button></header><div class="history-list"><p v-if="!snapshots.length" class="history-empty">暂无可恢复的历史版本</p><button v-for="snapshot in snapshots" :key="snapshot.version" :disabled="saving||snapshot.version===selected.version" @click="restoreSnapshot(snapshot.version)"><span class="version-mark">v{{snapshot.version}}</span><span><strong>{{snapshot.version===selected.version?'当前版本':`版本 ${snapshot.version}`}}</strong><small>{{new Date(snapshot.createdAt).toLocaleString('zh-CN')}}</small></span><span class="restore-label">恢复</span></button></div></section></Transition>
    </main>

    <main v-else class="empty-workspace"><div class="empty-visual"><span></span><span></span><span></span><svg viewBox="0 0 64 64"><path d="M13 47 25 31l10 10 8-12 9 18"/><circle cx="22" cy="20" r="4"/></svg></div><span class="eyebrow">A BLANK SPACE FOR IDEAS</span><h2>把想法铺在画布上</h2><p>自由绘制、连接和组织内容。画布独立于 Markdown 笔记，并优先保存在本地。</p><button class="create-empty" @click="createOpen=true">＋ 创建新画布</button></main>
    <Transition name="panel"><div v-if="createOpen" class="create-backdrop" @click.self="createOpen=false"><section class="create-dialog"><header><div><span class="eyebrow">NEW VISUAL DOCUMENT</span><h2>选择画布类型或白板预设</h2></div><button class="icon-button" @click="createOpen=false">×</button></header><div class="type-grid"><button v-for="option in canvasCreationOptions" :key="option.id" :data-creation-option="option.id" :disabled="!option.adapter.enabled" @click="createCanvas(option)"><span>{{option.badge}}</span><strong>{{option.label}}</strong><small>{{option.description}}</small><em v-if="!option.adapter.enabled">即将支持</em></button></div></section></div></Transition>
    <Transition name="toast"><div v-if="notice" class="canvas-toast" :class="notice.type"><span>{{notice.type==='success'?'✓':'!'}}</span>{{notice.text}}<button @click="notice=null">×</button></div></Transition>
  </section>
</template>

<script setup lang="ts">
import {knowledgeAvailable} from '../services/clientCapabilities'
import MoreIcon from '../components/MoreIcon.vue'
import {computed,nextTick,onBeforeUnmount,onMounted,ref} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {useNotesStore} from '../stores/notes'
import {useAuthStore} from '../stores/auth'
import UnavailableCanvasEditor from '../components/canvas/UnavailableCanvasEditor.vue'
import {canvasCreationOptions,getCanvasTypeAdapter,type CanvasCreationOption} from '../canvas/registry'
import {classifyObsidianPath,extractExcalidrawScene,isExcalidrawDocument,importErrorMessage} from '../services/obsidianImport'
import {createCanvasService,type CanvasEntity,type CanvasSnapshot} from '../services/canvases'
import {workspaceService} from '../services/workspace'
import {openContextMenu} from '../services/contextMenu'
import {confirmDialog,promptDialog} from '../services/productDialog'
import {globalAreaUid} from '../services/globalAreaScope'
import {createLinkedMindmapCanvasInput} from '../canvas/mindmapEditor'
import {registerLocalDraftGuard} from '../services/localDraftLifecycle'
import {isCommunityEdition} from '../services/clientCapabilities'

const notes=useNotesStore(),auth=useAuthStore(),route=useRoute(),router=useRouter()
const mobileEditorOpen=ref(Boolean(route.query.canvas)),mobileSwitchBusy=ref(false)
const narrowCommunity=()=>isCommunityEdition&&window.matchMedia('(max-width:1079px)').matches
const query=ref(''),host=ref<{download?:()=>void;fitToContent?:()=>void;flush?:()=>void|Promise<void>}>(),saving=ref(false),migrating=ref(false),createOpen=ref(false)
const canvases=ref<CanvasEntity[]>([]),snapshots=ref<CanvasSnapshot[]>([]),historyOpen=ref(false),errorMessage=ref(''),editorGeneration=ref(0)
const notice=ref<{type:'success'|'error';text:string}|null>(null)
const service=computed(()=>createCanvasService(String(auth.user?.userId||'local')))
const scopedCanvases=computed(()=>canvases.value.filter(item=>(knowledgeAvailable||item.canvasType!=='knowledge_graph')&&(!globalAreaUid.value||!item.areaUid||item.areaUid===globalAreaUid.value)))
const selected=computed(()=>scopedCanvases.value.find(item=>item.uid===String(route.query.canvas||''))||scopedCanvases.value[0])
const selectedAdapter=computed(()=>getCanvasTypeAdapter(selected.value?.canvasType))
const selectedEditor=computed(()=>selectedAdapter.value?.editor||UnavailableCanvasEditor)
const visible=computed(()=>scopedCanvases.value.filter(item=>!query.value||`${item.title} ${item.textIndex}`.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())))
const recoverable=computed(()=>notes.notes.filter(note=>(!globalAreaUid.value||note.areaUid===globalAreaUid.value)&&isExcalidrawDocument(note.content||'',String((note as any).obsidianSourcePath||''))))
const statusText=computed(()=>saving.value?'保存中…':selected.value?`已保存 · v${selected.value.version}`:'')
const scopeLabel=computed(()=>selected.value?.projectUid?'项目画布':selected.value?.areaUid?'领域画布':'未归属画布')
let pendingScene:string|undefined,sceneSavePromise:Promise<void>|undefined,noticeTimer:number|undefined

function showNotice(type:'success'|'error',text:string){notice.value={type,text};clearTimeout(noticeTimer);noticeTimer=window.setTimeout(()=>notice.value=null,5000)}
function relativeTime(value:string){const minutes=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/60000));if(minutes<1)return'刚刚';if(minutes<60)return`${minutes} 分钟前`;if(minutes<1440)return`${Math.floor(minutes/60)} 小时前`;if(minutes<10080)return`${Math.floor(minutes/1440)} 天前`;return new Date(value).toLocaleDateString('zh-CN')}
async function open(uid:string){try{await flushCanvas();historyOpen.value=false;errorMessage.value='';await router.replace({path:'/canvas',query:{canvas:uid}});editorGeneration.value++;mobileEditorOpen.value=true}catch(error){showNotice('error',importErrorMessage(error,'画布保存失败'))}}
async function backToCanvasList(){if(mobileSwitchBusy.value)return;mobileSwitchBusy.value=true;try{await flushCanvas();mobileEditorOpen.value=false}catch(error){showNotice('error',importErrorMessage(error,'画布保存失败'))}finally{mobileSwitchBusy.value=false}}
async function repairUnassignedObsidianCanvases(values:CanvasEntity[]){
  const pending=values.filter(item=>!item.areaUid&&item.sourceFormat==='obsidian'&&item.sourcePath)
  if(!pending.length)return values
  const [areas,projects]=await Promise.all([workspaceService.areas(),workspaceService.projects(undefined,true)])
  const personal=areas.find(item=>item.name==='个人'||item.kind==='life'),work=areas.find(item=>item.name==='工作'||item.kind==='career')
  const repaired=new Map<string,CanvasEntity>()
  for(const item of pending){
    const sourcePath=item.sourcePath
    if(!sourcePath)continue
    const category=classifyObsidianPath(sourcePath).category,area=category==='work'?work:category==='personal'?personal:undefined
    if(!area)continue
    const parts=sourcePath.replace(/\\/g,'/').split('/').filter(Boolean),projectName=parts[1]
    const project=projectName?projects.find(value=>value.areaUid===area.uid&&value.name===projectName):undefined
    try{repaired.set(item.uid,await service.value.update(item,{areaUid:area.uid,projectUid:project?.uid||null}))}catch{/* Keep the canvas visible as unassigned if repair cannot be persisted. */}
  }
  return values.map(item=>repaired.get(item.uid)||item)
}
async function reload(){canvases.value=await repairUnassignedObsidianCanvases(await service.value.list())}
async function materializeImportedMindmaps(){const imported=notes.notes.filter(note=>!note.deleted&&note.type==='mindmap'),existing=await service.value.list(),linked=new Set(existing.filter(item=>item.canvasType==='mindmap'&&item.sourceNoteUid).map(item=>item.sourceNoteUid));let created=0;for(const note of imported){if(linked.has(note.uid))continue;try{await service.value.create({...createLinkedMindmapCanvasInput(note),title:note.title||'未命名思维导图',sourceFormat:'migrated',createdAt:note.createdAt});linked.add(note.uid);created++}catch(error){showNotice('error',`${note.title||'未命名思维导图'}：${importErrorMessage(error,'思维导图转换失败')}`)}}return created}
const adapterFor=getCanvasTypeAdapter
async function createCanvas(option:CanvasCreationOption){const adapter=option.adapter;if(!adapter.enabled)return;try{const documentData=option.initialDocument(),item=await service.value.create({title:option.defaultTitle,areaUid:globalAreaUid.value||null,canvasType:adapter.type,documentData,sceneData:documentData,dataFormat:adapter.dataFormat});canvases.value.unshift(item);createOpen.value=false;open(item.uid)}catch(error){showNotice('error',importErrorMessage(error,'创建画布失败'))}}
function saveScene(documentData:string){pendingScene=documentData;return drainScene()}
function drainScene(){
 if(sceneSavePromise)return sceneSavePromise
 if(!selected.value||pendingScene===undefined)return Promise.resolve()
 saving.value=true;errorMessage.value=''
 sceneSavePromise=(async()=>{while(pendingScene!==undefined&&selected.value){const next=pendingScene;pendingScene=undefined;const current=selected.value;try{const saved=await service.value.update(current,{documentData:next,sceneData:next}),index=canvases.value.findIndex(item=>item.uid===saved.uid);if(index>=0)canvases.value[index]=saved}catch(error){pendingScene=pendingScene??next;errorMessage.value=importErrorMessage(error,'画布保存失败');break}}})().finally(()=>{saving.value=false;sceneSavePromise=undefined})
 return sceneSavePromise
}
async function flushCanvas(){
 try{await host.value?.flush?.();await nextTick();await drainScene();if(sceneSavePromise)await sceneSavePromise;if(pendingScene!==undefined)throw Error(errorMessage.value||'画布尚未保存，请重试')}catch(error){errorMessage.value=importErrorMessage(error,'画布保存失败');throw error}
}
const unregisterCanvasGuard=registerLocalDraftGuard({}, {flush:flushCanvas,dirty:()=>saving.value||pendingScene!==undefined,dismiss:()=>{if(historyOpen.value){historyOpen.value=false;return true}if(createOpen.value){createOpen.value=false;return true}if(narrowCommunity()&&mobileEditorOpen.value){void backToCanvasList();return true}return false}})
async function renameCanvas(value:CanvasEntity,title?:string){const next=title??await promptDialog('重命名画布',value.title);if(!next?.trim()||next.trim()===value.title)return;try{const saved=await service.value.update(value,{title:next.trim()}),index=canvases.value.findIndex(item=>item.uid===saved.uid);canvases.value[index]=saved;showNotice('success','画布已重命名')}catch(error){showNotice('error',importErrorMessage(error,'标题保存失败'))}}
async function rename(title:string){if(selected.value)await renameCanvas(selected.value,title)}
async function openHistory(){if(!selected.value)return;try{snapshots.value=await service.value.snapshots(selected.value);historyOpen.value=true}catch(error){showNotice('error',importErrorMessage(error,'历史版本加载失败'))}}
async function restoreSnapshot(version:number){if(!selected.value||!window.confirm(`恢复到版本 ${version}？当前内容仍会保留为历史版本。`))return;saving.value=true;try{const saved=await service.value.restore(selected.value,version),index=canvases.value.findIndex(item=>item.uid===saved.uid);canvases.value[index]=saved;editorGeneration.value++;snapshots.value=await service.value.snapshots(saved);showNotice('success',`已恢复为新版本 v${saved.version}`)}catch(error){errorMessage.value=importErrorMessage(error,'恢复失败')}finally{saving.value=false}}
async function removeCanvas(value=selected.value){if(!value||!await confirmDialog(`将“${value.title}”移入画布回收状态？`))return;try{const wasSelected=value.uid===selected.value?.uid;await service.value.remove(value);canvases.value=canvases.value.filter(item=>item.uid!==value.uid);if(wasSelected){historyOpen.value=false;if(canvases.value[0])open(canvases.value[0].uid);else await router.replace('/canvas')}showNotice('success','画布已移入回收状态')}catch(error){showNotice('error',importErrorMessage(error,'删除画布失败'))}}
function canvasContextMenu(event:MouseEvent,value:CanvasEntity){openContextMenu(event,[
  {id:'open',label:'打开画布',icon:'▧',run:()=>open(value.uid)},
  {id:'rename',label:'重命名',icon:'✎',run:()=>renameCanvas(value)},
  {id:'delete',label:'移入回收状态',icon:'×',danger:true,separator:true,run:()=>removeCanvas(value)},
])}
async function repair(){if(migrating.value||!recoverable.value.length)return;migrating.value=true;errorMessage.value='';let migrated=0,resumed=0;const failures:string[]=[];let first='';try{const existing=new Map((await service.value.list()).map(item=>[item.uid,item]));for(const note of [...recoverable.value]){try{let canvas=existing.get(note.uid);if(!canvas){const sceneData=extractExcalidrawScene(note.content||'',String((note as any).obsidianSourcePath||''));if(!sceneData)throw new Error('未找到可用的 Excalidraw 场景');canvas=await service.value.create({uid:note.uid,title:note.title,areaUid:note.areaUid,projectUid:note.projectUid,sceneData,sourceFormat:'migrated',sourcePath:String((note as any).obsidianSourcePath||''),createdAt:note.createdAt});existing.set(canvas.uid,canvas);migrated++}else resumed++;await notes.removeEntity(note);first ||= canvas.uid}catch(error){failures.push(`${note.title}：${importErrorMessage(error,'迁移失败')}`)}}await reload();if(first)open(first);if(failures.length)showNotice('error',`已迁移 ${migrated+resumed} 项，${failures.length} 项失败：${failures[0]}`);else showNotice('success',`迁移完成：新增 ${migrated} 项${resumed?`，续接 ${resumed} 项`:''}`)}finally{migrating.value=false}}
const syncReload=()=>void reload()
onMounted(async()=>{window.addEventListener('note-flow:canvas-change',syncReload);await notes.load();const created=await materializeImportedMindmaps();await reload();if(created)showNotice('success',`已识别并恢复 ${created} 个思维导图`);if(!route.query.canvas&&canvases.value[0]){if(narrowCommunity())await router.replace({path:'/canvas',query:{canvas:canvases.value[0].uid}});else await open(canvases.value[0].uid)}})
onBeforeUnmount(()=>{unregisterCanvasGuard();window.removeEventListener('note-flow:canvas-change',syncReload);clearTimeout(noticeTimer)})
</script>

<style scoped>
.canvas-page{--ink:#18372d;--green:#164c3b;position:relative;display:grid;grid-template-columns:286px minmax(0,1fr);height:calc(100vh - 72px);min-height:600px;overflow:hidden;background:#eef1ee;color:var(--ink)}
.canvas-sidebar{display:flex;min-height:0;flex-direction:column;padding:22px 16px 16px;border-right:1px solid #dfe5e1;background:linear-gradient(180deg,#fbfcfb,#f6f8f6)}.sidebar-heading{display:flex;align-items:flex-start;justify-content:space-between;padding:0 4px 18px}.sidebar-heading h1{margin:3px 0 2px;font-size:26px;letter-spacing:-.04em}.sidebar-heading p,.history-panel p{margin:0;color:#809089;font-size:12px}.eyebrow{color:#819189;font-size:9px;font-weight:800;letter-spacing:.16em}
button,input{font:inherit}.icon-button{display:grid;width:34px;height:34px;place-items:center;border:1px solid #dde4df;border-radius:10px;background:#fff;color:#486158;cursor:pointer}.icon-button.primary{border-color:var(--green);background:var(--green);color:#fff;font-size:20px;box-shadow:0 7px 16px #164c3b2b}.search-box{display:flex;align-items:center;gap:8px;padding:9px 10px;border:1px solid #e0e6e2;border-radius:11px;background:#fff}.search-box svg,.workspace-toolbar svg{width:17px;fill:none;stroke:currentColor;stroke-width:1.7}.search-box input{min-width:0;flex:1;border:0;outline:0;background:transparent;color:#29463c;font-size:12px}.search-box kbd{padding:2px 6px;border-radius:5px;background:#f0f3f1;color:#91a098;font:10px inherit}
.list-heading{display:flex;justify-content:space-between;padding:20px 5px 8px;color:#84938c;font-size:10px;font-weight:700;letter-spacing:.06em}.canvas-list{display:flex;min-height:0;flex:1;flex-direction:column;gap:5px;overflow:auto}.canvas-card{display:grid;grid-template-columns:38px minmax(0,1fr) 28px;align-items:center;gap:10px;padding:9px;border:1px solid transparent;border-radius:12px;background:transparent;color:inherit;text-align:left;cursor:pointer;transition:.16s}.canvas-card:hover,.canvas-card:focus-visible{border-color:#e4e9e6;background:#fff;transform:translateY(-1px);outline:0}.canvas-card.active{border-color:#d3e3da;background:#eaf3ee;box-shadow:inset 3px 0 var(--green)}.canvas-thumb{display:grid;width:38px;height:38px;place-items:center;border:1px solid #e0e6e2;border-radius:10px;background:#fff;color:#577269}.canvas-thumb svg{width:21px;fill:none;stroke:currentColor;stroke-width:1.5}.card-copy{display:grid;min-width:0;gap:3px}.card-copy strong{overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.card-copy small{color:#8b9993;font-size:10px}.card-menu{display:grid;width:28px;height:28px;place-items:center;padding:0;border:0;border-radius:7px;background:transparent;color:#83938b;font-size:14px;letter-spacing:1px;opacity:0;cursor:pointer}.canvas-card:hover .card-menu,.canvas-card:focus-within .card-menu,.canvas-card.active .card-menu{opacity:1}.card-menu:hover{background:#dde9e2;color:#245540}.list-empty{display:grid;place-items:center;align-content:center;gap:6px;min-height:180px;color:#9aa7a1;text-align:center}.list-empty>span{font-size:30px}.list-empty p{margin:0;font-size:12px}.list-empty button{border:0;background:transparent;color:#316d58;font-size:11px;cursor:pointer}
.migration-card{display:grid;grid-template-columns:32px 1fr;gap:9px;margin-top:14px;padding:12px;border:1px solid #eadcb8;border-radius:13px;background:linear-gradient(135deg,#fffbef,#fff7df)}.migration-icon{display:grid;width:30px;height:30px;place-items:center;border-radius:9px;background:#f0dca6;color:#6f5720;font-weight:800}.migration-card strong{font-size:11px}.migration-card p{margin:3px 0 0;color:#82765a;font-size:10px;line-height:1.45}.migration-card button{grid-column:1/-1;padding:7px;border:1px solid #ddc986;border-radius:8px;background:#fff9e8;color:#624d19;font-size:11px;font-weight:700;cursor:pointer}.migration-card button:disabled{opacity:.55}
.canvas-workspace{position:relative;display:grid;min-width:0;min-height:0;grid-template-rows:64px 1fr;padding:10px 10px 10px 0}.workspace-toolbar{z-index:2;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border:1px solid #e1e6e2;border-bottom:0;border-radius:14px 14px 0 0;background:#fff}.title-group{display:flex;min-width:0;align-items:center;gap:10px}.document-icon{display:grid;width:36px;height:36px;place-items:center;border-radius:10px;background:#edf4f0;color:#285b48}.document-icon svg{width:19px}.title-group>div{display:grid}.title-group input{width:min(420px,35vw);border:0;outline:0;background:transparent;color:#213f34;font-size:15px;font-weight:750}.title-group p{margin:2px 0 0;color:#91a098;font-size:10px}.toolbar-actions{display:flex;align-items:center;gap:5px}.toolbar-actions button{display:flex;align-items:center;gap:6px;padding:7px 9px;border:0;border-radius:8px;background:transparent;color:#536b62;font-size:11px;cursor:pointer}.toolbar-actions button:hover{background:#f1f5f2;color:#214f3e}.save-state{display:flex;align-items:center;gap:6px;color:#73857d;font-size:10px;white-space:nowrap}.save-state i{width:6px;height:6px;border-radius:50%;background:#47a37c;box-shadow:0 0 0 3px #e4f3eb}.save-state.failed{color:#b4493f}.save-state.failed i{background:#c4574c}.divider{width:1px;height:22px;margin:0 4px;background:#e8ece9}
.editor-shell{min-height:0;overflow:hidden;border:1px solid #e1e6e2;border-radius:0 0 14px 14px;background:#fff;box-shadow:0 12px 35px #1f40321a}.editor-shell :deep(.excalidraw-host){min-height:0;height:100%}
.history-panel{position:absolute;z-index:30;top:82px;right:22px;width:350px;max-height:calc(100% - 104px);overflow:auto;padding:16px;border:1px solid #dfe6e1;border-radius:14px;background:#fff;box-shadow:0 22px 60px #183a2d2b}.history-panel header{display:flex;justify-content:space-between}.history-panel h2{margin:3px 0;font-size:18px}.history-list{display:grid;gap:7px;margin-top:15px}.history-list>button{display:grid;grid-template-columns:42px 1fr auto;align-items:center;gap:10px;padding:10px;border:1px solid #e6ebe8;border-radius:10px;background:#fbfcfb;color:#344f45;text-align:left;cursor:pointer}.history-list>button:hover:not(:disabled){border-color:#bcd5c9;background:#f2f7f4}.history-list>button:disabled{opacity:.55}.version-mark{display:grid;width:36px;height:36px;place-items:center;border-radius:9px;background:#e9f2ed;color:#35664f;font-size:10px;font-weight:800}.history-list>button>span:nth-child(2){display:grid;gap:3px}.history-list small{color:#899790;font-size:9px}.restore-label{color:#39735b;font-size:10px;font-weight:700}.history-empty{padding:35px 0;text-align:center}
.empty-workspace{display:grid;place-items:center;align-content:center;padding:30px;text-align:center;background:radial-gradient(circle at center,#f8faf8,#eef1ee 68%)}.empty-workspace h2{margin:10px 0 7px;font-size:25px}.empty-workspace p{max-width:440px;margin:0;color:#71827a;font-size:12px;line-height:1.7}.empty-visual{position:relative;display:grid;width:190px;height:130px;place-items:center;margin-bottom:24px;border:1px solid #dae3de;border-radius:18px;background-color:#fff;background-image:radial-gradient(#cad6d0 1px,transparent 1px);background-size:14px 14px;box-shadow:0 20px 50px #254d3d1c}.empty-visual svg{width:64px;fill:none;stroke:#4d7666;stroke-width:1.5}.empty-visual span{position:absolute;width:10px;height:10px;border:2px solid #69917f;border-radius:50%;background:#fff}.empty-visual span:nth-child(1){top:26px;left:34px}.empty-visual span:nth-child(2){right:30px;bottom:25px}.empty-visual span:nth-child(3){top:22px;right:45px}.create-empty{margin-top:20px;padding:10px 16px;border:0;border-radius:10px;background:var(--green);color:#fff;font-size:12px;font-weight:700;cursor:pointer}
.canvas-toast{position:absolute;z-index:60;right:24px;bottom:24px;display:flex;align-items:center;gap:9px;max-width:500px;padding:11px 12px;border:1px solid #c9ded3;border-radius:11px;background:#f3faf6;color:#285541;font-size:11px;box-shadow:0 14px 40px #153a2b24}.canvas-toast>span{display:grid;width:21px;height:21px;place-items:center;border-radius:50%;background:#3b8b68;color:#fff}.canvas-toast.error{border-color:#ebc5bf;background:#fff5f3;color:#8b3b33}.canvas-toast.error>span{background:#bd594e}.canvas-toast button{margin-left:auto;border:0;background:transparent;color:inherit;cursor:pointer}.panel-enter-active,.panel-leave-active,.toast-enter-active,.toast-leave-active{transition:.18s}.panel-enter-from,.panel-leave-to{opacity:0;transform:translateX(12px)}.toast-enter-from,.toast-leave-to{opacity:0;transform:translateY(10px)}
.card-copy small{display:flex;align-items:center;gap:5px}.card-copy small b{padding:2px 5px;border-radius:5px;background:#dfece5;color:#35624f;font-size:8px}.create-backdrop{position:absolute;z-index:80;inset:0;display:grid;place-items:center;padding:24px;background:#15342a66;backdrop-filter:blur(3px)}.create-dialog{width:min(680px,90vw);padding:22px;border:1px solid #dce5df;border-radius:18px;background:#fff;box-shadow:0 28px 80px #183a2d3d}.create-dialog header{display:flex;align-items:flex-start;justify-content:space-between}.create-dialog h2{margin:4px 0 18px;font-size:22px}.type-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.type-grid>button{position:relative;display:grid;grid-template-columns:42px 1fr;gap:2px 10px;align-items:center;padding:13px;border:1px solid #dfe7e2;border-radius:12px;background:#fbfdfc;color:#29483c;text-align:left;cursor:pointer}.type-grid>button:hover:not(:disabled){border-color:#8bb4a1;background:#f1f8f4}.type-grid>button:disabled{cursor:not-allowed;opacity:.58}.type-grid>button>span{grid-row:1/3;display:grid;width:40px;height:40px;place-items:center;border-radius:10px;background:#e6f0ea;color:#356650;font-size:10px;font-weight:800}.type-grid strong{font-size:12px}.type-grid small{color:#71837b;font-size:10px}.type-grid em{position:absolute;top:8px;right:8px;color:#8b7a54;font-size:9px;font-style:normal}
@media(max-width:1120px){.canvas-page{grid-template-columns:245px 1fr}.save-state{display:none}.toolbar-actions button span{display:none}.title-group input{width:28vw}}
.canvas-mobile-switch{display:none}
@media(max-width:1079px){
.community-responsive .canvas-page{width:100%;min-width:0;min-height:0;height:calc(100dvh - 132px);grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}
.community-responsive .canvas-mobile-switch{display:flex;align-items:center;gap:8px;min-width:0;padding:6px 10px;background:#fff;border-bottom:1px solid #dfe5e1}
.community-responsive .canvas-mobile-switch button{min-height:44px;padding:6px 10px;border:1px solid #dce5df;border-radius:8px;background:#fff;color:#315a49}
.community-responsive .canvas-mobile-switch button[aria-pressed=true]{background:#eaf3ee;border-color:#8bb4a1}
.community-responsive .canvas-mobile-switch span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#73857d}
.community-responsive .canvas-sidebar{grid-row:2;border-right:0;padding:12px}
.community-responsive .canvas-page:not(.mobile-editor-open)>.canvas-workspace,.community-responsive .canvas-page:not(.mobile-editor-open)>.empty-workspace,.community-responsive .mobile-editor-open>.canvas-sidebar{display:none}
.community-responsive .canvas-workspace{grid-row:2;grid-template-rows:auto minmax(0,1fr);padding:0;min-width:0}
.community-responsive .workspace-toolbar{flex-wrap:wrap;gap:4px;padding:6px 10px;border-radius:0}
.community-responsive .title-group{flex:1;min-width:140px}
.community-responsive .title-group>div{min-width:0;flex:1}
.community-responsive .title-group input{width:100%;min-width:0}
.community-responsive .toolbar-actions button,.community-responsive .icon-button{min-width:44px;min-height:44px}
.community-responsive .editor-shell{min-width:0;border-radius:0}
.community-responsive .history-panel{top:80px;right:8px;width:calc(100% - 16px)}
.community-responsive .create-backdrop{padding:10px}
.community-responsive .create-dialog{width:100%;max-height:100%;overflow:auto;padding:14px}
.community-responsive .type-grid{grid-template-columns:minmax(0,1fr)}
.community-responsive .canvas-toast{right:8px;left:8px;bottom:8px;max-width:none}
.community-responsive .editor-shell :deep(.mermaid-body){grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(160px,1fr) minmax(140px,1fr)}
.community-responsive .editor-shell :deep(.mermaid-tools),.community-responsive .editor-shell :deep(.mindmap-editor header){flex-wrap:wrap;gap:6px;padding:6px 8px}
.community-responsive .editor-shell :deep(.actions){flex-wrap:wrap}
}
</style>
