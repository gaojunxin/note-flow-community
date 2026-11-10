import type {TaskEntity} from '@note-flow/core/contracts'
export function parseCsv(text:string){const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const char=text[i];if(char==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(char===','&&!quoted){row.push(cell);cell=''}else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(value=>value.trim()))rows.push(row);row=[];cell=''}else cell+=char}row.push(cell);if(row.some(value=>value.trim()))rows.push(row);return rows}
export function parseLocalTickTick(text:string){
 const rows=parseCsv(text.replace(/^\uFEFF/,'')),index=rows.findIndex(row=>row.some(value=>['title','task name','任务名称','标题'].includes(value.trim().toLowerCase())))
 if(index<0)throw Error('CSV 中找不到任务标题列')
 const headers=rows[index].map(value=>value.trim().toLowerCase()),warnings=new Set<string>()
 const value=(row:string[],...keys:string[])=>row[headers.findIndex(name=>keys.includes(name))]?.trim()||''
 const tasks=rows.slice(index+1).filter(row=>value(row,'title','task name','任务名称','标题')).map((row,position)=>{
  const get=(...keys:string[])=>value(row,...keys),title=get('title','task name','任务名称','标题'),status=get('status','状态'),rawRepeat=get('repeat','recurrence','重复'),rawReminder=get('reminder','提醒'),tags=get('tags','标签').split(/[,;，]/).map(s=>s.trim().replace(/^#/,'' )).filter(Boolean),description=[get('content','description','描述','内容')]
  let recurrenceRule:string|null=null
  if(rawRepeat){try{const parts=Object.fromEntries(rawRepeat.toUpperCase().replace(/^RRULE:/,'').split(';').map(p=>p.split('='))),frequency=parts.FREQ?.toLowerCase(),interval=Number(parts.INTERVAL||1);if(['daily','weekly','monthly','yearly'].includes(frequency)&&Number.isInteger(interval)&&interval>0&&Object.keys(parts).every(k=>['FREQ','INTERVAL'].includes(k)))recurrenceRule=JSON.stringify({frequency,interval});else throw Error()}catch{description.push('滴答原重复规则：'+rawRepeat);warnings.add('不支持的重复规则保留在任务描述中，不会转换为其他规则')}}
  const reminders:number[]=[]
  for(const raw of rawReminder.split(/\r?\n/).filter(Boolean)){const match=raw.match(/^(-)?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/),minutes=match?Number(match[2]||0)*1440+Number(match[3]||0)*60+Number(match[4]||0):NaN;if(match&&(match[1]||minutes===0))reminders.push(minutes);else{description.push('滴答原提醒：'+raw);warnings.add('不支持的提醒保留在任务描述中，请导入后核对')}}
  if(status==='-1')description.push('滴答清单原状态：已放弃')
  const priority=Number(get('priority','优先级'))||0
  const task:Partial<TaskEntity>={title,description:description.filter(Boolean).join('\n\n'),listName:get('list name','list','清单名称','清单'),dueAt:get('due date','due time','截止日期','到期时间')||null,startAt:get('start date','开始日期')||null,completed:status==='2'||status==='-1'||/^(completed|done|已完成|完成)$/i.test(status),abandonedAt:status==='-1'?get('completed time','完成时间')||new Date().toISOString():null,allDay:/^(true|1)$/i.test(get('is all day','all day','全天')),priority:priority>=5?3:priority>=3?2:priority>=1?1:0,recurrenceRule,reminderOffsetsMinutes:[...new Set(reminders)].slice(0,5),timezone:get('timezone','time zone','时区')||Intl.DateTimeFormat().resolvedOptions().timeZone}
  return {sourceId:get('task id','id','任务id')||String(position),parentSourceId:get('parent id','parent task id','父任务id'),tags,task}
 })
 const ids=new Set<string>();for(const row of tasks){if(ids.has(row.sourceId))throw Error('CSV 中任务 ID 重复，请检查原始文件');ids.add(row.sourceId);if(row.parentSourceId&&!tasks.some(other=>other.sourceId===row.parentSourceId))warnings.add('部分父任务不在文件中，对应任务将作为顶层任务保留')}
 return {tasks,warnings:[...warnings]}
}
