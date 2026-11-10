/** Keep the header indicator and the sync page on the same runtime conditions. */
export function syncRuntimeIssues(input:{deliveryError?:string;notePhase:string;noteError?:string}) {
  const issues:Array<{kind:string;message:string}>=[]
  if(input.notePhase==='conflict')issues.push({kind:'conflict',message:'存在笔记同步冲突，请在下方选择保留的版本。'})
  if(input.notePhase==='error')issues.push({kind:'note',message:input.noteError?.trim()||'笔记同步未完成，请重试同步。'})
  if(input.deliveryError?.trim()&&!issues.some(issue=>issue.message===input.deliveryError!.trim()))issues.push({kind:'delivery',message:input.deliveryError.trim()})
  return issues
}
