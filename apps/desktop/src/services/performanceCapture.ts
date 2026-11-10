import { invoke } from '@tauri-apps/api/core'
import type { InvokeArgs, InvokeOptions } from '@tauri-apps/api/core'
import type { Router } from 'vue-router'
import {appendBounded} from './boundedBuffer'
import { NATIVE_SHADOW_RESULT_EVENT, type NativeShadowResult } from './nativeCore/events'

export type PerformanceSample={name:string;durationMs:number;at:string;detail?:Record<string,string>}
export type LongTask={durationMs:number;startMs:number;path?:string;attribution?:string[]}
export type RouteWindow={id:number;from:string;to:string;startMs:number;endMs:number;settledEndMs?:number;durationMs:number;longTasks:LongTask[]}
export type InvokeSample={command:string;durationMs:number;ok:boolean;at:string}
export type MetricSummary={count:number;p50Ms:number;p95Ms:number;maxMs:number}

const enabled=import.meta.env.VITE_PC_PERF_CAPTURE==='true'
const samples:PerformanceSample[]=[],longTasks:LongTask[]=[],routeWindows:RouteWindow[]=[],invokeSamples:InvokeSample[]=[],shadowSamples:NativeShadowResult[]=[]
let flushing=false
let dirty=false,flushTimer:number|undefined,observer:PerformanceObserver|undefined
const nowIso=()=>new Date().toISOString()
const nextPaint=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
const rounded=(value:number)=>Math.round(value*10)/10

export function summarizeDurations(values:number[]):MetricSummary{
  if(!values.length)return{count:0,p50Ms:0,p95Ms:0,maxMs:0}
  const sorted=[...values].sort((a,b)=>a-b)
  const percentile=(value:number)=>sorted[Math.max(0,Math.ceil(sorted.length*value)-1)]
  return{count:sorted.length,p50Ms:rounded(percentile(.5)),p95Ms:rounded(percentile(.95)),maxMs:rounded(sorted.at(-1)??0)}
}

export function summarizeBy<T>(items:T[],key:(item:T)=>string,duration:(item:T)=>number){
  const groups:Record<string,number[]>={}
  for(const item of items)(groups[key(item)]??=[]).push(duration(item))
  return Object.fromEntries(Object.entries(groups).map(([name,values])=>[name,summarizeDurations(values)]))
}

export function shouldMeasureAccountMenuOpen(target:Element){
  return target.matches('.pc-user')&&target.getAttribute('aria-expanded')!=='true'
}

export function associateLongTask(routes:RouteWindow[],task:LongTask){
  const taskEnd=task.startMs+task.durationMs
  for(const route of routes)if(task.startMs<=(route.settledEndMs??route.endMs)&&taskEnd>=route.startMs)appendBounded(route.longTasks,task,100)
}

export function summarizeShadowResults(items:NativeShadowResult[]){
  const counts:Record<string,number>={}
  for(const item of items){
    const key=`${item.domain}:${item.status}`
    counts[key]=(counts[key]??0)+1
  }
  return{counts,durations:summarizeBy(items,item=>`${item.domain}:${item.status}`,item=>item.durationMs)}
}

async function recordAfterPaint(name:string,start:number,detail?:Record<string,string>){
  await nextPaint();appendBounded(samples,{name,durationMs:performance.now()-start,at:nowIso(),detail});dirty=true
}

/** Starts at the user handler boundary, avoiding fragile delegated DOM-event detection. */
export function measureInteractionAfterPaint(name:string,detail?:Record<string,string>){
  if(!enabled)return
  void recordAfterPaint(name,performance.now(),detail)
}

/**
 * Records commands issued by our frontend/native-core adapter. Calls performed
 * internally by Tauri plugins (notably plugin-sql and plugin-http) are outside
 * this boundary and must not be presented as complete IPC counts.
 */
export async function trackedInvoke<T>(command:string,args?:InvokeArgs,options?:InvokeOptions):Promise<T>{
  if(!enabled)return invoke<T>(command,args,options)
  const start=performance.now()
  try{
    const result=await invoke<T>(command,args,options)
    appendBounded(invokeSamples,{command,durationMs:performance.now()-start,ok:true,at:nowIso()});dirty=true
    return result
  }catch(error){
    appendBounded(invokeSamples,{command,durationMs:performance.now()-start,ok:false,at:nowIso()});dirty=true
    throw error
  }
}

export function buildPerformanceReport(){
  const routeLongTasks=routeWindows.flatMap(route=>route.longTasks)
  return{
    schemaVersion:2,kind:'m19-windows-release-ui',capturedAt:nowIso(),
    environment:{userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:(navigator as Navigator&{deviceMemory?:number}).deviceMemory??null},
    aggregates:{
      samples:summarizeBy(samples,item=>item.name,item=>item.durationMs),
      longTasks:summarizeDurations(longTasks.map(item=>item.durationMs)),
      routeLongTasks:summarizeDurations(routeLongTasks.map(item=>item.durationMs)),
      invokes:summarizeBy(invokeSamples,item=>item.command,item=>item.durationMs),
      invokeFailures:invokeSamples.reduce<Record<string,number>>((result,item)=>{if(!item.ok)result[item.command]=(result[item.command]??0)+1;return result},{}),
      shadow:summarizeShadowResults(shadowSamples)
    },
    coverage:{historyLimit:500,routeTaskLimit:100,aggregates:'retained history only',invokes:'frontend trackedInvoke commands only; Tauri plugin internal IPC is excluded'},
    samples:[...samples],longTasks:[...longTasks],routeWindows:[...routeWindows],invokeSamples:[...invokeSamples],shadowSamples:[...shadowSamples]
  }
}

async function flush(){
  if(!enabled||!dirty||flushing)return
  flushing=true;dirty=false
  try{await invoke('save_performance_report',{report:JSON.stringify(buildPerformanceReport(),null,2)})}catch{dirty=true}finally{flushing=false}
}

export function startPerformanceCapture(router:Router){
  if(!enabled)return()=>undefined
  let routeStart:number|undefined,routeFrom='',routeSequence=0
  void recordAfterPaint('app_first_interactive',0)
  const removeBefore=router.beforeEach((to,from)=>{routeStart=performance.now();routeFrom=from.fullPath;return true})
  const removeAfter=router.afterEach(to=>{
    if(routeStart===undefined)return
    const start=routeStart,from=routeFrom;routeStart=undefined
    void nextPaint().then(()=>{
      const end=performance.now()
      appendBounded(samples,{name:to.path==='/settings'?'settings_route':'route_navigation',durationMs:end-start,at:nowIso(),detail:{from,to:to.fullPath}})
      // Async view data commonly commits just after first paint. Keep first-paint
      // duration intact, but associate long tasks during a short settling tail.
      const route={id:++routeSequence,from,to:to.fullPath,startMs:start,endMs:end,settledEndMs:end+1_000,durationMs:end-start,longTasks:[]}
      appendBounded(routeWindows,route)
      for(const task of longTasks)associateLongTask([route],task)
      dirty=true
    })
  })
  const shadowResult=(event:Event)=>{appendBounded(shadowSamples,(event as CustomEvent<NativeShadowResult>).detail);dirty=true}
  window.addEventListener(NATIVE_SHADOW_RESULT_EVENT,shadowResult)
  if('PerformanceObserver'in window)try{
    observer=new PerformanceObserver(list=>{for(const entry of list.getEntries()){
      const attribution=Array.from((entry as PerformanceEntry&{attribution?:Array<{name?:string;containerType?:string}>}).attribution??[])
        .map(item=>item.name||item.containerType||'unknown')
      const task={durationMs:entry.duration,startMs:entry.startTime,path:router.currentRoute.value.fullPath,...(attribution.length?{attribution}:{})};appendBounded(longTasks,task)
      associateLongTask(routeWindows,task)
      dirty=true
    }});observer.observe({entryTypes:['longtask']})
  }catch{/* WebView may not expose Long Tasks */}
  flushTimer=window.setInterval(()=>{void flush()},5_000)
  const visibility=()=>{if(document.visibilityState==='hidden')void flush()}
  document.addEventListener('visibilitychange',visibility)
  ;(window as Window&{__noteFlowPerf?:{flush:()=>Promise<void>;summary:()=>unknown}}).__noteFlowPerf={flush,summary:buildPerformanceReport}
  return()=>{window.removeEventListener(NATIVE_SHADOW_RESULT_EVENT,shadowResult);document.removeEventListener('visibilitychange',visibility);removeBefore();removeAfter();observer?.disconnect();if(flushTimer)window.clearInterval(flushTimer);void flush()}
}
