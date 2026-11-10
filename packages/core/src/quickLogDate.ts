/** A calendar day is not a journal identity: every quick log needs its own period key. */
export function quickLogPeriodKey(day:string,uid:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!uid||uid.length>128)throw new Error('日志日期或记录编号无效')
 return `quick-log:${day}:${uid}`
}
export function quickLogPeriodDay(value?:string|null){
 const key=String(value||'')
 if(/^\d{4}-\d{2}-\d{2}$/.test(key))return key
 return /^quick-log:(\d{4}-\d{2}-\d{2}):.+$/.exec(key)?.[1]||''
}
