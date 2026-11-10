/** Visibility-aware single-flight polling. Resume events coalesce with active work. */
export function startBackgroundRefresh(run:()=>Promise<unknown>,host:{window:Pick<Window,'setInterval'|'clearInterval'|'addEventListener'|'removeEventListener'>;document:Pick<Document,'visibilityState'|'addEventListener'|'removeEventListener'>;now?:()=>number}){
  const {window,document}=host,now=host.now||Date.now
  let stopped=false,running=false,lastAttempt=now()
  const refresh=async()=>{
    if(stopped||running)return
    running=true;lastAttempt=now()
    try{await run()}catch{/* The notification store presents its own failure state. */}finally{running=false}
  }
  const resume=()=>{if(document.visibilityState!=='hidden'&&now()-lastAttempt>=30_000)void refresh()}
  const online=()=>{void refresh()}
  const timer=window.setInterval(()=>{if(now()-lastAttempt>=(document.visibilityState==='hidden'?300_000:30_000))void refresh()},30_000)
  window.addEventListener('online',online);window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume)
  return()=>{stopped=true;window.clearInterval(timer);window.removeEventListener('online',online);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume)}
}
