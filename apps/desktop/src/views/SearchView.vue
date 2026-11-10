<script setup lang="ts">
import {knowledgeAvailable} from '../services/clientCapabilities'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTasksStore } from '../stores/tasks'
import { useAuthStore } from '../stores/auth'
import { highlightSegments, searchNotes, type SearchHit } from '../services/search'
import { knowledgeService } from '../services/knowledge'
import { useNotesStore } from '../stores/notes'
import { globalAreaUid } from '../services/globalAreaScope'
import {searchLocalAttachmentContent,type AttachmentContentHit} from '../services/attachmentContentSearch'
import AttachmentSearchResults from '../components/AttachmentSearchResults.vue'
import AttachmentIndexProtection from '../components/AttachmentIndexProtection.vue'
import AttachmentPreviewDialog from '../components/AttachmentPreviewDialog.vue'
import {clientOwnerScope} from '../services/clientContext'
import {appLock} from '../services/appLock'
import {accountLifecycleRevision} from '../services/accountStorage'
import { isRegularNote } from '@note-flow/core'

const route = useRoute(), router = useRouter(), tasks = useTasksStore(), notes = useNotesStore()
const auth = useAuthStore()
const useEncryptedAttachmentIndex=ref(false),attachmentIndexConfigured=ref(false),attachmentIndexReady=ref(false),attachmentIndexUnlocked=ref(false)
function indexProtectionChanged(state:{configured:boolean;unlocked:boolean}){const changed=!attachmentIndexReady.value||state.configured!==attachmentIndexConfigured.value||state.unlocked!==attachmentIndexUnlocked.value;attachmentIndexConfigured.value=state.configured;attachmentIndexUnlocked.value=state.unlocked;attachmentIndexReady.value=true;if(changed){useEncryptedAttachmentIndex.value=state.configured;clearAttachmentSearch()}}
const attachmentHits=ref<AttachmentContentHit[]>([]),attachmentBusy=ref(false),attachmentMessage=ref(''),attachmentPreview=ref(-1)
const attachmentCursor=ref<string>(),attachmentStats=ref({scanned:0,skipped:0,indexed:0,writes:0})
let attachmentRequest:AbortController|undefined,attachmentSequence=0
function clearAttachmentSearch(){attachmentRequest?.abort();attachmentSequence++;attachmentHits.value=[];attachmentMessage.value='';attachmentBusy.value=false;attachmentPreview.value=-1;attachmentCursor.value=undefined;attachmentStats.value={scanned:0,skipped:0,indexed:0,writes:0}}
function onAttachmentChange(event:Event){if((event as CustomEvent).detail?.scope===clientOwnerScope(String(auth.user?.userId||'')))clearAttachmentSearch()}
async function runAttachmentSearch(append=false){
 if(!append)clearAttachmentSearch();else{attachmentRequest?.abort();attachmentSequence++}
 const owner=auth.user?.userId
 if(!owner)return
 const current=attachmentSequence,controller=new AbortController();attachmentRequest=controller;attachmentBusy.value=true
 try{
  const result=await searchLocalAttachmentContent(String(owner),query.value,controller.signal,{useEncryptedIndex:useEncryptedAttachmentIndex.value,cursor:append?attachmentCursor.value:undefined})
  if(current!==attachmentSequence)return
  const allowedNotes=new Set(notes.notes.filter(note=>!globalAreaUid.value||note.areaUid===globalAreaUid.value).map(note=>note.uid)),allowedTasks=new Set(tasks.tasks.filter(task=>!globalAreaUid.value||task.areaUid===globalAreaUid.value).map(task=>task.uid))
  const filtered=result.hits.filter(hit=>!globalAreaUid.value||(hit.item.noteUid&&allowedNotes.has(hit.item.noteUid))||(hit.item.taskUid&&allowedTasks.has(hit.item.taskUid)))
  const merged=new Map((append?attachmentHits.value:[]).map(hit=>[hit.item.uid,hit]))
  for(const hit of filtered)merged.set(hit.item.uid,hit)
  attachmentHits.value=[...merged.values()]
  attachmentCursor.value=result.nextCursor
  attachmentStats.value={scanned:attachmentStats.value.scanned+result.scanned,skipped:attachmentStats.value.skipped+result.skipped,indexed:attachmentStats.value.indexed+result.indexed,writes:attachmentStats.value.writes+result.indexWriteFailures}
  const stats=attachmentStats.value
  attachmentMessage.value=`已检查 ${stats.scanned} 个本机文本附件，显示 ${attachmentHits.value.length} 项结果${stats.indexed?`，${stats.indexed} 项来自加密索引`:''}${stats.writes?`；${stats.writes} 项未写入索引，本次结果仍可用`:''}${stats.skipped?`；${stats.skipped} 项不支持或不可读取`:''}${result.limited?`；已检查范围 ${result.checkedThrough}/${result.sourceCount}，可继续搜索`:''}`

 }catch{if(current===attachmentSequence&&!controller.signal.aborted){clearAttachmentSearch();attachmentMessage.value='附件搜索未完成或附件已变化，请解锁并重新搜索'}}
 finally{if(current===attachmentSequence)attachmentBusy.value=false}
}

const query = ref(typeof route.query.q === 'string' ? route.query.q : '')
watch([query,globalAreaUid,()=>auth.user?.userId,()=>appLock.locked.value,()=>accountLifecycleRevision()],clearAttachmentSearch)
type ResultRow = (SearchHit | { type: 'knowledge'; uid: string; title: string; summary: string }) & { context?: string; updatedAt?: string }
const scope = ref<'all' | 'note' | 'task' | 'knowledge'>('all')
const noteRows = ref<SearchHit[]>([]), page = ref(1), total = ref(0), hasMore = ref(false)
const knowledgeRows = ref<ResultRow[]>([])
const loading = ref(false), loadingMore = ref(false), error = ref('')
let timer: ReturnType<typeof setTimeout> | undefined, request: AbortController | undefined, sequence = 0
const taskRows = computed<SearchHit[]>(() => {
  if (scope.value === 'note' || scope.value === 'knowledge') return []
  const needle = query.value.trim().toLocaleLowerCase()
  if (!needle) return []
  return tasks.tasks.filter(task => (!globalAreaUid.value||task.areaUid===globalAreaUid.value)&&`${task.title} ${task.description || ''} ${task.listName || ''}`.toLocaleLowerCase().includes(needle)).slice(0, 20).map(task => ({ type: 'task', uid: task.uid, title: task.title, summary: task.description || '暂无备注', context: task.listName || '收集箱', updatedAt: task.updatedAt }))
})
const rows = computed<ResultRow[]>(() => scope.value === 'task' ? taskRows.value : scope.value === 'knowledge' ? knowledgeRows.value : [...knowledgeRows.value, ...noteRows.value, ...taskRows.value])
const groups=computed(()=>[
  {type:'knowledge',label:'知识',items:knowledgeRows.value},
  {type:'note',label:'笔记',items:noteRows.value},
  {type:'task',label:'任务',items:taskRows.value}
].filter(group=>(scope.value==='all'||scope.value===group.type)&&group.items.length))
const resultTotal=computed(()=>knowledgeRows.value.length+noteRows.value.length+taskRows.value.length)
async function runSearch(nextPage = 1, append = false) {
  const value = query.value.trim()
  if (!value) { noteRows.value = []; knowledgeRows.value = []; total.value = 0; hasMore.value = false; error.value = ''; return }
  request?.abort(); request = new AbortController(); append ? loadingMore.value = true : loading.value = true; error.value = ''
  const currentSequence = ++sequence
  try {
    await Promise.all([scope.value !== 'note' && scope.value !== 'knowledge' && !tasks.tasks.length ? tasks.load() : Promise.resolve(),!notes.notes.length?notes.load():Promise.resolve()])
    knowledgeRows.value = !knowledgeAvailable || scope.value === 'note' || scope.value === 'task' ? [] : (await knowledgeService.list(value)).filter(item=>!globalAreaUid.value||item.areaUid===globalAreaUid.value).slice(0, 20).map(item => ({ type: 'knowledge', uid: item.uid, title: item.title, summary: item.conclusion || item.content, context:'知识库', updatedAt:item.updatedAt }))
    if (scope.value === 'task' || scope.value === 'knowledge') { noteRows.value = []; total.value = 0; hasMore.value = false; return }
    const userId = auth.user?.userId
    if (!userId) throw new Error('请先登录')
    const result = await searchNotes(userId, value, nextPage, 20, request.signal)
    if (currentSequence !== sequence) return
    const allowed=new Set(notes.notes.filter(isRegularNote).filter(note=>!globalAreaUid.value||note.areaUid===globalAreaUid.value).map(note=>note.uid)),filtered=result.items.filter(item=>allowed.has(item.uid))
    noteRows.value = append ? [...noteRows.value, ...filtered] : filtered
    page.value = result.page; total.value = noteRows.value.length; hasMore.value = result.hasMore
  } catch (source) {
    if ((source as { code?: string })?.code !== 'ERR_CANCELED') {
      const detail = source as { message?: string; error?: { message?: string } }
      error.value = source instanceof Error ? source.message : detail?.message || detail?.error?.message || '搜索失败'
    }
  } finally { loading.value = false; loadingMore.value = false }
}
function scheduleSearch() { clearTimeout(timer); timer = setTimeout(() => runSearch(), 280); router.replace({ query: query.value.trim() ? { q: query.value.trim() } : {} }) }
function changeScope(value: string) { scope.value = value as typeof scope.value }
function resultContext(item:ResultRow){return item.context||''}
function open(item: ResultRow) { item.type === 'knowledge' ? router.push(`/knowledge/${item.uid}`) : item.type === 'note' ? router.push({ path: '/notes', query: { note: item.uid } }) : router.push({path:'/tasks',query:{task:item.uid}}) }
function onKeydown(event: KeyboardEvent) { if(event.key!=='Escape')return;if(query.value){event.preventDefault();query.value='';void router.replace({path:'/search'})}else router.back() }
watch([query, scope], scheduleSearch)
watch(()=>route.query.q,value=>{const next=typeof value==='string'?value:'';if(next!==query.value)query.value=next})
onMounted(() => { window.addEventListener('note-flow:attachment-cache-change',onAttachmentChange); window.addEventListener('keydown', onKeydown); if (query.value.trim()) runSearch() })
onBeforeUnmount(() => { window.removeEventListener('note-flow:attachment-cache-change',onAttachmentChange); clearAttachmentSearch(); clearTimeout(timer); request?.abort(); window.removeEventListener('keydown', onKeydown) })
</script>
<template>
  <div class="page search-page">
    <header><button aria-label="返回" title="返回" @click="router.back">‹</button><div class="search-scopes"><button v-for="item in [{v:'all',l:'全部',n:resultTotal},{v:'knowledge',l:'知识',n:knowledgeRows.length},{v:'note',l:'笔记',n:noteRows.length},{v:'task',l:'任务',n:taskRows.length}].filter(item=>knowledgeAvailable||item.v!=='knowledge')" :key="item.v" :class="{active:scope===item.v}" @click="changeScope(item.v)">{{item.l}} <small v-if="query.trim()">{{item.n}}</small></button></div></header>
    <section v-if="query.trim()" class="attachment-content-search"><AttachmentIndexProtection v-if="auth.user" :owner-id="String(auth.user.userId)" @change="indexProtectionChanged"/><label class="attachment-index-choice"><input v-model="useEncryptedAttachmentIndex" :disabled="!attachmentIndexConfigured" type="checkbox" @change="clearAttachmentSearch"/>使用已解锁的加密索引</label><button :disabled="attachmentBusy||appLock.locked.value||!attachmentIndexReady" @click="runAttachmentSearch()">{{attachmentBusy?'正在搜索本机附件…':'搜索本机附件内容'}}</button><small>TXT、Markdown、CSV、JSON ≤ 2 MiB · PDF ≤ 10 MiB / 100 页 · DOCX ≤ 10 MiB · 仅检查本机副本</small><button v-if="attachmentBusy" @click="clearAttachmentSearch">取消</button><p v-if="attachmentMessage" role="status">{{attachmentMessage}}</p><button v-if="attachmentCursor" :disabled="attachmentBusy" @click="runAttachmentSearch(true)">继续搜索剩余附件</button><AttachmentSearchResults :hits="attachmentHits" @open="attachmentPreview=$event"/></section>
    <AttachmentPreviewDialog v-if="attachmentPreview>=0&&auth.user" :owner-id="String(auth.user.userId)" :items="attachmentHits.map(hit=>hit.item)" :index="attachmentPreview" @change="attachmentPreview=$event" @close="attachmentPreview=-1"/>
    <section v-if="!query.trim()" class="search-empty"><span>⌕</span><strong>搜索你的工作内容</strong><p>{{knowledgeAvailable?'输入关键词，查找知识、笔记和任务。':'输入关键词，查找笔记和任务。'}}</p></section>
    <div v-else-if="loading" class="search-skeleton" aria-label="正在搜索"><i v-for="item in 4" :key="item"/></div>
    <section v-else-if="error" class="search-empty search-error"><strong>搜索暂时不可用</strong><p>{{error}}</p><button @click="runSearch()">重新搜索</button></section>
    <section v-else-if="!rows.length" class="search-empty"><span>⌕</span><strong>没有找到“{{query.trim()}}”</strong><p>可以缩短关键词，或切换到其他内容类型。</p></section>
    <template v-else><div class="search-summary">找到 {{resultTotal}} 项结果</div><section v-for="group in groups" :key="group.type" class="search-group"><header><strong>{{group.label}}</strong><small>{{group.items.length}}</small></header><div class="search-results"><button v-for="item in group.items" :key="`${item.type}-${item.uid}`" @click="open(item)"><span class="search-result-icon">{{item.type==='knowledge'?'◇':item.type==='note'?'▤':'✓'}}</span><div><strong><template v-for="(part,index) in highlightSegments(item.title||'未命名',query)" :key="index"><mark v-if="part.match">{{part.text}}</mark><template v-else>{{part.text}}</template></template></strong><p><template v-for="(part,index) in highlightSegments(String(item.summary||'').slice(0,240)||'暂无内容',query)" :key="index"><mark v-if="part.match">{{part.text}}</mark><template v-else>{{part.text}}</template></template></p><small v-if="resultContext(item)">{{resultContext(item)}}<template v-if="item.updatedAt"> · {{new Date(item.updatedAt).toLocaleDateString('zh-CN')}}</template></small></div><em>{{item.type==='knowledge'?'知识':item.type==='note'?'笔记':'任务'}}</em></button></div></section><footer v-if="scope!=='task'&&scope!=='knowledge'" class="search-footer"><span>笔记 {{noteRows.length}} / {{total}}</span><button v-if="hasMore" :disabled="loadingMore" @click="runSearch(page+1,true)">{{loadingMore?'加载中…':'加载更多'}}</button></footer></template>
  </div>
</template>

<style scoped>
.attachment-content-search{padding:12px 16px;margin:12px 0;border:1px solid var(--pc-border);border-radius:8px}.attachment-content-search>button{padding:6px 10px;border:1px solid var(--pc-border);border-radius:5px;background:var(--pc-surface,#fff);color:var(--pc-text);cursor:pointer}.attachment-content-search>small{display:inline-block;margin:6px 10px;color:var(--pc-muted);font-size:11px}.attachment-content-search>p{font-size:12px;color:var(--pc-muted)}
</style>
