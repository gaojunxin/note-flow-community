import {journalPeriod,type ReviewPeriod} from '@note-flow/core'
export type ReviewBucket={label:string;start:string;end:string;prompt:string}
export const periodIntroductions:Record<ReviewPeriod,string>={daily:'当天记录',weekly:'沿着七天，找回本周值得记住的事',monthly:'按日历周回看，发现持续的变化',quarterly:'对照三个月，决定继续、停止与改变',yearly:'串起四个季度，回看一年的经历与认识'}
export function reviewBuckets(period:ReviewPeriod,anchor:string):ReviewBucket[]{
  const range=journalPeriod(period,anchor),result:ReviewBucket[]=[]
  const date=(value:string)=>new Date(value+'T00:00:00Z'),key=(value:Date)=>value.toISOString().slice(0,10)
  const push=(label:string,start:string,end:string,prompt='')=>result.push({label,start:start<range.start?range.start:start,end:end>range.end?range.end:end,prompt})
  if(period==='weekly'){
    for(let i=0;i<7;i++){const day=date(range.start);day.setUTCDate(day.getUTCDate()+i);push(['周一','周二','周三','周四','周五','周六','周日'][i],key(day),key(day))}
  }else if(period==='monthly'){
    const day=date(range.start);day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7)
    while(key(day)<=range.end){const end=new Date(day);end.setUTCDate(end.getUTCDate()+6);push(`第 ${result.length+1} 周`,key(day),key(end));day.setUTCDate(day.getUTCDate()+7)}
  }else if(period==='quarterly'||period==='yearly'){
    const start=date(range.start),step=period==='yearly'?3:1,count=period==='yearly'?4:3
    for(let i=0;i<count;i++){const from=new Date(start);from.setUTCMonth(from.getUTCMonth()+i*step);const to=new Date(from);to.setUTCMonth(to.getUTCMonth()+step);to.setUTCDate(0);push(period==='yearly'?`第 ${i+1} 季度`:`${from.getUTCMonth()+1} 月`,key(from),key(to),period==='yearly'?'有哪些经历值得留在年度总结中？':['当时的起点与期待','过程中的变化与尝试','现在的认识与调整'][i])}
  }
  return result
}
