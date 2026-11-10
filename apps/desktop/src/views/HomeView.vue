<script setup lang="ts">
import {accountSessionRevision} from '../services/accountStorage'
import {isCommunityEdition} from '../services/clientCapabilities'
import { computed, defineAsyncComponent, onActivated, onDeactivated, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { isRegularNote } from '@note-flow/core'
import { useNotesStore } from '../stores/notes'
import { useTasksStore } from '../stores/tasks'
import {readFocusRecords} from '../services/focusRecordSource'
import {focusRecordSummary,type FocusRecord} from '../services/focusRecords'
import { dailyCulture, loadDailyWeather, localDayKey, type DailyWeather } from '../services/dailyBrief'

const notesStore = useNotesStore()
const tasksStore = useTasksStore()
const router = useRouter()
const MonthCalendar=defineAsyncComponent(()=>import('../components/MonthCalendar.vue'))
const quickText = ref('')
const now=ref(new Date())
let clockTimer:ReturnType<typeof setTimeout>|undefined
function refreshClock(){
  if(clockTimer!==undefined)clearTimeout(clockTimer)
  now.value=new Date()
  clockTimer=setTimeout(refreshClock,60000-Date.now()%60000)
}
function resumeClock(){if(document.visibilityState==='visible')refreshClock()}
function startClock(){refreshClock();window.addEventListener('focus',refreshClock);document.addEventListener('visibilitychange',resumeClock)}
function stopClock(){if(clockTimer!==undefined)clearTimeout(clockTimer);clockTimer=undefined;window.removeEventListener('focus',refreshClock);document.removeEventListener('visibilitychange',resumeClock)}
onMounted(startClock);onActivated(startClock);onDeactivated(stopClock);onBeforeUnmount(stopClock)
const culture=computed(()=>dailyCulture(now.value)),weather=ref<DailyWeather>({label:'正在获取天气…',advice:'请稍候',source:'Open-Meteo'}),briefMessage=ref('')
const autoDailyBrief=ref(localStorage.getItem('note-flow-home-daily-brief')==='true')
const focusSessions = ref<FocusRecord[]>([])
const recentNotes = computed(() => notesStore.notes.filter(isRegularNote).slice(0, 4).map(note => ({ id: note.uid, title: note.title || '未命名笔记', excerpt: note.content || '暂无正文', time: note.updatedAt ? new Date(note.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '', tag: note.type || '笔记' })))
const recentTasks = computed(() => tasksStore.tasks.filter(task => !task.completed).slice(0, 4).map(task => ({ id: task.uid, title: task.title, project: task.listName || '收集箱', date: task.dueAt ? new Date(task.dueAt.replace(' ', 'T')).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '未设置', done: task.completed })))

const todayFocusSessions = computed(() => focusSessions.value.filter(item => new Date(item.startedAt).toDateString() === now.value.toDateString()))
const todayFocusSeconds = computed(() => focusRecordSummary(todayFocusSessions.value).totalSeconds)
const todayFocusCount = computed(() => focusRecordSummary(todayFocusSessions.value).sessionCount)
const focusBars = computed(() => {
  const values = Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(now.value); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - 6 + offset)
    return focusRecordSummary(focusSessions.value.filter(item=>new Date(item.startedAt).toDateString()===day.toDateString())).totalSeconds
  })
  const max = Math.max(...values, 1)
  return values.map(value => Math.max(value ? 12 : 3, Math.round(value / max * 100)))
})
const focusWeekdays=computed(()=>Array.from({length:7},(_,offset)=>{const day=new Date(now.value);day.setDate(day.getDate()-6+offset);return ['日','一','二','三','四','五','六'][day.getDay()]}))
const dailyBriefContent=computed(()=>`## 今日提示\n\n- 农历：${culture.value.yearName}年 ${culture.value.lunar}（${culture.value.zodiac}年）\n- 干支：${culture.value.pillars.map(item=>`${item.label}${item.value}`).join(' · ')}\n- 节气：${culture.value.term.current}，${culture.value.term.next}\n- 天气：${weather.value.label}；${weather.value.advice}\n- 民俗参考：宜 ${culture.value.suitable.join('、')||'接口暂未返回'}；忌 ${culture.value.avoid||'接口暂未返回'}\n\n> ${culture.value.quote} —— ${culture.value.author}`)
async function appendDailyBrief(manual=false){
  const day=localDayKey(),source=`quick_log_home_brief_${day}`
  if(notesStore.notes.some(note=>note.captureSource===source)){if(manual)briefMessage.value='今日提示已在日志中';return}
  const note=await notesStore.service().create({title:`${day} 今日提示`,content:dailyBriefContent.value,type:'work_log',status:'active',organizationStatus:'pending',captureSource:source})
  notesStore.notes=[note,...notesStore.notes];briefMessage.value='已追加到今日日志'
}
async function quickCreate() {
  const content = quickText.value.trim(); if (!content) return
  const note = await notesStore.create({ title: content.slice(0, 30), content })
  quickText.value = ''
  await router.push({ path: '/notes', query: { note: note.uid } })
}
const homeRefreshing=ref(false),homeRefreshMessage=ref(''),calendarRevision=ref(0)
let homeActive=true
onBeforeUnmount(()=>{homeActive=false})
async function refreshHome(){
 if(homeRefreshing.value)return
 const session=accountSessionRevision(),current=()=>homeActive&&session===accountSessionRevision()
 homeRefreshing.value=true;homeRefreshMessage.value=''
 try{
  const from=new Date();from.setDate(from.getDate()-6);from.setHours(0,0,0,0)
  const results=await Promise.allSettled([notesStore.service().list(),tasksStore.load({force:true}),readFocusRecords(from.toISOString(),new Date().toISOString()),isCommunityEdition?Promise.resolve({label:'本地模式',advice:'社区版未启用联网天气',source:'本机'}):loadDailyWeather()])
  if(!current())return
  const failures:string[]=[]
  if(results[0].status==='fulfilled')notesStore.$patch({notes:results[0].value,loadedAt:Date.now(),invalidated:false});else failures.push('笔记')
  if(results[1].status==='rejected'||tasksStore.error)failures.push('任务')
  if(results[2].status==='fulfilled'){focusSessions.value=results[2].value.items;if(results[2].value.localOnly)failures.push('云端专注记录')}else failures.push('专注记录')
  if(results[3].status==='fulfilled')weather.value=results[3].value;else failures.push('天气')
  calendarRevision.value++
  homeRefreshMessage.value=failures.length?failures.join('、')+'未能刷新，已保留上次可用数据。':''
 }catch{if(current())homeRefreshMessage.value='首页刷新失败，请稍后重试'}finally{if(homeActive)homeRefreshing.value=false}
}
onMounted(async()=>{const session=accountSessionRevision();await refreshHome();if(homeActive&&session===accountSessionRevision()&&autoDailyBrief.value)await appendDailyBrief()})

</script>

<template>
  <div class="page home-page">
    <section class="home-greeting">
      <div><h1>欢迎回来</h1><p>“{{culture.quote}}”　<span>—— {{culture.author}}</span></p></div><button class="home-refresh" :disabled="homeRefreshing" @click="refreshHome">{{homeRefreshing?'刷新中…':'刷新'}}</button>
    </section>


    <p v-if="homeRefreshMessage" class="home-refresh-message" role="status">{{homeRefreshMessage}}</p>
    <div class="home-columns">
      <div class="home-main-column">
        <section class="quick-capture surface" aria-label="快速记录">
          <h2 class="quick-capture-title">快速记录</h2>
          <label><span>✎</span><input v-model="quickText" placeholder="写下此刻的想法…" @keyup.enter="quickCreate" /></label>
          <footer><div><button @click="router.push({path:'/notes',query:{import:'file'}})">导入文件</button></div><div><button class="capture-submit" :disabled="!quickText.trim()" @click="quickCreate">记录</button></div></footer>
        </section>

        <div class="home-split">
          <section class="surface compact-section">
            <div class="section-heading"><h2>待办任务 <small>{{ recentTasks.length }}</small></h2><a @click="router.push('/tasks')">全部任务 ›</a></div>
            <label v-for="task in recentTasks" :key="task.id" class="mini-task">
              <input type="checkbox" :checked="task.done" />
              <span><strong>{{ task.title }}</strong><small>{{ task.project }}</small></span><time>{{ task.date }}</time>
            </label>
            <button class="inline-add" @click="router.push('/tasks')">＋ 新建任务</button>
          </section>

          <section class="surface compact-section">
            <div class="section-heading"><h2>最近内容</h2><a @click="router.push('/notes')">全部内容 ›</a></div>
            <article v-for="note in recentNotes" :key="note.id" class="mini-note" @click="router.push({path:'/notes',query:{note:note.id}})">
              <span class="doc-mark">▤</span><div><strong>{{ note.title }}</strong><small>{{ note.excerpt }}</small></div><time>{{ note.time }}</time>
            </article>
          </section>
        </div>

        <section class="surface focus-summary"><div class="section-heading"><h2>◎　专注</h2></div><div class="focus-current"><span class="focus-dot">◎</span><div><strong>{{Math.round(todayFocusSeconds/60)}} <small>分钟</small></strong><small>今日专注时长</small></div><button @click="router.push('/focus')">查看记录</button></div><div class="focus-week"><header>最近 7 天</header><div class="bar-chart"><span v-for="(height,index) in focusBars" :key="index"><i :style="{height:`${Math.max(5,height)}%`}"/><small>{{focusWeekdays[index]}}</small></span></div></div></section>

      </div>

      <aside class="home-side-column">
        <section class="surface home-calendar-card" aria-label="首页月历"><MonthCalendar compact almanac :clock="now" :weather="weather" :refresh-key="calendarRevision" />
        </section>

      </aside>
    </div>
  </div>
</template>

<style scoped>
.home-greeting{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.home-greeting h1{font-size:22px}.home-greeting p{font-size:12px;color:var(--pc-muted)}
.home-refresh{flex:none;padding:8px 12px;border:1px solid var(--pc-border);border-radius:8px;background:#fff;color:var(--pc-primary);font:inherit;cursor:pointer}.home-refresh:hover{background:var(--pc-primary-soft,#eef5f1)}.home-refresh:disabled{opacity:.6;cursor:wait}
.home-refresh-message{font-size:12px;color:#a15e25;margin:0 0 14px}
.home-page .home-columns{grid-template-columns:minmax(0,1fr) 320px;align-items:start}
.home-page .home-main-column,.home-page .home-side-column{min-width:0;gap:16px}
.home-calendar-card{overflow:hidden;padding:0}.home-page .compact-section{min-height:220px}
.quick-capture-title{font-size:13px;margin:0 0 10px;color:var(--pc-text)}
@media(max-width:1100px){.home-page .home-columns{grid-template-columns:minmax(0,1fr) 290px}.home-page .home-split{grid-template-columns:1fr}.home-page .compact-section{min-height:0}}
@media(max-width:900px){.home-page .home-columns{grid-template-columns:minmax(0,1fr)}.home-calendar-card{max-width:380px}}
</style>
