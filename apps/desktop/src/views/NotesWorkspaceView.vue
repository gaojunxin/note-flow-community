<script setup lang="ts">
import {saveLocalExport} from '../services/localFileExport'
import {useNoteOutline} from '../services/noteOutlineTree'
import NoteTitleInput from '../components/NoteTitleInput.vue'
import {isFileNote} from '../services/noteContentKind'
import {captureFileExportBoundary} from '../services/fileExportBoundary'
import NoteListRowContent from '../components/NoteListRowContent.vue'
import {noteListPreview,noteDirectoryPath,noteListUpdatedDate} from '../services/noteListPresentation'
import {downloadNotes} from '../services/workspaceDownload'
import {hasAutomaticNoteOutline} from '../services/noteOutlineLayout'
import {compareNoteTitles} from '../services/noteListSort'
import {ElButton,ElSelect,ElOption,ElMessage} from 'element-plus'
import '../styles/noteListTable.css'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/select/style/css'
import 'element-plus/es/components/option/style/css'
import 'element-plus/es/components/button/style/css'
import MarkdownDocumentBody from '../components/MarkdownDocumentBody.vue'
import ReaderFindBar from '../components/ReaderFindBar.vue'
import {noteAttachmentReady} from '../services/noteAttachmentReady'
import {folderConsolidationCandidates} from '../services/folderConsolidation'
import {aiDataScope} from '../services/aiDataScope'
import {consolidationInput} from '../services/noteConsolidation'
import TagFilterPicker from '../components/TagFilterPicker.vue'
import type {FolderTransferImpact} from '../services/folderTreeTransfer'
import MoreIcon from '../components/MoreIcon.vue'
import {Star,StarFilled} from '@element-plus/icons-vue'
import {linkedCanvasMarkdown,resolveLinkedCanvas} from '../services/linkedNoteCanvas'
import {noteCanvasEmbeds,noteCanvasMarkdown,parseNoteCanvasScene,replaceNoteCanvas} from '../services/noteCanvas'
import {attachmentImageItem} from '../services/attachmentImages'
import {resolveImportedNoteLink} from '@note-flow/core/imported-note-links'
import OrganizationDestinationDialog from '../components/OrganizationDestinationDialog.vue'
import {folderPath,folderDescendants,sameFolderScope,validateFolderMove} from '../services/folderDestinations'
import { confirmDialog, promptDialog } from '../services/productDialog'
import { openContextMenu } from '../services/contextMenu'
import { computed, defineAsyncComponent, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import {useNoteListSearch} from '../services/noteListSearch'
import { useNotesStore } from '../stores/notes'
import { useRoute, useRouter } from 'vue-router'
import { foldersService, type FolderEntity,type FolderDeleteProgress } from '../services/folders'
import FolderDeleteProgressDialog from '../components/FolderDeleteProgressDialog.vue'
import TrashClearProgressDialog from '../components/TrashClearProgressDialog.vue'
import {purgeTrashBatch} from '../services/trashBatch'
import { folderImportPathParts } from '../services/folderImportPaths'
import {noteAttachmentReferenceChanges} from '../services/noteAttachmentReferences'
import {noteDraftChanges,noteDraftSnapshot,reconcileNoteDraft,type NoteDraftSnapshot} from '../services/noteDraft'
import {maintainUploadedAttachmentReferences} from '../services/attachmentReferenceMaintenance'
import {pausePcSync,runPcSyncGuarded,pcSyncResetPaused} from '../services/syncResetGuard'
import FolderImportResult,{type FolderImportOutcome} from '../components/FolderImportResult.vue'
import FolderImportProgress from '../components/FolderImportProgress.vue'
import { tagsService, type TagEntity } from '../services/tags'
import {countTagNotes,inTagScope,matchesNoteTags,noteHasTag,noteTagUids,type TagMatchMode} from '../services/noteTags'
import { workspaceService, type AreaEntity, type JournalSeriesEntity, type ProjectEntity, type ReportGenerationInfo } from '../services/workspace'
import ProjectContextHeader from '../components/ProjectContextHeader.vue'
import AttachmentPreviewDialog from '../components/AttachmentPreviewDialog.vue'
import FileContentPreview from '../components/FileContentPreview.vue'
import { runBulkOperation, type BulkFailure } from '../services/bulkOperations'
import { noteUndoChanges } from '../services/noteUndoChanges'
import { cachedAttachment, deleteAttachment, hasPendingNoteAttachments, isOfficeAttachment, listAttachments, localAttachments, openAttachmentContent, processAttachmentQueue, queueAttachment, removeLocalAttachment, retryLocalAttachment, unlinkAttachment, type AttachmentItem, type LocalAttachment } from '../services/attachments'
import { isPeriodicNote, isRegularNote, type NoteEntity } from '@note-flow/core'
import { useAuthStore } from '../stores/auth'
import { tasksService, taskNotesService } from '../services/tasks'
import { noteLinksService, type NoteLinkView } from '../services/noteLinks'
import { knowledgeService } from '../services/knowledge'
import { noteOrganizationService } from '../services/noteOrganization'
import { AI_DATA_CONFIRMATION,AI_KNOWLEDGE_CONFIRMATION,AI_UNAVAILABLE_MESSAGE } from '../services/aiExperience'
import {isCommunityEdition} from '../services/clientCapabilities'
import {registerLocalDraftGuard} from '../services/localDraftLifecycle'
import { createCanvasService } from '../services/canvases'
import { openOrCreateLinkedMindmapCanvas } from '../services/linkedMindmapCanvas'
import { globalAreaUid } from '../services/globalAreaScope'
import api from '../services/api'
import { consumeGlobalCreateFiles, selectGlobalCreateFiles } from '../services/globalCreate'
import { isDesktopClient } from '../services/serverConfig'
import {canInlinePreview,inferMediaType,isPdfPreviewFile} from '../services/filePreview'
import { Channel, invoke } from '@tauri-apps/api/core'
import NoteFolderTree from '../components/NoteFolderTree.vue'
import {areaTreeId,selectedTreeArea,buildNoteAreaGroups,expandedNoteAreas,buildFolderNodes,projectVisibleFolders} from '../services/noteFolderTree'
import {scopedPreferenceKey} from '../services/clientContext'

// Keep CodeMirror/Yjs and markdown rendering out of the route's first task.
// The workspace shell can paint before these larger dependency graphs load.
const NoteConsolidationDialog = defineAsyncComponent(() => import('../components/NoteConsolidationDialog.vue'))
const BodyRecoveryDialog=defineAsyncComponent(()=>import('../components/BodyRecoveryDialog.vue'))
const NoteHistoryDialog=defineAsyncComponent(()=>import('../components/NoteHistoryDialog.vue'))
const DuplicateNotesDialog=defineAsyncComponent(()=>import('../components/DuplicateNotesDialog.vue'))
const duplicateNoteUid=ref('')
const historyNoteUid=ref('')
const bodyRecoveryNoteUid=ref('')
async function openHistory(){await flushDraft();if(selected.value)historyNoteUid.value=selected.value.uid}
const FolderConsolidationDialog=defineAsyncComponent(()=>import('../components/FolderConsolidationDialog.vue'))
const FolderOrganizationDialog=defineAsyncComponent(()=>import('../components/FolderOrganizationDialog.vue'))
const directoryOrganization=ref<{folderUid?:string;areaUid:string|null;projectUid:string|null}>()
async function openDirectoryOrganization(folder=activeFolder.value){
 try{const scope=aiDataScope();await flushDraft();if(scope!==aiDataScope())return;directoryOrganization.value={folderUid:folder?.uid,areaUid:folder?(folder.areaUid||null):(newItemAreaUid.value||null),projectUid:folder?(folder.projectUid||null):(currentProject.value?.uid||null)}}
 catch(source){folderError.value=source instanceof Error?source.message:'无法打开目录整理'}
}
function openDirectoryTools(event:MouseEvent){openContextMenu(event,[{id:'directory-organization',label:'AI 整理目录',run:()=>openDirectoryOrganization()}])}
async function directoryOrganizationChanged(){try{await Promise.all([loadFolders(),notesStore.reloadLocal()])}catch(source){folderError.value=source instanceof Error?source.message:'目录已整理，请刷新列表查看'}}

const folderPlan=ref<FolderEntity>(),folderPlanBusy=ref(false),folderPlanError=ref('')
async function openFolderConsolidation(folder:FolderEntity){try{await flushDraft();folderPlanError.value='';folderPlan.value=folder}catch(source){folderError.value=source instanceof Error?source.message:'无法打开目录整合'}}
async function reviewFolderSelection(uids:string[]){
 if(folderPlanBusy.value)return;folderPlanBusy.value=true;folderPlanError.value=''
 const scope=aiDataScope(),folder=folderPlan.value
 try{const service=notesStore.service(),values=await Promise.all(uids.map(uid=>service.get(uid)));if(scope!==aiDataScope()||folder!==folderPlan.value)throw Error('账号或目录已切换，请重新选择');if(values.some(note=>!note))throw Error('部分来源已不存在，请刷新目录后重试');const sources=values as NoteEntity[];if(!folder||!scopedFolders.value.some(row=>row.uid===folder.uid)||folderConsolidationCandidates(folder,scopedFolders.value,sources,true).length!==sources.length)throw Error('来源已移动或不再允许整合，请刷新目录');consolidationInput(sources);consolidationSources.value=JSON.parse(JSON.stringify(sources));folderPlan.value=undefined;consolidationOpen.value=true}catch(source){folderPlanError.value=source instanceof Error?source.message:'来源核对失败'}finally{folderPlanBusy.value=false}
}
const consolidationOpen=ref(false),consolidationSources=ref<NoteEntity[]>([])
async function openConsolidation(){await flushDraft();consolidationSources.value=JSON.parse(JSON.stringify(bulkItems.value));consolidationOpen.value=true}
function consolidationChanged(uid?:string){if(uid)notesStore.select(uid);leaveMultiSelect()}
const downloadBusy=ref(false)
async function downloadNoteScope(scope?:{folderUid?:string;noteUid?:string}){if(downloadBusy.value)return;downloadBusy.value=true;const progress=ElMessage({type:'info',message:'正在准备下载文件…',duration:0});try{const assertCurrent=captureFileExportBoundary();await flushDraft();await notesStore.flushPendingSaves();const service=notesStore.service();const notes=[...await service.list('active'),...await service.list('archived')];assertCurrent();const saved=await downloadNotes(String(auth.user?.userId||''),notes,folders.value,uid=>service.getForMutation(uid),scope);if(saved)ElMessage.success(isDesktopClient()?'下载文件已保存':'已发起文件下载');else ElMessage.info('已取消下载')}catch(source){notesStore.error=source instanceof Error?source.message:'下载失败';ElMessage.error(notesStore.error)}finally{progress.close();downloadBusy.value=false}}
function openLibraryDownloads(event:MouseEvent){openContextMenu(event,[{id:'download-library',label:'下载整个笔记库',iconName:'download',disabled:downloadBusy.value,run:()=>downloadNoteScope()}])}
function openNoteListActions(event:MouseEvent){openContextMenu(event,[{id:'bulk',label:'批量管理',iconName:'check',disabled:!visibleNotes.value.length,run:enterMultiSelect},...(!isCommunityEdition&&activeFolder.value?[{id:'folder-consolidation',label:'整合当前目录',run:()=>openFolderConsolidation(activeFolder.value!)}]:[])])}
function openBulkMore(event:MouseEvent){if(bulkBusy.value||!bulkSelected.value.size)return;openContextMenu(event,[
 {id:'bulk-tag',label:'添加标签',run:()=>openBulk('tag')},
 {id:'bulk-organize',label:'标记已整理',run:()=>executeQuickBulk('organize')},
 {id:'bulk-archive',label:'归档',run:()=>openBulk('archive')},
 {id:'bulk-delete',label:'移到回收站',danger:true,separator:true,run:deleteSelectedNotes},
])}

const MarkdownEditor = defineAsyncComponent(() => import('../components/MarkdownEditor.vue'))
const MarkdownPreview = defineAsyncComponent(() => import('../components/MarkdownPreview.vue'))

const route = useRoute(), router = useRouter()
watch(()=>route.fullPath,()=>{bodyRecoveryNoteUid.value=''})
const projectUid = computed(() => typeof route.params.projectUid === 'string' ? route.params.projectUid : typeof route.query.projectUid === 'string' ? route.query.projectUid : '')
const TREE_VISIBLE_KEY = 'jiyu-pc-note-library-visible'
const treeVisibilityKey=computed(()=>projectUid.value?'jiyu-pc-project-directory-visible':TREE_VISIBLE_KEY)
const TREE_WIDTH_KEY = 'jiyu-pc-note-library-width'
const LIST_VISIBLE_KEY = 'jiyu-pc-note-list-visible'
const storedVisibility = (key: string, fallback: boolean) => { const value = localStorage.getItem(key); return value === null ? fallback : value !== 'false' }
const treeVisible = ref(storedVisibility(treeVisibilityKey.value, window.innerWidth>1100))
const listVisible = ref(storedVisibility(LIST_VISIBLE_KEY, true))
const focusReading = ref(false)
const propertiesVisible = ref(false)
const OUTLINE_VISIBLE_KEY='jiyu-pc-note-outline-visible'
const wideOutlinePreference=ref(storedVisibility(OUTLINE_VISIBLE_KEY,true))
const outlineOverlayOpen=ref(false),outlineManualOpen=ref(false),sidebarFloating=ref(true)
const workspaceElement=ref<HTMLElement>(),outlineButton=ref<HTMLButtonElement>(),infoButton=ref<HTMLButtonElement>()
let sidebarResizeObserver:ResizeObserver|undefined
const previewHeadings=ref<Array<{text:string;level:number}>>([]),activePreviewHeading=ref(-1)
const markdownPreview=ref<{scrollToHeading:(index:number)=>void}>()
const outlineSidebarVisible=computed(()=>editorMode.value!=='edit'&&Boolean(selected.value)&&!selectedIsFile.value&&!focusReading.value&&(sidebarFloating.value?outlineOverlayOpen.value:wideOutlinePreference.value&&(hasAutomaticNoteOutline(draftContent.value)||outlineManualOpen.value)))
function setWideOutlinePreference(value:boolean){wideOutlinePreference.value=value;localStorage.setItem(OUTLINE_VISIBLE_KEY,String(value))}
function closeOutline(){if(sidebarFloating.value)outlineOverlayOpen.value=false;else setWideOutlinePreference(false);void nextTick(()=>outlineButton.value?.focus())}
function closeNoteInfo(){propertiesVisible.value=false;void nextTick(()=>infoButton.value?.focus())}
function toggleNoteInfo(){if(propertiesVisible.value)closeNoteInfo();else{outlineOverlayOpen.value=false;propertiesVisible.value=true}}
function toggleOutlineSidebar(){
  const closing=outlineSidebarVisible.value&&!propertiesVisible.value
  propertiesVisible.value=false
  if(sidebarFloating.value)outlineOverlayOpen.value=!closing
  else{outlineManualOpen.value=true;setWideOutlinePreference(!closing)}
}
function selectOutlineHeading(index:number){markdownPreview.value?.scrollToHeading(index);if(sidebarFloating.value)closeOutline()}
function closeFloatingSidebar(){if(!sidebarFloating.value)return;if(propertiesVisible.value)closeNoteInfo();else if(outlineSidebarVisible.value)closeOutline()}
function measureSidebarSpace(){
  const root=workspaceElement.value;if(!root||!root.clientWidth)return
  let occupied=0
  for(const node of root.querySelectorAll<HTMLElement>(':scope > .note-tree,:scope > .note-list-panel,:scope > .column-resizer,:scope > .tree-column-resizer')){
    const style=getComputedStyle(node)
    if(style.position!=='absolute'&&style.display!=='none')occupied+=node.getBoundingClientRect().width
  }
  const floating=root.clientWidth-occupied-260<600||window.innerWidth<=1100
  if(floating!==sidebarFloating.value){outlineOverlayOpen.value=false;if(floating)propertiesVisible.value=false;sidebarFloating.value=floating}
}


let compactLibrary = window.innerWidth <= 1100
const folderQuery = ref('')
const collapsedFolderIds=ref(new Set<number|string>((()=>{try{const value=JSON.parse(localStorage.getItem('jiyu-pc-collapsed-folders')||'[]');return Array.isArray(value)?value:[]}catch{return[]}})()))
const smartViewsExpanded=ref(false)
const tagManagerOpen=ref(false),tagManagerQuery=ref(''),tagPickerOpen=ref(false),tagPickerQuery=ref('')
const listTagUids=ref<string[]>([]),listTagMode=ref<TagMatchMode>('any')
const favoriteTagUids=ref<string[]>([])
const treeGroups=ref<Record<'organize'|'archive'|'tags',boolean>>((()=>{try{return{organize:true,archive:true,tags:true,...JSON.parse(localStorage.getItem('jiyu-pc-note-tree-groups')||'{}')}}catch{return{organize:true,archive:true,tags:true}}})())
function toggleTreeGroup(group:'organize'|'archive'|'tags'){treeGroups.value[group]=!treeGroups.value[group];localStorage.setItem('jiyu-pc-note-tree-groups',JSON.stringify(treeGroups.value))}
const includeSubfolders=ref(localStorage.getItem('jiyu-pc-include-subfolders')!=='false')
const listQuery = ref('')
type NoteListSort='updated_desc'|'updated_asc'|'title_asc'
const listSort=ref<NoteListSort>((localStorage.getItem('jiyu-pc-note-list-sort') as NoteListSort)||'updated_desc')
type NoteListGroup='none'|'project'|'type'|'month'
const listGroup=ref<NoteListGroup>((localStorage.getItem('jiyu-pc-note-list-group') as NoteListGroup)||'none')
const showListSummary=ref(localStorage.getItem('jiyu-pc-note-list-summary')==='true')
const showListPath=ref(localStorage.getItem('jiyu-pc-note-list-path')==='true')
watch(showListSummary,value=>localStorage.setItem('jiyu-pc-note-list-summary',String(value)))
watch(showListPath,value=>localStorage.setItem('jiyu-pc-note-list-path',String(value)))
function openListDisplayOptions(event:MouseEvent){openContextMenu(event,[{id:'summary',label:`${showListSummary.value?'✓ ':''}显示摘要`,run:()=>{showListSummary.value=!showListSummary.value}},{id:'path',label:`${showListPath.value?'✓ ':''}全部笔记显示目录路径`,run:()=>{showListPath.value=!showListPath.value}}])}
const listLimit=ref(20)
const listWidth = ref(Math.min(600,Math.max(300,Number(localStorage.getItem('jiyu-pc-note-list-width'))||460)))
watch(listWidth,value=>localStorage.setItem('jiyu-pc-note-list-width',String(value)))
const treeWidth = ref(Math.min(440, Math.max(220, Number(localStorage.getItem(TREE_WIDTH_KEY)) || 260)))
const listControlOpen = ref<''|'filter'>('')
const listFilterMenu = ref<HTMLElement>()
const listFilterButton=ref<HTMLButtonElement>(),listPopover=ref<HTMLElement>()
const listPopoverStyle=ref<Record<string,string>>({})
function toggleListControl(type:'filter'){
  if(listControlOpen.value===type){listControlOpen.value='';return}
  const trigger=listFilterButton.value,width=250
  if(trigger){const rect=trigger.getBoundingClientRect(),left=Math.max(8,Math.min(window.innerWidth-width-8,rect.right-width));listPopoverStyle.value={top:`${rect.bottom+7}px`,left:`${left}px`,width:`${width}px`}}
  listControlOpen.value=type
}
const dragging = ref(false)
const treeDragging = ref(false)
const notesStore = useNotesStore()
const titleTagsOpen=ref(false),titleTagsButton=ref<InstanceType<typeof ElButton>>()
function closeTitleTags(){titleTagsOpen.value=false;void nextTick(()=>titleTagsButton.value?.ref?.focus())}
watch(()=>notesStore.selectedUid,()=>{titleTagsOpen.value=false;outlineOverlayOpen.value=false;outlineManualOpen.value=false;previewHeadings.value=[]})
watch([treeVisible,listVisible,treeWidth,listWidth],()=>{void nextTick(measureSidebarSpace)})
const auth=useAuthStore(),ownerId=computed(()=>String(auth.user?.userId||''))
const tagFavoritesKey=()=>scopedPreferenceKey('jiyu-pc-favorite-note-tags',ownerId.value)
watch(ownerId,()=>{directoryOrganization.value=undefined;try{const saved=JSON.parse(localStorage.getItem(tagFavoritesKey())||'[]');favoriteTagUids.value=Array.isArray(saved)?saved.filter(value=>typeof value==='string'):[]}catch{favoriteTagUids.value=[]}},{immediate:true})
function toggleFavoriteTag(tag:TagEntity){favoriteTagUids.value=favoriteTagUids.value.includes(tag.uid)?favoriteTagUids.value.filter(uid=>uid!==tag.uid):[...favoriteTagUids.value,tag.uid];localStorage.setItem(tagFavoritesKey(),JSON.stringify(favoriteTagUids.value))}
const draftTitle = ref('')
const draftContent = ref('')
type EditorMode = 'edit' | 'preview' | 'split'
const editorMode = ref<EditorMode>((['preview','split'].includes(localStorage.getItem('jiyu-pc-editor-mode')||'')?localStorage.getItem('jiyu-pc-editor-mode'):'edit') as EditorMode)
const instantRendering = ref(localStorage.getItem('jiyu-pc-instant-rendering') === 'true')
const previewInitialized = ref(editorMode.value !== 'edit')
watch(editorMode,mode=>{outlineOverlayOpen.value=false;if(mode!=='edit'){previewInitialized.value=true;propertiesVisible.value=false}})
watch(instantRendering, value => localStorage.setItem('jiyu-pc-instant-rendering', String(value)))
type MarkdownEditorHandle={insertText:(text:string)=>void;replaceSelection:(before:string,after?:string,placeholderText?:string)=>void;prefixLines:(prefix:string)=>void;setHeading:(level:number)=>void;undo:()=>void;redo:()=>void;focus:()=>void}
const markdownEditor = ref<MarkdownEditorHandle>()
const NoteCanvasPicker=defineAsyncComponent(()=>import('../components/NoteCanvasPicker.vue'))
const noteCanvasPickerOpen=ref(false)
async function chooseExistingCanvas(uid:string){
 const note=selected.value,owner=ownerId.value;if(!note||note.deleted)return
 try{const {canvas}=await resolveLinkedCanvas(owner,uid);if(selected.value?.uid!==note.uid||ownerId.value!==owner)return
  const markdown=linkedCanvasMarkdown(canvas.uid,canvas.title)
  if(markdownEditor.value&&editorMode.value!=='preview')markdownEditor.value.insertText(markdown+'\n');else draftContent.value+=`\n${markdown}\n`
  await notesStore.saveNote(note.uid,{content:draftContent.value});noteCanvasPickerOpen.value=false
 }catch(source){attachmentError.value=source instanceof Error?source.message:'画布插入失败';noteCanvasPickerOpen.value=false}
}
async function openLinkedNoteCanvas(uid:string){try{await flushDraft();await resolveLinkedCanvas(ownerId.value,uid);await router.push({path:'/canvas',query:{canvas:uid}})}catch(source){attachmentError.value=source instanceof Error?source.message:'画布打开失败'}}
const NoteCanvasDialog=defineAsyncComponent(()=>import('../components/NoteCanvasDialog.vue'))
const noteCanvas=ref<{id:string;noteUid:string;owner:string;scene:string;existing:boolean;linkedUid?:string}>(),noteCanvasBusy=ref(false),noteCanvasError=ref('')
let noteCanvasRequest=0
async function openNoteCanvas(id?:string){
 const note=selected.value,owner=ownerId.value;if(!note||note.deleted||selectedIsFile.value||noteCanvasBusy.value)return
 const request=++noteCanvasRequest;attachmentError.value='';noteCanvasError.value=''
 try{
  let scene=JSON.stringify({type:'excalidraw',version:2,source:'note-flow',elements:[],appState:{viewBackgroundColor:'#ffffff'},files:{}})
  if(id){
   const embed=noteCanvasEmbeds(draftContent.value).find(item=>item.id===id),item=embed&&attachmentImageItem(embed.source)
   if(!item)throw Error('找不到画布引用')
   scene=await(await cachedAttachment(owner,{...item,originalFilename:'drawing.excalidraw',mediaType:'application/json'})).text();parseNoteCanvasScene(scene)
  }
  if(request!==noteCanvasRequest||selected.value?.uid!==note.uid||ownerId.value!==owner)return
  noteCanvas.value={id:id||crypto.randomUUID(),noteUid:note.uid,owner,scene,existing:Boolean(id)}
 }catch(source){if(request===noteCanvasRequest)attachmentError.value=source instanceof Error?source.message:'画布打开失败'}
}
async function saveNoteCanvas(scene:string,preview:Blob){
 const canvas=noteCanvas.value;if(!canvas||noteCanvasBusy.value)return
 noteCanvasBusy.value=true;attachmentBusy.value=true;noteCanvasError.value=''
 try{
  const valid=()=>selected.value?.uid===canvas.noteUid&&ownerId.value===canvas.owner&&!selected.value?.deleted
  if(!valid())throw Error('笔记或空间已切换，请关闭画布后重新打开')
  parseNoteCanvasScene(scene)
  if(canvas.existing&&!canvas.linkedUid)replaceNoteCanvas(draftContent.value,canvas.id,'')
  if(!canvas.existing||canvas.linkedUid){
   if(!canvas.linkedUid){const saved=await createCanvasService(canvas.owner).create({title:`${draftTitle.value.trim()||'笔记'} · 画布`,canvasType:'excalidraw',sceneData:scene,documentData:scene,areaUid:selected.value?.areaUid||null,projectUid:selected.value?.projectUid||null});canvas.linkedUid=saved.uid}
   if(!valid())throw Error('笔记或空间已切换，画布已保存在画布库')
   let saved=(await createCanvasService(canvas.owner).list()).find(item=>item.uid===canvas.linkedUid)
   if(!saved)throw Error('找不到新建的画布')
   if((saved.documentData||saved.sceneData)!==scene)saved=await createCanvasService(canvas.owner).update(saved,{sceneData:scene,documentData:scene})
   const markdown=linkedCanvasMarkdown(saved.uid,saved.title)
   if(!draftContent.value.includes(`](noteflow-canvas:${saved.uid})`)){if(markdownEditor.value&&editorMode.value!=='preview')markdownEditor.value.insertText(markdown+'\n');else draftContent.value+=`\n${markdown}\n`}
  }else{
  const drawing=await queueAttachment(canvas.owner,canvas.noteUid,new File([scene],`canvas-${canvas.id}.excalidraw`,{type:'application/json'}))
  const image=await queueAttachment(canvas.owner,canvas.noteUid,new File([preview],`canvas-${canvas.id}.png`,{type:'image/png'}))
  if(!valid())throw Error('笔记或空间已切换，画布文件已保留在原笔记')
  const markdown=noteCanvasMarkdown(canvas.id,`attachment:${drawing.uid}`,`attachment:${image.uid}`)
  if(canvas.existing)draftContent.value=replaceNoteCanvas(draftContent.value,canvas.id,markdown)
  else if(markdownEditor.value&&editorMode.value!=='preview')markdownEditor.value.insertText(markdown+'\n')
  else draftContent.value+=`${draftContent.value&&!draftContent.value.endsWith('\n')?'\n':''}${markdown}\n`
  }
  canvas.existing=true
  await notesStore.saveNote(canvas.noteUid,{content:draftContent.value})
  noteCanvas.value=undefined
  await loadAttachments(canvas.noteUid)
  void flushAttachments().catch(source=>{attachmentError.value=source instanceof Error?source.message:'画布已保存到本机，上传暂未完成'})
 }catch(source){noteCanvasError.value=source instanceof Error?source.message:'画布保存失败'}finally{noteCanvasBusy.value=false;attachmentBusy.value=false}
}

const editorReady=ref(false),propertiesReady=ref(false)
let hydrationFrame=0,hydrationIdle=0
let workspaceLoaded=false
const folders = ref<FolderEntity[]>([])
const tags = ref<TagEntity[]>([])
const journalSeries = ref<JournalSeriesEntity[]>([])
const projects = ref<ProjectEntity[]>([])
const areas = ref<AreaEntity[]>([])
const project = ref<ProjectEntity>()
const projectArea = ref<AreaEntity>()
const folderError = ref('')
const reportGeneration = ref<ReportGenerationInfo>()
const reportRegenerating = ref(false)
const reportActionError = ref('')
const taskCreateStatus=ref('')
const online = ref(window.navigator.onLine)
const attachments=ref<AttachmentItem[]>([]),localAttachmentRows=ref<LocalAttachment[]>([]),attachmentBusy=ref(false),attachmentError=ref(''),attachmentPreviewIndex=ref(-1)
const propertyAttachmentCount=computed(()=>new Set([...attachments.value.map(item=>item.uid),...localAttachmentRows.value.filter(item=>item.status!=='uploaded'&&item.status!=='local').map(item=>item.serverUid||item.uid)]).size)
type FolderImportCandidate={file:File;sha256:string;relativePath:string;directoryParts:string[];duplicate?:NoteEntity|true;pendingNote?:NoteEntity;pendingAttachment?:{uid:string;sha256:string}}
type FolderImportDestination={id:number|null;uid:string|null;name:string;areaUid?:string|null;projectUid?:string|null}
const folderImportInput=ref<HTMLInputElement>(),folderTreeImportInput=ref<HTMLInputElement>(),folderImportOpen=ref(false),folderImportFolder=ref<FolderImportDestination>(),folderImportCandidates=ref<FolderImportCandidate[]>([]),folderImportKeepDuplicates=ref(false),folderImportBusy=ref(false),folderImportMessage=ref('')
const folderImportDirectoryCount=computed(()=>{const paths=new Set<string>();for(const item of folderImportCandidates.value)for(let index=1;index<=item.directoryParts.length;index++)paths.add(item.directoryParts.slice(0,index).join('/'));return paths.size})
const noteLinks=ref<NoteLinkView[]>([]),linkError=ref('')
const intelligenceBusy=ref(false),intelligenceMessage=ref('')
type NoteBulkAction = 'move'|'tag'|'archive'|'organize'|'pending'|'pin'
const bulkSelected = ref(new Set<string>())
const multiSelectMode = ref(false)
const bulkAction = ref<NoteBulkAction>()
const bulkAreaUid = ref(''), bulkProjectUid = ref(''), bulkTagId = ref<number>()
const bulkBusy = ref(false), bulkCompleted = ref(0), bulkFailures = ref<BulkFailure<NoteEntity>[]>([])
const bulkUndo = ref<{action:NoteBulkAction;items:NoteEntity[]}>()
const bulkUndoFailures=ref<BulkFailure<NoteEntity>[]>([])
async function extractSelectedKnowledge(){if(isCommunityEdition)return;const notes=[...bulkItems.value].filter(note=>!note.deleted&&note.aiPolicy!=='excluded');if(notes.length<2){intelligenceMessage.value='请至少选择两篇允许 AI 处理的笔记';return}if(!await confirmDialog(`将基于 ${notes.length} 篇笔记生成知识草稿，原笔记不会修改。继续吗？`))return;intelligenceBusy.value=true;try{const joined=notes.map(note=>`## ${note.title||'未命名笔记'}\n\n${note.content||''}`).join('\n\n---\n\n');const title=await promptDialog('知识标题',`${notes[0].title||'多篇笔记'} · 知识整理`);if(!title?.trim())return;const conclusion=await promptDialog('一句话说明可复用结论','');if(conclusion===null)return;const created=await knowledgeService.create({title:title.trim(),conclusion:conclusion.trim(),content:joined,maturity:'draft',confidence:'medium',keyPoints:[],sourceNoteUids:notes.map(note=>note.uid)});intelligenceMessage.value=`知识“${created.title}”已创建，已关联 ${notes.length} 篇来源笔记`;bulkSelected.value=new Set();await router.push(`/knowledge/${created.uid}`)}catch(e){intelligenceMessage.value=e instanceof Error?e.message:'知识提炼失败'}finally{intelligenceBusy.value=false}}

function adaptWorkspace() {
  const nextCompactLibrary = window.innerWidth <= 1100
  if (nextCompactLibrary && !compactLibrary && !projectUid.value) treeVisible.value = false
  void nextTick(measureSidebarSpace)
  compactLibrary = nextCompactLibrary
}
const organizationNotes=computed(()=>[...new Map([...notesStore.archived,...notesStore.notes].map(note=>[note.uid,note])).values()])
const findOrganizationNote=(uid:string)=>organizationNotes.value.find(note=>note.uid===uid)
const bulkItems = computed(()=>organizationNotes.value.filter(note=>bulkSelected.value.has(note.uid)))
const bulkTargetProjects = computed(()=>projects.value.filter(item=>!bulkAreaUid.value||item.areaUid===bulkAreaUid.value).filter(item=>!['archived','completed'].includes(item.status)))
const selectedFolderId = ref<number | string>('all')
const selectedLibraryAreaUid=computed(()=>selectedTreeArea(selectedFolderId.value))
const preferredLibraryAreaUid=ref(globalAreaUid.value)
const libraryAreaExpansion=ref<Record<string,boolean>>({})
const libraryAreaPreferenceKey=()=>scopedPreferenceKey('jiyu-pc-library-area-expansion',ownerId.value||'anonymous')
watch(ownerId,()=>{try{const saved=JSON.parse(localStorage.getItem(libraryAreaPreferenceKey())||'{}');libraryAreaExpansion.value=saved&&typeof saved==='object'&&!Array.isArray(saved)?Object.fromEntries(Object.entries(saved).filter(([key,value])=>key.startsWith('area:')&&typeof value==='boolean')) as Record<string,boolean>:{}}catch{libraryAreaExpansion.value={}}},{immediate:true})
function setLibraryAreaCollapsed(uid:string,collapsed:boolean){libraryAreaExpansion.value={...libraryAreaExpansion.value,[areaTreeId(uid)]:!collapsed};localStorage.setItem(libraryAreaPreferenceKey(),JSON.stringify(libraryAreaExpansion.value))}
function selectLibraryArea(uid:string){selectFolder(areaTreeId(uid))}

const folderOwnership=computed(()=>{
  const byId=new Map(folders.value.map(folder=>[folder.id,{projects:new Set<string>(folder.projectUid?[folder.projectUid]:[]),hasGlobal:false}])),idByUid=new Map(folders.value.map(folder=>[folder.uid,folder.id]))
  for(const note of notesStore.notes.filter(isRegularNote)){const id=Number(note.folderId)||idByUid.get(note.folderUid||'');if(!id||!byId.has(id))continue;const owner=byId.get(id)!;note.projectUid?owner.projects.add(note.projectUid):owner.hasGlobal=true}
  const children=new Map<number,number[]>();for(const folder of folders.value)if(folder.parentId!=null)children.set(folder.parentId,[...(children.get(folder.parentId)||[]),folder.id])
  const visiting=new Set<number>(),resolved=new Set<number>(),resolve=(id:number)=>{if(resolved.has(id)||visiting.has(id))return;visiting.add(id);for(const childId of children.get(id)||[]){resolve(childId);const parent=byId.get(id),child=byId.get(childId);if(parent&&child){child.projects.forEach(value=>parent.projects.add(value));parent.hasGlobal ||= child.hasGlobal}}visiting.delete(id);resolved.add(id)}
  folders.value.forEach(folder=>resolve(folder.id));return byId
})
function folderBelongsToScope(folder:FolderEntity){const ownership=folderOwnership.value.get(folder.id);if(projectUid.value)return folder.projectUid===projectUid.value||(!folder.projectUid&&!ownership?.hasGlobal&&Boolean(ownership?.projects.has(projectUid.value)));return(!globalAreaUid.value||folder.areaUid===globalAreaUid.value)&&!folder.projectUid&&(Boolean(ownership?.hasGlobal)||!ownership?.projects.size)}
const scopedFolders=computed(()=>folders.value.filter(folderBelongsToScope))
const displayedFolders=computed(()=>projectVisibleFolders(scopedFolders.value,projects.value.find(project=>project.uid===projectUid.value)))
const groupFoldersByArea=computed(()=>!projectUid.value&&!globalAreaUid.value)
const libraryAreaCounts=computed(()=>{const counts=new Map<string,number>();for(const note of regularNotes.value.filter(inGlobalArea)){const uid=note.areaUid||'';counts.set(uid,(counts.get(uid)||0)+1)}return counts})
const noteAreaGroups=computed(()=>buildNoteAreaGroups(areas.value,scopedFolders.value,libraryAreaCounts.value))
const expandedLibraryAreaIds=computed(()=>expandedNoteAreas(noteAreaGroups.value,libraryAreaExpansion.value,preferredLibraryAreaUid.value))
const selectedLibraryAreaLabel=computed(()=>selectedLibraryAreaUid.value===undefined?'':noteAreaGroups.value.find(group=>group.uid===selectedLibraryAreaUid.value)?.label||(selectedLibraryAreaUid.value?'领域信息待同步':'未归属领域'))

const selectedFolderScope=computed(()=>{if(typeof selectedFolderId.value!=='number')return{ids:new Set<number>(),uids:new Set<string>()};const ids=new Set<number>([selectedFolderId.value]),uids=new Set<string>();let changed=true;while(changed){changed=false;for(const folder of scopedFolders.value)if(folder.id===selectedFolderId.value||includeSubfolders.value&&folder.parentId!=null&&ids.has(folder.parentId)&&(folder.areaUid||'')===(scopedFolders.value.find(parent=>parent.id===folder.parentId)?.areaUid||'')){if(!ids.has(folder.id)){ids.add(folder.id);changed=true}if(folder.uid)uids.add(folder.uid)}}return{ids,uids}})
watch(includeSubfolders,value=>localStorage.setItem('jiyu-pc-include-subfolders',String(value)))
const selected = computed(() => notesStore.selected)
const outlineNoteKey=computed(()=>scopedPreferenceKey(`note-outline:${selected.value?.uid||''}`,ownerId.value))
const noteOutline=useNoteOutline(previewHeadings,outlineNoteKey,activePreviewHeading)
const noteOutlineQuery=ref('')
watch(outlineNoteKey,()=>{noteOutlineQuery.value=''})
// 搜索临时穿透折叠并保留匹配标题的祖先，不改变用户原有折叠偏好与原始定位序号。
const filteredNoteOutline=computed(()=>{
 const query=noteOutlineQuery.value.trim().toLocaleLowerCase()
 if(!query)return noteOutline.visibleRows.value
 const keep=new Set<number>(),rows=noteOutline.rows.value
 for(const row of rows)if(row.text.toLocaleLowerCase().includes(query)){
  let index=row.index;while(index>=0&&!keep.has(index)){keep.add(index);index=rows[index].parent}
 }
 return rows.filter(row=>keep.has(row.index))
})
function openOutlineActions(event:MouseEvent){openContextMenu(event,[
 {id:'outline-expand',label:'全部展开',disabled:!previewHeadings.value.length,run:()=>noteOutline.expandAll()},
 {id:'outline-collapse',label:'全部收起',disabled:!noteOutline.rows.value.some(row=>row.hasChildren),run:()=>noteOutline.collapseAll()},
])}

const mobileNotePane = ref<'library'|'list'|'editor'>('list')
watch(() => notesStore.selectedUid, uid => { if (uid) mobileNotePane.value = 'editor' }, {immediate:true})
function showMobileNotePane(pane: 'library'|'list'|'editor') { mobileNotePane.value = pane; if(pane==='library')treeVisible.value=true; if(pane==='list')listVisible.value=true }
const selectedIsFile=computed(()=>isFileNote(selected.value))
function legacyFileAttachmentUid(note:NoteEntity){return note.attachmentUid||note.content?.match(/\/api\/v1\/attachments\/([^/)\s]+)\/content/)?.[1]||null}
function inferredFileMediaType(note:NoteEntity){return inferMediaType(note.fileName||note.title||'',note.mediaType||'')}
const selectedFileAttachment=computed<AttachmentItem|undefined>(()=>{const note=selected.value;if(!note)return;const uid=legacyFileAttachmentUid(note),linked=attachments.value.find(item=>item.uid===uid)||attachments.value[0];if(linked)return linked;if(!uid)return;return{uid,version:0,originalFilename:note.fileName||note.title||'文件',mediaType:inferredFileMediaType(note),sizeBytes:Number(note.sizeBytes||0),sha256:note.sha256||'',contentUrl:`/api/v1/attachments/${uid}/content`}})
const selectedFileInlinePreview=computed(()=>{const note=selected.value;return Boolean(note&&selectedIsFile.value&&canInlinePreview(note.fileName||note.title||'',inferredFileMediaType(note)))})
const selectedIsPdfPreview=computed(()=>Boolean(selectedIsFile.value&&selectedFileInlinePreview.value&&selectedFileAttachment.value&&isPdfPreviewFile(selectedFileAttachment.value.originalFilename,selectedFileAttachment.value.mediaType||'')))
const selectedFolderMetadata=computed(()=>selected.value?folders.value.find(folder=>folder.id===selected.value?.folderId||folder.uid===selected.value?.folderUid):undefined)
const selectedFolderValue=computed(()=>selectedFolderMetadata.value?.id||'')
const selectedAreaMetadata=computed(()=>areas.value.find(area=>area.uid===selected.value?.areaUid))
const selectedProjectMetadata=computed(()=>projects.value.find(item=>item.uid===selected.value?.projectUid))
const inGlobalArea=(note:{areaUid?:string|null;projectUid?:string|null})=>projectUid.value?note.projectUid===projectUid.value:!note.projectUid&&(!globalAreaUid.value||note.areaUid===globalAreaUid.value)
const scopedArchived=computed(()=>notesStore.archived.filter(isRegularNote).filter(inGlobalArea))
const scopedTrash=computed(()=>notesStore.trash.filter(isRegularNote).filter(inGlobalArea))
const reportSeriesUid = computed(() => typeof route.params.seriesUid === 'string' ? route.params.seriesUid : '')
const regularNotes = computed(() => notesStore.notes.filter(isRegularNote))
const periodicNotes = computed(() => notesStore.notes.filter(isPeriodicNote))
const allProjectNotes = computed(() => notesStore.notes.filter(note => Boolean(note.projectUid) && isRegularNote(note)))
const projectNotes = computed(() => {
  if (!projectUid.value) return notesStore.notes.filter(isRegularNote)
  const scoped = notesStore.notes.filter(note => note.projectUid === projectUid.value)
  return reportSeriesUid.value ? scoped.filter(note => note.journalSeriesUid === reportSeriesUid.value) : scoped.filter(isRegularNote)
})
const selectedTagId = computed(() => typeof selectedFolderId.value === 'string' && selectedFolderId.value.startsWith('tag:') ? Number(selectedFolderId.value.slice(4)) : null)
const periodFilter = computed(() => typeof selectedFolderId.value === 'string' && selectedFolderId.value.startsWith('period:') ? selectedFolderId.value.slice(7) : '')
const projectFilter = computed(() => typeof selectedFolderId.value === 'string' && selectedFolderId.value.startsWith('project:') ? selectedFolderId.value.slice(8) : '')
const showingProjectNotes = computed(() => Boolean(projectFilter.value))
const smartFilter = computed(() => typeof selectedFolderId.value==='string'&&selectedFolderId.value.startsWith('smart:')?selectedFolderId.value.slice(6):'')
const canCreateInCurrentScope=computed(()=>selectedFolderId.value==='all'||selectedLibraryAreaUid.value!==undefined||typeof selectedFolderId.value==='number')
const emptyScopeLabel=computed(()=>selectedLibraryAreaUid.value!==undefined?'当前领域还没有笔记':selectedFolderId.value==='trash'?'回收站为空':selectedFolderId.value==='archived'?'还没有归档笔记':smartFilter.value==='inbox'?'收集箱已清空':smartFilter.value==='pending'?'没有待整理笔记':periodFilter.value?'当前分类还没有记录':'当前目录还没有笔记')
const emptyScopeHelp=computed(()=>selectedLibraryAreaUid.value!==undefined?'可以新建笔记，或先创建目录来组织内容。':selectedFolderId.value==='trash'?'删除的笔记会暂存在这里。':selectedFolderId.value==='archived'?'归档后的笔记会保留在这里。':smartFilter.value==='inbox'?'新捕获且尚未进入整理流程的内容会显示在这里。':smartFilter.value==='pending'?'已进入整理流程、但尚未完成归类的笔记会显示在这里。':periodFilter.value?'日报、周报和总结请从对应的记录或项目入口生成。':'可以在当前目录中新建笔记。')
const typeFilter = computed(() => typeof selectedFolderId.value==='string'&&selectedFolderId.value.startsWith('type:')?selectedFolderId.value.slice(5):'')
const listTypeFilter=ref('')
const listFileFilter=ref<''|'file'|'non_file'>('')
const noteTypeLabels:Record<string,string>={note:'普通笔记',knowledge:'知识笔记',meeting:'会议记录',problem_analysis:'问题分析'}
function fileKindLabel(note:NoteEntity){
  const extension=String(note.fileExtension||note.fileName?.split('.').pop()||note.title?.split('.').pop()||'').toLocaleLowerCase()
  const extensionLabels:Record<string,string>={pdf:'PDF',doc:'Word',docx:'Word',xls:'Excel',xlsx:'Excel',csv:'CSV',ppt:'PowerPoint',pptx:'PowerPoint',xmind:'XMind',drawio:'Draw.io',md:'Markdown',txt:'文本',zip:'ZIP',rar:'RAR','7z':'7Z'}
  return extensionLabels[extension]||({pdf:'PDF',word:'Word',excel:'Excel',powerpoint:'PowerPoint',xmind:'XMind',other:'文件'} as Record<string,string>)[String(note.fileKind||'other')]||'文件'
}
function contentTypeLabel(note:NoteEntity){
  if(isFileNote(note))return fileKindLabel(note)
  return({note:'笔记',mindmap:'思维导图',journal:'日志',knowledge:'知识',meeting:'会议',work_log:'工作日志',problem_analysis:'问题分析'} as Record<string,string>)[String(note.type||'note')]||'笔记'
}
function contentTypeIcon(note:NoteEntity){
  if(!isFileNote(note))return({mindmap:'◇',journal:'◷',knowledge:'◆',meeting:'▣',work_log:'◫',problem_analysis:'◉'} as Record<string,string>)[String(note.type||'note')]||'▤'
  return({PDF:'PDF',Word:'W',Excel:'X',CSV:'CSV',PowerPoint:'P',XMind:'XM','Draw.io':'D',Markdown:'M',文本:'T',ZIP:'ZIP',RAR:'RAR','7Z':'7Z',文件:'F'} as Record<string,string>)[fileKindLabel(note)]||'F'
}
function contentTypeClass(note:NoteEntity){return isFileNote(note)?`file kind-${fileKindLabel(note).toLocaleLowerCase().replace(/[^a-z0-9]+/g,'-')}`:`kind-${String(note.type||'note').replace(/_/g,'-')}`}
async function openFileItem(note=selected.value){if(!note)return;const attachmentUid=legacyFileAttachmentUid(note);if(!attachmentUid)return;const linked=(await listAttachments(note.uid).catch(()=>[])).find(item=>item.uid===attachmentUid)||undefined;if(linked){await openAttachmentContent(ownerId.value,linked);return}if(isCommunityEdition)throw new Error('本地附件不存在，请从完整备份恢复附件');const response=await api.get<Blob>(`/api/v1/attachments/${attachmentUid}/content`,{responseType:'blob',timeout:0});await saveLocalExport(response.data,note.fileName||note.title||'文件')}
function matchesListType(note:NoteEntity,type:string){return!type||(type==='note'?(!note.type||note.type==='note'):note.type===type)}
function matchesFileFilter(note:NoteEntity,filter:string){return!filter||(filter==='file'?isFileNote(note):!isFileNote(note))}
const currentProject = computed(() => project.value || (projectFilter.value && projectFilter.value !== 'all' ? projects.value.find(item=>item.uid===projectFilter.value) : undefined))
function periodicCategory(note:{journalSeriesUid?:string|null;periodType?:string|null}){
  const series=journalSeries.value.find(item=>item.uid===note.journalSeriesUid),kind=series?.kind||'',name=series?.name||''
  if(note.periodType==='daily'&&(kind.includes('career')||kind.includes('work')||name.includes('工作')))return'work-daily'
  if(note.periodType==='daily'&&(kind.includes('diary')||name.includes('日记')))return'diary'
  return note.periodType==='yearly'?'annual':note.periodType||'other'
}
const visibleNotes = computed(() => {
  const filterTags=(note:NoteEntity)=>matchesNoteTags(note,listTagUids.value,tags.value,listTagMode.value)
  if (selectedFolderId.value === 'trash') return scopedTrash.value.filter(filterTags)
  if (selectedFolderId.value === 'archived') return scopedArchived.value.filter(filterTags)
  const tagScope=selectedTagId.value!==null||listTagUids.value.length>0
  const source = tagScope||smartFilter.value||typeFilter.value ? notesStore.notes.filter(isRegularNote) : showingProjectNotes.value ? allProjectNotes.value : periodFilter.value ? periodicNotes.value : projectNotes.value
  return source.filter(note=>tagScope?inTagScope(note,globalAreaUid.value,projectUid.value):inGlobalArea(note)).filter(note => selectedLibraryAreaUid.value!==undefined?(note.areaUid||'')===selectedLibraryAreaUid.value:typeFilter.value?(typeFilter.value==='note'?!isPeriodicNote(note)&&(!note.type||note.type==='note'):note.type===typeFilter.value):smartFilter.value ? smartMatch(note,smartFilter.value) : selectedFolderId.value === 'all' || selectedFolderId.value === 'period:all' || selectedFolderId.value === 'project:all' ? true : projectFilter.value ? note.projectUid === projectFilter.value : periodFilter.value ? periodicCategory(note) === periodFilter.value : selectedFolderId.value === 'favorites' ? note.pinned : selectedFolderId.value === 'uncategorized' ? !note.folderId&&!note.folderUid : selectedTagId.value ? Boolean(tags.value.find(tag=>tag.id===selectedTagId.value)&&noteHasTag(note,tags.value.find(tag=>tag.id===selectedTagId.value)!)) : selectedFolderScope.value.ids.has(Number(note.folderId))||Boolean(note.folderUid&&selectedFolderScope.value.uids.has(note.folderUid))).filter(note=>filterTags(note)&&matchesListType(note,listTypeFilter.value)&&matchesFileFilter(note,listFileFilter.value))
})
function smartMatch(note:NoteEntity,filter:string){
  if(filter==='inbox')return note.organizationStatus==='inbox'
  if(filter==='pending')return note.organizationStatus==='pending'||!note.organizationStatus
  if(filter==='untagged')return !(note.tagIds?.length||note.tagUids?.length)
  if(filter==='unfiled')return !note.folderId&&!note.folderUid
  if(filter==='unprojected')return !note.projectUid
  if(filter==='stale'){const cutoff=Date.now()-90*86400000;return new Date(note.updatedAt||note.createdAt||0).getTime()<cutoff}
  if(filter==='attachments')return /attachment:|\/api\/v1\/attachments\//.test(note.content||'')
  return true
}
const {results:searchedNotes,searching:listSearching,run:runListSearch}=useNoteListSearch(visibleNotes,listQuery)
function noteGroupLabel(note:NoteEntity){if(listGroup.value==='project')return projects.value.find(item=>item.uid===note.projectUid)?.name||'未关联项目';if(listGroup.value==='type')return isFileNote(note)?'文件':noteTypeLabels[note.type||'note']||'其他类型';if(listGroup.value==='month'){const value=new Date(note.updatedAt||note.createdAt||0);return Number.isNaN(value.getTime())?'未知时间':`${value.getFullYear()} 年 ${value.getMonth()+1} 月`}return''}
function noteGroupRank(note:NoteEntity){return listGroup.value==='project'&&!note.projectUid?0:1}
const isObsidianFileNode=isFileNote

const sortedNotes=computed(()=>[...searchedNotes.value].sort((a,b)=>{if(listGroup.value!=='none'){const rank=noteGroupRank(a)-noteGroupRank(b);if(rank)return rank;const group=noteGroupLabel(a).localeCompare(noteGroupLabel(b),'zh-CN');if(group)return group}return listSort.value==='title_asc'?compareNoteTitles(a.title,b.title):listSort.value==='updated_asc'?new Date(a.updatedAt||a.createdAt||0).getTime()-new Date(b.updatedAt||b.createdAt||0).getTime():new Date(b.updatedAt||b.createdAt||0).getTime()-new Date(a.updatedAt||a.createdAt||0).getTime()}))
const displayedNotes = computed(() => sortedNotes.value.slice(0,listLimit.value))
watch(listSort,value=>localStorage.setItem('jiyu-pc-note-list-sort',value))
watch(listGroup,value=>localStorage.setItem('jiyu-pc-note-list-group',value))
const listTitle = computed(() => {
  if(reportSeriesUid.value)return'历史报告'
  if(projectFilter.value==='all')return'全部项目笔记'
  if(projectUid.value)return'笔记'
  if(projectFilter.value)return`项目笔记 / ${currentProject.value?.name||'当前项目'}`
  if(periodFilter.value)return periodFilter.value==='all'?'日记与报告':({diary:'日记','work-daily':'工作日报',daily:'其他日报',weekly:'周报',monthly:'月报',annual:'年度总结'}[periodFilter.value]||'日记与报告')
  if(selectedLibraryAreaUid.value!==undefined)return selectedLibraryAreaLabel.value
  if(activeFolder.value)return activeFolder.value.name
  if(activeTag.value)return`标签 / ${activeTag.value.name}`
  if(selectedFolderId.value==='favorites')return'收藏笔记'
  if(selectedFolderId.value==='uncategorized')return'未分类笔记'
  if(smartFilter.value)return({inbox:'笔记收集箱',pending:'待整理',untagged:'无标签',unfiled:'无目录',unprojected:'未关联项目',stale:'长期未更新',attachments:'有附件'} as Record<string,string>)[smartFilter.value]||'智能集合'
  if(typeFilter.value)return noteTypeLabels[typeFilter.value]||'笔记类型'
  if(selectedFolderId.value==='trash')return'回收站'
  if(selectedFolderId.value==='archived')return'归档笔记'
  return'全部笔记'
})
const listSearchPlaceholder = computed(() => projectUid.value||projectFilter.value&&projectFilter.value!=='all'?'搜索当前项目笔记':activeFolder.value?'搜索当前目录':activeTag.value?'搜索当前标签':'搜索当前列表')
const activeFolderParentPath=computed(()=>{
  const names:string[]=[]
  let parentId=activeFolder.value?.parentId
  const seen=new Set<number>()
  while(parentId!=null&&!seen.has(parentId)){seen.add(parentId);const parent=folders.value.find(item=>item.id===parentId);if(!parent)break;names.unshift(parent.name);parentId=parent.parentId}
  return names
})
const listPathLabel=computed(()=>{
  const scope=projectUid.value?(project.value?.name||'当前项目'):(globalAreaUid.value?areas.value.find(item=>item.uid===globalAreaUid.value)?.name:'全部领域')||projectArea.value?.name||''
  const folderArea=groupFoldersByArea.value&&activeFolder.value?(areas.value.find(area=>area.uid===activeFolder.value?.areaUid)?.name||(activeFolder.value.areaUid?'领域信息待同步':'未归属领域')):''
  return[scope,folderArea,...activeFolderParentPath.value].filter(Boolean).join(' / ')
})

const activeFilterCount=computed(()=>Number(Boolean(listTypeFilter.value))+Number(Boolean(listFileFilter.value))+Number(listGroup.value!=='none')+Number(listTagUids.value.length>0))
const fullTime=(value?:string|null)=>value?new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'-'
const folderRows = computed(() => {
  const rows:Array<FolderEntity&{depth:number}>=[]
  const visit=(nodes:ReturnType<typeof buildFolderNodes>,depth:number)=>{for(const node of nodes){rows.push({...node.raw as FolderEntity,depth});visit(node.children||[],depth+1)}}
  visit(buildFolderNodes(scopedFolders.value),0)
  return rows
})
const folderNoteCounts=computed(()=>{
  const counts=new Map<number,number>(),idByUid=new Map(scopedFolders.value.map(folder=>[folder.uid,folder.id]))
  for(const folder of scopedFolders.value)counts.set(folder.id,0)
  for(const note of regularNotes.value.filter(inGlobalArea)){const id=Number(note.folderId)||idByUid.get(note.folderUid||'');if(id&&counts.has(id))counts.set(id,(counts.get(id)||0)+1)}
  for(const folder of [...folderRows.value].sort((a,b)=>b.depth-a.depth))if(folder.parentId!=null&&(scopedFolders.value.find(parent=>parent.id===folder.parentId)?.areaUid||'')===(folder.areaUid||''))counts.set(folder.parentId,(counts.get(folder.parentId)||0)+(counts.get(folder.id)||0))
  return counts
})
const folderNoteCount=(id:number)=>folderNoteCounts.value.get(id)||0
const uncategorizedNoteCount=computed(()=>regularNotes.value.filter(inGlobalArea).filter(note=>!note.folderId&&!note.folderUid).length)
function folderHasChildren(id:number){return scopedFolders.value.some(item=>item.parentId===id)}
function toggleFolderCollapsed(id:number|string){const next=new Set(collapsedFolderIds.value);next.has(id)?next.delete(id):next.add(id);collapsedFolderIds.value=next;localStorage.setItem('jiyu-pc-collapsed-folders',JSON.stringify([...next]))}
function setFolderCollapsed(folder:FolderEntity,collapsed:boolean){if(collapsedFolderIds.value.has(folder.id)!==collapsed)toggleFolderCollapsed(folder.id)}
function setAllFoldersCollapsed(collapsed:boolean){
  folderQuery.value=''
  const next=new Set(collapsedFolderIds.value)
  for(const folder of scopedFolders.value)collapsed?next.add(folder.id):next.delete(folder.id)
  collapsedFolderIds.value=next
  localStorage.setItem('jiyu-pc-collapsed-folders',JSON.stringify([...next]))
  if(groupFoldersByArea.value){
    const expansion={...libraryAreaExpansion.value}
    for(const group of noteAreaGroups.value)expansion[areaTreeId(group.uid)]=!collapsed
    libraryAreaExpansion.value=expansion
    localStorage.setItem(libraryAreaPreferenceKey(),JSON.stringify(expansion))
  }
}

const activeFolder = computed(() => typeof selectedFolderId.value === 'number' ? scopedFolders.value.find(item => item.id === selectedFolderId.value) : undefined)
const newItemAreaUid=computed(()=>activeFolder.value?(activeFolder.value.areaUid||null):selectedLibraryAreaUid.value!==undefined?(selectedLibraryAreaUid.value||null):globalAreaUid.value||null)
const selectedFolderDescendantCount=computed(()=>Math.max(0,selectedFolderScope.value.ids.size-1))
const legalFolderRows = computed(() => folderRows.value)
const activeTag = computed(() => selectedTagId.value ? tags.value.find(item => item.id === selectedTagId.value) : undefined)
const tagNoteCount=(tagId:number)=>{const tag=tags.value.find(item=>item.id===tagId);return tag?countTagNotes(regularNotes.value,tag,globalAreaUid.value,projectUid.value):0}
const visibleTags=computed(()=>tags.value.filter(tag=>favoriteTagUids.value.includes(tag.uid)))
const matchingTags=(query:string)=>tags.value.filter(tag=>tag.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'))
const selectedTags=computed(()=>selected.value?tags.value.filter(tag=>noteHasTag(selected.value!,tag)):[])
const unknownSelectedTagUids=computed(()=>selected.value?noteTagUids(selected.value,tags.value).filter(uid=>!tags.value.some(tag=>tag.uid===uid)):[])
function showTagArticles(tag:TagEntity){listTagUids.value=[];listTypeFilter.value='';listFileFilter.value='';listQuery.value='';tagManagerOpen.value=false;selectFolder(`tag:${tag.id}`)}
function toggleListTag(uid:string){listTagUids.value=listTagUids.value.includes(uid)?listTagUids.value.filter(value=>value!==uid):[...listTagUids.value,uid]}
const saveLabel = computed(() => notesStore.saving ? '正在保存…' : notesStore.hasPendingSaves()?'尚未保存':'已保存')
const syncLabel = computed(() => isCommunityEdition?'仅保存在本机':notesStore.syncPhase==='syncing'?'同步中…':notesStore.syncPhase==='error'?'同步暂未完成':selected.value?.syncStatus==='pending'?'待同步':selected.value?.syncStatus==='conflict'?'同步冲突':notesStore.syncPhase==='offline'?'离线':'已同步')
const documentStateLabel=computed(()=>notesStore.hasPendingSaves()&&notesStore.saveError?`保存失败：${notesStore.saveError}`:taskCreateStatus.value||(notesStore.saving?'正在保存…':notesStore.hasPendingSaves()?'尚未保存':syncLabel.value==='已同步'?'已保存并同步':`${saveLabel.value} · ${syncLabel.value}`))
const documentStatusError=computed(()=>Boolean(notesStore.hasPendingSaves()&&notesStore.saveError)||notesStore.syncPhase==='error'||selected.value?.syncStatus==='conflict')
const documentStatusText=computed(()=>taskCreateStatus.value||(notesStore.hasPendingSaves()&&notesStore.saveError?'保存失败':notesStore.saving?'正在保存…':notesStore.hasPendingSaves()?'尚未保存':notesStore.syncPhase==='syncing'?'同步中…':notesStore.syncPhase==='error'?'同步暂未完成':selected.value?.syncStatus==='conflict'?'同步冲突':!isCommunityEdition&&selected.value?.syncStatus==='pending'?'待同步':!isCommunityEdition&&notesStore.syncPhase==='offline'?'已保存 · 离线':isCommunityEdition?'已保存':'已同步'))

let saveTimer: ReturnType<typeof setTimeout> | undefined
let attachmentRequest=0,linkRequest=0
let draftBaseline:NoteDraftSnapshot|undefined
function saveDraft(uid:string){
  const note=[...notesStore.notes,...notesStore.archived,...notesStore.trash].find(value=>value.uid===uid),changes=noteDraftChanges(draftBaseline,note,draftTitle.value,draftContent.value)
  if(!Object.keys(changes).length)return
  draftBaseline={...draftBaseline!,...changes} as NoteDraftSnapshot
  return notesStore.saveNote(uid,changes)
}

const draftGuardOwner={}
let unregisterDraftGuard:(()=>void)|undefined
// 离页、切换和批量操作共用保存屏障：先保存当前草稿，再等待仓储已有写入完成；失败向上抛出阻止后续操作。
async function flushDraft(){clearTimeout(saveTimer);const uid=selected.value?.uid;if(uid)await saveDraft(uid);await notesStore.flushPendingSaves()}
function registerDraftGuard(){unregisterDraftGuard?.();unregisterDraftGuard=registerLocalDraftGuard(draftGuardOwner,{flush:flushDraft,dirty:()=>notesStore.hasPendingSaves()||Boolean(selected.value&&Object.keys(noteDraftChanges(draftBaseline,selected.value,draftTitle.value,draftContent.value)).length),dismiss:()=>{if(focusReading.value){focusReading.value=false;return true}if(attachmentPreviewIndex.value>=0){attachmentPreviewIndex.value=-1;return true}if(folderImportOpen.value&&!folderImportBusy.value){folderImportOpen.value=false;return true}if(tagManagerOpen.value){tagManagerOpen.value=false;return true}if(tagPickerOpen.value){tagPickerOpen.value=false;return true}return false}})}
registerDraftGuard()

watch(()=>selected.value?.uid, (uid,previousUid) => {
  previewHeadings.value=[]
  clearTimeout(saveTimer)
  if(previousUid)void saveDraft(previousUid)
  const note=uid?(notesStore.notes.find(item=>item.uid===uid)||notesStore.archived.find(item=>item.uid===uid)||notesStore.trash.find(item=>item.uid===uid)):undefined
  draftTitle.value = note?.title || ''
  draftContent.value = note?.content || ''
  draftBaseline=note?noteDraftSnapshot(note):undefined
  attachments.value=[];localAttachmentRows.value=[];attachmentError.value='';noteLinks.value=[];linkError.value='';if(note&&!note.deleted){void loadAttachments(note.uid);void loadNoteLinks(note.uid)}
}, { immediate: true })

watch(()=>[selected.value?.uid,selected.value?.title,selected.value?.content],()=>{
  const received=reconcileNoteDraft(draftBaseline,selected.value||undefined,draftTitle.value,draftContent.value)
  draftBaseline=received.baseline
  draftTitle.value=received.title
  draftContent.value=received.content
})

watch([selected, reportSeriesUid], async ([note, seriesUid]) => {
  reportGeneration.value = undefined
  reportActionError.value = ''
  if (!note || !seriesUid || isCommunityEdition) return
  try { reportGeneration.value = await workspaceService.reportGeneration(seriesUid, note.uid) }
  catch (source) { reportActionError.value = source instanceof Error ? source.message : '报告来源加载失败' }
}, { immediate: true })

watch([draftTitle, draftContent], () => {
  if (!selected.value || selected.value.deleted) return
  clearTimeout(saveTimer)
  if(!Object.keys(noteDraftChanges(draftBaseline,selected.value,draftTitle.value,draftContent.value)).length)return
  const uid=selected.value.uid
  saveTimer = setTimeout(() => saveDraft(uid), 700)
})
watch(treeVisible, value => localStorage.setItem(treeVisibilityKey.value, String(value)))
watch(treeVisibilityKey, key=>{treeVisible.value=storedVisibility(key,window.innerWidth>1100)},{flush:'sync'})
watch(listVisible, value => localStorage.setItem(LIST_VISIBLE_KEY, String(value)))
watch(editorMode, value => localStorage.setItem('jiyu-pc-editor-mode', value))
watch(focusReading,value=>document.body.classList.toggle('notes-focus-reading',value))
watch([listQuery,selectedFolderId,projectUid],()=>{listLimit.value=50})
watch(()=>notesStore.syncPhase,(value,previous)=>{if(previous==='syncing'&&value!=='syncing')void Promise.all([loadFolders(),loadTags()])})
watch(globalAreaUid,(_value,previous)=>{
  if(previous)preferredLibraryAreaUid.value=previous
  if(selectedLibraryAreaUid.value!==undefined)selectedFolderId.value='all'
  if(typeof selectedFolderId.value==='number'&&!scopedFolders.value.some(folder=>folder.id===selectedFolderId.value))selectedFolderId.value='all'
  if(!visibleNotes.value.some(note=>note.uid===notesStore.selectedUid))notesStore.select(visibleNotes.value[0]?.uid||'')
})

function format(action: 'undo'|'redo'|'bold'|'italic'|'link'|'list'|'ordered'|'quote') {
  const editor = markdownEditor.value
  if (!editor || editorMode.value === 'preview') return
  if (action === 'undo' || action === 'redo') return editor[action]()
  if (action === 'bold') editor.replaceSelection('**', '**', '粗体文本')
  else if (action === 'italic') editor.replaceSelection('*', '*', '斜体文本')
  else if (action === 'link') editor.replaceSelection('[', '](https://)', '链接文字')
  else if (action === 'list') editor.prefixLines('- ')
  else if (action === 'ordered') editor.prefixLines('1. ')
  else editor.prefixLines('> ')
}

async function loadAttachments(noteUid=selected.value?.uid||''){if(!noteUid)return;const request=++attachmentRequest,local=await localAttachments(ownerId.value,noteUid);if(request!==attachmentRequest||selected.value?.uid!==noteUid)return;localAttachmentRows.value=local;try{const remote=await listAttachments(noteUid);if(request!==attachmentRequest||selected.value?.uid!==noteUid)return;attachments.value=remote;for(const item of remote.filter(value=>value.mediaType?.startsWith('image/')))void cachedAttachment(ownerId.value,item).catch(()=>undefined)}catch(source){if(request===attachmentRequest&&selected.value?.uid===noteUid)attachmentError.value=source instanceof Error?source.message:'附件加载失败'}}
async function loadNoteLinks(noteUid=selected.value?.uid||''){if(!noteUid||!isCommunityEdition&&!online.value)return;const request=++linkRequest;try{const rows=await noteLinksService.list(noteUid);if(request===linkRequest&&selected.value?.uid===noteUid)noteLinks.value=rows}catch(source){if(request===linkRequest&&selected.value?.uid===noteUid)linkError.value=source instanceof Error?source.message:'关联内容加载失败'}}
async function addNoteLink(){const note=selected.value;if(!note)return;const query=await promptDialog('输入要关联的笔记标题');if(!query?.trim())return;const target=notesStore.notes.find(item=>item.uid!==note.uid&&(item.title||'').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));if(!target){linkError.value='没有找到匹配笔记';return}const raw=await promptDialog('关联类型：来源 / 相关 / 后续','相关');const type=raw==='来源'?'source':raw==='后续'?'follow_up':'related';try{await noteLinksService.create(note.uid,target.uid,type);await loadNoteLinks(note.uid)}catch(source){linkError.value=source instanceof Error?source.message:'创建关联失败'}}
async function removeNoteLink(link:NoteLinkView){try{await noteLinksService.remove(link);await loadNoteLinks()}catch(source){linkError.value=source instanceof Error?source.message:'移除关联失败'}}
function linkedNote(link:NoteLinkView){const current=selected.value?.uid,outgoing=link.sourceNoteUid===current;return{uid:outgoing?link.targetNoteUid:link.sourceNoteUid,title:(outgoing?link.targetTitle:link.sourceTitle)||'未命名笔记',backlink:!outgoing}}
async function suggestOrganization(){if(isCommunityEdition)return;const note=selected.value;if(!note||intelligenceBusy.value)return;if(!await confirmDialog(AI_DATA_CONFIRMATION))return;intelligenceBusy.value=true;intelligenceMessage.value='';try{const result=await noteOrganizationService.suggestions(note.uid);if(!result.available){intelligenceMessage.value=result.message||AI_UNAVAILABLE_MESSAGE;return}const summary=String(result.summary||'').trim(),details=[summary&&`摘要：${summary}`,Array.isArray(result.tags)&&result.tags.length&&`标签建议：${result.tags.join('、')}`,result.folderHint&&`目录建议：${result.folderHint}`].filter(Boolean).join('\n');if(await confirmDialog(`${details||'模型没有返回可应用的建议'}\n\n应用摘要到当前笔记？`)&&summary)await notesStore.updateEntity(note,{summary})}catch(source){intelligenceMessage.value=source instanceof Error?source.message:'AI 建议失败'}finally{intelligenceBusy.value=false}}
async function extractKnowledge(){if(isCommunityEdition)return;const note=selected.value;if(!note||intelligenceBusy.value)return;if(!await confirmDialog(AI_KNOWLEDGE_CONFIRMATION))return;intelligenceBusy.value=true;try{const ai=await noteOrganizationService.knowledgeDraft(note.uid),title=await promptDialog('知识标题',String(ai.knowledgeTitle||note.title||'未命名知识'));if(!title?.trim())return;const content=await promptDialog('确认或编辑详细说明',String(ai.knowledgeBody||note.content||''));if(content==null)return;const conclusion=await promptDialog('一句话说明现在认为正确、值得复用的结论',String(ai.summary||note.summary||''));if(conclusion==null)return;const created=await knowledgeService.create({title:title.trim(),conclusion:conclusion.trim(),content,maturity:'draft',confidence:'medium',keyPoints:[],sourceNoteUids:[note.uid]});intelligenceMessage.value=`知识“${created.title}”已创建，原笔记保持不变`;await router.push(`/knowledge/${created.uid}`)}catch(source){intelligenceMessage.value=source instanceof Error?source.message:'知识提炼失败'}finally{intelligenceBusy.value=false}}
async function findDuplicates(){await flushDraft();if(selected.value)duplicateNoteUid.value=selected.value.uid}
function consolidateDuplicates(notes:NoteEntity[]){duplicateNoteUid.value='';consolidationSources.value=JSON.parse(JSON.stringify(notes));consolidationOpen.value=true}
function attachmentMarkdown(file:{name:string;mediaType:string},url:string){const label=file.name.replace(/[\[\]]/g,'-');return file.mediaType.startsWith('image/')?`![${label}](${url})`:file.mediaType.startsWith('audio/')?`[音频 · ${label}](${url})`:`[附件 · ${label}](${url})`}
async function addFiles(files:File[]){
 const note=selected.value,owner=ownerId.value;if(!note||note.deleted||!owner||attachmentBusy.value)return
 attachmentBusy.value=true;attachmentError.value=''
 try{
  for(const file of files){
   const item=await queueAttachment(owner,note.uid,file),markdown=attachmentMarkdown({name:item.name,mediaType:item.mediaType},`attachment:${item.uid}`)
   if(selected.value?.uid!==note.uid||ownerId.value!==owner)throw new Error('笔记或空间已切换，附件已保留在原笔记，请重新打开查看')
   if(markdownEditor.value&&editorMode.value==='edit')markdownEditor.value.insertText(markdown+'\n')
   else draftContent.value+=`${draftContent.value.endsWith('\n')||!draftContent.value?'':'\n'}${markdown}\n`
   await notesStore.saveNote(note.uid,{content:draftContent.value})
  }
  await loadAttachments(note.uid)
  void flushAttachments().catch(source=>{attachmentError.value=source instanceof Error?source.message:'图片已保存到本机，上传暂未完成'})
 }catch(source){attachmentError.value=source instanceof Error?source.message:'附件保存失败'}finally{attachmentBusy.value=false}
}
async function addAttachment(event:Event){const input=event.target as HTMLInputElement,files=[...(input.files||[])];input.value='';await addFiles(files)}
async function applyUploadedReference(noteUid:string,from:string,to:string,serverUid?:string){
  const note=notesStore.notes.find(value=>value.uid===noteUid);if(!note)return
  const changes=noteAttachmentReferenceChanges(note,from.replace(/^attachment:/,''),to,serverUid);if(!Object.keys(changes).length)return
  const saved=await notesStore.updateEntity(note,changes)
  if(selected.value?.uid===noteUid&&changes.content!==undefined){
    draftContent.value=draftContent.value.replaceAll(from,to)
    if(draftBaseline?.uid===noteUid)draftBaseline={...draftBaseline,content:draftBaseline.content.replaceAll(from,to)}
  }
  return saved
}
async function flushAttachments(){if(folderImportBusy.value)return;return runPcSyncGuarded(async()=>{
  if(!ownerId.value||!isCommunityEdition&&!online.value)return
  const repaired=await maintainUploadedAttachmentReferences(()=>notesStore.notes,await localAttachments(ownerId.value),applyUploadedReference)
  if(repaired)await notesStore.refreshInBackground()
  if(!await hasPendingNoteAttachments(ownerId.value))return
  await notesStore.refreshInBackground()
  const result=await processAttachmentQueue(ownerId.value,{noteReady:uid=>{const note=notesStore.notes.find(value=>value.uid===uid);return noteAttachmentReady(note,isCommunityEdition)},replaceReference:async(noteUid,from,to,serverUid)=>{await applyUploadedReference(noteUid,from,to,serverUid)}})
  if(result.uploaded)void notesStore.refreshInBackground()
})}
async function retryLocal(item:LocalAttachment){await retryLocalAttachment(ownerId.value,item.uid);await flushAttachments();await loadAttachments(item.noteUid)}
async function removeLocal(item:LocalAttachment){draftContent.value=draftContent.value.replace(new RegExp(`!?\\[[^\\]]*\\]\\([^)]*attachment:${item.uid}[^)]*\\)\\n?`,'g'),'');await removeLocalAttachment(ownerId.value,item.uid);await notesStore.save({content:draftContent.value});await loadAttachments(item.noteUid)}
async function removeAttachmentReference(item:AttachmentItem){const note=selected.value;if(!note||!await confirmDialog(`从当前笔记移除“${item.originalFilename}”的引用？文件不会被删除。`))return;draftContent.value=draftContent.value.replaceAll(item.contentUrl,'').replaceAll(`/api/v1/attachments/${item.uid}/content`,'');await notesStore.save({content:draftContent.value});await unlinkAttachment(note.uid,item);await loadAttachments(note.uid)}
async function removeAttachmentFile(item:AttachmentItem){if(!await confirmDialog(`永久删除附件“${item.originalFilename}”？请先确保所有引用均已移除。`))return;try{await deleteAttachment(item,ownerId.value);await loadAttachments()}catch(source){attachmentError.value=source instanceof Error?source.message:'附件删除失败'}}
async function openAttachment(item:AttachmentItem){if(isOfficeAttachment(item)){try{await openAttachmentContent(ownerId.value,item)}catch(source){attachmentError.value=source instanceof Error?source.message:'文档打开失败'}return}attachmentPreviewIndex.value=attachments.value.findIndex(value=>value.uid===item.uid)}


async function loadFolders() { folderError.value = ''; try { folders.value = await foldersService.list() } catch (source) { folderError.value = source instanceof Error ? source.message : '目录加载失败' } }
async function loadTags() { try { tags.value = await tagsService.list() } catch (source) { folderError.value = source instanceof Error ? source.message : '标签加载失败' } }
async function loadJournalSeries(){try{journalSeries.value=await workspaceService.series()}catch{journalSeries.value=[]}}
const creatingNote=ref(false)
async function createNamedNote(scope:Partial<NoteEntity>){
  if(creatingNote.value)return
  creatingNote.value=true
  try{
    const assertCurrent=captureFileExportBoundary()
    const title=await promptDialog({title:'新建笔记',inputLabel:'笔记名称',inputPlaceholder:'请输入笔记名称',inputRequired:true,confirmText:'创建'})
    if(!title?.trim())return
    assertCurrent();await flushDraft();assertCurrent()
    const note=await notesStore.create({...scope,title:title.trim()})
    assertCurrent()
    listQuery.value='';listTypeFilter.value='';listFileFilter.value='';listTagUids.value=[];listSort.value='updated_desc';listLimit.value=Math.max(listLimit.value,50)
    await nextTick()
    workspaceElement.value?.querySelector<HTMLElement>('.note-table-row.active')?.scrollIntoView({block:'nearest'})
    return note
  }catch(source){folderError.value=source instanceof Error?source.message:'新建笔记失败'}
  finally{creatingNote.value=false}
}
async function createNote(){if(reportSeriesUid.value||periodFilter.value||showingProjectNotes.value)return;editorMode.value='edit';const creatingFromAll=selectedFolderId.value==='all',folder=activeFolder.value,areaUid=newItemAreaUid.value,projectUidValue=folder?.projectUid||projectUid.value||null,organized=Boolean(folder||areaUid||projectUidValue);if(creatingFromAll){listQuery.value='';listTypeFilter.value='';listFileFilter.value='';listLimit.value=Math.max(listLimit.value,50)}await createNamedNote({type:'note',folderId:folder?.id||null,folderUid:folder?.uid||null,areaUid,projectUid:projectUidValue,organizationStatus:organized?'organized':'pending',organizedAt:organized?new Date().toISOString():null});if(creatingFromAll)selectedFolderId.value='all'}
function fileKindFromName(name:string){const extension=name.split('.').pop()?.toLocaleLowerCase()||'';return{extension,fileKind:extension==='pdf'?'pdf':['doc','docx'].includes(extension)?'word':['xls','xlsx','csv'].includes(extension)?'excel':['ppt','pptx'].includes(extension)?'powerpoint':extension==='xmind'?'xmind':'other'} as const}
async function fileSha256(file:File){return[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join('')}
const folderImportResult=ref<FolderImportOutcome>()
const folderImportProgress=ref({phase:'',completed:0,total:0,current:''})
function prepareFolderImport(folder:FolderImportDestination){folderImportOpen.value=false;folderImportProgress.value={phase:'',completed:0,total:0,current:''};folderImportFolder.value=folder;folderImportMessage.value='';folderImportResult.value=undefined;folderImportKeepDuplicates.value=false;folderImportCandidates.value=[]}
function chooseFolderImport(folder:FolderImportDestination){if(folderImportBusy.value)return;prepareFolderImport(folder);folderImportInput.value?.click()}
async function chooseFolderTreeImport(folder:FolderImportDestination){
  if(folderImportBusy.value)return
  prepareFolderImport(folder)
  if(!isDesktopClient()){folderTreeImportInput.value?.click();return}
  folderImportBusy.value=true
  let scanning=true
  try{
    await nextTick()
    const progress=new Channel<number>(count=>{
      if(!scanning)return
      folderImportOpen.value=true
      folderImportMessage.value='正在扫描所选文件夹…'
      folderImportProgress.value={phase:'扫描文件夹',completed:count,total:0,current:''}
    })
    const entries=await invoke<Array<{relativePath:string;name:string;lastModified:number}>|null>('choose_file_import_folder',{onProgress:progress})
    scanning=false
    if(!entries)return
    folderImportOpen.value=true
    folderImportMessage.value='正在读取所选文件夹…'
    const total=entries.filter(entry=>!skipImportedPath(entry.relativePath)).length
    folderImportProgress.value={phase:'读取文件',completed:0,total,current:''}
    const files:File[]=[]
    for(const entry of entries){
      if(skipImportedPath(entry.relativePath))continue
      const bytes=await invoke<ArrayBuffer>('read_import_file',{relativePath:entry.relativePath})
      const file=new File([bytes],entry.name,{lastModified:entry.lastModified})
      Object.defineProperty(file,'webkitRelativePath',{value:entry.relativePath});files.push(file)
      folderImportProgress.value={phase:'读取文件',completed:files.length,total,current:entry.relativePath}
    }
    await stageFolderImport(files)
  }catch(source){folderImportOpen.value=true;folderImportMessage.value=source instanceof Error?source.message:'无法读取所选文件夹'}
  finally{scanning=false;folderImportBusy.value=false}
}
function normalizedImportPath(file:File){return folderImportPathParts(file)}
function skipImportedPath(path:string){const parts=path.replace(/\\/g,'/').split('/').filter(Boolean),name=(parts.at(-1)||'').toLocaleLowerCase();return parts.slice(1).some(part=>part.startsWith('.'))||name.startsWith('.')||name==='thumbs.db'||name==='desktop.ini'||name.startsWith('~$')||name.endsWith('.tmp')}
async function stageFolderImport(files:File[]){const accepted=files.filter(file=>!skipImportedPath(file.webkitRelativePath||file.name));if(!accepted.length){folderImportMessage.value='所选文件夹中没有可导入的文件';return}folderImportBusy.value=true;folderImportOpen.value=true;folderImportMessage.value='正在计算文件指纹…';folderImportProgress.value={phase:'准备导入预览',completed:0,total:accepted.length,current:''};try{const existing=[...notesStore.notes,...notesStore.archived],seen=new Set<string>();const candidates:FolderImportCandidate[]=[];for(const file of accepted){const parts=normalizedImportPath(file),relativePath=parts.join('/'),sha256=await fileSha256(file),duplicate=existing.find(note=>!note.deleted&&note.sha256===sha256&&(note.type!=="file"||Boolean(note.attachmentUid)))||(seen.has(sha256)?true:undefined);seen.add(sha256);folderImportProgress.value.completed++;folderImportProgress.value.current=relativePath;candidates.push({file,sha256,relativePath,directoryParts:parts.slice(0,-1),duplicate})}folderImportCandidates.value=candidates;folderImportMessage.value=''}catch(source){folderImportMessage.value=source instanceof Error?source.message:'无法读取所选文件'}finally{folderImportBusy.value=false}}
async function previewFolderImport(event:Event){const input=event.target as HTMLInputElement,files=[...(input.files||[])];input.value='';if(files.length)await stageFolderImport(files)}
async function executeFolderImport(){const folder=folderImportFolder.value;if(!folder||!ownerId.value||folderImportBusy.value)return;const candidates=folderImportCandidates.value.filter(item=>!item.file.size||folderImportKeepDuplicates.value||!item.duplicate),folderRows=[...folders.value],folderByPath=new Map<string,FolderImportDestination>();folderByPath.set('',folder);folderImportBusy.value=true;folderImportMessage.value='';folderImportResult.value=undefined;folderImportProgress.value={phase:'等待当前同步结束',completed:0,total:candidates.length,current:''};let imported=0,createdFolders=0,emptyFiles=0,processed=0,resumeSync:(()=>void)|undefined;const failed:FolderImportCandidate[]=[],issues:{path:string;reason:string}[]=[];try{resumeSync=await pausePcSync();folderImportProgress.value.phase='导入文件';const ensureFolder=async(parts:string[])=>{let parent:FolderImportDestination=folder,path='';for(const name of parts){path=path?`${path}/${name}`:name;const cached=folderByPath.get(path);if(cached){parent=cached;continue}let child=folderRows.find(value=>value.parentId===parent.id&&value.name===name&&(value.areaUid||null)===(folder.areaUid||globalAreaUid.value||null)&&(value.projectUid||null)===(folder.projectUid||null));if(!child){child=await foldersService.create(name,parent.id,{areaUid:folder.areaUid||globalAreaUid.value||null,projectUid:folder.projectUid||null});folderRows.push(child);createdFolders++}folderByPath.set(path,child);parent=child}return parent};for(const item of candidates){folderImportProgress.value.current=item.relativePath;if(!item.file.size){emptyFiles++;issues.push({path:item.relativePath,reason:"空文件（0 字节），已跳过"});folderImportProgress.value.completed=++processed;continue}try{const target=await ensureFolder(item.directoryParts),kind=fileKindFromName(item.file.name),markdown=/\.(md|markdown)$/i.test(item.file.name),content=markdown?await item.file.text():'',areaUid=target.areaUid||folder.areaUid||globalAreaUid.value||null,projectUidValue=target.projectUid||folder.projectUid||null,note=item.pendingNote||(notesStore.notes||[]).find(value=>value.type==="file"&&!value.deleted&&!value.attachmentUid&&value.sha256===item.sha256&&value.fileName===item.file.name&&(value.folderUid||null)===(target.uid||null)&&(value.areaUid||null)===(areaUid||null))||await notesStore.create({title:markdown?item.file.name.replace(/\.(md|markdown)$/i,''):item.file.name,content,type:markdown?'note':'file',contentFormat:markdown?'markdown':'file',...(markdown?{fileName:item.file.name}:{fileKind:kind.fileKind,fileName:item.file.name,fileExtension:kind.extension,mediaType:item.file.type||inferMediaType(item.file.name),sizeBytes:item.file.size}),sha256:item.sha256,folderId:target.id,folderUid:target.uid,areaUid,projectUid:projectUidValue,captureSource:'folder_import',organizationStatus:'organized',organizedAt:new Date().toISOString()},{select:false,sync:false,publish:false});item.pendingNote=note;if(markdown){await notesStore.updateEntity(note,{type:'note',contentFormat:'markdown',content,fileName:item.file.name,fileKind:null,fileExtension:null,mediaType:null,sizeBytes:null,attachmentUid:null,sha256:item.sha256},{publish:false})}else{const attachment=item.pendingAttachment||await queueAttachment(ownerId.value,note.uid,item.file);item.pendingAttachment=attachment;await notesStore.updateEntity(note,{attachmentUid:attachment.uid,sha256:attachment.sha256},{publish:false})};imported++}catch(source){failed.push(item);issues.push({path:item.relativePath,reason:source instanceof Error?source.message:"文件导入失败"})}finally{folderImportProgress.value.completed=++processed}}folderImportResult.value={imported,createdFolders,skipped:folderImportCandidates.value.length-candidates.length,unfinished:failed.length,...(emptyFiles?{emptyFiles}:{}),...(issues.length?{issues}:{}),...(failed.length?{error:"部分文件导入失败，可重试未完成的文件"}:{})};folderImportProgress.value.phase='刷新列表';await Promise.all([notesStore.reloadLocal(),loadFolders()]);if(folder.id!==null)selectedFolderId.value=folder.id;else selectLibraryArea(folder.areaUid||'');folderImportMessage.value=`已导入 ${imported} 个文件，跳过 ${emptyFiles} 个空文件，${failed.length} 个文件未完成`;folderImportCandidates.value=failed}catch(source){folderImportCandidates.value=failed;folderImportResult.value={imported,createdFolders,skipped:folderImportResult.value?.skipped||0,unfinished:failed.length,...(emptyFiles?{emptyFiles}:{}),...(issues.length?{issues}:{}),error:source instanceof Error?source.message:'导入失败，请重试'};folderImportMessage.value=`已导入 ${imported} 个；${source instanceof Error?source.message:'其余文件导入失败'}`}finally{folderImportBusy.value=false;resumeSync?.();void flushAttachments().catch(()=>undefined)}}
async function importStandaloneFiles(files:File[]){
  if(!ownerId.value)return
  const areaUid=typeof route.query.areaUid==='string'?route.query.areaUid:newItemAreaUid.value
  const projectUidValue=typeof route.query.projectUid==='string'?route.query.projectUid:null
  for(const file of files.filter(item=>item.size>0)){
    const kind=fileKindFromName(file.name),markdown=/\.(md|markdown)$/i.test(file.name)
    const note=await notesStore.create({title:markdown?file.name.replace(/\.(md|markdown)$/i,''):file.name,content:markdown?await file.text():'',type:markdown?'note':'file',contentFormat:markdown?'markdown':'file',fileName:file.name,...(markdown?{captureSource:'folder_import',sha256:await fileSha256(file)}:{fileKind:kind.fileKind,fileExtension:kind.extension,mediaType:file.type||inferMediaType(file.name),sizeBytes:file.size}),areaUid,projectUid:projectUidValue,organizationStatus:areaUid||projectUidValue?'organized':'pending',organizedAt:areaUid||projectUidValue?new Date().toISOString():null})
    if(!markdown){const attachment=await queueAttachment(ownerId.value,note.uid,file);await notesStore.updateEntity(note,{attachmentUid:attachment.uid,sha256:attachment.sha256})}
  }
  listQuery.value='';listTypeFilter.value='';listFileFilter.value=files.some(file=>/\.(md|markdown)$/i.test(file.name))?'':'file';selectedFolderId.value='all';listLimit.value=Math.max(listLimit.value,50)
  await flushAttachments().catch(()=>undefined)
}
async function openStandaloneFilePicker(){const staged=consumeGlobalCreateFiles(),files=staged.length?staged:await selectGlobalCreateFiles();if(files.length)await importStandaloneFiles(files)}
async function createProjectNote(){const uid=projectUid.value||currentProject.value?.uid,projectValue=projects.value.find(item=>item.uid===uid);if(!uid)return;editorMode.value='edit';await createNamedNote({type:'note',projectUid:uid,areaUid:projectValue?.areaUid||null,organizationStatus:'organized',organizedAt:new Date().toISOString()});if(!projectUid.value)selectedFolderId.value=`project:${uid}`}
async function loadProjectContext(){const [projectRows,areaRows]=await Promise.allSettled([workspaceService.projects(undefined,true),workspaceService.areas()]);if(projectRows.status==='fulfilled')projects.value=projectRows.value;if(areaRows.status==='fulfilled')areas.value=areaRows.value;if(!projectUid.value)return;project.value=projects.value.find(item=>item.uid===projectUid.value);projectArea.value=areas.value.find(item=>item.uid===project.value?.areaUid)}
const noteLinkFragment=ref(''),noteLinkError=ref('')
watch(()=>selected.value?.uid,()=>{noteLinkError.value='';noteLinkFragment.value=''})
async function openImportedNoteLink(href:string){
 const source=selected.value,linkOwner=ownerId.value;if(!source)return
 noteLinkError.value=''
 try{
  await flushDraft();await loadFolders()
  if(ownerId.value!==linkOwner||selected.value?.uid!==source.uid)return
  const result=resolveImportedNoteLink(href,source,[...notesStore.notes,...notesStore.archived],folders.value)
  if(result.state!=='resolved'){noteLinkError.value=result.state==='ambiguous'?'目录中存在同名笔记，无法确定链接目标。':'未找到链接对应的笔记，请检查是否已导入或同步完整目录。';return}
  const target=[...notesStore.notes,...notesStore.archived].find(note=>note.uid===result.uid)!
  noteLinkFragment.value=''
  if(projectUid.value&&target.projectUid!==projectUid.value){await router.push({path:'/notes',query:{note:result.uid}});return}
  listQuery.value='';listTypeFilter.value='';listFileFilter.value=''
  await revealRequestedNote(result.uid);await nextTick();noteLinkFragment.value=result.fragment
 }catch(error){noteLinkError.value=error instanceof Error?error.message:'笔记链接打开失败'}
}
async function revealRequestedNote(uid:string){
  const boundary=organizationToken(),path=route.fullPath
  const find=()=>notesStore.notes.find(item=>item.uid===uid)||notesStore.archived.find(item=>item.uid===uid)||notesStore.trash.find(item=>item.uid===uid)
  let note=find()
  // The initial list is local-first; a deep-linked note may arrive in the
  // background sync after mount. Wait for that sync before resolving the UID.
  if(!note&&online.value&&notesStore.syncEnabled()){await notesStore.runSync({force:true});if(!organizationCurrent(boundary)||route.fullPath!==path)return;note=find()}
  if(!note){noteLinkError.value='暂未找到这篇笔记，请检查同步后重试。';return}
  noteLinkError.value=''
  if(!isRegularNote(note)){
    if(note.type==='mindmap')await openLinkedMindmap(note)
    else if(['excalidraw','canvas','diagrams','drawio','flowchart','mermaid'].includes(String(note.type)))await router.push({path:'/canvas',query:{canvas:note.uid}})
    else if(note.type==='knowledge'||note.type==='knowledge_graph')await router.push('/knowledge')
    return
  }
  if(!projectUid.value){selectedFolderId.value=note.deleted?'trash':note.status==='archived'?'archived':'all'}
  notesStore.select(uid)
}
function openProjectTab(tab:'overview'|'tasks'|'knowledge'|'logs'|'reviews'|'credentials'){router.push(`/projects/${projectUid.value}/${tab}`)}
async function setProjectStatus(status:ProjectEntity['status']){if(!project.value)return;project.value=await workspaceService.updateProject(project.value,{status});window.dispatchEvent(new Event('note-flow:workspace-change'))}
async function exportProject(){if(!project.value)return;const content=JSON.stringify({exportedAt:new Date().toISOString(),project:project.value,notes:projectNotes.value},null,2);await saveLocalExport(new Blob([content],{type:'application/json'}),`${project.value.name}-项目笔记归档.json`)}
function networkChanged(){online.value=window.navigator.onLine;if(isCommunityEdition||online.value)void flushAttachments()}
function closeListFilterOutside(event:PointerEvent){const target=event.target as Node;if(listControlOpen.value&&!listFilterMenu.value?.contains(target)&&!listPopover.value?.contains(target))listControlOpen.value=''}
function scheduleWorkspaceHydration(){
  if(editorReady.value||hydrationFrame||hydrationIdle)return
  hydrationFrame=requestAnimationFrame(()=>{propertiesReady.value=true;hydrationFrame=requestAnimationFrame(()=>{
    hydrationFrame=0
    const hydrate=()=>{hydrationIdle=0;editorReady.value=true;if(listLimit.value===20)listLimit.value=50}
    hydrationIdle=typeof window.requestIdleCallback==='function'?window.requestIdleCallback(hydrate,{timeout:700}):setTimeout(hydrate,50)
  })})
}
function noteWorkspaceKeydown(event:KeyboardEvent){if(event.target instanceof Element&&event.target.closest('[role="dialog"]'))return;if(event.key==='Escape'&&sidebarFloating.value&&(propertiesVisible.value||outlineSidebarVisible.value)&&!document.querySelector('[role=dialog],.pc-context-menu')){event.preventDefault();closeFloatingSidebar();return;}if(event.key==='Escape'&&focusReading.value)focusReading.value=false;if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key==='.'&&!event.altKey&&!event.isComposing&&!destination.value&&document.querySelector('.notes-workspace')?.getClientRects().length){const target=event.target as HTMLElement;if(target.closest('input,textarea,select,[contenteditable=true],.cm-editor'))return;event.preventDefault();if(bulkItems.value.length)void openNoteDestination([...bulkItems.value]);else if(selected.value)void openNoteDestination([selected.value])}}
function cancelWorkspaceHydration(){cancelAnimationFrame(hydrationFrame);hydrationFrame=0;if(hydrationIdle){typeof window.cancelIdleCallback==='function'?window.cancelIdleCallback(hydrationIdle):clearTimeout(hydrationIdle);hydrationIdle=0}}
function workspaceMetadataChanged(){if(!pcSyncResetPaused())void loadProjectContext()}
onActivated(()=>{organizationActive=true;registerDraftGuard();if(workspaceLoaded){scheduleWorkspaceHydration();workspaceMetadataChanged();if(typeof route.query.folder==='string')void loadFolders().then(revealOrganizationRoute)}})
onDeactivated(()=>{dismissOrganizationResult();directoryOrganization.value=undefined;bodyRecoveryNoteUid.value='';organizationActive=false;organizationEpoch++;destination.value=null;unregisterDraftGuard?.();cancelWorkspaceHydration()})
onMounted(async () => {sidebarResizeObserver=new ResizeObserver(measureSidebarSpace);if(workspaceElement.value)sidebarResizeObserver.observe(workspaceElement.value);measureSidebarSpace(); window.addEventListener('note-flow:workspace-change',workspaceMetadataChanged);window.addEventListener('online',networkChanged);window.addEventListener('offline',networkChanged);window.addEventListener('resize',adaptWorkspace);window.addEventListener('pointerdown',closeListFilterOutside);window.addEventListener('keydown',noteWorkspaceKeydown);await Promise.allSettled([notesStore.load(), notesStore.loadTrash(), notesStore.loadArchived(), loadFolders(), loadTags(),loadProjectContext(),loadJournalSeries()]); if (route.query.create === '1') { await createNote(); await router.replace(route.path) } else if(route.query.import==='file'){await openStandaloneFilePicker();await router.replace({path:route.path,query:projectUid.value?{projectUid:projectUid.value}:{}})} else if (typeof route.params.noteUid === 'string') await revealRequestedNote(route.params.noteUid); else if (typeof route.query.note === 'string') await revealRequestedNote(route.query.note); else if(!visibleNotes.value.some(note=>note.uid===notesStore.selectedUid))notesStore.select(visibleNotes.value[0]?.uid||''); workspaceLoaded=true;revealOrganizationRoute();scheduleWorkspaceHydration();await flushAttachments().catch(()=>undefined) })
onBeforeUnmount(()=>{pauseOrganizationNotice();sidebarResizeObserver?.disconnect();organizationActive=false;organizationEpoch++;unregisterDraftGuard?.();focusReading.value=false;document.body.classList.remove('notes-focus-reading');clearTimeout(saveTimer);cancelWorkspaceHydration();const uid=selected.value?.uid;if(uid)void saveDraft(uid);window.removeEventListener('note-flow:workspace-change',workspaceMetadataChanged);window.removeEventListener('online',networkChanged);window.removeEventListener('offline',networkChanged);window.removeEventListener('resize',adaptWorkspace);window.removeEventListener('pointerdown',closeListFilterOutside);window.removeEventListener('keydown',noteWorkspaceKeydown)})

function selectFolder(value: number | string) {selectedFolderId.value = value; if (!visibleNotes.value.some(note => note.uid === notesStore.selectedUid)) notesStore.select(visibleNotes.value[0]?.uid || '') }
async function createLibraryNote(target?:FolderEntity|string) {
  try {
    await flushDraft()
    if(typeof target==='string')selectLibraryArea(target)
    else if(target)selectFolder(target.id)
    else if(!canCreateInCurrentScope.value&&(!showingProjectNotes.value||projectFilter.value==='all'))selectFolder('all')
    listQuery.value='';listTypeFilter.value='';listFileFilter.value='';listTagUids.value=[]
    listLimit.value=Math.max(listLimit.value,50)
    if(showingProjectNotes.value)await createProjectNote()
    else await createNote()
  } catch(source) { folderError.value=source instanceof Error?source.message:'新建笔记失败' }
}
function blankNoteListMenu(event:MouseEvent){
  if(event.defaultPrevented||(event.target as HTMLElement).closest('button,a,input,select,textarea,li,.folder-node,.area-node,.note-table-row'))return
  if(!canCreateInCurrentScope.value||reportSeriesUid.value||periodFilter.value||selectedFolderId.value==='trash'||selectedFolderId.value==='archived')return
  openContextMenu(event,[
    {id:'new-note',label:'新建笔记',disabled:creatingNote.value,run:()=>createLibraryNote()},
    {id:'new-folder',label:activeFolder.value?'新建子目录':'新建目录',run:()=>createFolder()},
    {id:'import',label:'导入文件',run:()=>openStandaloneFilePicker()},
  ])
}
function openLibraryCreate(event:MouseEvent) {
  const folder=activeFolder.value,area=selectedLibraryAreaUid.value
  openContextMenu(event,[
    {id:'note',label:'新建笔记',disabled:Boolean(reportSeriesUid.value),run:()=>createLibraryNote(folder||area)},
    {id:'folder',label:folder?'新建子目录':'新建目录',run:()=>{if(folder)selectFolder(folder.id);else if(area!==undefined)selectLibraryArea(area);return createFolder()}},
  ])
}
async function createFolder() { const name = await promptDialog('目录名称'); if (!name?.trim()) return; try { const parent=activeFolder.value;await foldersService.create(name.trim(), parent?.id || null,{areaUid:newItemAreaUid.value,projectUid:parent?.projectUid||projectUid.value||null}); if(groupFoldersByArea.value)setLibraryAreaCollapsed(newItemAreaUid.value||'',false); await loadFolders() } catch (source) { folderError.value = source instanceof Error ? source.message : '新建目录失败' } }
async function renameFolder(folder=activeFolder.value) { if (!folder) return; const name = await promptDialog('重命名目录', folder.name); if (!name?.trim() || name.trim() === folder.name) return; try { await foldersService.update(folder, name.trim()); await loadFolders() } catch (source) { folderError.value = source instanceof Error ? source.message : '重命名失败' } }
const folderStructureBusy=ref(false)
async function previewFolderPromotion(folder:FolderEntity){const parent=folders.value.find(row=>folder.parentUid?row.uid===folder.parentUid:row.id===folder.parentId);if(!parent){folderError.value='父目录不存在，请刷新后重试';return}const grandparent=folders.value.find(row=>parent.parentUid?row.uid===parent.parentUid:row.id===parent.parentId);await openFolderDestination(folder,grandparent||null)}
async function adjustFolder(folder:FolderEntity,removeParent=false){
  if(folderStructureBusy.value||folderDeleteBusy.value||folderImportBusy.value)return
  if(removeParent){
    try{await loadFolders();const archived=await notesStore.service().list('archived'),children=folders.value.filter(row=>row.parentUid?row.parentUid===folder.uid:row.parentId===folder.id),contents=[...notesStore.notes,...archived].filter(note=>note.folderUid?note.folderUid===folder.uid:note.folderId===folder.id),parent=folders.value.find(row=>folder.parentUid?row.uid===folder.parentUid:row.id===folder.parentId)
    if(!await confirmDialog({title:`移除目录“${folder.name}”并提升内容？`,message:`原路径：${folderPath(folder,folders.value)}\n目标：${parent?folderPath(parent,folders.value):'顶级'}\n直接子目录 ${children.length} 个：${children.map(row=>row.name).join('、')||'无'}\n直接内容 ${contents.length} 项：${contents.map(row=>row.title||'未命名').join('、')||'无'}\n更深层级保持。不会删除内容；移除目录无法一键撤销，需要恢复结构时，新建同名目录并使用移动操作将内容移回。`,confirmText:'移除并提升',tone:'warning'}))return
    }catch(error){folderError.value=error instanceof Error?error.message:'无法读取影响范围';return}
  }
  folderStructureBusy.value=true;folderError.value=''
  let resumeSync:(()=>void)|undefined
  try{
    resumeSync=await pausePcSync()
    await flushDraft()
    if(removeParent){await foldersService.dissolve(folder);if(selectedFolderId.value===folder.id)selectedFolderId.value=folder.parentId??'all'}
    else await foldersService.promote(folder)
    if(!isCommunityEdition&&!isDesktopClient())await notesStore.service().sync()
    await Promise.all([loadFolders(),notesStore.reloadLocal()])
  }catch(source){folderError.value=source instanceof Error?source.message:'调整目录失败';await Promise.allSettled([loadFolders(),notesStore.reloadLocal()])}
  finally{folderStructureBusy.value=false;resumeSync?.();void notesStore.refreshInBackground()}
}
const folderDeleteOpen=ref(false),folderDeleteBusy=ref(false),folderDeleteName=ref(''),folderDeleteError=ref(''),folderDeleteProgress=ref<FolderDeleteProgress>({phase:'准备删除',completed:0,total:0})
async function deleteFolder(folder=activeFolder.value) {
  if(folderStructureBusy.value||folderDeleteBusy.value||folderImportBusy.value||!folder||!await confirmDialog(`删除目录“${folder.name}”及全部子目录？其中的笔记和文件会一起移到回收站，附件会保留。`))return
  folderDeleteOpen.value=true;folderDeleteBusy.value=true;folderDeleteName.value=folder.name;folderDeleteError.value='';folderError.value='';folderDeleteProgress.value={phase:'等待当前同步结束',completed:0,total:0,current:folder.name}
  let resumeSync:(()=>void)|undefined
  try{
    await nextTick();resumeSync=await pausePcSync()
    await foldersService.remove(folder,progress=>{folderDeleteProgress.value=progress})
    folderDeleteProgress.value={...folderDeleteProgress.value,phase:'刷新目录和列表',current:''}
    selectedFolderId.value='all'
    if(!isCommunityEdition&&!isDesktopClient())await notesStore.service().sync()
    await Promise.all([loadFolders(),notesStore.reloadLocal()])
  }catch(source){
    folderDeleteError.value=source instanceof Error?source.message:'删除失败'
    await Promise.allSettled([loadFolders(),notesStore.reloadLocal()])
  }finally{folderDeleteBusy.value=false;resumeSync?.();void notesStore.refreshInBackground()}
}
async function moveSelected(event: Event){if(!selected.value)return;const raw=(event.target as HTMLSelectElement).value,folder=raw?folders.value.find(row=>row.id===Number(raw)):null;await openNoteDestination([selected.value]);if(destination.value?.kind==='notes')destinationFolderUid.value=folder?.uid||''}
async function openLinkedMindmap(note:NoteEntity){
  try{
    const source=note.uid===selected.value?.uid?{...note,title:draftTitle.value.trim()||note.title||'未命名笔记',content:draftContent.value}:note
    if(note.uid===selected.value?.uid)await notesStore.saveNote(note.uid,{title:source.title,content:source.content})
    const {canvas}=await openOrCreateLinkedMindmapCanvas(createCanvasService(ownerId.value),source)
    await router.push({path:'/canvas',query:{canvas:canvas.uid}})
  }catch(source){folderError.value=source instanceof Error?source.message:'创建关联思维导图失败'}
}
async function createTag() { const name=await promptDialog('标签名称'); if(!name?.trim())return; try{await tagsService.create(name.trim());await loadTags()}catch(source){folderError.value=source instanceof Error?source.message:'新建标签失败'} }
async function renameTag(tag=activeTag.value) { if(!tag)return;const name=await promptDialog('重命名标签',tag.name);if(!name?.trim()||name.trim()===tag.name)return;try{await tagsService.update(tag,name.trim());await loadTags()}catch(source){folderError.value=source instanceof Error?source.message:'重命名失败'} }
async function deleteTag(tag=activeTag.value) { if(!tag||!await confirmDialog(`删除标签“${tag.name}”？只会解除分类关联，不会删除笔记。`))return;try{await tagsService.remove(tag);if(selectedTagId.value===tag.id)selectedFolderId.value='all';listTagUids.value=listTagUids.value.filter(uid=>uid!==tag.uid);favoriteTagUids.value=favoriteTagUids.value.filter(uid=>uid!==tag.uid);localStorage.setItem(tagFavoritesKey(),JSON.stringify(favoriteTagUids.value));await Promise.all([loadTags(),notesStore.load()])}catch(source){folderError.value=source instanceof Error?source.message:'删除失败'} }
async function renameNote(note=selected.value){
 if(!note||note.deleted)return
 const owner=ownerId.value,originalTitle=note.uid===selected.value?.uid?draftTitle.value:note.title||''
 const value=await promptDialog('重命名笔记',originalTitle)
 if(value===null)return
 const title=value.trim()
 if(!title){folderError.value='笔记标题不能为空';return}
 if(title.length>200){folderError.value='笔记标题不能超过 200 个字符';return}
 if(title===originalTitle)return
 try{
  if(owner!==ownerId.value)throw Error('账号已切换，请重新打开笔记')
  await flushDraft()
  const current=await notesStore.service().get(note.uid)
  if(owner!==ownerId.value||!current||current.deleted)throw Error('笔记已变化，请刷新后重试')
  if((current.title||'')!==originalTitle)throw Error('标题已变化，请重新打开重命名')
  await notesStore.saveNote(note.uid,{title});await notesStore.flushPendingSaves()
  if(selected.value?.uid===note.uid&&owner===ownerId.value){draftTitle.value=title;if(draftBaseline)draftBaseline={...draftBaseline,title}}
 }catch(source){folderError.value=source instanceof Error?source.message:'重命名失败'}
}
function openNoteActions(event:MouseEvent){
 const note=selected.value;if(!note)return
 event.preventDefault();event.stopPropagation()
 const rect=(event.currentTarget as HTMLElement).getBoundingClientRect(),anchor=new MouseEvent('click',{clientX:Math.max(8,rect.right-220),clientY:rect.bottom+6})
 if(note.deleted){noteContextMenu(anchor,note);return}
 openContextMenu(anchor,[
  {id:'rename',label:'重命名',icon:'✎',run:()=>renameNote(note)},
  ...(!projectUid.value?[{id:'task',label:'从笔记创建任务',iconName:'task' as const,run:()=>createTaskFromNote()}]:[]),
  ...(!isPeriodicNote(note)?[{id:'move',label:'移动到…',iconName:'move' as const,separator:true,run:()=>openNoteDestination([note])}]:[]),
  {id:'export',label:'导出笔记 ZIP',iconName:'download' as const,separator:true,disabled:downloadBusy.value,run:()=>downloadNoteScope({noteUid:note.uid})},
 ])
}
function noteContextMenu(event:MouseEvent,note:NoteEntity){openContextMenu(event,[
  {id:'download-file',label:'下载文件（Markdown + 元数据）',iconName:'download',disabled:downloadBusy.value||!!note.deleted,run:()=>downloadNoteScope({noteUid:note.uid})},
  {id:'open',label:'打开笔记',iconName:'document' as const,run:()=>notesStore.select(note.uid)},
  ...(!note.deleted?[{id:'rename',label:'重命名',icon:'✎',run:()=>renameNote(note)}]:[]),
  ...(note.deleted?[{id:'restore',label:'恢复笔记',iconName:'restore' as const,run:()=>{notesStore.select(note.uid);return restoreSelected()}},...(!isCommunityEdition?[{id:'purge',label:'永久删除',iconName:'delete' as const,danger:true,separator:true,run:()=>purgeNote(note)}]:[])]:note.status==='archived'?[{id:'restore',label:'恢复为活跃笔记',iconName:'restore' as const,run:()=>notesStore.restoreArchived(note)}]:[
  {id:'pin',label:note.pinned?'取消收藏':'添加收藏',iconName:note.pinned?'star-filled' as const:'star' as const,run:()=>notesStore.togglePinned(note)},
  {id:'move',label:'移动到…（Ctrl+Shift+.）',iconName:'move' as const,run:()=>openNoteDestination([note])},
  {id:'tag',label:'添加标签',iconName:'tag' as const,run:()=>{notesStore.select(note.uid);bulkSelected.value=new Set([note.uid]);openBulk('tag')}},
  {id:'organize',label:'标记整理完成',iconName:'check' as const,run:()=>notesStore.updateEntity(note,{organizationStatus:'organized',organizedAt:new Date().toISOString()})},
  {id:'linked-mindmap',label:'创建 / 打开关联思维导图',iconName:'mindmap' as const,run:()=>openLinkedMindmap(note)},
  {id:'archive',label:'归档笔记',iconName:'archive' as const,separator:true,run:()=>notesStore.updateEntity(note,{status:'archived'})},
  {id:'delete',label:'移入回收站',iconName:'delete' as const,danger:true,run:()=>moveNoteToTrash(note)},
  ]),
])}
function folderContextMenu(event:MouseEvent,folder:FolderEntity){openContextMenu(event,[
  {id:'download-directory',label:'下载目录（含子目录）',iconName:'download',disabled:downloadBusy.value,run:()=>downloadNoteScope({folderUid:folder.uid})},
  {id:'note',label:'新建笔记',disabled:Boolean(reportSeriesUid.value),run:()=>createLibraryNote(folder)},
  {id:'child',label:'新建子目录',run:()=>{selectFolder(folder.id);return createFolder()}},
  {id:'import-files',label:'导入文件到此目录',separator:true,run:()=>chooseFolderImport(folder)},
  {id:'import-folder',label:'导入文件夹到此目录',run:()=>chooseFolderTreeImport(folder)},
  {id:'rename',label:'重命名',separator:true,run:()=>renameFolder(folder)},
  {id:'move-folder',label:'移动目录到…',disabled:folderStructureBusy.value,run:()=>openFolderDestination(folder)},
  {id:'promote',label:'提升一级',disabled:folderStructureBusy.value||(!folder.parentUid&&folder.parentId==null),run:()=>previewFolderPromotion(folder)},
  ...(!isCommunityEdition?[{id:'directory-organization',label:'AI 整理目录',run:()=>openDirectoryOrganization(folder)},{id:'folder-consolidation',label:'整合目录笔记',run:()=>openFolderConsolidation(folder)}]:[]),
  {id:'dissolve',label:'移除目录并提升内容',separator:true,disabled:folderStructureBusy.value,run:()=>adjustFolder(folder,true)},
  {id:'delete',label:'删除目录',danger:true,run:()=>deleteFolder(folder)},
])}
function areaContextMenu(event:MouseEvent,area:{uid:string;label:string}){
  const destination:FolderImportDestination={id:null,uid:null,name:area.label,areaUid:area.uid||null,projectUid:null}
  openContextMenu(event,[
    {id:'note',label:'新建笔记',disabled:Boolean(reportSeriesUid.value),run:()=>createLibraryNote(area.uid)},
    {id:'child',label:'新建目录',run:()=>{selectLibraryArea(area.uid);return createFolder()}},
    {id:'import-files',label:'导入文件到此领域',separator:true,run:()=>chooseFolderImport(destination)},
    {id:'import-folder',label:'导入文件夹到此领域',run:()=>chooseFolderTreeImport(destination)},
  ])
}
function tagContextMenu(event:MouseEvent,tag:TagEntity){openContextMenu(event,[
  {id:'open',label:'查看标签笔记',icon:'#',run:()=>selectFolder(`tag:${tag.id}`)},
  {id:'rename',label:'重命名',icon:'✎',run:()=>renameTag(tag)},
  {id:'delete',label:'删除标签',icon:'×',danger:true,separator:true,run:()=>deleteTag(tag)},
])}
async function toggleTag(tagId:number,checked:boolean){const note=selected.value,tag=tags.value.find(item=>item.id===tagId);if(!note||note.deleted||!tag)return;const next=new Set(noteTagUids(note,tags.value));checked?next.add(tag.uid):next.delete(tag.uid);const ids=tags.value.filter(item=>next.has(item.uid)).map(item=>item.id);try{await notesStore.acceptServer(await foldersService.organize(note,note.folderId||null,ids,[...next]))}catch(source){folderError.value=source instanceof Error?source.message:'标签更新失败'}}
async function createAndAssignTag(){const name=tagPickerQuery.value.trim();if(!name||!selected.value||selected.value.deleted)return;try{const tag=await tagsService.create(name);await loadTags();await toggleTag(tag.id,true);tagPickerQuery.value=''}catch(source){folderError.value=source instanceof Error?source.message:'添加标签失败'}}
async function restoreSelected(){await notesStore.restoreSelected();selectedFolderId.value='all'}
const noteDeleteBusy=ref(false),noteDeleteError=ref('')
async function moveNoteToTrash(note=selected.value){
  if(noteDeleteBusy.value||!note||!await confirmDialog(`将“${note.title||'未命名笔记'}”移入回收站？可稍后从回收站恢复。`))return
  noteDeleteBusy.value=true;noteDeleteError.value=''
  try{notesStore.select(note.uid);await notesStore.removeSelected()}
  catch(source){noteDeleteError.value=source instanceof Error?source.message:'移入回收站失败，请重新操作'}
  finally{noteDeleteBusy.value=false}
}
async function restoreArchived(){if(!selected.value)return;await notesStore.restoreArchived(selected.value);selectedFolderId.value='all'}
const trashClearOpen=ref(false),trashClearBusy=ref(false),trashClearPhase=ref(''),trashClearCompleted=ref(0),trashClearTotal=ref(0),trashClearCurrent=ref(''),trashClearRemoved=ref(0),trashClearError=ref(''),trashClearFailures=ref<Array<{title:string;reason:string}>>([])
const trashRetryItems=ref<NoteEntity[]>([])
async function clearTrashItems(items:NoteEntity[],confirmServerDelete=false){
  if(isCommunityEdition||trashClearBusy.value)return
  trashClearOpen.value=true;trashClearBusy.value=true;trashClearCompleted.value=0;trashClearTotal.value=items.length;trashClearRemoved.value=0;trashClearFailures.value=[];trashClearError.value='';trashClearPhase.value='等待当前同步结束';trashClearCurrent.value=''
  let resume:(()=>void)|undefined
  try{
    await nextTick();await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));resume=await pausePcSync()
    const service=notesStore.service()
    if(online.value&&notesStore.syncEnabled()){
      trashClearPhase.value='同步回收站状态'
      try{await service.sync()}catch{ /* Each purge still verifies the server state before deleting. */ }
    }
    trashClearPhase.value='永久删除内容'
    const result=await purgeTrashBatch(items,note=>service.purge(note,confirmServerDelete),(completed,current)=>{trashClearCompleted.value=completed;trashClearCurrent.value=current})
    trashClearRemoved.value=result.removed;trashClearFailures.value=result.failures
    const failed=new Set(result.failures.map(item=>item.uid));trashRetryItems.value=items.filter(item=>failed.has(item.uid))
  }catch(error){trashClearError.value=error instanceof Error?error.message:'清理失败，请重试'}
  finally{
    trashClearPhase.value='刷新回收站';trashClearCurrent.value=''
    try{await notesStore.reloadLocal();await notesStore.loadConflicts();if(!notesStore.trash.some(note=>note.uid===notesStore.selectedUid))notesStore.select(notesStore.trash[0]?.uid||'')}catch{trashClearError.value+=' 回收站列表刷新失败，请重新进入页面。'}
    trashClearBusy.value=false;resume?.()
  }
}
async function retryTrashClear(){
  const items=[...trashRetryItems.value];if(!items.length||trashClearBusy.value)return
  if(!await confirmDialog(`重试永久删除这 ${items.length} 项？服务器上仍活跃的对应笔记也将先移入回收站再永久删除。此操作不可恢复。`))return
  await clearTrashItems(items,true)
}
async function purgeNote(note=selected.value){if(trashClearBusy.value||!note?.deleted||!await confirmDialog(`永久删除“${note.title||'未命名笔记'}”？此操作不可恢复。`))return;await clearTrashItems([note])}
async function emptyTrash(){const items=[...scopedTrash.value];if(trashClearBusy.value||!items.length||!await confirmDialog(`永久删除当前回收站中的 ${items.length} 篇笔记？此操作不可恢复。`))return;await clearTrashItems(items)}
async function setSelectedOrganization(status:'inbox'|'pending'|'organized'){if(!selected.value)return;try{await notesStore.setOrganizationStatus(selected.value,status)}catch(source){folderError.value=source instanceof Error?source.message:'整理状态更新失败'}}
function organizationReasons(note:NoteEntity){const reasons:string[]=[];if(note.organizationStatus==='inbox')reasons.push('收集箱');if(!note.folderId&&!note.folderUid)reasons.push('无目录');if(!(note.tagIds?.length||note.tagUids?.length))reasons.push('无标签');if(!note.projectUid)reasons.push('未关联项目');return reasons.slice(0,3).join(' · ')}


function startResize(event: MouseEvent) {
  dragging.value = true
  const startX = event.clientX
  const startWidth = listWidth.value
  const move = (source: MouseEvent) => { listWidth.value = Math.min(600, Math.max(300, startWidth + source.clientX - startX)) }
  const stop = () => { dragging.value = false; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop) }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', stop)
}
function startTreeResize(event: MouseEvent) {
  event.preventDefault()
  treeDragging.value = true
  const startX = event.clientX
  const startWidth = treeWidth.value
  const move = (source: MouseEvent) => { treeWidth.value = Math.min(440, Math.max(220, startWidth + source.clientX - startX)) }
  const stop = () => {
    treeDragging.value = false
    localStorage.setItem(TREE_WIDTH_KEY, String(treeWidth.value))
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', stop)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', stop)
}
async function createTaskFromNote(){const note=selected.value;if(!note)return;const title=await promptDialog('任务名称',note.title?`处理：${note.title}`:'');if(!title?.trim())return;taskCreateStatus.value='正在创建任务…';try{const task=await tasksService.create({title:title.trim(),description:'',areaUid:note.areaUid||null,projectUid:note.projectUid||null,listName:'收集箱',priority:0,completed:false,reminderOffsetsMinutes:[0],timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});await taskNotesService.link(task.uid,note.uid,'source');taskCreateStatus.value='已创建任务并关联当前笔记';window.setTimeout(()=>taskCreateStatus.value='',2500)}catch(source){taskCreateStatus.value=source instanceof Error?source.message:'创建任务失败'}}
function openSelectedProject(){if(selected.value?.projectUid)router.push({path:`/projects/${selected.value.projectUid}/notes`,query:{note:selected.value.uid}})}
function toggleBulkNote(uid:string,checked:boolean){const next=new Set(bulkSelected.value);checked?next.add(uid):next.delete(uid);bulkSelected.value=next}
function enterMultiSelect(){multiSelectMode.value=true;listControlOpen.value=''}
function leaveMultiSelect(){multiSelectMode.value=false;bulkSelected.value=new Set()}
async function openNoteRow(note:NoteEntity){if(multiSelectMode.value){toggleBulkNote(note.uid,!bulkSelected.value.has(note.uid));return}if(note.type==='mindmap'){const {canvas}=await openOrCreateLinkedMindmapCanvas(createCanvasService(ownerId.value),note);await router.push({path:'/canvas',query:{canvas:canvas.uid}});return}if(note.type==='excalidraw'){void router.push({path:'/canvas',query:{canvas:note.uid}});return}notesStore.select(note.uid)}
async function deleteSelectedNotes(){const items=[...bulkItems.value];if(!items.length||!await confirmDialog(`将选中的 ${items.length} 篇笔记移到回收站？`))return;bulkBusy.value=true;bulkFailures.value=[];const result=await runBulkOperation(items,async note=>{notesStore.select(note.uid);await notesStore.removeSelected();return note},{chunkSize:20,onProgress:done=>bulkCompleted.value=done});bulkFailures.value=result.failed;bulkBusy.value=false;await notesStore.load();if(result.failed.length)bulkSelected.value=new Set(result.failed.map(value=>value.item.uid));else leaveMultiSelect()}
function startFolderOrganizeDrag(event:DragEvent,folder:FolderEntity){event.dataTransfer?.setData('application/x-noteflow-folder',folder.uid);if(event.dataTransfer)event.dataTransfer.effectAllowed='move'}
function startNoteOrganizeDrag(event:DragEvent,note:NoteEntity){if(note.deleted||isPeriodicNote(note)){event.preventDefault();return}const draggedNoteUids=bulkSelected.value.has(note.uid)?[...bulkSelected.value]:[note.uid];event.dataTransfer?.setData('application/x-noteflow-notes',JSON.stringify(draggedNoteUids));if(event.dataTransfer)event.dataTransfer.effectAllowed='move'}
async function dropOrganization(event:DragEvent,target:FolderEntity){if(destinationBusy.value)return;const folderUid=event.dataTransfer?.getData('application/x-noteflow-folder')||'';if(folderUid){const folder=folders.value.find(row=>row.uid===folderUid);if(!folder)return;try{if(isCommunityEdition||sameFolderScope(folder,target))validateFolderMove(folder,target,folders.value);else if(folderDescendants(folder,folders.value).some(row=>row.uid===target.uid))throw Error('不能移动到自身或子目录');await openFolderDestination(folder,target);if(destination.value?.kind==='folder')destinationScope.value=scopeKey(target)}catch(error){folderError.value=error instanceof Error?error.message:'不能移动到此目录'}}else{let uids:string[]=[];try{uids=JSON.parse(event.dataTransfer?.getData('application/x-noteflow-notes')||'[]')}catch{return}if(!Array.isArray(uids)||uids.some(uid=>typeof uid!=='string'))return;const notes=notesStore.notes.filter(row=>uids.includes(row.uid));if(notes.length){await openNoteDestination(notes,target);if(destination.value?.kind==='notes')destinationScope.value=scopeKey(target)}}}
type DestinationScope={areaUid:string|null;projectUid:string|null}
const destination=ref<{kind:'notes';uids:string[]}|{kind:'folder';folder:FolderEntity}|null>(null)
const destinationScope=ref(''),destinationFolderUid=ref(''),destinationBusy=ref(false),destinationErrors=ref<string[]>([])
const destinationOriginals=new Map<string,NoteEntity>()
const destinationTransfer=ref<FolderTransferImpact>()
function transferRelativePath(uid:string){const preview=destinationTransfer.value;if(!preview)return '';const names:string[]=[],seen=new Set<string>();let row=preview.folders.find(f=>f.uid===uid);while(row&&!seen.has(row.uid)){seen.add(row.uid);names.unshift(row.name);row=row.parentUid?preview.folders.find(f=>f.uid===row!.parentUid):undefined}return names.join(' / ')}
const pendingFolderTransfer=(uid:string)=>isCommunityEdition?undefined:foldersService.pendingTreeTransfer(uid)
const crossScopeFolder=computed(()=>!isCommunityEdition&&destination.value?.kind==='folder'&&Boolean(destinationScope.value)&&(!sameFolderScope(destination.value.folder,parseDestinationScope())||Boolean(pendingFolderTransfer(destination.value.folder.uid)?.sent)))
watch([destination,destinationScope,destinationFolderUid],()=>{destinationTransfer.value=undefined})
let organizationActive=true,organizationEpoch=0
const organizationToken=()=>({owner:recentDestinationKey(),epoch:organizationEpoch})
const organizationCurrent=(token:ReturnType<typeof organizationToken>)=>organizationActive&&token.owner===recentDestinationKey()&&token.epoch===organizationEpoch
watch(ownerId,()=>{organizationEpoch++;destination.value=null;organizationResult.value=undefined;folderUndo.value=undefined;bulkUndo.value=undefined;bulkUndoFailures.value=[]})
const folderUndo=ref<{folderUid:string;parentUid:string|null;scope?:DestinationScope}>(),organizationResult=ref<{message:string;scope:DestinationScope;folderUid:string}>()
let organizationNoticeTimer:ReturnType<typeof setTimeout>|undefined
let organizationNoticeHovered=false,organizationNoticeFocused=false
function pauseOrganizationNotice(){clearTimeout(organizationNoticeTimer);organizationNoticeTimer=undefined}
function dismissOrganizationResult(){pauseOrganizationNotice();organizationResult.value=undefined;folderUndo.value=undefined;organizationNoticeHovered=false;organizationNoticeFocused=false}
function scheduleOrganizationNotice(){pauseOrganizationNotice();if(organizationResult.value&&!destinationBusy.value&&!destination.value&&!organizationNoticeHovered&&!organizationNoticeFocused)organizationNoticeTimer=setTimeout(dismissOrganizationResult,15000)}
function holdOrganizationNotice(kind:'hover'|'focus',held:boolean){if(kind==='hover')organizationNoticeHovered=held;else organizationNoticeFocused=held;scheduleOrganizationNotice()}
watch([organizationResult,destinationBusy,destination],scheduleOrganizationNotice,{flush:'sync'})
watch([()=>route.fullPath,globalAreaUid,selectedFolderId],dismissOrganizationResult,{flush:'sync'})
const recentDestinations=ref<Array<{scope:string;folderUid:string}>>([])
const recentDestinationKey=()=>`${scopedPreferenceKey('jiyu-pc-recent-move-targets',ownerId.value||'local')}:${ownerId.value||'local'}`
watch(ownerId,()=>{try{const values=JSON.parse(localStorage.getItem(recentDestinationKey())||'[]');recentDestinations.value=Array.isArray(values)?values.filter(row=>typeof row?.scope==='string'&&typeof row?.folderUid==='string').slice(0,6):[]}catch{recentDestinations.value=[]}},{immediate:true})
const scopeKey=(value:{areaUid?:string|null;projectUid?:string|null})=>JSON.stringify([value.areaUid||null,value.projectUid||null])
function parseDestinationScope():DestinationScope{const [areaUid,projectUid]=JSON.parse(destinationScope.value);return{areaUid,projectUid}}
const scopeName=(value:DestinationScope)=>[areas.value.find(row=>row.uid===value.areaUid)?.name||'未归属领域',projects.value.find(row=>row.uid===value.projectUid)?.name].filter(Boolean).join(' / ')
const destinationScopes=computed(()=>isCommunityEdition&&destination.value?.kind==='folder'?[{key:scopeKey(destination.value.folder),label:scopeName(destination.value.folder as DestinationScope)}]:[{key:scopeKey({}),label:'未归属领域 / 不归属项目'},...areas.value.filter(row=>!row.archived&&!row.deleted).map(area=>({key:scopeKey({areaUid:area.uid}),label:`${area.name} / 不归属项目`})),...projects.value.filter(row=>!['archived','completed'].includes(row.status)).map(project=>({key:scopeKey({areaUid:project.areaUid,projectUid:project.uid}),label:`${areas.value.find(row=>row.uid===project.areaUid)?.name||'领域待同步'} / ${project.name}`}))])
const destinationTargets=computed(()=>{if(!destinationScope.value)return[];const scope=parseDestinationScope(),folder=destination.value?.kind==='folder'?destination.value.folder:null;return[{uid:'',label:folder?'顶级目录':'无目录',disabled:false},...folders.value.filter(row=>!('deleted' in row&&row.deleted)&&sameFolderScope(row,scope)).map(row=>{let disabled=false;if(folder){if(!sameFolderScope(folder,scope))disabled=folderDescendants(folder,folders.value).some(child=>child.uid===row.uid);else try{validateFolderMove(folder,row,folders.value)}catch{disabled=true}}return{uid:row.uid,label:`${scopeName(scope)} / ${folderPath(row,folders.value)}`,disabled}})]})
const recentDestinationTargets=computed(()=>destination.value?.kind==='folder'?[]:recentDestinations.value.filter(row=>row.scope===destinationScope.value).map(row=>destinationTargets.value.find(target=>target.uid===row.folderUid&&!target.disabled)).filter((row):row is {uid:string;label:string;disabled:boolean}=>Boolean(row)))
function clearRecentDestinations(){recentDestinations.value=[];localStorage.removeItem(recentDestinationKey())}
function rememberDestination(){recentDestinations.value=[{scope:destinationScope.value,folderUid:destinationFolderUid.value},...recentDestinations.value.filter(row=>row.scope!==destinationScope.value||row.folderUid!==destinationFolderUid.value)].slice(0,6);localStorage.setItem(recentDestinationKey(),JSON.stringify(recentDestinations.value))}
const destinationCurrent=computed(()=>{if(destination.value?.kind==='folder')return`原路径：${folderPath(destination.value.folder,folders.value)}`;if(destination.value?.kind==='notes'){const items=destination.value.uids.map(uid=>findOrganizationNote(uid)).filter(Boolean) as NoteEntity[];return items.map(note=>{const folder=folders.value.find(row=>row.uid===note.folderUid||row.id===note.folderId);return`${note.title||'未命名笔记'}：${scopeName(note as DestinationScope)} / ${folder?folderPath(folder,folders.value):'无目录'}`}).join('；')}return''})
const destinationImpact=computed(()=>{if(!destination.value)return'';if(destination.value.kind==='folder'){if(crossScopeFolder.value){const preview=destinationTransfer.value;return preview?`将整棵目录迁移至 ${scopeName(preview.target)}，共 ${preview.folderCount} 个目录、${preview.noteCount} 篇内容（归档 ${preview.archivedNoteCount} 篇，回收站 ${preview.trashNoteCount} 篇）。保留层级、正文、标签和附件引用；由服务端事务一次提交。${preview.resuming?'这是待确认操作，重试会核对原回执，不重复迁移。':''}`:'将连同所有子目录和笔记跨领域 / 项目迁移。先预览完整范围，再确认迁移；需要联网，相关本机修改需先同步。'}const folder=destination.value.folder,subtree=folderDescendants(folder,folders.value),uids=new Set(subtree.map(row=>row.uid)),ids=new Set(subtree.map(row=>row.id)),count=[...notesStore.notes,...notesStore.archived].filter(note=>note.folderUid?uids.has(note.folderUid):ids.has(Number(note.folderId))).length;const target=destinationTargets.value.find(row=>row.uid===destinationFolderUid.value);return`将移动至 ${target?.label||'请选择目标'} / ${folder.name}；影响 ${subtree.length-1} 个子目录及 ${count} 项内容。后代结构、内容身份和引用保持，可撤销。`}if(!destinationScope.value)return'所选笔记来自不同作用域，请明确选择目标领域 / 项目和目录。';const scope=parseDestinationScope(),target=destinationTargets.value.find(row=>row.uid===destinationFolderUid.value);return`将 ${destination.value.uids.length} 项内容移动到 ${target?.label||'无目录'}。${destination.value.uids.some(uid=>{const note=findOrganizationNote(uid);return note&&!sameFolderScope(note,scope)})?'将同时变更领域 / 项目并替换原目录归属。':''}标题、正文、类型、标签和附件引用保持；成功项可撤销。`})
async function openNoteDestination(items:NoteEntity[],folder?:FolderEntity){if(destinationBusy.value)return;const token=organizationToken();folderError.value='';try{await flushDraft();if(!organizationCurrent(token))return;const eligible=items.filter(note=>!note.deleted&&(isRegularNote(note)||isFileNote(note))&&!isPeriodicNote(note));if(eligible.length!==items.length)throw Error('所选内容包含受保护或不支持移动的类型，请先取消这些选择');if(!eligible.length)return;destinationOriginals.clear();destination.value={kind:'notes',uids:eligible.map(row=>row.uid)};const scopes=new Set(eligible.map(scopeKey));destinationScope.value=scopes.size===1?[...scopes][0]:'';destinationFolderUid.value=folder?.uid||(eligible.length===1?eligible[0].folderUid||folders.value.find(row=>row.id===eligible[0].folderId)?.uid||'':'');destinationErrors.value=[]}catch(error){if(!organizationCurrent(token))return;folderError.value=error instanceof Error?error.message:'草稿保存失败，尚未移动'}}
async function openFolderDestination(folder:FolderEntity,parent?:FolderEntity|null){if(destinationBusy.value)return;const token=organizationToken();try{await flushDraft();if(!organizationCurrent(token))return;await loadFolders();if(!organizationCurrent(token))return;const archived=await notesStore.service().list('archived');if(!organizationCurrent(token))return;notesStore.archived=archived;const current=folders.value.find(row=>row.uid===folder.uid);if(!current)throw Error('目录不存在');const pending=isCommunityEdition?undefined:await foldersService.loadPendingTreeTransfer(current.uid);if(!organizationCurrent(token))return;destination.value={kind:'folder',folder:current};destinationScope.value=scopeKey(current);destinationFolderUid.value=parent!==undefined?parent?.uid||'':current.parentUid||folders.value.find(row=>row.id===current.parentId)?.uid||'';destinationErrors.value=[];if(pending?.sent){destinationScope.value=scopeKey(pending.request.target);destinationFolderUid.value=pending.request.target.parentUid||'';await nextTick();destinationTransfer.value={...pending.impact,resuming:true}}}catch(error){if(!organizationCurrent(token))return;folderError.value=error instanceof Error?error.message:'准备移动失败'}}
function changeDestinationScope(value:string){destinationScope.value=value;destinationFolderUid.value='';destinationErrors.value=[]}
async function createDestinationFolder(name:string){if(destinationBusy.value||!destinationScope.value||!destination.value)return;const token=organizationToken(),context=destination.value;const current=()=>organizationCurrent(token)&&destination.value===context;destinationBusy.value=true;destinationErrors.value=[];try{const folder=await foldersService.create(name,null,parseDestinationScope());if(!current())return;await loadFolders();if(!current())return;destinationFolderUid.value=folder.uid}catch(error){if(!current())return;destinationErrors.value=[error instanceof Error?error.message:'目录创建失败']}finally{destinationBusy.value=false}}
async function submitDestination(){
 if(destinationBusy.value||!destination.value||!destinationScope.value)return
 const token=organizationToken(),context=destination.value;const current=()=>organizationCurrent(token)&&destination.value===context
 destinationBusy.value=true;destinationErrors.value=[]
 try{
  await flushDraft();if(!current())return;await loadFolders();if(!current())return;const scope=parseDestinationScope(),target=destinationFolderUid.value?folders.value.find(row=>row.uid===destinationFolderUid.value):null
  if(destinationFolderUid.value&&!target)throw Error('目标目录已不存在，请重新选择')
  if(target&&!sameFolderScope(target,scope))throw Error('目标目录和领域 / 项目不一致，请重新选择')
  if(destination.value.kind==='folder'){
   if(crossScopeFolder.value){
    const root=destination.value.folder,transferTarget={...scope,parentUid:target?.uid||null}
    if(!destinationTransfer.value){const preview=await foldersService.treeTransferPreview(root,transferTarget);if(!current())return;destinationTransfer.value=preview;return}
    const oldScope={areaUid:root.areaUid||null,projectUid:root.projectUid||null},oldParent=root.parentUid||folders.value.find(row=>row.id===root.parentId)?.uid||null
    const result=await foldersService.transferTree(root,transferTarget,destinationTransfer.value);if(!current())return
    await Promise.all([loadFolders(),notesStore.reloadLocal()]);if(!current())return
    folderUndo.value={folderUid:root.uid,parentUid:oldParent,scope:oldScope};organizationResult.value={message:`整棵目录迁移完成：${result.folderCount} 个目录、${result.noteCount} 篇内容`,scope,folderUid:root.uid};destination.value=null;return
   }
   const checked=validateFolderMove(destination.value.folder,target||null,folders.value),oldParent=checked.current.parentUid||folders.value.find(row=>row.id===checked.current.parentId)?.uid||null
   if(oldParent===(target?.uid||null)){destination.value=null;return}
   const saved=await foldersService.move(checked.current,target||null);if(!current())return;await loadFolders();if(!current())return;folderUndo.value={folderUid:saved.uid,parentUid:oldParent};organizationResult.value={message:'目录已移动，可撤销',scope,folderUid:saved.uid};destination.value=null;return
  }
  const items=destination.value.uids.map(uid=>findOrganizationNote(uid)).filter(Boolean) as NoteEntity[]
  if(items.length!==destination.value.uids.length)throw Error('部分笔记已不在当前列表，请刷新后重新选择')
  const result=await runBulkOperation(items,async note=>{
   if(!current())throw Error('页面或账号已切换，本项未移动')
   if(sameFolderScope(note,scope)&&(note.folderUid||folders.value.find(row=>row.id===note.folderId)?.uid||'')===(target?.uid||''))return note
   const saved=await notesStore.updateEntity(note,{...scope,folderId:target?.id||null,folderUid:target?.uid||null});if(!current())return saved;if(!destinationOriginals.has(note.uid))destinationOriginals.set(note.uid,note);return saved
  },{chunkSize:20})
  if(!current())return
  if(destinationOriginals.size)bulkUndo.value={action:'move',items:[...destinationOriginals.values()]}
  destinationErrors.value=result.failed.map(row=>`${row.item.title||'未命名笔记'}：${row.message}`);bulkSelected.value=new Set(result.failed.map(row=>row.item.uid))
  if(result.succeeded.length){rememberDestination();folderUndo.value=undefined;organizationResult.value={message:`本次 ${result.succeeded.length} 项成功，${result.failed.length} 项失败`,scope,folderUid:target?.uid||''}}
  if(result.failed.length)destination.value={kind:'notes',uids:result.failed.map(row=>row.item.uid)};else{destination.value=null;leaveMultiSelect()}
 }catch(error){if(!current())return;destinationErrors.value=[error instanceof Error?error.message:'移动失败，请重试'];if(destination.value?.kind==='folder'&&!pendingFolderTransfer(destination.value.folder.uid)?.sent)destinationTransfer.value=undefined}finally{destinationBusy.value=false}
}
async function undoFolderDestination(){const undo=folderUndo.value;if(!undo||destinationBusy.value)return;const token=organizationToken();destinationBusy.value=true;try{await flushDraft();if(!organizationCurrent(token))return;await loadFolders();if(!organizationCurrent(token))return;const current=folders.value.find(row=>row.uid===undo.folderUid),parent=undo.parentUid?folders.value.find(row=>row.uid===undo.parentUid):null;if(!current||undo.parentUid&&!parent)throw Error('原目录或父目录已不存在，请手动调整');if(undo.scope){destination.value={kind:'folder',folder:current};destinationScope.value=scopeKey(undo.scope);destinationFolderUid.value=parent?.uid||'';destinationErrors.value=[];return}await foldersService.move(current,parent||null);if(!organizationCurrent(token))return;folderUndo.value=undefined;await loadFolders();if(!organizationCurrent(token))return;organizationResult.value=undefined}catch(error){if(organizationCurrent(token))folderError.value=error instanceof Error?error.message:'撤销失败，请重试'}finally{destinationBusy.value=false}}
function revealOrganizationRoute(){const uid=route.query.folder;if(typeof uid!=='string')return;selectedFolderId.value=uid==='none'?'uncategorized':folders.value.find(row=>row.uid===uid)?.id||'all';treeVisible.value=true;listVisible.value=true}
async function viewOrganizationTarget(){const result=organizationResult.value;if(!result)return;dismissOrganizationResult();globalAreaUid.value=result.scope.areaUid||'';const path=result.scope.projectUid?`/projects/${result.scope.projectUid}/notes`:'/notes';if(route.path!==path){await router.push({path,query:{folder:result.folderUid||'none'}});return}selectedFolderId.value=folders.value.find(row=>row.uid===result.folderUid)?.id||'uncategorized';treeVisible.value=true;listVisible.value=true}


function openBulk(action:NoteBulkAction){if(bulkBusy.value)return;if(action==='move'){void openNoteDestination([...bulkItems.value]);return}bulkAction.value=action;bulkFailures.value=[];bulkCompleted.value=0;bulkAreaUid.value=currentProject.value?.areaUid||'';bulkProjectUid.value=currentProject.value?.uid||'';bulkTagId.value=tags.value[0]?.id}
function bulkActionLabel(){return bulkAction.value==='move'?'移动归属':bulkAction.value==='tag'?'添加标签':'归档笔记'}
async function executeBulkNotes(){
  const items=[...bulkItems.value];if(!items.length||!bulkAction.value)return
  const action=bulkAction.value,targetProject=projects.value.find(item=>item.uid===bulkProjectUid.value),targetArea=targetProject?.areaUid||bulkAreaUid.value
  if(action==='move'&&!targetArea){bulkFailures.value=[{item:items[0],message:'请选择目标领域'}];return}
  if(action==='tag'&&!bulkTagId.value){bulkFailures.value=[{item:items[0],message:'请选择标签'}];return}
  bulkBusy.value=true;bulkCompleted.value=0;bulkFailures.value=[]
  const result=await runBulkOperation(items,async note=>{
    if(action==='move')return notesStore.updateEntity(note,{areaUid:targetArea,projectUid:targetProject?.uid||null})
    if(action==='tag'){const tag=tags.value.find(item=>item.id===bulkTagId.value);if(!tag)throw new Error('标签不存在');const uids=[...new Set([...noteTagUids(note,tags.value),tag.uid])];const ids=tags.value.filter(item=>uids.includes(item.uid)).map(item=>item.id);const saved=await foldersService.organize(note,note.folderId||null,ids,uids);await notesStore.acceptServer(saved);return saved}
    return notesStore.updateEntity(note,{status:'archived'})
  },{chunkSize:20,onProgress:done=>bulkCompleted.value=done})
  bulkFailures.value=result.failed;bulkUndo.value={action,items:result.succeeded.map(value=>value.item)};bulkBusy.value=false
  await notesStore.load();bulkSelected.value=new Set(result.failed.map(value=>value.item.uid))
  if(!result.failed.length)bulkAction.value=undefined
}
async function executeQuickBulk(action:'organize'|'pending'|'pin'){
  const items=[...bulkItems.value];if(!items.length||bulkBusy.value)return;bulkBusy.value=true;bulkCompleted.value=0;bulkFailures.value=[]
  const result=await runBulkOperation(items,note=>notesStore.updateEntity(note,action==='pin'?{pinned:true}:{organizationStatus:action==='organize'?'organized':'pending',organizedAt:action==='organize'?new Date().toISOString():null}),{chunkSize:20,onProgress:done=>bulkCompleted.value=done})
  bulkFailures.value=result.failed;bulkUndo.value={action,items:result.succeeded.map(value=>value.item)};bulkBusy.value=false;bulkSelected.value=new Set(result.failed.map(value=>value.item.uid));await notesStore.load()
}
async function undoBulkNotes(){
  const undo=bulkUndo.value;if(!undo||bulkBusy.value)return;const token=organizationToken();bulkBusy.value=true;bulkFailures.value=[];bulkUndoFailures.value=[];bulkCompleted.value=0
  try{await flushDraft();if(!organizationCurrent(token))return;const result=await runBulkOperation(undo.items,async original=>{
    const current=findOrganizationNote(original.uid)||(await notesStore.service().list('archived')).find(item=>item.uid===original.uid)
    if(!organizationCurrent(token))throw new Error('页面或账号已切换，本项未撤销')
    if(!current)throw new Error('笔记已不存在')
    if(undo.action==='tag'){const saved=await foldersService.organize(current,current.folderId||null,original.tagIds||[],noteTagUids(original,tags.value));await notesStore.acceptServer(saved);return saved}
    return notesStore.updateEntity(current,noteUndoChanges(undo.action,original))
  },{chunkSize:20,onProgress:done=>bulkCompleted.value=done})
  if(!organizationCurrent(token))return
  bulkFailures.value=result.failed;bulkUndoFailures.value=result.failed;bulkBusy.value=false;bulkUndo.value=result.failed.length?{...undo,items:result.failed.map(value=>value.item)}:undefined;await notesStore.load()
  }catch(error){if(organizationCurrent(token))bulkUndoFailures.value=undo.items.map(item=>({item,message:error instanceof Error?error.message:'撤销失败，请重试'}))}finally{bulkBusy.value=false}
}
async function regenerateReport(){
  if(isCommunityEdition)return
  if(!selected.value||!reportSeriesUid.value||reportRegenerating.value)return
  reportRegenerating.value=true;reportActionError.value='';clearTimeout(saveTimer)
  try{
    if(draftTitle.value!==selected.value.title||draftContent.value!==selected.value.content)await notesStore.save({title:draftTitle.value.trim()||'未命名笔记',content:draftContent.value})
    const current=notesStore.selected
    if(!current)throw new Error('报告尚未加载')
    const saved=await workspaceService.regenerateReport(reportSeriesUid.value,current.uid,current.version)
    await notesStore.acceptServer({...saved,syncStatus:'synced'})
    reportGeneration.value=await workspaceService.reportGeneration(reportSeriesUid.value,current.uid)
  }catch(source){reportActionError.value=source instanceof Error?source.message:'重新汇总失败'}finally{reportRegenerating.value=false}
}
</script>

<template>
  <DuplicateNotesDialog v-if="duplicateNoteUid" :note-uid="duplicateNoteUid" :owner-id="ownerId" @close="duplicateNoteUid=''" @select="consolidateDuplicates"/>
  <BodyRecoveryDialog v-if="bodyRecoveryNoteUid" :key="`${ownerId}:${bodyRecoveryNoteUid}`" :note-uid="bodyRecoveryNoteUid" :owner-id="ownerId" :folders="folders" :areas="areas" :projects="projects" @close="bodyRecoveryNoteUid=''"/>
  <NoteHistoryDialog v-if="historyNoteUid" :key="`${ownerId}:${historyNoteUid}`" :note-uid="historyNoteUid" :owner-id="ownerId" @close="historyNoteUid=''"/>
  <FolderOrganizationDialog v-if="directoryOrganization" :owner-id="ownerId" :initial-folder-uid="directoryOrganization.folderUid" :initial-area-uid="directoryOrganization.areaUid" :initial-project-uid="directoryOrganization.projectUid" @close="directoryOrganization=undefined" @changed="directoryOrganizationChanged"/>
  <FolderConsolidationDialog v-if="folderPlan" :folder="folderPlan" :folders="scopedFolders" :notes="regularNotes" :busy="folderPlanBusy" :error="folderPlanError" @close="folderPlan=undefined" @select="reviewFolderSelection"/>
  <NoteConsolidationDialog v-if="consolidationOpen" :notes="consolidationSources" :folders="folders" :owner-id="ownerId" @close="consolidationOpen=false" @changed="consolidationChanged"/>
  <NoteCanvasPicker v-if="noteCanvasPickerOpen" :owner-id="ownerId" :area-uid="globalAreaUid" @close="noteCanvasPickerOpen=false" @create="noteCanvasPickerOpen=false;openNoteCanvas()" @select="chooseExistingCanvas"/>
  <NoteCanvasDialog v-if="noteCanvas" :key="noteCanvas.id" :scene="noteCanvas.scene" :busy="noteCanvasBusy" :error="noteCanvasError" @save="saveNoteCanvas" @close="noteCanvas=undefined"/>
  <OrganizationDestinationDialog v-if="destination" :title="destination.kind==='folder'?'移动目录到…':'移动到…'" :current="destinationCurrent" :scopes="destinationScopes" :scope="destinationScope" :targets="destinationTargets" :target="destinationFolderUid" :busy="destinationBusy" :errors="destinationErrors" :impact="destinationImpact" :recent="recentDestinationTargets" :can-create="destination.kind==='notes'" :submit-label="crossScopeFolder?(destinationTransfer?'确认整棵迁移':'预览整棵迁移'):undefined" @scope="changeDestinationScope" @target="value=>destinationFolderUid=value" @submit="submitDestination" @close="destination=null" @create="createDestinationFolder" @clear-recent="clearRecentDestinations"><template #preview><details v-if="destinationTransfer" class="folder-transfer-preview" open><summary>迁移范围 · {{destinationTransfer.folderCount}} 个目录 / {{destinationTransfer.noteCount}} 篇内容</summary><ul><li v-for="row in destinationTransfer.folders.filter(f=>!f.deleted).slice(0,50)" :key="row.uid">{{transferRelativePath(row.uid)}} <small v-if="row.uid===destinationTransfer.rootUid">（整棵迁移的起点）</small></li></ul><p v-if="destinationTransfer.folderCount>50">仅列出前 50 个目录，确认将迁移全部 {{destinationTransfer.folderCount}} 个目录。</p></details></template></OrganizationDestinationDialog>
  <div class="project-note-page" :class="{'is-project':projectUid}">
    <ProjectContextHeader v-if="project&&!route.params.projectUid" show-project-name :project="project" :area-name="projectArea?.name" active-tab="notes" @tab="value=>value==='notes'?undefined:openProjectTab(value)" @status="setProjectStatus" @export="exportProject" />
  <div ref="workspaceElement" class="notes-workspace" :class="{ 'sidebar-floating':sidebarFloating,'sidebar-docked':!sidebarFloating, 'mobile-notes-library':mobileNotePane==='library','mobile-notes-list':mobileNotePane==='list','mobile-notes-editor':mobileNotePane==='editor', 'tree-hidden': !treeVisible || focusReading, 'list-hidden': !listVisible || focusReading, 'project-context': projectUid, 'properties-hidden': sidebarFloating || (!propertiesVisible&&!outlineSidebarVisible) || (propertiesVisible&&!propertiesReady) || !selected || focusReading, 'editor-empty-state': !selected, 'focus-reading':focusReading, dragging, 'tree-dragging':treeDragging }" :style="{'--note-library-width':`${treeWidth}px`}">
    <p v-if="noteDeleteError" class="note-delete-error" role="alert">{{noteDeleteError}} <button type="button" aria-label="关闭删除错误提示" @click="noteDeleteError=''">×</button></p>
    <nav v-if="isCommunityEdition" class="mobile-only mobile-note-switch" aria-label="笔记面板"><button @click="showMobileNotePane('library')" :aria-pressed="mobileNotePane==='library'">笔记库</button><button @click="showMobileNotePane('list')" :aria-pressed="mobileNotePane==='list'">笔记列表</button><button :disabled="!selected" @click="showMobileNotePane('editor')" :aria-pressed="mobileNotePane==='editor'">正文</button></nav>
    <aside v-if="treeVisible && !focusReading" class="note-tree" @contextmenu="blankNoteListMenu">
      <div class="panel-title"><strong>{{projectUid?'项目目录':'笔记库'}}</strong><span class="folder-title-actions"><button class="pc-action pc-action--icon" aria-label="笔记库更多操作" title="笔记库更多操作" @click="openLibraryDownloads"><MoreIcon/></button><button class="folder-create-button" type="button" :title="activeFolder?`在“${activeFolder.name}”中新建`:selectedLibraryAreaUid!==undefined?`在“${selectedLibraryAreaLabel}”中新建`:'新建笔记或目录'" aria-label="新建笔记或目录" @click="openLibraryCreate">＋</button><button class="panel-collapse" type="button" :title="projectUid?'收起项目目录':'收起笔记库'" :aria-label="projectUid?'收起项目目录':'收起笔记库'" @click="treeVisible = false">‹</button></span></div>
      <div class="tree-filter"><span aria-hidden="true">⌕</span><input v-model="folderQuery" placeholder="搜索目录" aria-label="搜索目录"/><button v-if="folderQuery" type="button" title="清空目录搜索" aria-label="清空目录搜索" @click="folderQuery=''">×</button></div>
      <div class="tree-section-title tree-primary-title"><strong>快捷入口</strong></div><ul class="tree-list tree-system-list"><li :class="{active:selectedFolderId==='all'}" @click="selectFolder('all')"><span>▤ {{projectUid?'全部项目笔记':'全部笔记'}}</span><small>{{regularNotes.filter(inGlobalArea).length}}</small></li><li :class="{active:selectedFolderId==='favorites'}" @click="selectFolder('favorites')"><span>☆ 收藏</span><small>{{regularNotes.filter(inGlobalArea).filter(note => note.pinned).length}}</small></li><li :class="{active:selectedFolderId==='uncategorized'}" @click="selectFolder('uncategorized')"><span>◇ 未分类</span><small>{{uncategorizedNoteCount}}</small></li></ul>
      <div class="tree-section-title"><strong>常用标签</strong><button class="tag-manager-trigger" type="button" @click="tagManagerOpen=true">全部标签</button></div><ul class="tree-list tag-tree"><li v-for="tag in visibleTags" :key="tag.uid" :class="{active:selectedTagId===tag.id}" @click="showTagArticles(tag)" @contextmenu="tagContextMenu($event,tag)"><span><i :style="{background:tag.color||'#2F7D5B'}"/># {{tag.name}}</span><small>{{tagNoteCount(tag.id)}}</small><button class="tree-item-delete" type="button" :aria-label="`取消收藏标签 ${tag.name}`" @click.stop="toggleFavoriteTag(tag)">×</button></li></ul>
<div class="tree-section-title tree-folder-title"><strong>目录 <small>{{displayedFolders.length}}</small></strong><span class="folder-tree-controls"><button type="button" :disabled="!displayedFolders.length" :title="folderQuery?'清空目录搜索并展开全部目录':'展开当前范围内的全部目录'" aria-label="全部展开目录" @click="setAllFoldersCollapsed(false)">全部展开</button><button type="button" :disabled="!displayedFolders.length" :title="folderQuery?'清空目录搜索并收起全部目录':'收起当前范围内的全部目录'" aria-label="全部收起目录" @click="setAllFoldersCollapsed(true)">全部收起</button><ElButton v-if="!isCommunityEdition" text size="small" class="folder-tools-more" aria-label="目录更多操作" aria-haspopup="menu" title="目录更多操作" @click="openDirectoryTools"><MoreIcon/></ElButton></span></div><NoteFolderTree :folders="displayedFolders" :selected-id="selectedFolderId" :collapsed-ids="collapsedFolderIds" :counts="folderNoteCounts" :query="folderQuery" :area-groups="groupFoldersByArea?noteAreaGroups:undefined" :expanded-area-ids="expandedLibraryAreaIds" @select-area="selectLibraryArea" @toggle-area="setLibraryAreaCollapsed" @select="folder=>selectFolder(folder.id)" @toggle="setFolderCollapsed" @menu="folderContextMenu" @menu-area="areaContextMenu" @drag-folder="startFolderOrganizeDrag" @drop-folder="dropOrganization"/>
      <div class="tree-section-title"><strong>存档</strong><button class="tree-section-toggle" @click="toggleTreeGroup('archive')">{{treeGroups.archive?'⌃':'⌄'}}</button></div><ul v-if="treeGroups.archive" class="tree-list"><li :class="{active:selectedFolderId==='archived'}" @click="selectFolder('archived')">▣ 归档笔记 <small>{{scopedArchived.length}}</small></li><li class="trash-entry" :class="{active:selectedFolderId==='trash'}" @click="selectFolder('trash')">♲ 回收站 <small>{{scopedTrash.length}}</small></li></ul>
      <p v-if="folderError" class="panel-message error">{{folderError}}</p><p v-else-if="!folders.length" class="panel-message">还没有目录，可以先创建一个。</p>
    </aside>
    <div v-if="treeVisible && !focusReading" class="tree-column-resizer" role="separator" :aria-label="projectUid?'调整项目目录宽度':'调整笔记库宽度'" aria-orientation="vertical" @mousedown="startTreeResize" />

    <section v-if="listVisible && !focusReading" class="note-list-panel" @contextmenu="blankNoteListMenu" :class="{'bulk-mode':multiSelectMode}" :style="{ width: `${listWidth}px` }">
      <header class="note-list-context" :class="{'library-collapsed':!treeVisible}"><button v-if="!treeVisible&&!focusReading" class="note-tree-reopen" type="button" :title="projectUid?'展开项目目录':'展开笔记库'" :aria-label="projectUid?'展开项目目录':'展开笔记库'" @click="treeVisible=true">{{projectUid?'目录':'笔记库'}}</button><button class="note-list-collapse" type="button" title="收起笔记列表" aria-label="收起笔记列表" @click="listVisible=false">‹</button><div class="note-list-heading"><span><strong :title="multiSelectMode?'批量管理':[listPathLabel,listTitle].filter(Boolean).join(' / ')">{{multiSelectMode?'批量管理':listTitle}}</strong><b>{{multiSelectMode?bulkSelected.size:visibleNotes.length}}</b><span class="note-list-load-status" role="status" aria-live="polite"><span v-if="notesStore.loading">更新中…</span></span></span></div><button v-if="!multiSelectMode&&!reportSeriesUid&&!periodFilter&&(canCreateInCurrentScope||showingProjectNotes&&projectFilter!=='all')" class="note-list-create" title="新建笔记" aria-label="新建笔记" @click="createLibraryNote()">＋</button><button v-if="!multiSelectMode&&(visibleNotes.length||!isCommunityEdition)" class="pc-more-trigger note-list-menu" title="更多列表操作" @click="openNoteListActions" aria-label="更多列表操作"><MoreIcon/></button></header>
      <label v-if="activeFolder&&folderHasChildren(activeFolder.id)&&!multiSelectMode" class="folder-scope-bar" title="同时显示当前目录下的子目录笔记"><input v-model="includeSubfolders" type="checkbox"/><span>同时显示子目录笔记</span><small>{{selectedFolderDescendantCount}} 个子目录</small></label>
      <Teleport to="body"><div v-if="listControlOpen==='filter'" ref="listPopover" class="note-list-filter-popover note-list-floating-popover" :style="listPopoverStyle" role="dialog" aria-label="笔记筛选" @click.stop><header><strong>筛选</strong><button aria-label="关闭筛选" @click="listControlOpen=''">×</button></header><section><small>内容类型</small><div class="popover-options"><button :class="{active:!listTypeFilter}" @click="listTypeFilter=''">全部</button><button v-for="(label,type) in noteTypeLabels" :key="type" :class="{active:listTypeFilter===type}" @click="listTypeFilter=type">{{label}}</button></div></section><section><small>文件</small><div class="popover-options"><button :class="{active:!listFileFilter}" @click="listFileFilter=''">不限</button><button :class="{active:listFileFilter==='file'}" @click="listFileFilter='file'">仅文件</button><button :class="{active:listFileFilter==='non_file'}" @click="listFileFilter='non_file'">排除文件</button></div></section><section><small>标签</small><TagFilterPicker :tags="tags" v-model:selected="listTagUids" v-model:mode="listTagMode" /></section><section><small>列表分组</small><div class="popover-options"><button :class="{active:listGroup==='none'}" @click="listGroup='none'">不分组</button><button v-if="!projectUid" :class="{active:listGroup==='project'}" @click="listGroup='project'">项目</button><button :class="{active:listGroup==='type'}" @click="listGroup='type'">类型</button><button :class="{active:listGroup==='month'}" @click="listGroup='month'">月份</button></div></section><footer><button @click="listTypeFilter='';listFileFilter='';listGroup='none';listTagUids=[]">重置</button><button class="primary" @click="listControlOpen=''">完成</button></footer></div></Teleport>

      <label class="panel-search note-list-search">⌕ <input v-model="listQuery" :placeholder="listSearchPlaceholder" aria-label="搜索当前笔记列表" @keydown.enter.prevent="runListSearch" /></label>
      <div v-if="!multiSelectMode" ref="listFilterMenu" class="note-list-control-row note-table-controls">
        <ElSelect v-model="listTypeFilter" size="small" aria-label="按内容类型筛选" placeholder="全部类型" class="note-type-select"><ElOption label="全部类型" value=""/><ElOption v-for="(label,type) in noteTypeLabels" :key="type" :label="label" :value="type"/></ElSelect>
        <ElSelect v-model="listSort" size="small" aria-label="笔记排序" class="note-sort-select"><ElOption label="更新时间 ↓" value="updated_desc"/><ElOption label="更新时间 ↑" value="updated_asc"/><ElOption label="标题 A → Z" value="title_asc"/></ElSelect>
        <button ref="listFilterButton" type="button" class="note-tags-filter pc-action pc-action--secondary" aria-haspopup="dialog" :class="{active:listControlOpen==='filter'||listTagUids.length}" :aria-expanded="listControlOpen==='filter'" @click.stop="toggleListControl('filter')"><span>{{listTagUids.length?`标签 ${listTagUids.length}`:'全部标签'}}</span><span aria-hidden="true">⌄</span></button>
        <ElButton class="note-density-button" size="small" title="列表显示选项" aria-label="列表显示选项" aria-haspopup="menu" @click="openListDisplayOptions">☷</ElButton>
      </div>
      <div v-if="!multiSelectMode&&activeFilterCount" class="note-active-filters"><button v-if="listTypeFilter" @click="listTypeFilter=''">类型：{{noteTypeLabels[listTypeFilter]||listTypeFilter}} ×</button><button v-if="listFileFilter" @click="listFileFilter=''">{{listFileFilter==='file'?'仅文件':'排除文件'}} ×</button><button v-if="listTagUids.length" @click="listTagUids=[]">标签：{{listTagUids.length}} 个 · {{listTagMode==='all'?'匹配全部':'匹配任一'}} ×</button><button v-if="listGroup!=='none'" @click="listGroup='none'">分组：{{({project:'项目',type:'类型',month:'月份'} as Record<string,string>)[listGroup]}} ×</button><a @click="listTypeFilter='';listFileFilter='';listGroup='none';listTagUids=[]">清空</a></div>
      <button v-if="selectedFolderId==='trash'&&scopedTrash.length" class="trash-clear-button" :disabled="isCommunityEdition||trashClearBusy" :title="isCommunityEdition?'社区存储暂不支持永久删除，可保留或恢复回收站记录':undefined" @click="emptyTrash">清空回收站</button>
      <div v-if="multiSelectMode" class="note-list-bulk-toolbar"><label class="bulk-select-all"><input type="checkbox" :disabled="bulkBusy" :checked="displayedNotes.length>0&&displayedNotes.every(note=>bulkSelected.has(note.uid))" :indeterminate="bulkSelected.size>0&&!displayedNotes.every(note=>bulkSelected.has(note.uid))" @change="displayedNotes.forEach(note=>toggleBulkNote(note.uid,($event.target as HTMLInputElement).checked))">全选</label><button :disabled="bulkBusy||!bulkSelected.size" @click="openBulk('move')">移动</button><button v-if="!isCommunityEdition" :disabled="bulkBusy||bulkSelected.size<2" aria-label="整合笔记" title="整合所选笔记" @click="openConsolidation">整合</button><button :disabled="bulkBusy||!bulkSelected.size" aria-label="更多批量操作" aria-haspopup="menu" @click="openBulkMore">更多</button><button :disabled="bulkBusy" @click="leaveMultiSelect">完成</button></div>
      <div v-if="bulkUndoFailures.length" class="panel-message error" role="alert"><p v-for="failure in bulkUndoFailures" :key="failure.item.uid">{{failure.item.title}}：{{failure.message}}</p><button :disabled="bulkBusy" @click="undoBulkNotes">重试撤销失败项</button></div>
      <div v-if="organizationResult" class="panel-message organization-result" @mouseenter="holdOrganizationNotice('hover',true)" @mouseleave="holdOrganizationNotice('hover',false)" @focusin="holdOrganizationNotice('focus',true)" @focusout="holdOrganizationNotice('focus',false)"><span role="status">{{organizationResult.message}}</span><div class="organization-result-actions"><ElButton text size="small" :disabled="destinationBusy" @click="viewOrganizationTarget">查看目标</ElButton><ElButton v-if="folderUndo" text size="small" :disabled="destinationBusy" @click="undoFolderDestination">{{folderUndo.scope?'移回原位置…':'撤销目录移动'}}</ElButton><ElButton text size="small" :disabled="destinationBusy" aria-label="关闭移动结果提示" @click="dismissOrganizationResult">关闭</ElButton></div></div>
      <div class="note-table-header note-table-grid" aria-label="笔记列表列标题"><span aria-label="类型"/><span>标题</span><span class="note-tags-heading">标签</span><button type="button" class="note-date-heading" :aria-label="listSort==='updated_asc'?'按更新时间降序':'按更新时间升序'" @click="listSort=listSort==='updated_asc'?'updated_desc':'updated_asc'">更新日期 <span aria-hidden="true">{{listSort==='updated_asc'?'↑':listSort==='updated_desc'?'↓':'⌄'}}</span></button></div>
      <p v-if="folderError" class="panel-message error" role="alert">{{folderError}}</p>
      <p v-if="listQuery.trim()" class="panel-message" role="status">{{listSearching?'正在搜索…':`找到 ${searchedNotes.length} 篇`}}</p>
      <p v-if="notesStore.syncError" class="panel-message" :class="{error:notesStore.syncPhase!=='syncing'}" role="status" aria-live="polite">{{notesStore.syncPhase==='syncing'?'正在重新同步，本机修改已保留。':notesStore.syncPhase==='offline'?'当前离线，本机修改已保留，联网后将重试。':'同步暂未完成，本机修改已保留。'}} <span :title="notesStore.syncError">{{notesStore.syncError}}</span> <button type="button" :disabled="!online||notesStore.syncPhase==='syncing'" @click="notesStore.runSync({force:true})">重新同步</button></p>
      <p v-if="notesStore.error" class="panel-message error" role="alert">{{notesStore.error}} <button type="button" :disabled="notesStore.loading" @click="notesStore.invalidate();notesStore.load()">重试加载</button></p>
      <div v-else-if="!visibleNotes.length" class="panel-message note-list-empty-state"><span>{{notesStore.loading?'正在准备列表…':emptyScopeLabel}}</span></div>
      <p v-else-if="!displayedNotes.length" class="panel-message">没有匹配的笔记。</p>
      <template v-for="(note,index) in displayedNotes" :key="note.uid"><h3 v-if="listGroup!=='none'&&(index===0||noteGroupLabel(displayedNotes[index-1])!==noteGroupLabel(note))" class="note-list-group-title">{{noteGroupLabel(note)}}</h3><article class="note-table-row" tabindex="0" @keydown.enter.self="openNoteRow(note);mobileNotePane='editor'" :class="{ active: !multiSelectMode&&notesStore.selectedUid === note.uid, 'bulk-selected':bulkSelected.has(note.uid) }" :draggable="!note.deleted&&!isPeriodicNote(note)" @dragstart="startNoteOrganizeDrag($event,note)" @click="openNoteRow(note);mobileNotePane='editor'" @contextmenu="noteContextMenu($event,note)"><input v-if="multiSelectMode" class="note-bulk-check" type="checkbox" :checked="bulkSelected.has(note.uid)" :aria-label="`选择 ${note.title||'未命名笔记'}`" @click.stop @change="toggleBulkNote(note.uid,($event.target as HTMLInputElement).checked)"/>
        <NoteListRowContent :title="note.title" :icon="contentTypeIcon(note)" :icon-class="contentTypeClass(note)" :type-label="contentTypeLabel(note)" :updated-label="noteListUpdatedDate(note.updatedAt)" :updated-at="note.updatedAt" :tags="tags.filter(tag=>noteHasTag(note,tag))" @tag="uid=>{listTagUids=[uid];listTagMode='any'}" :sync-status="note.syncStatus" :preview="noteListPreview(note,listQuery,showListSummary)" :directory-path="showListPath&&selectedFolderId==='all'&&(!projectFilter||projectFilter==='all')&&!selectedTagId&&!projectUid&&!reportSeriesUid&&!periodFilter&&!smartFilter?noteDirectoryPath(note,folders):undefined"/>
      </article></template>
      <button v-if="displayedNotes.length<searchedNotes.length" class="note-list-more" @click="listLimit+=50">加载更多（剩余 {{searchedNotes.length-displayedNotes.length}} 篇）</button>
    </section>
    <div v-if="listVisible && !focusReading" class="column-resizer" role="separator" @mousedown="startResize" />

    <section class="note-editor" :class="{'preview-mode':editorMode==='preview','file-mode':selectedIsFile,'pdf-mode':selectedIsPdfPreview}">
      <div v-if="selected" class="editor-tabs"><button v-if="!focusReading&&!treeVisible&&!listVisible" type="button" :title="projectUid?'展开项目目录':'展开笔记库'" :aria-label="projectUid?'展开项目目录':'展开笔记库'" @click="treeVisible = true">☰ {{projectUid?'项目目录':'笔记库'}}</button><button v-if="!focusReading&&!listVisible" type="button" title="展开笔记列表" aria-label="展开笔记列表" @click="listVisible=true">☷ 笔记列表</button><div v-if="!selectedIsFile" class="editor-mode-switch" aria-label="编辑器显示模式"><button v-for="mode in ([['edit','编辑'],['split','分屏'],['preview','预览']] as const)" :key="mode[0]" type="button" :class="{active:editorMode===mode[0]}" :aria-pressed="editorMode===mode[0]" @click="editorMode=mode[0]">{{mode[1]}}</button></div><button v-if="reportSeriesUid&&!selected.deleted" class="context-focus-button" :disabled="isCommunityEdition||reportRegenerating||!online" :title="isCommunityEdition?'社区版保留报告内容，自动汇总由私有组件提供':online?'仅更新自动汇总区块，保留手写内容':'重新汇总需要联网'" @click="regenerateReport">{{reportRegenerating?'汇总中…':'↻ 重新汇总'}}</button><i/><div class="editor-right-controls"><ReaderFindBar v-if="!selectedIsFile&&editorReady&&editorMode!=='edit'" content-selector=".note-reading-search-content" :document-key="outlineNoteKey"/><div v-if="documentStatusText" class="editor-state" :class="{failed:documentStatusError}" :title="documentStateLabel" role="status" :aria-label="documentStateLabel" aria-live="polite"><span v-if="documentStatusText">{{documentStatusText}}</span><button v-if="notesStore.syncPhase==='error'" type="button" :disabled="!online" @click="notesStore.runSync()">重新同步</button></div><div v-if="!focusReading" class="editor-sidebar-controls" role="group" aria-label="笔记侧栏显示"><button v-if="!selectedIsFile&&editorMode!=='edit'" ref="outlineButton" class="editor-sidebar-button" type="button" :aria-pressed="outlineSidebarVisible&&!propertiesVisible" :title="outlineSidebarVisible&&!propertiesVisible?'收起大纲':'展开大纲'" @click="toggleOutlineSidebar">大纲</button><button ref="infoButton" class="editor-sidebar-button" type="button" :aria-pressed="propertiesVisible" :title="propertiesVisible?'收起笔记信息':'展开笔记信息'" :aria-label="propertiesVisible?'收起笔记信息':'展开笔记信息'" @click="toggleNoteInfo">信息</button></div></div></div>
      <div v-if="selected&&!selectedIsFile&&editorMode!=='preview'" class="editor-toolbar"><label v-if="editorMode==='edit'" class="editor-render-toggle" title="开启后直接显示图片和 Markdown 格式；关闭后显示源码"><input v-model="instantRendering" type="checkbox" role="switch" aria-label="即时渲染">即时渲染</label><button title="撤销" @click="format('undo')">↶</button><button title="重做" @click="format('redo')">↷</button><select title="段落格式" @change="markdownEditor?.setHeading(Number(($event.target as HTMLSelectElement).value))"><option value="0">正文</option><option value="1">标题 1</option><option value="2">标题 2</option><option value="3">标题 3</option></select><button title="粗体" @click="format('bold')"><b>B</b></button><button title="斜体" @click="format('italic')"><i>I</i></button><button title="链接" @click="format('link')">⌁</button><button title="无序列表" @click="format('list')">≡</button><button title="有序列表" @click="format('ordered')">☷</button><button title="引用" @click="format('quote')">“</button><button type="button" :disabled="attachmentBusy||selected.deleted" @click="noteCanvasPickerOpen=true">＋ 插入画布</button><label class="editor-file-action" title="添加图片、音频或文件">＋ 附件<input type="file" multiple :disabled="attachmentBusy" @change="addAttachment"></label></div>
      <div class="editor-scroll-area"><p v-if="attachmentError" role="alert" class="panel-message error">{{attachmentError}}</p>
      <article v-if="selected" class="editor-document real-editor-document" :class="[`mode-${editorMode}`,{'file-document':selectedIsFile}]">
        <p v-if="notesStore.saveError&&notesStore.hasPendingSaves()" class="panel-message error" role="alert">{{notesStore.saveError}} <button type="button" @click="flushDraft().catch(()=>undefined)">重试保存</button></p>
        <header v-if="!selectedIsFile" class="note-document-header" :class="{'has-type-icon':selected.type==='mindmap'}">
          <div class="note-document-title">
            <span v-if="selected.type==='mindmap'" class="note-title-type" :title="contentTypeLabel(selected)" role="img" :aria-label="contentTypeLabel(selected)">{{contentTypeIcon(selected)}}</span>
            <NoteTitleInput v-model="draftTitle" :readonly="selected.deleted||editorMode==='preview'" @submit="markdownEditor?.focus()"/>
            <div class="note-document-actions">
              <ElButton ref="titleTagsButton" text size="small" class="note-tag-toggle" :aria-expanded="titleTagsOpen" aria-controls="note-title-tags" @click="titleTagsOpen=!titleTagsOpen">标签 {{selectedTags.length+unknownSelectedTagUids.length}}</ElButton>
              <button v-if="!selected.deleted" class="note-title-favorite pc-action pc-action--icon" type="button" :class="{active:selected.pinned}" :title="selected.pinned?'取消收藏':'收藏笔记'" :aria-label="selected.pinned?'取消收藏':'收藏笔记'" :aria-pressed="Boolean(selected.pinned)" @click="notesStore.togglePinned(selected)"><StarFilled v-if="selected.pinned" aria-hidden="true"/><Star v-else aria-hidden="true"/></button>
              <button class="pc-more-trigger note-title-more pc-action pc-action--icon" type="button" title="更多笔记操作" aria-label="更多笔记操作" aria-haspopup="menu" @click="openNoteActions"><MoreIcon/></button>
            </div>
          </div>
          <div v-if="titleTagsOpen" id="note-title-tags" class="note-title-tags" role="group" aria-label="笔记标签" @keydown.esc.prevent.stop="closeTitleTags">
            <p v-if="!selectedTags.length&&!unknownSelectedTagUids.length" class="note-tags-empty">暂无标签</p>
            <span v-for="tag in selectedTags" :key="tag.uid" class="note-tag-chip"><button class="pc-action pc-action--text" type="button" @click="showTagArticles(tag)"># {{tag.name}}</button><button v-if="!selected.deleted" class="pc-action pc-action--icon" type="button" :aria-label="`移除标签 ${tag.name}`" @click="toggleTag(tag.id,false)">×</button></span>
            <span v-for="uid in unknownSelectedTagUids" :key="uid" class="note-tags-pending" title="关联已保留，等待标签元数据同步">标签信息待同步</span>
            <ElButton v-if="!selected.deleted" text size="small" @click="tagPickerOpen=true">＋ 添加标签</ElButton>
          </div>
        </header>
        <MarkdownDocumentBody :mode="editorMode">
          <FileContentPreview v-if="selectedIsFile&&selectedFileInlinePreview&&selectedFileAttachment" :owner-id="ownerId" :item="selectedFileAttachment" :show-filename="selectedIsPdfPreview||selectedFileAttachment.originalFilename!==selected.title"/>
          <section v-else-if="selectedIsFile" class="file-content-card"><span class="file-content-icon" :class="contentTypeClass(selected)">{{contentTypeIcon(selected)}}</span><div><strong>{{fileKindLabel(selected)}} 文件</strong><p>{{selected.fileName||selected.title}}</p><small>{{inferredFileMediaType(selected)}}<template v-if="selected.sizeBytes"> · {{Math.ceil(selected.sizeBytes/1024)}} KB</template></small><small v-if="!legacyFileAttachmentUid(selected)" class="file-content-warning">文件内容尚未关联，当前只有文件元数据</small></div><button class="primary-action" :disabled="!legacyFileAttachmentUid(selected)" @click="openFileItem()">{{legacyFileAttachmentUid(selected)?(isDesktopClient()?'用默认程序打开':'下载或打开'):'文件不可用'}}</button></section>
          <div v-else-if="!editorReady" class="editor-deferred-placeholder" aria-label="正在准备编辑器"><i/><i/><i/></div>
          <MarkdownEditor v-else v-show="editorMode!=='preview'" ref="markdownEditor" v-model="draftContent" :readonly="selected.deleted" :live-preview="editorMode!=='split'&&instantRendering" :owner-id="ownerId" @attachment-files="addFiles" @canvas-edit="openNoteCanvas" @linked-canvas-open="openLinkedNoteCanvas" />
          <MarkdownPreview class="note-reading-search-content" ref="markdownPreview" v-if="!selectedIsFile&&editorReady&&previewInitialized" v-show="editorMode!=='edit'" :active="editorMode!=='edit'" :content="draftContent" @outline-change="previewHeadings=$event" @outline-active="activePreviewHeading=$event" :owner-id="ownerId" :note-uid="selected.uid" :fragment="noteLinkFragment" @note-link="openImportedNoteLink" @canvas-edit="openNoteCanvas" @linked-canvas-open="openLinkedNoteCanvas" /><p v-if="noteLinkError" class="property-empty" role="alert">{{noteLinkError}}</p>
        </MarkdownDocumentBody>
      </article>
      <div v-else-if="currentProject&&projectFilter!=='all'&&(projectUid||projectFilter)" class="editor-empty project-note-empty"><span class="project-note-empty-icon">▤</span><strong>还没有笔记</strong><p>记录项目方案、会议纪要、决策和过程文档。</p><button class="primary-action" @click="createProjectNote">＋ 新建笔记</button></div>
      <div v-else class="editor-empty"><strong>{{showingProjectNotes?'还没有项目笔记':selectedFolderId==='all'?'选择或创建一篇笔记':emptyScopeLabel}}</strong><p>{{showingProjectNotes?'请先进入一个项目，再创建项目笔记。':selectedFolderId==='all'?(isCommunityEdition?'内容保存在本机，可随时导出完整备份。':'内容会先保存在本机，然后通过同步协议上传。'):emptyScopeHelp}}</p><div class="editor-empty-actions"><button v-if="!treeVisible&&!listVisible&&!focusReading" :aria-label="projectUid?'展开项目目录':'展开笔记库'" @click="treeVisible=true">{{projectUid?'展开项目目录':'展开笔记库'}}</button><button v-if="selectedFolderId!=='all'" @click="selectFolder('all')">查看全部笔记</button><button v-if="canCreateInCurrentScope&&!reportSeriesUid&&!showingProjectNotes" class="primary-action" @click="createNote">{{selectedFolderId==='all'?'新建笔记':selectedLibraryAreaUid!==undefined?'在此领域新建':'在此目录新建'}}</button><button v-else-if="showingProjectNotes" class="primary-action" @click="router.push('/projects')">查看项目</button></div></div>
      </div>
      <footer v-if="selected&&!selectedIsPdfPreview" class="editor-status"><span>{{selected.title||'未命名笔记'}}</span><span>{{selectedIsFile?`${fileKindLabel(selected)} 文件${selected.sizeBytes?` · ${Math.ceil(selected.sizeBytes/1024)} KB`:''}`:`Markdown · ${draftContent.length} 字`}}</span></footer>
    </section>

    <button v-if="sidebarFloating&&(outlineSidebarVisible||propertiesVisible&&propertiesReady)&&selected&&!focusReading" class="note-sidebar-dismiss" type="button" tabindex="-1" aria-label="关闭笔记侧栏" @click="closeFloatingSidebar"/>
    <Transition name="note-sidebar" mode="out-in">
    <aside v-if="outlineSidebarVisible&&!propertiesVisible" key="outline" class="note-properties note-outline-sidebar" aria-label="笔记大纲">
      <div class="panel-title"><strong>大纲</strong><span class="outline-header-actions"><ElButton text size="small" aria-label="大纲更多操作" aria-haspopup="menu" title="大纲更多操作" @click="openOutlineActions"><MoreIcon/></ElButton><button class="panel-collapse" type="button" title="收起大纲" aria-label="收起大纲" @click="closeOutline">›</button></span></div>
      <label class="note-outline-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input v-model="noteOutlineQuery" type="search" aria-label="搜索笔记大纲" placeholder="筛选标题"/></label>
      <p v-if="noteOutlineQuery.trim()&&!filteredNoteOutline.length" class="workspace-outline-empty" role="status">没有匹配的大纲标题</p>
      <nav v-if="previewHeadings.length" class="workspace-outline-nav" aria-label="笔记标题导航">
        <div v-for="heading in filteredNoteOutline" :key="heading.key" class="workspace-outline-row" :class="{active:heading.index===noteOutline.activeIndex.value}" :style="{'padding-inline-start':`${4+heading.depth*12}px`}">
          <button v-if="heading.hasChildren&&!noteOutlineQuery.trim()" class="outline-branch-toggle pc-action pc-action--text" type="button" :aria-expanded="!noteOutline.collapsed.value.has(heading.key)" :aria-label="`${noteOutline.collapsed.value.has(heading.key)?'展开':'收起'}${heading.text}的子标题`" @click="noteOutline.toggle(heading)"><svg viewBox="0 0 16 16" aria-hidden="true"><path :d="noteOutline.collapsed.value.has(heading.key)?'m6 4 4 4-4 4':'m4 6 4 4 4-4'"/></svg></button>
          <span v-else class="outline-branch-spacer" aria-hidden="true"/>
          <button class="outline-heading-link" type="button" :aria-current="heading.index===noteOutline.activeIndex.value?'location':undefined" :title="heading.text" @click="selectOutlineHeading(heading.index)">{{heading.text}}</button>
        </div>
      </nav>
      <p v-else class="workspace-outline-empty">{{hasAutomaticNoteOutline(draftContent)?'正在生成大纲…':'正文中暂无标题'}}</p>
    </aside>
    <aside v-else-if="selected&&propertiesVisible&&propertiesReady&&!focusReading" key="info" class="note-properties">
      <div class="panel-title"><strong>笔记信息</strong><button class="panel-collapse" type="button" title="收起笔记信息" aria-label="收起笔记信息" @click="closeNoteInfo">›</button></div>

      <details v-if="reportSeriesUid" class="property-disclosure"><summary>报告生成</summary><div class="property-section-body"><p v-if="reportActionError" class="property-empty">{{reportActionError}}</p><dl v-if="reportGeneration"><div><dt>系列</dt><dd>{{reportGeneration.seriesName}}</dd></div><div><dt>生成时间</dt><dd>{{reportGeneration.generatedAt?new Date(reportGeneration.generatedAt).toLocaleString('zh-CN'):'-'}}</dd></div><div><dt>来源</dt><dd>{{reportGeneration.sources.length}} 项</dd></div></dl><div v-if="reportGeneration?.sources.length" class="report-source-references"><span v-for="source in reportGeneration.sources" :key="source.uid" :title="source.sourceUid"><b>{{({task:'任务',note:'笔记',focus_session:'专注',project_log:'日志'} as const)[source.sourceType]}}</b>{{source.sourceLabel||source.sourceUid}}</span></div><button class="property-action" :disabled="isCommunityEdition||reportRegenerating||!online" :title="isCommunityEdition?'社区版保留报告内容，自动汇总由私有组件提供':undefined" @click="regenerateReport">{{reportRegenerating?'正在重新汇总…':'重新汇总自动区块'}}</button></div></details>

      <details class="property-disclosure"><summary>关联内容 <small>{{noteLinks.length}}</small></summary><div class="property-section-body"><p v-if="linkError" class="property-empty">{{linkError}}</p><p v-else-if="!noteLinks.length" class="property-empty">暂无关联与反向链接</p><div v-for="link in noteLinks" :key="link.uid" class="property-attachment"><button @click="revealRequestedNote(linkedNote(link).uid)">{{linkedNote(link).backlink?'←':'→'}} {{linkedNote(link).title}}</button><small>{{link.linkType==='source'?'来源':link.linkType==='follow_up'?'后续':'相关'}}{{linkedNote(link).backlink?' · 反向链接':''}}</small><button class="danger-text" @click="removeNoteLink(link)">移除</button></div><button class="property-action" :disabled="!selected||(!isCommunityEdition&&!online)" @click="addNoteLink">＋ 添加关联</button></div></details>
      <details class="property-disclosure"><summary>附件 <small>{{propertyAttachmentCount}}</small><small v-if="attachmentError" class="property-error-indicator">需处理</small></summary><div class="property-section-body"><p v-if="attachmentError" class="property-empty">{{attachmentError}}</p><p v-else-if="!attachments.length&&!localAttachmentRows.length" class="property-empty">暂无附件</p><div v-for="item in localAttachmentRows.filter(value=>value.status!=='uploaded'&&value.status!=='local')" :key="item.uid" class="property-attachment"><b>{{item.name}}</b><small>{{Math.ceil(item.sizeBytes/1024)}} KB · {{({local:'仅本机',pending:'待上传',uploading:'上传中',uploaded_needs_link:'等待写回',failed:'上传失败'} as Record<string,string>)[item.status]||item.status}}</small><p v-if="item.lastError">{{item.lastError}}</p><div><button v-if="item.status==='failed'" @click="retryLocal(item)">重试</button><button @click="removeLocal(item)">移除</button></div></div><div v-for="item in attachments" :key="item.uid" class="property-attachment"><button @click="openAttachment(item)">{{item.mediaType?.startsWith('image/')?'图片':item.mediaType?.startsWith('audio/')?'音频':'文件'}} · {{item.originalFilename}}</button><small>{{Math.ceil(item.sizeBytes/1024)}} KB</small><div><button @click="openAttachment(item)">预览</button><button @click="removeAttachmentReference(item)">移除引用</button><button class="danger-text" @click="removeAttachmentFile(item)">删除文件</button></div></div></div></details>
            <details open class="property-disclosure"><summary>详细信息</summary><div class="property-section-body"><dl><div><dt>类型</dt><dd>{{noteTypeLabels[selected.type||'note']||contentTypeLabel(selected)}}</dd></div><div><dt>标签</dt><dd><span v-for="tag in selectedTags" :key="tag.uid" class="property-tag-name"># {{tag.name}}</span><span v-if="unknownSelectedTagUids.length">{{unknownSelectedTagUids.length}} 个标签信息待同步</span><span v-if="!selectedTags.length&&!unknownSelectedTagUids.length">未设置标签</span><ElButton v-if="!selected.deleted" text size="small" @click="tagPickerOpen=true">管理标签</ElButton></dd></div><div><dt>领域</dt><dd>{{selectedAreaMetadata?.name||'未设置领域'}}</dd></div><div><dt>项目</dt><dd>{{selectedProjectMetadata?.name||'未关联项目'}}</dd></div><div><dt>目录</dt><dd><select :value="selectedFolderValue" :disabled="!selected||selected.deleted" @change="moveSelected"><option value="">未设置目录</option><option v-for="folder in legalFolderRows" :key="folder.id" :value="folder.id">{{'　'.repeat(folder.depth)}}{{folder.name}}</option></select><small v-if="selected?.folderUid&&!selectedFolderMetadata" class="property-reference-warning">目录元数据尚未同步（{{selected.folderUid}}）</small></dd></div><div><dt>状态</dt><dd>{{ selected?.deleted?'回收站':selected?.status==='archived'?'已归档':'正常' }}</dd></div><div><dt>版本</dt><dd>{{ selected?.version ?? '本地新建' }}</dd></div><div><dt>创建时间</dt><dd>{{fullTime(selected.createdAt)}}</dd></div><div><dt>更新时间</dt><dd>{{fullTime(selected.updatedAt)}}</dd></div><div><dt>同步</dt><dd>{{documentStateLabel}}</dd></div></dl></div></details>
      <details class="property-disclosure"><summary>更多操作</summary><div class="property-section-body"><button class="property-action" :disabled="!selected||downloadBusy||!!selected.deleted" @click="selected&&downloadNoteScope({noteUid:selected.uid})">下载文件（Markdown + 元数据）</button><button v-if="!isCommunityEdition&&selected&&isRegularNote(selected)" class="property-action" @click="openHistory">历史版本</button><button v-if="!isCommunityEdition&&selected&&!selected.deleted&&selected.syncStatus==='pending'" class="property-action" @click="bodyRecoveryNoteUid=selected.uid">处理正文同步</button><div class="property-action-group"><p class="property-empty">{{intelligenceMessage|| (selected?.organizationStatus==='organized'?'已整理':selected?.organizationStatus==='inbox'?'来自收集箱':'等待整理')}}</p><button v-if="selected?.organizationStatus!=='organized'" class="property-action" :disabled="!selected" @click="setSelectedOrganization('organized')">✓ 整理完成</button><button v-else class="property-action" :disabled="!selected" @click="setSelectedOrganization('pending')">稍后整理</button><button class="property-action" :disabled="isCommunityEdition||!selected||!online||intelligenceBusy" @click="findDuplicates">检测重复笔记</button><button class="property-action" :disabled="isCommunityEdition||!selected||!online||intelligenceBusy" :title="isCommunityEdition?'社区版未启用 AI 服务':undefined" @click="suggestOrganization">AI 整理建议</button><button v-if="!isCommunityEdition" class="property-action" :disabled="!selected||!online||intelligenceBusy" @click="extractKnowledge">提炼为知识笔记</button></div><div class="property-action-group"><template v-if="selected?.deleted"><p class="property-empty">回收站中的笔记为只读。</p><button class="property-action" @click="restoreSelected">恢复笔记</button><button class="danger-text" :disabled="isCommunityEdition||trashClearBusy" :title="isCommunityEdition?'社区存储暂不支持永久删除':undefined" @click="purgeNote()">永久删除</button></template><template v-else-if="selected?.status==='archived'"><p class="property-empty">该笔记已归档。</p><button class="property-action" @click="restoreArchived">移回全部笔记</button></template><template v-else><button v-if="selected?.projectUid" class="property-action" @click="openSelectedProject">打开所属项目</button><button class="property-action" :disabled="!selected||downloadBusy" @click="selected&&downloadNoteScope({noteUid:selected.uid})">导出当前笔记 ZIP</button><button class="property-action" :disabled="!selected" @click="selected&&notesStore.togglePinned(selected)">{{selected?.pinned?'★ 取消收藏':'☆ 添加收藏'}}</button><button class="danger-text" :disabled="!selected" @click="moveNoteToTrash()">移入回收站</button></template></div></div></details>
    </aside>
    </Transition>
    <div v-if="bulkUndo" class="bulk-actions"><span>批量操作已完成</span><button :disabled="bulkBusy" @click="undoBulkNotes">撤销上次操作</button></div>
    <div v-if="tagManagerOpen" class="pc-modal-backdrop" @click.self="tagManagerOpen=false"><section class="pc-task-dialog tag-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="tag-manager-title"><div class="section-heading"><div><h2 id="tag-manager-title">全部标签</h2><p>{{projectUid?'当前项目':globalAreaUid?'当前领域（含项目）':'全部领域'}}的活跃文章；点击主题查看相关文章。</p></div><button type="button" aria-label="关闭标签管理" @click="tagManagerOpen=false">×</button></div><label>查找标签<input v-model="tagManagerQuery" placeholder="搜索主题名称"/></label><div class="tag-manager-list"><article v-for="tag in matchingTags(tagManagerQuery)" :key="tag.uid"><button type="button" :aria-label="`${favoriteTagUids.includes(tag.uid)?'取消收藏':'收藏'}标签 ${tag.name}`" :aria-pressed="favoriteTagUids.includes(tag.uid)" @click="toggleFavoriteTag(tag)">{{favoriteTagUids.includes(tag.uid)?'★':'☆'}}</button><button type="button" class="tag-manager-name" @click="showTagArticles(tag)"># {{tag.name}}</button><small>{{tagNoteCount(tag.id)}} 篇</small><button type="button" @click="renameTag(tag)">重命名</button><button type="button" class="danger-text" @click="deleteTag(tag)">删除</button></article><p v-if="!matchingTags(tagManagerQuery).length" class="property-empty">没有匹配的标签</p></div><div class="dialog-actions"><button type="button" @click="createTag">＋ 新建标签</button><button type="button" @click="tagManagerOpen=false">完成</button></div></section></div>
    <div v-if="tagPickerOpen&&selected&&!selected.deleted" class="pc-modal-backdrop" @click.self="tagPickerOpen=false"><section class="pc-task-dialog tag-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="tag-picker-title"><div class="section-heading"><h2 id="tag-picker-title">添加标签</h2><button type="button" aria-label="关闭添加标签" @click="tagPickerOpen=false">×</button></div><input v-model="tagPickerQuery" placeholder="搜索或输入新标签" aria-label="文章标签搜索"/><div class="tag-picker-options"><label v-for="tag in matchingTags(tagPickerQuery)" :key="tag.uid"><input type="checkbox" :checked="noteHasTag(selected,tag)" @change="toggleTag(tag.id,($event.target as HTMLInputElement).checked)"/><span># {{tag.name}}</span></label></div><button v-if="tagPickerQuery.trim()&&!tags.some(tag=>tag.name===tagPickerQuery.trim())" type="button" @click="createAndAssignTag">创建并添加“{{tagPickerQuery.trim()}}”</button><p v-if="folderError" class="panel-message error">{{folderError}}</p><div class="dialog-actions"><button type="button" @click="tagPickerOpen=false">完成</button></div></section></div>
    <div v-if="bulkAction" class="pc-modal-backdrop" @click.self="!bulkBusy&&(bulkAction=undefined)"><section class="pc-task-dialog bulk-dialog" role="dialog" aria-modal="true"><div class="section-heading"><div><h2>{{bulkActionLabel()}}</h2><p>将处理 {{bulkItems.length}} 篇笔记；每篇独立执行，失败项不会影响已成功项目。</p></div><button :disabled="bulkBusy" @click="bulkAction=undefined">×</button></div><template v-if="bulkAction==='move'"><label>目标领域<select v-model="bulkAreaUid" @change="bulkProjectUid=''" required><option disabled value="">请选择领域</option><option v-for="area in areas" :key="area.uid" :value="area.uid">{{area.name}}</option></select></label><label>目标项目<select v-model="bulkProjectUid"><option value="">不归属项目</option><option v-for="item in bulkTargetProjects" :key="item.uid" :value="item.uid">{{item.name}}</option></select></label><p class="bulk-impact">移动后会清除不再合法的目录归属；标题、正文和标签保持不变。</p></template><template v-else-if="bulkAction==='tag'"><label>添加标签<select v-model.number="bulkTagId"><option v-for="tag in tags" :key="tag.id" :value="tag.id">{{tag.name}}</option></select></label><p class="bulk-impact">保留已有标签并追加所选标签。桌面端离线更改会在联网后同步。</p></template><p v-else class="bulk-impact">归档后笔记从当前列表隐藏，可在归档范围中恢复；不会移入回收站。</p><div v-if="bulkBusy" class="bulk-progress"><i :style="{width:`${bulkItems.length?bulkCompleted/bulkItems.length*100:0}%`}"/><span>已处理 {{bulkCompleted}} / {{bulkItems.length}}</span></div><div v-if="bulkFailures.length" class="bulk-failures"><strong>{{bulkFailures.length}} 项失败</strong><span v-for="failure in bulkFailures.slice(0,8)" :key="failure.item.uid">{{failure.item.title||'未命名笔记'}}：{{failure.message}}</span></div><div class="dialog-actions"><button :disabled="bulkBusy" @click="bulkAction=undefined">取消</button><button class="primary-action" :disabled="bulkBusy||!bulkItems.length" @click="executeBulkNotes">{{bulkBusy?'处理中…':`确认${bulkActionLabel()}`}}</button></div></section></div>
    <input ref="folderImportInput" class="folder-import-input" type="file" multiple @change="previewFolderImport"/>
    <input ref="folderTreeImportInput" class="folder-import-input" type="file" webkitdirectory multiple @change="previewFolderImport"/>
    <div v-if="folderImportOpen" class="pc-modal-backdrop" @click.self="!folderImportBusy&&(folderImportOpen=false)"><section class="pc-task-dialog folder-import-dialog" role="dialog" aria-modal="true"><div class="section-heading"><div><h2>导入文件到“{{folderImportFolder?.name}}”</h2><p>Markdown 作为可编辑笔记导入，其他文件保留原文件；保留所选文件夹及全部子目录层级。</p></div><button :disabled="folderImportBusy" @click="folderImportOpen=false">×</button></div><FolderImportProgress v-if="folderImportBusy" v-bind="folderImportProgress"/><FolderImportResult v-else-if="folderImportResult" :result="folderImportResult" :destination="folderImportFolder?.name||'目标目录'" @dismiss="folderImportResult=undefined"/><div v-if="!folderImportBusy&&!folderImportResult" class="folder-import-summary"><span>所选文件 <b>{{folderImportCandidates.length}}</b></span><span>子目录 <b>{{folderImportDirectoryCount}}</b></span><span>新增 <b>{{folderImportCandidates.filter(item=>!item.duplicate).length}}</b></span><span>重复 <b>{{folderImportCandidates.filter(item=>item.duplicate).length}}</b></span></div><div v-if="folderImportCandidates.length&&!folderImportResult&&!folderImportBusy" class="folder-import-preview"><article v-for="item in folderImportCandidates" :key="`${item.relativePath}-${item.sha256}`" :class="{duplicate:item.duplicate}"><span><strong>{{item.relativePath}}</strong><small>{{Math.max(1,Math.ceil(item.file.size/1024))}} KB · {{item.sha256.slice(0,12)}}</small></span><em>{{item.duplicate?(folderImportKeepDuplicates?'保留副本':'将跳过'):'新增'}}</em></article></div><label v-if="!folderImportBusy&&!folderImportResult&&folderImportCandidates.some(item=>item.duplicate)" class="folder-import-duplicate"><input v-model="folderImportKeepDuplicates" type="checkbox"/>保留完全相同文件的副本</label><p v-if="folderImportMessage&&!folderImportResult&&!folderImportBusy" class="folder-import-message">{{folderImportMessage}}</p><div class="dialog-actions"><button :disabled="folderImportBusy" @click="folderImportOpen=false">{{folderImportResult?'确认结果':'关闭'}}</button><button v-if="!folderImportResult||folderImportResult.error" class="primary-action" :disabled="folderImportBusy||!folderImportCandidates.length||(!folderImportKeepDuplicates&&folderImportCandidates.every(item=>item.duplicate))" @click="executeFolderImport">{{folderImportBusy?'导入中…':folderImportResult?.unfinished?`重试 ${folderImportCandidates.length} 个失败文件`:`导入 ${folderImportKeepDuplicates?folderImportCandidates.length:folderImportCandidates.filter(item=>!item.duplicate).length} 个文件`}}</button></div></section></div>
    <AttachmentPreviewDialog v-if="attachmentPreviewIndex>=0" :owner-id="ownerId" :items="attachments" :index="attachmentPreviewIndex" @change="attachmentPreviewIndex=$event" @close="attachmentPreviewIndex=-1"/>
  </div></div>
  <FolderDeleteProgressDialog v-if="folderDeleteOpen" :name="folderDeleteName" :busy="folderDeleteBusy" :error="folderDeleteError" :progress="folderDeleteProgress" @close="folderDeleteOpen=false"/>
  <TrashClearProgressDialog v-if="trashClearOpen" :busy="trashClearBusy" :phase="trashClearPhase" :completed="trashClearCompleted" :total="trashClearTotal" :current="trashClearCurrent" :removed="trashClearRemoved" :failures="trashClearFailures" :error="trashClearError" @close="trashClearOpen=false" @retry="retryTrashClear"/>
</template>
<style scoped>
.notes-workspace.sidebar-docked:not(.focus-reading){grid-template-columns:var(--note-library-width) auto 7px minmax(420px,1fr) 260px!important}
.notes-workspace.sidebar-docked.tree-hidden{grid-template-columns:auto 7px minmax(420px,1fr) 260px!important}
.notes-workspace.sidebar-docked.list-hidden{grid-template-columns:var(--note-library-width) minmax(420px,1fr) 260px!important}
.notes-workspace.sidebar-docked.tree-hidden.list-hidden{grid-template-columns:minmax(420px,1fr) 260px!important}
.notes-workspace.sidebar-docked.properties-hidden{grid-template-columns:var(--note-library-width) auto 7px minmax(420px,1fr)!important}
.notes-workspace.sidebar-docked.tree-hidden.properties-hidden{grid-template-columns:auto 7px minmax(420px,1fr)!important}
.notes-workspace.sidebar-docked.list-hidden.properties-hidden{grid-template-columns:var(--note-library-width) minmax(420px,1fr)!important}
.notes-workspace.sidebar-docked.tree-hidden.list-hidden.properties-hidden{grid-template-columns:minmax(420px,1fr)!important}
.notes-workspace.sidebar-docked.focus-reading{grid-template-columns:minmax(0,1fr)!important}
.notes-workspace.sidebar-docked>.note-properties{position:static;width:auto;border-left:1px solid var(--pc-border);box-shadow:none}
.notes-workspace.sidebar-floating>.note-properties{display:block;position:absolute;z-index:15;top:44px;right:0;bottom:0;width:min(300px,calc(100% - 36px));border-left:1px solid var(--pc-border);background:#fbfcfb;box-shadow:-12px 0 30px #1730231f}
.note-sidebar-dismiss{position:absolute;inset:44px 0 0;z-index:14;padding:0;border:0;background:transparent;cursor:default}
.sidebar-floating .note-sidebar-enter-active,.sidebar-floating .note-sidebar-leave-active{transition:transform .18s ease,opacity .18s ease}
.sidebar-floating .note-sidebar-enter-from,.sidebar-floating .note-sidebar-leave-to{transform:translateX(100%);opacity:0}
@media(prefers-reduced-motion:reduce){.sidebar-floating .note-sidebar-enter-active,.sidebar-floating .note-sidebar-leave-active{transition:none}}

.editor-right-controls{display:flex;flex:none;align-items:center;gap:12px}
.editor-right-controls>.editor-state{box-sizing:border-box;flex:0 0 104px;justify-content:flex-end;min-width:104px;font-variant-numeric:tabular-nums}
.editor-right-controls>.editor-state span{min-width:0;padding:0;overflow:hidden;text-overflow:ellipsis;font-size:11px}
.editor-sidebar-controls{display:flex;align-items:center;gap:2px;padding:3px;border:1px solid var(--pc-border);border-radius:8px;background:#f3f6f4}
.editor-sidebar-controls>.editor-sidebar-button{display:inline-flex;align-items:center;justify-content:center;min-width:44px;height:26px;margin:0;padding:0 10px;border:0;border-radius:5px;background:transparent;color:var(--pc-muted);font-size:11px;line-height:1;cursor:pointer}
.editor-sidebar-controls>.editor-sidebar-button:hover{color:var(--pc-primary);background:#e8efea}
.editor-sidebar-controls>.editor-sidebar-button[aria-pressed="true"]{background:#fff;color:var(--pc-primary);box-shadow:0 1px 3px #17332614}
.editor-sidebar-controls>.editor-sidebar-button:focus-visible{outline:2px solid var(--pc-primary);outline-offset:1px}

.outline-header-actions{display:flex;align-items:center;gap:3px}
.workspace-outline-nav{display:grid;padding:8px 10px;gap:2px}
.workspace-outline-row{display:flex;align-items:flex-start;min-width:0;border-radius:5px;color:var(--pc-muted)}
.workspace-outline-row.active{background:var(--pc-primary-soft);color:var(--pc-primary);font-weight:600}
.outline-branch-spacer,.workspace-outline-row>.outline-branch-toggle{flex:none;width:20px;min-width:20px;min-height:28px!important;height:28px;padding:0!important;display:grid;place-items:center}
.workspace-outline-row>.outline-branch-toggle{color:inherit!important}
.outline-branch-toggle svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.outline-heading-link{flex:1;min-width:0;padding:5px 4px;border:0;border-radius:5px;background:transparent;color:inherit;font-size:11px;line-height:1.6;font-weight:inherit;text-align:left;overflow-wrap:anywhere;cursor:pointer}
.outline-heading-link:hover{background:var(--pc-primary-soft);color:var(--pc-primary)}
.outline-heading-link:focus-visible{outline:2px solid var(--pc-primary);outline-offset:-2px}
.workspace-outline-empty{margin:16px;color:var(--pc-muted);font-size:11px}

.property-disclosure{margin:0 12px;border-bottom:1px solid var(--pc-border)}
.property-disclosure>summary{display:flex;align-items:center;gap:8px;min-height:44px;padding:8px 2px;list-style:none;color:var(--pc-text);font-size:12px;cursor:pointer;user-select:none}
.property-disclosure>summary::-webkit-details-marker{display:none}
.property-disclosure>summary::before{content:'›';width:12px;color:var(--pc-muted);font-size:17px;line-height:1}
.property-disclosure[open]>summary::before{transform:rotate(90deg)}
.property-disclosure>summary small{color:var(--pc-muted);font-size:11px}
.property-disclosure>summary .property-error-indicator{margin-left:auto;color:#a3453b}
.property-disclosure>summary:focus-visible{outline:2px solid var(--pc-primary);outline-offset:2px;border-radius:4px}
.property-section-body{padding:2px 2px 14px}
.note-properties .property-section-body dl{gap:12px}
.note-properties .property-section-body dl>div{align-items:flex-start;gap:14px}
.note-properties .property-section-body dt{flex:none;min-width:28px;font-size:11px;line-height:1.6}
.note-properties .property-section-body dd{min-width:0;text-align:right;overflow-wrap:anywhere;font-size:11px;line-height:1.6}
.note-properties .property-section-body select{width:100%;max-width:100%;padding:4px;font-size:11px}
.property-action-group+.property-action-group{margin-top:12px;padding-top:12px;border-top:1px solid var(--pc-border)}
.note-properties .property-section-body .property-action{margin-bottom:0;padding:8px 0;font-size:11px}

.tree-section-title .tag-manager-trigger{display:inline-flex;flex:none;align-items:center;justify-content:center;height:22px;min-height:0;padding:2px 6px;border:0;border-radius:4px;background:transparent;color:var(--pc-muted);font-size:11px;font-weight:400;line-height:16px;white-space:nowrap;cursor:pointer}
.tree-section-title .tag-manager-trigger:hover{background:var(--pc-primary-soft);color:var(--pc-primary)}
.tree-section-title .tag-manager-trigger:focus-visible{outline:2px solid var(--pc-primary);outline-offset:2px}

.tag-search-input{box-sizing:border-box;width:100%;margin:6px 0;padding:6px;border:1px solid var(--pc-border);border-radius:6px}
.tag-filter-options,.tag-picker-options{display:grid;max-height:230px;gap:8px;overflow:auto;padding:8px 0}.tag-filter-options>label,.tag-picker-options>label{display:flex;align-items:center;gap:6px;font-size:11px}

.tag-manager-dialog{width:min(600px,calc(100vw - 32px))}.tag-manager-list{max-height:50vh;overflow:auto}.tag-manager-list>article{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--pc-border)}.tag-manager-list button{padding:5px;border:0;border-radius:5px;background:transparent;color:var(--pc-muted);font-size:10px}.tag-manager-list button:hover{background:var(--pc-primary-soft);color:var(--pc-primary)}.tag-manager-list .tag-manager-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;color:var(--pc-text)}.tag-manager-list small{flex:none;color:var(--pc-muted);font-size:9px}
.folder-import-input{display:none}.folder-import-dialog{width:min(620px,calc(100vw - 32px))}.folder-import-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.folder-import-summary span{display:flex;justify-content:space-between;padding:10px;border:1px solid var(--pc-border);border-radius:8px;color:var(--pc-muted)}.folder-import-preview{max-height:310px;overflow:auto;border:1px solid var(--pc-border);border-radius:9px}.folder-import-preview article{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-bottom:1px solid var(--pc-border)}.folder-import-preview article:last-child{border-bottom:0}.folder-import-preview article>span{display:flex;min-width:0;flex-direction:column;gap:3px}.folder-import-preview strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.folder-import-preview small,.folder-import-preview em,.folder-import-message{color:var(--pc-muted);font-size:11px}.folder-import-preview em{flex:none;font-style:normal}.folder-import-preview article.duplicate em{color:#9a6a20}.folder-import-duplicate{display:flex;align-items:center;gap:8px}.folder-import-message{margin:0}
.editor-deferred-placeholder{display:grid;align-content:start;gap:12px;min-height:240px;padding:18px 4px}.editor-deferred-placeholder i{display:block;height:10px;border-radius:5px;background:linear-gradient(90deg,#eef3f0,#f7f9f8,#eef3f0)}.editor-deferred-placeholder i:nth-child(1){width:82%}.editor-deferred-placeholder i:nth-child(2){width:64%}.editor-deferred-placeholder i:nth-child(3){width:73%}
.tree-list li{padding-top:6px;padding-bottom:6px}.folder-tree-row{display:flex!important;align-items:center;min-height:30px;padding-top:0!important;padding-right:6px!important;padding-bottom:0!important}.folder-tree-row>.folder-tree-toggle,.folder-tree-row>.folder-tree-name{border:0;background:transparent;color:inherit;cursor:pointer}.folder-tree-toggle{display:grid;flex:0 0 22px;place-items:center;height:24px;padding:0;font-size:12px}.folder-tree-name{display:flex;min-width:0;flex:1;align-items:center;gap:6px;padding:5px 4px;text-align:left}.folder-tree-row:not(.has-children)>.folder-tree-name{padding-left:4px}.folder-tree-name i{flex:none;font-style:normal}.folder-tree-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tree-more-toggle{justify-content:center!important;color:var(--pc-muted)!important;font-size:8px!important}.tag-tree li{justify-content:space-between}.tag-tree li small{color:var(--pc-muted)}
.tree-primary-title{margin-top:8px}.tree-folder-title{margin-top:3px;border-top:1px solid #edf1ee}.tree-folder-title small{color:var(--pc-muted);font-size:9px;font-weight:400}.tree-system-list{padding-bottom:7px}.folder-list{padding-top:1px}.folder-tree-name small{min-width:22px;margin-left:auto;color:var(--pc-muted);font-size:9px;font-weight:400;text-align:right}.folder-glyph{position:relative;width:14px;height:10px;border:1px solid #8b9b92;border-radius:2px}.folder-glyph:before{position:absolute;top:-4px;left:1px;width:6px;height:3px;border:1px solid #8b9b92;border-bottom:0;border-radius:2px 2px 0 0;content:''}.folder-tree-row.active .folder-glyph,.folder-tree-row.active .folder-glyph:before{border-color:var(--pc-primary)}.panel-empty-actions{display:grid;justify-items:start;gap:8px}.panel-empty-actions button,.editor-empty-actions>button{padding:6px 10px;border:1px solid var(--pc-border);border-radius:7px;background:#fff;color:var(--pc-primary);font-size:9px;cursor:pointer}.editor-empty-actions{display:flex;justify-content:center;gap:8px}.editor-empty-actions .primary-action{border-color:var(--pc-primary);background:var(--pc-primary);color:#fff}
.tree-filter>span{display:grid;place-items:center;width:18px;color:var(--pc-muted);font-size:12px}.folder-scope-bar{display:flex;min-height:30px;align-items:center;gap:7px;margin:0 10px 7px;padding:5px 8px;border-radius:6px;background:var(--pc-primary-soft);color:var(--pc-muted);font-size:10px;line-height:1.5;cursor:pointer}.folder-scope-bar input{flex:none;width:13px;height:13px;margin:0;accent-color:var(--pc-primary)}.folder-scope-bar span{min-width:0}.folder-scope-bar small{flex:none;margin-left:auto;font-size:9px;white-space:nowrap}
.folder-title-actions{display:flex;align-items:center;gap:3px}.panel-title .folder-create-button{display:grid;place-items:center;width:25px;height:25px;border:1px solid transparent;border-radius:7px;color:var(--pc-primary);font-size:17px;line-height:1}.panel-title .folder-create-button:hover{border-color:var(--pc-border);background:#fff}.tree-item-menu{display:grid;flex:0 0 26px;place-items:center;width:26px;height:22px;padding:0 0 6px;border:0;border-radius:5px;background:transparent;color:#849189;font-size:15px;line-height:1;cursor:pointer;opacity:0}.folder-tree-row:hover .tree-item-menu,.folder-tree-row.active .tree-item-menu,.tree-item-menu:focus-visible{opacity:1}.tree-item-menu:hover{background:#edf3ef;color:var(--pc-primary)}
.tree-item-delete{display:grid;flex:0 0 22px;place-items:center;width:22px;height:22px;padding:0;border:0;border-radius:5px;background:transparent;color:#9caaa2;font-size:15px;cursor:pointer;opacity:0}.folder-tree-row:hover .tree-item-delete,.folder-tree-row.active .tree-item-delete,.tag-tree li:hover .tree-item-delete,.tag-tree li.active .tree-item-delete,.tree-item-delete:focus-visible{opacity:1}.tree-item-delete:hover{background:#fbecec;color:#b54545}.tag-tree li>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tag-tree li>small{margin-left:auto}
.folder-scope-toggle{display:flex;min-width:0;align-items:center;gap:4px;margin-left:auto;padding:4px 6px;border-radius:6px;background:#f4f7f5;color:var(--pc-muted);font-size:8px;white-space:nowrap}.folder-scope-toggle input{width:12px;height:12px;margin:0;accent-color:var(--pc-primary)}.folder-scope-toggle small{min-width:12px;color:var(--pc-primary);text-align:center}
.note-list-filter-wrap{position:relative;display:flex;justify-content:flex-end;padding:0 12px 8px}.note-list-filter-wrap>button{display:flex;align-items:center;gap:5px;padding:6px 9px;border:1px solid var(--pc-border);border-radius:7px;background:#fff;color:var(--pc-muted);font-size:9px;cursor:pointer}.note-list-filter-wrap>button.active{border-color:#a9cbb8;background:var(--pc-primary-soft);color:var(--pc-primary)}.note-list-filter-wrap>button small{display:grid;place-items:center;width:14px;height:14px;border-radius:50%;background:var(--pc-primary);color:#fff;font-size:7px}.note-list-filter-popover{position:absolute;z-index:20;top:34px;right:12px;display:grid;gap:10px;width:250px;padding:13px;border:1px solid var(--pc-border);border-radius:11px;background:#fff;box-shadow:0 14px 40px rgba(17,42,28,.18)}.note-list-filter-popover header,.note-list-filter-popover footer{display:flex;align-items:center;justify-content:space-between}.note-list-filter-popover header button{border:0;background:transparent;font-size:18px}.note-list-filter-popover label{display:grid;gap:5px;color:var(--pc-muted);font-size:9px}.note-list-filter-popover select{width:100%;padding:7px 8px;border:1px solid var(--pc-border);border-radius:7px;background:#fff;color:var(--pc-text)}.note-list-filter-popover footer{justify-content:flex-end;gap:7px;padding-top:3px}.note-list-filter-popover footer button{padding:6px 10px;border:1px solid var(--pc-border);border-radius:7px;background:#fff}.note-list-filter-popover footer .primary{border-color:var(--pc-primary);background:var(--pc-primary);color:#fff}.note-list-group-title{position:sticky;z-index:1;top:0;margin:0;padding:7px 12px;border-block:1px solid var(--pc-border);background:#f4f7f5;color:var(--pc-muted);font-size:8px;font-weight:700}
.note-list-filter-wrap>button{min-width:72px;justify-content:center}.note-list-filter-popover{top:36px}.note-list-filter-popover:before{content:'';position:absolute;right:24px;top:-6px;width:10px;height:10px;border:1px solid var(--pc-border);border-width:1px 0 0 1px;background:#fff;transform:rotate(45deg)}
.note-list-bulk-toolbar{display:flex;align-items:center;gap:4px;padding:0 10px 9px;flex-wrap:wrap;border-bottom:1px solid var(--pc-border)}.note-list-bulk-toolbar button{flex:none;padding:5px 7px;border:1px solid var(--pc-border);border-radius:6px;background:#fff;color:var(--pc-text);font-size:12px;cursor:pointer}.note-list-bulk-toolbar button:last-child{margin-left:auto}.note-list-bulk-toolbar button:disabled{opacity:.4;cursor:not-allowed}.bulk-select-all{display:flex;flex:none;align-items:center;gap:5px;color:var(--pc-muted);font-size:12px}.bulk-select-all input,.note-list-panel.bulk-mode .note-bulk-check{width:16px;height:16px;margin:0;appearance:auto;accent-color:var(--pc-primary)}.note-list-panel.bulk-mode article{padding-left:43px}.note-list-panel.bulk-mode .note-bulk-check{left:15px;right:auto;top:15px;opacity:1!important;visibility:visible;pointer-events:auto}.note-multi-trigger{width:auto!important;padding:0 7px!important;font-size:9px!important}
.note-list-panel{position:relative;z-index:3}.note-list-context{position:sticky!important;z-index:60;top:0;overflow:visible;background:#fff}.note-list-controls{position:relative;z-index:61;display:flex;gap:3px;margin-left:auto}.note-list-controls>button{padding:5px 7px;border:0;border-radius:6px;background:transparent;color:var(--pc-muted);font-size:9px}.note-list-controls>button:hover,.note-list-controls>button.active{background:var(--pc-primary-soft);color:var(--pc-primary)}.note-list-controls .note-list-filter-popover{z-index:100;top:34px;right:0}.note-sort-popover{gap:3px;width:170px}.note-sort-popover>button{padding:8px 10px;border:0;border-radius:6px;background:#fff;color:var(--pc-text);text-align:left}.note-sort-popover>button:hover,.note-sort-popover>button.active{background:var(--pc-primary-soft);color:var(--pc-primary)}
.note-list-panel article{padding:8px 12px}.notes-workspace.project-context .note-list-panel article{padding:8px 12px}

.note-list-floating-popover{position:fixed!important;z-index:2100!important;right:auto!important;margin:0}.note-list-floating-popover:before{display:none}.note-list-floating-popover section{display:grid;gap:6px;padding-bottom:9px;border-bottom:1px solid #edf1ee}.note-list-floating-popover section>small{color:#75837b;font-size:9px;font-weight:650}.popover-options{display:flex;flex-wrap:wrap;gap:5px}.popover-options button{padding:6px 8px;border:1px solid #e2e8e4;border-radius:7px;background:#fff;color:#526159;font-size:9px;cursor:pointer}.popover-options button:hover{border-color:#b8cfc2}.popover-options button.active{border-color:#9fc7b0;background:#eaf5ee;color:var(--pc-primary);font-weight:650}.note-sort-popover>button{display:flex;justify-content:space-between;align-items:center}.note-sort-popover>button span{visibility:hidden;color:var(--pc-primary)}.note-sort-popover>button.active span{visibility:visible}
.note-list-more{width:calc(100% - 20px);margin:10px;padding:7px;border:1px solid var(--pc-border);border-radius:8px;background:#fff;color:var(--pc-primary);font-size:9px;line-height:1.35;cursor:pointer}
.note-list-context{align-items:flex-start;padding:11px 10px 8px;border-bottom:0}.note-list-heading{display:grid!important;min-width:0;flex:1;gap:4px}.note-list-heading>span{display:flex;min-width:0;align-items:center;gap:7px}.note-list-heading strong{font-size:13px}.note-list-heading b{display:grid;min-width:20px;height:18px;padding:0 5px;place-items:center;border-radius:9px;background:#edf2ef;color:#52665b;font-size:8px}.note-list-heading small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.note-list-create,.note-list-menu{flex:none!important;width:27px!important;height:27px!important;margin:0!important;padding:0!important;border-radius:7px!important}.note-list-search{height:35px;margin:4px 10px 7px}.note-list-control-row{display:flex;align-items:center;justify-content:space-between;padding:0 10px 8px;border-bottom:1px solid var(--pc-border)}.note-list-control-row .note-list-controls{display:flex;gap:5px;margin:0}.note-list-control-row .note-list-controls>button{height:29px;padding:0 8px;border:1px solid var(--pc-border);border-radius:7px;background:#fff;font-size:9px}.note-list-control-row .note-list-controls>button.active{border-color:#a9cbb8;background:var(--pc-primary-soft)}.note-list-control-row .note-list-controls b{display:inline-grid;min-width:14px;height:14px;margin-left:3px;place-items:center;border-radius:7px;background:var(--pc-primary);color:#fff;font-size:7px}.note-density-button{width:29px;height:29px;border:1px solid var(--pc-border);border-radius:7px;background:#fff;color:var(--pc-muted)}.note-active-filters{display:flex;align-items:center;gap:5px;padding:0 10px 8px;overflow-x:auto;border-bottom:1px solid var(--pc-border)}.note-active-filters button{flex:none;padding:5px 7px;border:0;border-radius:6px;background:#edf5f0;color:var(--pc-primary);font-size:8px}.note-active-filters a{margin-left:auto;color:var(--pc-primary);font-size:8px;white-space:nowrap;cursor:pointer}
.note-document-header{display:grid;gap:8px;margin-bottom:12px;padding:0;border:0}.note-document-title{display:flex;align-items:flex-start;gap:10px}.note-document-title>.note-title-input{flex:1;min-width:0}.note-title-type{display:grid;flex:none;place-items:center;width:18px;height:34px;color:var(--pc-muted);font-size:14px}.note-document-actions{display:flex;flex:none;align-items:center;gap:2px;padding-top:2px}.note-document-actions .note-tag-toggle{height:28px;margin:0;padding:0 7px;font-size:11px;color:var(--pc-muted)}.note-document-actions .note-title-favorite,.note-document-actions .note-title-more{display:grid;place-items:center;width:28px;height:28px;padding:0;font-size:18px;line-height:1}.note-document-actions .note-title-favorite.active{color:var(--pc-primary)}.note-document-actions button :deep(svg){display:block;width:17px;height:17px}.note-title-tags{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding-left:0}.note-document-header.has-type-icon .note-title-tags{padding-left:28px}.note-title-tags>.note-tag-chip{display:inline-flex;align-items:center;background:var(--pc-primary-soft);border-radius:5px}.note-title-tags .note-tag-chip>button{height:25px;margin:0;padding:0 6px;font-size:11px}.note-tags-empty,.note-tags-pending{margin:0;color:var(--pc-muted);font-size:11px}.property-tag-name{display:inline-block;margin:0 6px 4px 0;color:var(--pc-primary)}
.real-editor-document:not(.file-document){padding-top:16px}.real-editor-document:not(.file-document)>.markdown-mode-body{margin-top:0}
.trash-clear-button{width:calc(100% - 24px);margin:0 12px 9px;padding:7px;border:1px solid #e7caca;border-radius:7px;background:#fff8f8;color:#a64040;font-size:9px;cursor:pointer}.trash-clear-button:disabled{opacity:.5;cursor:not-allowed}
.file-content-card{display:flex;align-items:center;gap:18px;margin:28px 0;padding:24px;border:1px solid var(--pc-border);border-radius:14px;background:var(--pc-surface-soft)}.file-content-card>div{display:grid;min-width:0;flex:1;gap:3px}.file-content-card p{overflow:hidden;margin:3px 0;text-overflow:ellipsis;white-space:nowrap}.file-content-card small{color:var(--pc-muted)}.file-content-card .file-content-warning{margin-top:5px;color:#a06b25}.file-content-icon{display:grid;width:54px;height:62px;place-items:center;border:1px solid #d8e0e5;border-radius:10px;background:#fff;color:var(--pc-primary);font-size:18px;font-weight:750;box-shadow:0 4px 16px #20382b12}.file-content-icon.kind-pdf{border-color:#f2d1d1;background:#fff6f6;color:#c94444}.file-content-icon.kind-word{border-color:#cfddf2;background:#f5f8ff;color:#3370d8}.file-content-icon.kind-excel,.file-content-icon.kind-csv{border-color:#cbe6d6;background:#f3fbf6;color:#218756}.file-content-icon.kind-powerpoint{border-color:#f2d8c9;background:#fff7f1;color:#d3602f}
.note-editor.file-mode{grid-template-rows:40px minmax(0,1fr) 28px}.note-editor.file-mode .editor-scroll-area{display:flex;min-height:0;overflow:hidden}.real-editor-document.file-document{width:100%;height:100%;max-width:none;margin:0;padding:0 14px 12px}.file-document .markdown-mode-body{height:100%;min-height:0;margin:0}.file-document .file-inline-preview{height:calc(100% - 12px);min-height:0;margin:0}.file-document .file-content-card{box-sizing:border-box;align-self:start;width:min(680px,calc(100% - 48px));height:auto;margin:32px auto;padding:20px 22px;border-color:#dfe6e2;background:#fff;box-shadow:0 8px 26px #1733260d}.file-document .file-content-card .primary-action{padding:8px 13px;border-radius:8px}
.note-list-filter-popover{gap:8px;padding:11px;border-radius:10px;color:var(--pc-text);font-size:9px;box-shadow:0 12px 32px rgba(17,42,28,.16)}
.note-list-filter-popover header strong{font-size:10px;font-weight:650;line-height:1.3}
.note-list-filter-popover header button{display:grid;width:22px;height:22px;padding:0;place-items:center;border-radius:5px;color:var(--pc-muted);font-size:14px;line-height:1}
.note-list-filter-popover header button:hover{background:#f1f5f2;color:var(--pc-text)}
.note-list-filter-popover section{gap:5px;padding-bottom:7px}
.note-list-filter-popover section>small{font-size:8px;line-height:1.3}
.note-list-filter-popover footer{gap:6px;padding-top:2px}
.note-list-filter-popover footer button{height:26px;padding:0 9px;border-radius:6px;font-size:9px}
.popover-options{gap:4px}
.popover-options button{min-height:25px;padding:5px 7px;border-radius:6px;font-size:8px;line-height:1.2}
.note-sort-popover{gap:2px;width:160px}
.note-sort-popover>button{min-height:28px;padding:6px 8px;font-size:9px;line-height:1.3}
.note-sort-popover>button span{font-size:9px}
.tree-folder-title{gap:6px}.tree-folder-title>strong{display:flex;flex:none;align-items:center;gap:5px}.folder-tree-controls{display:flex;align-items:center;gap:2px}.folder-tree-controls>button{height:24px;padding:0 5px;border:0;border-radius:5px;background:transparent;color:var(--pc-muted);font-size:9px;line-height:1;white-space:nowrap;cursor:pointer}.folder-tree-controls>button:hover:not(:disabled){background:var(--pc-primary-soft);color:var(--pc-primary)}.folder-tree-controls>button:focus-visible{outline:2px solid var(--pc-primary);outline-offset:1px}.folder-tree-controls>button:disabled{opacity:.4;cursor:default}

/* Reuse this page's existing panels on community narrow screens. */
@media(max-width:1079px){
 .community-responsive .notes-workspace{display:grid!important;grid-template-columns:minmax(0,1fr)!important;grid-template-rows:44px minmax(0,1fr);height:calc(100dvh - 60px);min-width:0;overflow:hidden}
 .community-responsive .mobile-note-switch{grid-row:1;gap:4px;padding:0 8px;border-bottom:1px solid var(--pc-border)}
 .community-responsive .mobile-note-switch button{flex:1;min-height:44px;border:0;background:transparent;color:var(--pc-primary)}
 .community-responsive .mobile-note-switch button[aria-pressed=true]{background:var(--pc-primary-soft)}
 .community-responsive .notes-workspace>.note-tree,.community-responsive .notes-workspace>.note-list-panel,.community-responsive .notes-workspace>.note-editor{grid-row:2;width:100%!important;min-width:0;max-width:100%;height:100%;display:none}
 .community-responsive .notes-workspace.mobile-notes-library>.note-tree,.community-responsive .notes-workspace.mobile-notes-list>.note-list-panel{display:block}
 .community-responsive .notes-workspace.mobile-notes-editor>.note-editor{display:grid}
 .community-responsive .notes-workspace>.note-properties,.community-responsive .notes-workspace>.column-resizer,.community-responsive .notes-workspace>.tree-column-resizer{display:none}
 .community-responsive .notes-workspace.sidebar-floating>.note-properties{display:block;top:88px}
 .community-responsive .note-sidebar-dismiss{top:88px}
 .community-responsive .editor-tabs{overflow-x:auto;gap:4px;padding:0 8px}
 .community-responsive .editor-tabs>*{flex-shrink:0}
 .community-responsive .editor-tabs>button[aria-label="展开笔记库"],.community-responsive .editor-tabs>button[aria-label="展开笔记列表"]{display:none}
 .community-responsive .editor-document,.community-responsive .real-editor-document{width:calc(100% - 28px);max-width:100%;padding-top:16px}
 .community-responsive .note-document-title{flex-wrap:nowrap}
 .community-responsive .note-document-title>.note-title-input{min-width:0;flex:1}.community-responsive .note-title-type{display:none}
 .community-responsive .notes-workspace .editor-mode-switch button{min-width:44px}
 .community-responsive .note-document-actions{flex-wrap:wrap}
}


.note-list-panel{max-width:max(300px,calc(100vw - var(--note-library-width) - 650px))}
.note-table-controls{display:flex;gap:8px;align-items:center;justify-content:initial;padding:0 14px 12px;border-bottom:0}
.note-table-controls .note-type-select,.note-table-controls .note-sort-select{flex:1;min-width:0;width:0}
.note-table-controls :deep(.el-select__wrapper){min-height:32px;font-size:12px;box-shadow:0 0 0 1px var(--pc-border) inset}
.note-table-controls .note-tags-filter{display:flex;justify-content:space-between;align-items:center;gap:8px;flex:1;min-width:0;height:32px;margin:0;padding:0 10px;font-size:12px}.note-tags-filter>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.note-table-controls .note-density-button{flex:none;width:32px;height:32px;margin:0;padding:0;font-size:16px}
.note-list-search{height:36px;margin:4px 14px 12px}.note-list-search input{font-size:12px}
.note-list-context{min-height:44px;padding:10px 14px 8px;align-items:center}.note-list-heading{gap:0!important}.note-list-heading strong{font-size:15px}
.note-list-panel.bulk-mode article.note-table-row{padding-left:43px}

.note-outline-search{display:flex;align-items:center;gap:6px;box-sizing:border-box;min-height:30px;margin:6px 12px;padding:0 8px;border:1px solid var(--pc-border);border-radius:var(--pc-control-radius,6px);background:var(--pc-background);color:var(--pc-muted)}
.note-outline-search svg{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.7}
.note-outline-search input{appearance:none;min-width:0;width:100%;height:28px;padding:0;border:0;outline:0;background:transparent;color:var(--pc-text);font:inherit;font-size:11px}
.note-outline-search:focus-within{border-color:var(--pc-primary);box-shadow:0 0 0 2px var(--pc-primary-soft)}
.note-outline-search input::-webkit-search-cancel-button{display:none}
.editor-right-controls :deep(.reader-find-open){--pc-control-height:30px;--pc-control-font-size:12px}
</style>

<style scoped>
.note-delete-error{position:fixed;z-index:80;bottom:24px;left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100vw - 48px);box-sizing:border-box;padding:12px 16px;border:1px solid #e5b6b6;border-radius:12px;background:#fff4f4;color:#a93838;overflow-wrap:anywhere;box-shadow:0 8px 24px #0002}.note-delete-error button{margin-left:8px}

.note-outline-search{display:flex;align-items:center;gap:6px;box-sizing:border-box;min-height:30px;margin:6px 12px;padding:0 8px;border:1px solid var(--pc-border);border-radius:var(--pc-control-radius,6px);background:var(--pc-background);color:var(--pc-muted)}
.note-outline-search svg{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.7}
.note-outline-search input{appearance:none;min-width:0;width:100%;height:28px;padding:0;border:0;outline:0;background:transparent;color:var(--pc-text);font:inherit;font-size:11px}
.note-outline-search:focus-within{border-color:var(--pc-primary);box-shadow:0 0 0 2px var(--pc-primary-soft)}
.note-outline-search input::-webkit-search-cancel-button{display:none}
.editor-right-controls :deep(.reader-find-open){--pc-control-height:30px;--pc-control-font-size:12px}
</style>

<style scoped>
.note-list-context>.note-tree-reopen{display:inline-flex;flex:none;align-items:center;justify-content:center;width:auto;min-width:54px;height:26px;padding:0 7px;border:1px solid var(--pc-border);border-radius:6px;background:var(--pc-surface,#fff);color:var(--pc-muted);font-size:10px;line-height:1;white-space:nowrap;cursor:pointer}

.note-outline-search{display:flex;align-items:center;gap:6px;box-sizing:border-box;min-height:30px;margin:6px 12px;padding:0 8px;border:1px solid var(--pc-border);border-radius:var(--pc-control-radius,6px);background:var(--pc-background);color:var(--pc-muted)}
.note-outline-search svg{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.7}
.note-outline-search input{appearance:none;min-width:0;width:100%;height:28px;padding:0;border:0;outline:0;background:transparent;color:var(--pc-text);font:inherit;font-size:11px}
.note-outline-search:focus-within{border-color:var(--pc-primary);box-shadow:0 0 0 2px var(--pc-primary-soft)}
.note-outline-search input::-webkit-search-cancel-button{display:none}
.editor-right-controls :deep(.reader-find-open){--pc-control-height:30px;--pc-control-font-size:12px}
</style>

<style scoped>

.note-list-context.library-collapsed{display:grid;grid-template-columns:minmax(0,1fr) 22px 27px 27px;gap:6px}
.note-list-context.library-collapsed>.note-tree-reopen{grid-column:1;grid-row:1;justify-self:start}
.note-list-context.library-collapsed>.note-list-collapse{grid-column:2;grid-row:1}
.note-list-context.library-collapsed>.note-list-create{grid-column:3;grid-row:1}
.note-list-context.library-collapsed>.note-list-menu{grid-column:4;grid-row:1}
.note-list-context.library-collapsed>.note-list-heading{grid-column:1/-1;grid-row:2;width:100%}
.note-list-context.library-collapsed .note-list-heading strong{min-width:0;flex:1;white-space:normal;overflow-wrap:anywhere}
.note-list-context.library-collapsed .note-list-heading b{flex:none}

.note-list-heading>span>.note-list-load-status{display:inline-flex;flex:none;width:48px;min-height:14px;align-items:center;font-size:10px;font-weight:400;color:var(--pc-muted);white-space:nowrap}.note-list-load-status>span{font-size:inherit;font-weight:inherit}.note-list-empty-state{min-height:42px}

.note-outline-search{display:flex;align-items:center;gap:6px;box-sizing:border-box;min-height:30px;margin:6px 12px;padding:0 8px;border:1px solid var(--pc-border);border-radius:var(--pc-control-radius,6px);background:var(--pc-background);color:var(--pc-muted)}
.note-outline-search svg{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.7}
.note-outline-search input{appearance:none;min-width:0;width:100%;height:28px;padding:0;border:0;outline:0;background:transparent;color:var(--pc-text);font:inherit;font-size:11px}
.note-outline-search:focus-within{border-color:var(--pc-primary);box-shadow:0 0 0 2px var(--pc-primary-soft)}
.note-outline-search input::-webkit-search-cancel-button{display:none}
.editor-right-controls :deep(.reader-find-open){--pc-control-height:30px;--pc-control-font-size:12px}
</style>

<style scoped>.folder-tree-controls .folder-tools-more{width:24px;min-width:24px;height:24px;padding:0;margin:0;color:var(--pc-muted)}
.note-outline-search{display:flex;align-items:center;gap:6px;box-sizing:border-box;min-height:30px;margin:6px 12px;padding:0 8px;border:1px solid var(--pc-border);border-radius:var(--pc-control-radius,6px);background:var(--pc-background);color:var(--pc-muted)}
.note-outline-search svg{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.7}
.note-outline-search input{appearance:none;min-width:0;width:100%;height:28px;padding:0;border:0;outline:0;background:transparent;color:var(--pc-text);font:inherit;font-size:11px}
.note-outline-search:focus-within{border-color:var(--pc-primary);box-shadow:0 0 0 2px var(--pc-primary-soft)}
.note-outline-search input::-webkit-search-cancel-button{display:none}
.editor-right-controls :deep(.reader-find-open){--pc-control-height:30px;--pc-control-font-size:12px}
</style>

<style scoped>.folder-transfer-preview{margin:12px 0;padding:10px;border:1px solid var(--pc-border);border-radius:7px;font-size:12px}.folder-transfer-preview summary{cursor:pointer;color:var(--pc-primary)}.folder-transfer-preview ul{max-height:180px;overflow:auto;padding-left:20px;line-height:1.9}.folder-transfer-preview small{color:var(--pc-muted)}
.note-outline-search{display:flex;align-items:center;gap:6px;box-sizing:border-box;min-height:30px;margin:6px 12px;padding:0 8px;border:1px solid var(--pc-border);border-radius:var(--pc-control-radius,6px);background:var(--pc-background);color:var(--pc-muted)}
.note-outline-search svg{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.7}
.note-outline-search input{appearance:none;min-width:0;width:100%;height:28px;padding:0;border:0;outline:0;background:transparent;color:var(--pc-text);font:inherit;font-size:11px}
.note-outline-search:focus-within{border-color:var(--pc-primary);box-shadow:0 0 0 2px var(--pc-primary-soft)}
.note-outline-search input::-webkit-search-cancel-button{display:none}
.editor-right-controls :deep(.reader-find-open){--pc-control-height:30px;--pc-control-font-size:12px}
</style>

<style scoped>.organization-result{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;text-align:left}.organization-result>span{flex:1;min-width:0;overflow-wrap:anywhere}.organization-result-actions{display:flex;flex-wrap:wrap;align-items:center;gap:4px}.organization-result-actions .el-button+.el-button{margin-left:0}
.note-outline-search{display:flex;align-items:center;gap:6px;box-sizing:border-box;min-height:30px;margin:6px 12px;padding:0 8px;border:1px solid var(--pc-border);border-radius:var(--pc-control-radius,6px);background:var(--pc-background);color:var(--pc-muted)}
.note-outline-search svg{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.7}
.note-outline-search input{appearance:none;min-width:0;width:100%;height:28px;padding:0;border:0;outline:0;background:transparent;color:var(--pc-text);font:inherit;font-size:11px}
.note-outline-search:focus-within{border-color:var(--pc-primary);box-shadow:0 0 0 2px var(--pc-primary-soft)}
.note-outline-search input::-webkit-search-cancel-button{display:none}
.editor-right-controls :deep(.reader-find-open){--pc-control-height:30px;--pc-control-font-size:12px}
</style>

<style scoped>.note-editor.file-mode.pdf-mode{grid-template-rows:40px minmax(0,1fr)}.note-editor.pdf-mode .real-editor-document.file-document{padding-bottom:0}/* 文件预览经正文插槽挂载，使用deep穿过组件边界，清除默认外边距并填满释放的空间。 */.note-editor.pdf-mode .file-document :deep(.file-inline-preview){box-sizing:border-box;height:100%;min-height:0;margin:0}.note-outline-search{display:flex;align-items:center;gap:6px;box-sizing:border-box;min-height:30px;margin:6px 12px;padding:0 8px;border:1px solid var(--pc-border);border-radius:var(--pc-control-radius,6px);background:var(--pc-background);color:var(--pc-muted)}
.note-outline-search svg{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.7}
.note-outline-search input{appearance:none;min-width:0;width:100%;height:28px;padding:0;border:0;outline:0;background:transparent;color:var(--pc-text);font:inherit;font-size:11px}
.note-outline-search:focus-within{border-color:var(--pc-primary);box-shadow:0 0 0 2px var(--pc-primary-soft)}
.note-outline-search input::-webkit-search-cancel-button{display:none}
.editor-right-controls :deep(.reader-find-open){--pc-control-height:30px;--pc-control-font-size:12px}
</style>
