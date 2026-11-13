<script setup lang="ts">
import {ElButton,ElSwitch} from 'element-plus'
import 'element-plus/theme-chalk/el-switch.css'
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
import {readScopedNoteSearch} from '../services/noteSearchScope'

const route = useRoute(), router = useRouter(), tasks = useTasksStore(), notes = useNotesStore()
const auth = useAuthStore()
const settingsOpen=ref(false),attachmentSearched=ref(false)
const useEncryptedAttachmentIndex=ref(false),attachmentIndexConfigured=ref(false),attachmentIndexReady=ref(false),attachmentIndexUnlocked=ref(false)
function indexProtectionChanged(state:{configured:boolean;unlocked:boolean}){const changed=!attachmentIndexReady.value||state.configured!==attachmentIndexConfigured.value||state.unlocked!==attachmentIndexUnlocked.value;attachmentIndexConfigured.value=state.configured;attachmentIndexUnlocked.value=state.unlocked;attachmentIndexReady.value=true;if(changed){useEncryptedAttachmentIndex.value=state.configured;clearAttachmentSearch()}}
const attachmentHits=ref<AttachmentContentHit[]>([]),attachmentBusy=ref(false),attachmentMessage=ref(''),attachmentPreview=ref(-1)
const attachmentCursor=ref<string>(),attachmentStats=ref({scanned:0,skipped:0,indexed:0,writes:0})
let attachmentRequest:AbortController|undefined,attachmentSequence=0
function clearAttachmentSearch(){attachmentRequest?.abort();attachmentSequence++;attachmentHits.value=[];attachmentMessage.value='';attachmentBusy.value=false;attachmentPreview.value=-1;attachmentCursor.value=undefined;attachmentStats.value={scanned:0,skipped:0,indexed:0,writes:0};attachmentSearched.value=false}
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
  attachmentSearched.value=true
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
const scope = ref<'all' | 'note' | 'task' | 'knowledge' | 'attachment'>('all')
const noteRows = ref<SearchHit[]>([]), page = ref(1), total = ref(0), hasMore = ref(false)
const knowledgeRows = ref<ResultRow[]>([])
const knowledgeError=ref('')
const loading = ref(false), loadingMore = ref(false), error = ref('')
let timer: ReturnType<typeof setTimeout> | undefined, request: AbortController | undefined, sequence = 0
const taskRows = computed<SearchHit[]>(() => {
  if (scope.value === 'note' || scope.value === 'knowledge') return []
  const needle = query.value.trim().toLocaleLowerCase()
  if (!needle) return []
  return tasks.tasks.filter(task => (!globalAreaUid.value||task.areaUid===globalAreaUid.value)&&`${task.title} ${task.description || ''} ${task.listName || ''}`.toLocaleLowerCase().includes(needle)).slice(0, 20).map(task => ({ type: 'task', uid: task.uid, title: task.title, summary: task.description || '暂无备注', context: task.listName || '收集箱', updatedAt: task.updatedAt }))
})
const rows = computed<ResultRow[]>(() => scope.value === 'task' ? taskRows.value : scope.value === 'knowledge' ? knowledgeRows.value : [...knowledgeRows.value, ...noteRows.value, ...taskRows.value])
// 全部页只展示各类前五项；已加载数量不冒充完整命中总数。
const groups=computed(()=>[
  {type:'knowledge',label:'知识',items:knowledgeRows.value},
  {type:'note',label:'笔记',items:noteRows.value},
  {type:'task',label:'任务',items:taskRows.value}
].filter(group=>(scope.value==='all'||scope.value===group.type)&&group.items.length))
const resultTotal=computed(()=>knowledgeRows.value.length+noteRows.value.length+taskRows.value.length)
const searchBusy=computed(()=>scope.value==='attachment'?attachmentBusy.value:loading.value||loadingMore.value)
const visibleCount=computed(()=>scope.value==='attachment'?attachmentHits.value.length:scope.value==='note'?noteRows.value.length:scope.value==='knowledge'?knowledgeRows.value.length:scope.value==='task'?taskRows.value.length:resultTotal.value)
async function runSearch(nextPage = 1, append = false) {
  if(scope.value==='attachment')return
  const value = query.value.trim()
  if (!value) { noteRows.value = []; knowledgeRows.value = []; total.value = 0; hasMore.value = false; error.value = ''; return }
  request?.abort(); request = new AbortController(); append ? loadingMore.value = true : loading.value = true; error.value = '';knowledgeError.value=''
  const currentSequence = ++sequence
  try {
    await Promise.all([scope.value !== 'note' && scope.value !== 'knowledge' && !tasks.tasks.length ? tasks.load() : Promise.resolve(),!notes.notes.length?notes.load():Promise.resolve()])
    if(currentSequence!==sequence)return
    if(knowledgeAvailable && scope.value!=='note' && scope.value!=='task'){
      try{
        const items=await knowledgeService.list(value)
        if(currentSequence!==sequence)return
        knowledgeRows.value=items.filter(item=>!globalAreaUid.value||item.areaUid===globalAreaUid.value).slice(0,20).map(item=>({type:'knowledge',uid:item.uid,title:item.title,summary:item.conclusion||item.content,context:'知识库',updatedAt:item.updatedAt}))
      }catch{if(currentSequence!==sequence)return;knowledgeRows.value=[];knowledgeError.value='知识搜索暂时不可用，请重试。'}
    }else knowledgeRows.value=[]
    if (scope.value === 'task' || scope.value === 'knowledge') { noteRows.value = []; total.value = 0; hasMore.value = false; return }
    const userId = auth.user?.userId
    if (!userId) throw new Error('请先登录')
    const service=notes.service(),areaUid=globalAreaUid.value,searchSignal=request.signal
    const result=await readScopedNoteSearch({page:nextPage,areaUid,signal:searchSignal,
      readPage:page=>searchNotes(userId,value,page,20,searchSignal),
      readNote:uid=>service.getForMutation?service.getForMutation(uid):service.get(uid)
    })
    if(currentSequence!==sequence)return
    const filtered=result.items
    noteRows.value = append ? [...noteRows.value, ...filtered] : filtered
    page.value = result.page; total.value = noteRows.value.length; hasMore.value = result.hasMore
  } catch (source) {
    if(currentSequence!==sequence)return
    if ((source as { code?: string })?.code !== 'ERR_CANCELED') {
      const detail = source as { message?: string; error?: { message?: string } }
      error.value = source instanceof Error ? source.message : detail?.message || detail?.error?.message || '搜索失败'
    }
  } finally { if(currentSequence===sequence){loading.value = false; loadingMore.value = false} }
}
function scheduleSearch() { request?.abort();sequence++;loading.value=Boolean(query.value.trim())&&scope.value!=='attachment';loadingMore.value=false;noteRows.value=[];knowledgeRows.value=[];error.value='';knowledgeError.value='';clearTimeout(timer); timer = setTimeout(() => runSearch(), 280); router.replace({ query: query.value.trim() ? { q: query.value.trim() } : {} }) }
function changeScope(value: string) { request?.abort();sequence++;loading.value=false;loadingMore.value=false;scope.value = value as typeof scope.value }
function resultContext(item:ResultRow){return item.context||''}
function open(item: ResultRow) { item.type === 'knowledge' ? router.push(`/knowledge/${item.uid}`) : item.type === 'note' ? router.push({ path: '/notes', query: { note: item.uid } }) : router.push({path:'/tasks',query:{task:item.uid}}) }
function onKeydown(event: KeyboardEvent) { if(settingsOpen.value||document.querySelector('.attachment-index-dialog'))return;if(event.key!=='Escape')return;if(query.value){event.preventDefault();query.value='';void router.replace({path:'/search'})}else router.back() }
watch([query, scope,globalAreaUid,()=>auth.user?.userId,()=>accountLifecycleRevision()], scheduleSearch)
watch(()=>route.query.q,value=>{const next=typeof value==='string'?value:'';if(next!==query.value)query.value=next})
onMounted(() => { window.addEventListener('note-flow:attachment-cache-change',onAttachmentChange); window.addEventListener('keydown', onKeydown); if (query.value.trim()) runSearch() })
onBeforeUnmount(() => { window.removeEventListener('note-flow:attachment-cache-change',onAttachmentChange); clearAttachmentSearch(); clearTimeout(timer); request?.abort(); window.removeEventListener('keydown', onKeydown) })
</script>
<template>
  <div class="page search-page" :aria-busy="searchBusy">
    <header>
      <button class="pc-action pc-action--icon" aria-label="返回" title="返回" @click="router.back">‹</button>
      <strong class="search-heading">全局搜索</strong>
      <ElButton @click="settingsOpen=true">搜索设置</ElButton>
    </header>
    <nav class="search-scopes" aria-label="搜索类型"><button v-for="item in [{v:'all',l:'全部'},{v:'knowledge',l:'知识'},{v:'note',l:'笔记'},{v:'task',l:'任务'},{v:'attachment',l:'附件'}].filter(item=>knowledgeAvailable||item.v!=='knowledge')" :key="item.v" :aria-pressed="scope===item.v" :title="item.v==='attachment'?'按需搜索本机附件正文，不自动下载远端文件':undefined" :class="{active:scope===item.v}" @click="changeScope(item.v)">{{item.l}}</button><span v-if="query.trim()" class="search-nav-status" role="status" aria-live="polite"><template v-if="searchBusy"><span class="search-spinner" aria-hidden="true"/>{{scope==='attachment'?'搜索附件中…':loadingMore?'加载更多…':'搜索中…'}}</template><template v-else-if="scope!=='attachment'||attachmentSearched"><span :title="scope==='attachment'?'已检查范围内的附件命中数':'当前类别已加载的结果数量，并非完整总数'">已加载 {{visibleCount}} 项</span></template></span></nav>
    <!-- 管理组件保持挂载，设置关闭后仍接收锁定和账号失效通知。 -->
    <AttachmentIndexProtection v-if="auth.user" v-model:settings-open="settingsOpen" :owner-id="String(auth.user.userId)" @change="indexProtectionChanged"><ElSwitch v-model="useEncryptedAttachmentIndex" aria-label="使用加密索引加速附件搜索" :disabled="!attachmentIndexConfigured" @change="clearAttachmentSearch"/></AttachmentIndexProtection>
    <AttachmentPreviewDialog v-if="attachmentPreview>=0&&auth.user" :owner-id="String(auth.user.userId)" :items="attachmentHits.map(hit=>hit.item)" :index="attachmentPreview" @change="attachmentPreview=$event" @close="attachmentPreview=-1"/>
    <section v-if="!query.trim()" class="search-empty"><span>⌕</span><strong>搜索你的工作内容</strong><p>{{knowledgeAvailable?'输入关键词，查找知识、笔记、任务和本机附件内容。':'输入关键词，查找笔记、任务和本机附件内容。'}}</p></section>
    <section v-else-if="loading&&scope!=='attachment'" class="search-loading-panel" role="status" aria-live="polite">
      <div class="search-loading-message"><span class="search-spinner search-spinner--large" aria-hidden="true"/><div><strong>正在搜索“{{query.trim()}}”</strong><p>正在查找{{scope==='knowledge'?'知识':scope==='note'?'笔记':scope==='task'?'任务':knowledgeAvailable?'知识、笔记和任务':'笔记和任务'}}，请稍候…</p></div></div>
      <div class="search-skeleton" aria-hidden="true"><i v-for="item in 3" :key="item"/></div>
    </section>
    <section v-if="query.trim()&&error&&scope!=='attachment'" class="search-empty search-error"><strong>笔记搜索暂时不可用</strong><p>{{error}}</p><ElButton @click="runSearch()">重新搜索</ElButton></section>
    <p v-if="query.trim()&&knowledgeError&&['all','knowledge'].includes(scope)" role="alert">{{knowledgeError}} <ElButton @click="runSearch()">重试知识搜索</ElButton></p>
    <section v-if="query.trim()&&!loading&&!rows.length&&!error&&!knowledgeError&&scope!=='attachment'" class="search-empty"><span>⌕</span><strong>没有找到“{{query.trim()}}”</strong><p>可以缩短关键词，或切换到其他内容类型。</p></section>
    <template v-if="query.trim()&&!loading&&rows.length&&scope!=='attachment'"><section v-for="group in groups" :key="group.type" class="search-group"><header><strong>{{group.label}}</strong><small>已加载 {{group.items.length}} 项</small><ElButton v-if="scope==='all'" text @click="changeScope(group.type)">查看更多</ElButton></header><div class="search-results"><button v-for="item in (scope==='all'?group.items.slice(0,5):group.items)" :key="`${item.type}-${item.uid}`" @click="open(item)"><span class="search-result-icon">{{item.type==='knowledge'?'◇':item.type==='note'?'▤':'✓'}}</span><div><strong><template v-for="(part,index) in highlightSegments(item.title||'未命名',query)" :key="index"><mark v-if="part.match">{{part.text}}</mark><template v-else>{{part.text}}</template></template></strong><p><template v-for="(part,index) in highlightSegments(String(item.summary||'').slice(0,240)||'暂无内容',query)" :key="index"><mark v-if="part.match">{{part.text}}</mark><template v-else>{{part.text}}</template></template></p><small v-if="resultContext(item)">{{resultContext(item)}}<template v-if="item.updatedAt"> · {{new Date(item.updatedAt).toLocaleDateString('zh-CN')}}</template></small></div><em>{{item.type==='knowledge'?'知识':item.type==='note'?'笔记':'任务'}}</em></button></div></section><footer v-if="scope==='note'" class="search-footer"><span>已显示 {{noteRows.length}} 项笔记</span><ElButton v-if="hasMore" :loading="loadingMore" :disabled="loadingMore" @click="runSearch(page+1,true)">{{loadingMore?'加载中…':'加载更多'}}</ElButton></footer></template>
    <section v-if="query.trim()&&scope==='attachment'" class="attachment-content-search" aria-label="附件内容搜索">
      <header><strong>附件内容</strong><span>{{attachmentBusy?'正在搜索':attachmentSearched?`已找到 ${attachmentHits.length} 项`:'未搜索'}}</span></header>
      <p>搜索本机附件中的文字，按需读取文件。</p>
      <template v-if="attachmentIndexConfigured&&useEncryptedAttachmentIndex&&!attachmentIndexUnlocked"><p>附件搜索索引已锁定。</p><ElButton @click="settingsOpen=true">解锁索引</ElButton><ElButton @click="useEncryptedAttachmentIndex=false">仅扫描本机文件</ElButton></template>
      <ElButton v-else :disabled="attachmentBusy||appLock.locked.value||!attachmentIndexReady" @click="runAttachmentSearch()">{{attachmentBusy?'正在搜索本机附件…':'搜索本机附件内容'}}</ElButton>
      <ElButton v-if="attachmentBusy" @click="clearAttachmentSearch">取消</ElButton>
      <div v-if="attachmentBusy" class="search-loading-message attachment-loading" role="status"><span class="search-spinner search-spinner--large" aria-hidden="true"/><div><strong>正在搜索本机附件正文</strong><p>正在读取和解析支持的本机文件，可随时取消。</p></div></div>
      <p v-if="attachmentMessage" role="status">{{attachmentMessage}}</p>
      <p v-if="attachmentSearched&&!attachmentHits.length">已检查范围内没有匹配的附件内容。</p>
      <AttachmentSearchResults :hits="attachmentHits" @open="attachmentPreview=$event"/>
      <ElButton v-if="attachmentCursor" :disabled="attachmentBusy" @click="runAttachmentSearch(true)">继续搜索剩余附件</ElButton>
    </section>
  </div>
</template>

<style scoped>
.search-page>header{grid-template-columns:30px minmax(0,1fr) auto}
.search-page>header>.el-button{display:inline-flex;width:auto;height:32px;padding:8px 12px;font-size:13px;color:var(--pc-text);border:1px solid var(--pc-border);background:var(--pc-surface)}
.search-heading{font-size:15px;color:var(--pc-text)}
.search-scopes{padding-left:0;flex-wrap:wrap;align-items:center}
.search-nav-status{display:inline-flex;align-items:center;gap:7px;margin-left:auto;color:var(--pc-muted);font-size:12px;line-height:24px;white-space:nowrap}
.search-spinner{display:inline-block;flex:none;width:14px;height:14px;border:2px solid var(--pc-border);border-top-color:var(--pc-primary);border-radius:50%;animation:search-spin .75s linear infinite}
.search-spinner--large{width:26px;height:26px;border-width:3px}
.search-loading-panel{padding:20px 0}
.search-loading-message{display:flex;align-items:center;gap:14px;padding:20px;border:1px solid var(--pc-border);border-radius:10px;background:var(--pc-primary-soft)}
.search-loading-message strong{font-size:14px;color:var(--pc-text);overflow-wrap:anywhere}
.search-loading-message p{margin:6px 0 0;font-size:12px;line-height:1.6;color:var(--pc-muted)}
.search-loading-panel .search-skeleton{margin:16px 0 0}
.search-loading-panel .search-skeleton i{height:70px;border-color:var(--pc-border)}
.attachment-loading{margin-top:16px}
@keyframes search-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.search-spinner{animation:none}.search-loading-panel .search-skeleton i{animation:none}}
.search-group,.search-summary,.search-empty{padding-left:0}
.search-group>header .el-button{margin-left:auto}
.attachment-content-search{padding:16px;margin:20px 0;border-top:1px solid var(--pc-border)}
.attachment-content-search>header{display:flex;align-items:center;gap:12px;font-size:13px}
.attachment-content-search>header span,.attachment-content-search>p{font-size:12px;color:var(--pc-muted);line-height:1.6}
.attachment-content-search :deep(.search-results){margin-top:12px}
@media(max-width:600px){.search-page{width:calc(100% - 24px)}.search-page>header{gap:6px}.search-page>header>.el-button{padding:8px}.attachment-content-search{padding:12px 0}.search-scopes{gap:5px}.search-scopes button{padding:7px 10px}}
</style>
