/** 首页共用本地历法信息；节气与宜忌沿用既有简化规则，作为民俗参考。 */
const quotes=[
  ['不积跬步，无以至千里。','荀子'],
  ['知者行之始，行者知之成。','王阳明'],
  ['日日行，不怕千万里；常常做，不怕千万事。','金缨'],
  ['路虽远，行则将至；事虽难，做则必成。','荀子'],
  ['纸上得来终觉浅，绝知此事要躬行。','陆游'],
  ['千磨万击还坚劲，任尔东西南北风。','郑燮'],
  ['长风破浪会有时，直挂云帆济沧海。','李白'],
  ['博观而约取，厚积而薄发。','苏轼'],
  ['凡事预则立，不预则废。','礼记'],
  ['苟日新，日日新，又日新。','礼记']
] as const
const stems=['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'],branches=['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'],animals=['鼠','牛','虎','兔','龙','蛇','马','羊','猴','鸡','狗','猪']
const solarTerms=[['小寒',1,5],['大寒',1,20],['立春',2,4],['雨水',2,19],['惊蛰',3,6],['春分',3,21],['清明',4,5],['谷雨',4,20],['立夏',5,6],['小满',5,21],['芒种',6,6],['夏至',6,21],['小暑',7,7],['大暑',7,23],['立秋',8,8],['处暑',8,23],['白露',9,8],['秋分',9,23],['寒露',10,8],['霜降',10,23],['立冬',11,7],['小雪',11,22],['大雪',12,7],['冬至',12,22]] as const
const officers=['建','除','满','平','定','执','破','危','成','收','开','闭']
const officerActivities:Record<string,{suitable:string[];avoid:string[]}>=
{建:{suitable:['出行','上任','祈福'],avoid:['动土','安葬']},除:{suitable:['清洁','沐浴','求医'],avoid:['嫁娶','远行']},满:{suitable:['祈福','会友','庆典'],avoid:['诉讼','服药']},平:{suitable:['修整','规划','协商'],avoid:['动土','远行']},定:{suitable:['签约','会友','安定'],avoid:['诉讼','出行']},执:{suitable:['执行','修缮','捕捉'],avoid:['开业','迁居']},破:{suitable:['拆除','求医','反思'],avoid:['婚嫁','开业']},危:{suitable:['祭祀','祈福','安床'],avoid:['登高','远行']},成:{suitable:['开业','签约','入学'],avoid:['诉讼','争执']},收:{suitable:['收纳','理财','整理'],avoid:['开业','远行']},开:{suitable:['开业','出行','会友'],avoid:['安葬','封闭']},闭:{suitable:['休养','整理','修缮'],avoid:['开业','出行']}}
const dayNumber=(date:Date)=>Math.floor(new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime()/86400000)
export const localDayKey=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
const ganzhi=(index:number)=>`${stems[(index%10+10)%10]}${branches[(index%12+12)%12]}`
const julianDay=(date:Date)=>{let y=date.getFullYear(),m=date.getMonth()+1;if(m<=2){y--;m+=12}const a=Math.floor(y/100),b=2-a+Math.floor(a/4);return Math.floor(365.25*(y+4716))+Math.floor(30.6001*(m+1))+date.getDate()+b-1524}
const chineseDay=(value:string)=>{const day=Number(value);if(!day)return value;const digits=['一','二','三','四','五','六','七','八','九'];if(day===10)return'初十';if(day===20)return'二十';if(day===30)return'三十';return day<10?`初${digits[day-1]}`:day<20?`十${digits[day-11]||''}`:`廿${digits[day-21]||''}`}
const weekOfYear=(date:Date)=>{const first=new Date(date.getFullYear(),0,1),offset=(first.getDay()+6)%7;return Math.ceil(((date.getTime()-first.getTime())/86400000+1+offset)/7)}
const solarMonthBranch=(date:Date)=>{const month=date.getMonth()+1,day=date.getDate(),boundaries=[5,4,6,5,6,6,7,8,8,8,7,7];let branch=month%12;if(day<boundaries[month-1])branch=(branch+11)%12;return branch}
const termInfo=(date:Date)=>{const points=solarTerms.map(([name,month,day])=>({name,date:new Date(date.getFullYear(),month-1,day)}));let previous=points[0],next=points.at(-1)!;for(const point of points){if(point.date<=date)previous=point;if(point.date>date){next=point;break}}const distance=Math.ceil((next.date.getTime()-new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime())/86400000);return{current:Math.abs(date.getTime()-previous.date.getTime())<86400000?previous.name:`${previous.name}后`,next:`距${next.name}${distance}天`,nextName:next.name}}
export function dailyCulture(date=new Date()){
  const seed=dayNumber(date),quote=quotes[Math.abs(seed)%quotes.length]
  let lunar='农历日期',yearName=ganzhi(date.getFullYear()-4),lunarMonth='',lunarDay=''
  try{const parts=new Intl.DateTimeFormat('zh-CN-u-ca-chinese',{year:'numeric',month:'long',day:'numeric'}).formatToParts(date),part=(type:string)=>parts.find(item=>item.type===type)?.value||'';yearName=part('yearName')||yearName;lunarMonth=part('month');lunarDay=chineseDay(part('day'));lunar=`${lunarMonth}${lunarDay}`}catch{/* 旧WebView不支持农历格式时保留降级文案。 */}
  const dayIndex=(julianDay(date)+49)%60,dayPillar=ganzhi(dayIndex),hourBranch=Math.floor((date.getHours()+1)/2)%12,hourPillar=`${stems[(dayIndex%10*2+hourBranch)%10]}${branches[hourBranch]}`,monthBranch=solarMonthBranch(date),yearStem=Math.max(0,stems.indexOf(yearName[0])),monthPillar=`${stems[(yearStem*2+monthBranch)%10]}${branches[monthBranch]}`
  const zodiac=animals[branches.indexOf(yearName[1])],term=termInfo(date),officer=officers[(dayIndex%12-monthBranch+12)%12],activities=officerActivities[officer]
  return{lunar,lunarMonth,lunarDay,yearName,zodiac,pillars:[{label:'年柱',value:yearName},{label:'月柱',value:monthPillar},{label:'日柱',value:dayPillar},{label:'时柱',value:hourPillar}],term,week:`第 ${weekOfYear(date)} 周`,gregorian:new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'}).format(date),suitable:activities.suitable,avoid:activities.avoid.join('、'),quote:quote[0],author:quote[1],officer,almanacSource:'本地历法',almanacUpdatedAt:'',almanacError:''}
}
export type DailyCulture=ReturnType<typeof dailyCulture>
