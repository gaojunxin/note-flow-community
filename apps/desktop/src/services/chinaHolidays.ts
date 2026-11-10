/** China mainland arrangements: 国办发明电〔2025〕7号, published 2025-11-04. */
export const holidaySource={year:2026,title:'2026 年放假调休安排',url:'https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html'} as const
const holidays:[string,string,string][]=[
 ['2026-01-01','2026-01-03','元旦'],['2026-02-15','2026-02-23','春节'],
 ['2026-04-04','2026-04-06','清明节'],['2026-05-01','2026-05-05','劳动节'],
 ['2026-06-19','2026-06-21','端午节'],['2026-09-25','2026-09-27','中秋节'],
 ['2026-10-01','2026-10-07','国庆节']
]
const workdays=new Set(['2026-01-04','2026-02-14','2026-02-28','2026-05-09','2026-09-20','2026-10-10'])
export function chinaHoliday(dateKey:string):{kind:'holiday'|'workday';label:string}|undefined{
 if(!/^2026-\d{2}-\d{2}$/.test(dateKey))return
 if(workdays.has(dateKey))return {kind:'workday',label:'调休上班'}
 const holiday=holidays.find(([start,end])=>dateKey>=start&&dateKey<=end)
 return holiday?{kind:'holiday',label:holiday[2]}:undefined
}
