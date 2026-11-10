import { journalPeriod, type NoteEntity, type ReviewPeriod, type ReviewScope } from '@note-flow/core'

export const reviewGuides: Record<ReviewPeriod, {name:string; prompt:string; sources:string; children:string[]}> = {
  daily:{name:'日回顾',prompt:'回看今天的记录，记下值得记住的事。',sources:'当天记录',children:[]},
  weekly:{name:'周回顾',prompt:'这周发生了什么？有哪些收获、遗留问题？下周想推进什么？',sources:'本周日记与日报',children:['daily']},
  monthly:{name:'月回顾',prompt:'回看几周的变化：取得了什么进展？哪些问题反复出现？',sources:'本月相关周回顾',children:['weekly']},
  quarterly:{name:'季度回顾',prompt:'方向是否需要调整？下一季度继续什么、停止什么、改变什么？',sources:'本季度月回顾',children:['monthly']},
  yearly:{name:'年度回顾',prompt:'这一年有哪些重要经历和认识变化？下一年真正想关注什么？',sources:'本年月度与季度回顾',children:['monthly','quarterly']}
}

export function contentInScope(note:Pick<NoteEntity,'areaUid'|'projectUid'>,scope:ReviewScope,exact=false){
  if(scope.kind==='project')return note.projectUid===scope.projectUid
  if(scope.kind==='area')return note.areaUid===scope.areaUid&&(!exact||!note.projectUid)
  return !exact||(!note.areaUid&&!note.projectUid)
}

export function reviewSummaries(notes:NoteEntity[],period:ReviewPeriod,anchor:string,scope:ReviewScope){
  const range=journalPeriod(period,anchor)
  return notes.filter(note=>!note.deleted&&note.periodType===period&&note.periodStart?.slice(0,10)===range.start&&contentInScope(note,scope,true))
    .sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))
}

export function childReviewSources(notes:NoteEntity[],period:ReviewPeriod,anchor:string,scope:ReviewScope){
  const range=journalPeriod(period,anchor),children=reviewGuides[period].children
  return notes.filter(note=>!note.deleted&&contentInScope(note,scope)&&children.includes(note.periodType||'')&&note.periodStart&&
    note.periodStart.slice(0,10)<=range.end&&(note.periodEnd||note.periodStart).slice(0,10)>=range.start)
    .sort((a,b)=>String(a.periodStart).localeCompare(String(b.periodStart))||a.uid.localeCompare(b.uid))
}

export function reviewExcerpt(content:string){return content.replace(/<!--[\s\S]*?-->/g,'').replace(/[#*>`_\[\]]/g,'').replace(/\s+/g,' ').trim().slice(0,180)}

export function reviewDraftTemplate(period:ReviewPeriod){
  const headings=period==='quarterly'?['阶段变化','继续、停止与改变']:period==='yearly'?['值得记住的经历','收获与认识变化']:['值得记住的事','收获与问题']
  return headings.map(title=>`## ${title}\n\n`).join('')+'## 下期计划\n\n'
}
