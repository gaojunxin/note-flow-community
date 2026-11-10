import type { VaultItem } from './vault'
import * as XLSX from 'xlsx'

export type VaultImportItem = Omit<VaultItem,'uid'|'createdAt'|'updatedAt'> & { importScopeExplicit?:boolean }
export interface VaultImportPreview { items:VaultImportItem[]; errors:Array<{row:number;message:string}> }
export interface VaultImportContext { projects?:Array<{uid:string;name:string;areaUid?:string|null}>;areas?:Array<{uid:string;name:string}> }

const aliases:Record<string,string[]>={
  title:['title','name','名称','标题'],url:['url','website','网址','网站'],username:['username','account','login','用户名','账号'],email:['email','e-mail','邮箱','电子邮箱'],password:['password','token','密码','令牌'],accessKey:['accesskey','accesskeyid','access key (ak)','ak','访问密钥id','访问密钥 (ak)'],secretKey:['secretkey','accesskeysecret','secret key (sk)','sk','访问密钥','秘密密钥 (sk)'],notes:['notes','note','备注','说明','保密内容','保密内容/备注','保密内容 / 备注'],category:['category','folder','分类','目录'],ownership:['ownership','归属','归属类型'],organization:['organization','org','组织','所属组织','公司'],owner:['owner','负责人','责任人'],tags:['tags','tag','标签'],credentialType:['credentialtype','type','凭据类型','类型'],status:['status','状态'],environment:['environment','env','环境'],host:['host','hostname','ip','主机'],port:['port','端口'],databaseName:['databasename','database','数据库'],privateKey:['privatekey','sshkey','私钥'],licenseKey:['licensekey','许可证','许可证密钥','序列号'],issuer:['issuer','发行方','颁发者'],accountName:['accountname','账户名称','显示账号'],totpSecret:['totpsecret','otpsecret','动态码密钥','totp密钥'],recoveryCodes:['recoverycodes','backupcodes','备用验证码','恢复码'],expiresAt:['expiresat','expiry','过期时间','到期时间'],rotatedAt:['rotatedat','轮换时间','最后轮换时间'],lastVerifiedAt:['lastverifiedat','最近验证时间','最后验证时间'],revokedReason:['revokedreason','作废原因'],reminderDays:['reminderdays','提前提醒天数'],scopeType:['scopetype','归属范围'],projectUid:['projectuid','项目id'],projectName:['projectname','所属项目','项目名称'],areaUid:['areauid','领域id'],areaName:['areaname','所属领域','领域名称']
}
aliases.appId=['appid','app id','应用id','应用 id']
aliases.appCode=['appcode','app code','应用代码']
aliases.tenantId=['tenantid','tenant id','租户id','租户 id']
aliases.secretContent=['secretcontent','secret content','保密内容','敏感内容','保密内容/备注','保密内容 / 备注']
aliases.notes=['notes','note','备注','说明']
aliases.password.push('password / token','password/token','密码 / Token','密码/Token')
const normalizedAliases=new Map(Object.entries(aliases).flatMap(([field,names])=>names.map(name=>[name.toLocaleLowerCase().replace(/[\s_-]/g,''),field])))
const types=new Set(['login','server','database','api_key','cloud','license','totp','recovery_codes','certificate','secure_note','custom']),statuses=new Set(['active','expiring','expired','revoked','compromised','archived']),environments=new Set(['','local','home','development','testing','staging','production','dmz','internal']),ownerships=new Set(['','personal','home','work','enterprise'])
const value=(row:Record<string,unknown>,field:string)=>String(row[field]??'').trim()

function normalizeRow(source:Record<string,unknown>,context:VaultImportContext={}):VaultImportItem{
  const row:Record<string,unknown>={}
  for(const [key,item] of Object.entries(source)){const field=normalizedAliases.get(key.toLocaleLowerCase().replace(/[\s_-]/g,''));if(field)row[field]=item}
  const credentialType=types.has(value(row,'credentialType'))?value(row,'credentialType') as VaultImportItem['credentialType']:'login'
  const status=statuses.has(value(row,'status'))?value(row,'status') as VaultImportItem['status']:'active'
  const environment=environments.has(value(row,'environment'))?value(row,'environment') as VaultImportItem['environment']:''
  const ownership=ownerships.has(value(row,'ownership'))?value(row,'ownership') as VaultImportItem['ownership']:''
  const requestedScope=value(row,'scopeType').toLocaleLowerCase(),projectName=value(row,'projectName'),areaUid=value(row,'areaUid'),areaName=value(row,'areaName')
  let projectUid=value(row,'projectUid')||null
  const importScopeExplicit=Boolean(requestedScope||projectUid||projectName||areaUid||areaName)
  if(requestedScope&&!['personal','project'].includes(requestedScope))throw new Error('归属范围只能填写 personal 或 project')
  if(requestedScope==='personal'&&(projectUid||projectName))throw new Error('个人凭据不能同时指定项目')
  const projects=context.projects||[],areas=context.areas||[]
  let matchedAreaUid=areaUid
  if(areaUid&&context.areas&&!areas.some(item=>item.uid===areaUid))throw new Error(`领域ID不存在：${areaUid}`)
  if(!matchedAreaUid&&areaName){
    if(!context.areas)throw new Error('领域列表尚未加载，无法按名称匹配')
    const areaMatches=areas.filter(item=>item.name.trim()===areaName)
    if(areaMatches.length!==1)throw new Error(areaMatches.length?'领域名称重复，请填写领域ID':`领域不存在：${areaName}`)
    matchedAreaUid=areaMatches[0].uid
  }
  if(requestedScope!=='personal'&&(projectUid||projectName||requestedScope==='project')){
    if(projectUid&&context.projects&&!projects.some(item=>item.uid===projectUid))throw new Error(`项目ID不存在：${projectUid}`)
    if(projectUid&&matchedAreaUid&&projects.length&&projects.find(item=>item.uid===projectUid)?.areaUid!==matchedAreaUid)throw new Error('项目与所属领域不一致')
    if(!projectUid&&projectName&&projects.length){
      let candidates=projects.filter(item=>item.name.trim()===projectName)
      if(matchedAreaUid)candidates=candidates.filter(item=>item.areaUid===matchedAreaUid)
      if(candidates.length!==1)throw new Error(candidates.length?'项目名称重复，请填写领域或项目ID':`项目不存在：${projectName}`)
      projectUid=candidates[0].uid
    }
    if(!projectUid&&projectName)throw new Error('项目列表尚未加载，无法按名称匹配')
    if(requestedScope==='project'&&!projectUid)throw new Error('项目凭据必须填写所属项目或项目ID')
  }
  if(projectUid&&!matchedAreaUid)matchedAreaUid=projects.find(item=>item.uid===projectUid)?.areaUid||''
  const recoveryCodes=value(row,'recoveryCodes').split(/[\n,;，；]+/).map(code=>code.trim()).filter(Boolean).map(code=>({value:code,used:false}))
  const legacyUrl=value(row,'url'),sourceUrls=Array.isArray(source.urls)?source.urls:[],urls=sourceUrls.map(item=>typeof item==='string'?{label:'',url:item}:{label:String((item as any)?.label||''),url:String((item as any)?.url||'')}).filter(item=>item.url.trim())
  const dynamic=new Map(Object.entries(source).map(([key,item])=>[key.toLocaleLowerCase().replace(/[\s_-]/g,''),String(item??'').trim()]))
  for(let index=2;index<=20;index++){const url=dynamic.get(`网址${index}`)||dynamic.get(`url${index}`)||dynamic.get(`website${index}`);if(url)urls.push({label:dynamic.get(`网址${index}名称`)||dynamic.get(`url${index}label`)||dynamic.get(`website${index}label`)||`网址 ${index}`,url})}
  for(const [key,item] of Object.entries(source)){const match=key.trim().match(/^(?:网址|url|website)\s*[：:]\s*(.+)$/i);if(match&&String(item??'').trim())urls.push({label:match[1].trim(),url:String(item).trim()})}
  if(legacyUrl&&!urls.some(item=>item.url.trim()===legacyUrl))urls.unshift({label:'主网址',url:legacyUrl})
  return{title:value(row,'title'),url:urls[0]?.url.trim()||'',urls:urls.map((item,index)=>({label:item.label.trim()||(index===0?'主网址':`网址 ${index+1}`),url:item.url.trim()})),username:value(row,'username'),email:value(row,'email'),password:value(row,'password'),accessKey:value(row,'accessKey'),secretKey:value(row,'secretKey'),appId:value(row,'appId'),appCode:value(row,'appCode'),tenantId:value(row,'tenantId'),secretContent:value(row,'secretContent'),notes:value(row,'notes'),category:value(row,'category')||'登录账号',ownership,organization:value(row,'organization'),owner:value(row,'owner'),tags:value(row,'tags').split(/[,，;；]+/).map(tag=>tag.trim()).filter(Boolean),scopeType:projectUid?'project':'personal',areaUid:matchedAreaUid||null,projectUid,credentialType,status,environment,host:value(row,'host'),port:value(row,'port'),databaseName:value(row,'databaseName'),privateKey:value(row,'privateKey'),licenseKey:value(row,'licenseKey'),issuer:value(row,'issuer'),accountName:value(row,'accountName'),totpSecret:value(row,'totpSecret'),recoveryCodes,expiresAt:value(row,'expiresAt'),rotatedAt:value(row,'rotatedAt'),lastVerifiedAt:value(row,'lastVerifiedAt'),revokedReason:value(row,'revokedReason'),reminderDays:Number(value(row,'reminderDays')||30),importScopeExplicit}
}

function csvRows(text:string){
  const rows:string[][]=[],row:string[]=[],clean=text.replace(/^\uFEFF/,''),current={value:''};let quoted=false
  const pushCell=()=>{row.push(current.value);current.value=''},pushRow=()=>{if(row.some(cell=>cell.trim()))rows.push([...row]);row.length=0}
  for(let index=0;index<clean.length;index++){const char=clean[index];if(char==='"'){if(quoted&&clean[index+1]==='"'){current.value+='"';index++}else quoted=!quoted}else if(char===','&&!quoted)pushCell();else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&clean[index+1]==='\n')index++;pushCell();pushRow()}else current.value+=char}
  pushCell();pushRow();return rows
}

export function parseVaultImport(input:string|ArrayBuffer,filename='import.csv',context:VaultImportContext={}):VaultImportPreview{
  let rows:Record<string,unknown>[]
  const lowerName=filename.toLocaleLowerCase()
  if(lowerName.endsWith('.xlsx')||lowerName.endsWith('.xls')){
    const workbook=XLSX.read(input,{type:typeof input==='string'?'binary':'array',cellDates:false})
    const sheetName=workbook.SheetNames[0]
    if(!sheetName)throw new Error('Excel 文件中没有工作表')
    rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(workbook.Sheets[sheetName],{defval:'',raw:false})
    if(!rows.length)throw new Error('Excel 至少需要表头和一行数据')
  }else if(lowerName.endsWith('.json')){
    if(typeof input!=='string')throw new Error('无法读取 JSON 文件')
    const parsed=JSON.parse(input)
    if(parsed?.schema==='jiyu-private-vault')throw new Error('这是加密备份，请使用“导入加密备份”恢复')
    const source=Array.isArray(parsed)?parsed:Array.isArray(parsed?.items)?parsed.items:null
    if(!source)throw new Error('JSON 必须是凭据数组，或包含 items 数组')
    rows=source.filter((item:unknown)=>item&&typeof item==='object') as Record<string,unknown>[]
  }else{
    if(typeof input!=='string')throw new Error('无法读取 CSV 文件')
    const values=csvRows(input);if(values.length<2)throw new Error('CSV 至少需要表头和一行数据')
    const headers=values[0];rows=values.slice(1).map(cells=>Object.fromEntries(headers.map((header,index)=>[header,cells[index]||''])))
  }
  const items:VaultImportItem[]=[],errors:VaultImportPreview['errors']=[]
  rows.forEach((row,index)=>{try{const item=normalizeRow(row,context);if(!item.title)errors.push({row:index+2,message:'缺少名称'});else if(!item.password&&!item.accessKey&&!item.secretKey&&!item.appId&&!item.appCode&&!item.tenantId&&!item.secretContent&&!item.privateKey&&!item.licenseKey&&!item.totpSecret&&!item.recoveryCodes?.length)errors.push({row:index+2,message:'缺少凭据内容'});else items.push(item)}catch(source){errors.push({row:index+2,message:source instanceof Error?source.message:'归属信息无效'})}})
  return{items,errors}
}

export function vaultImportIdentity(item:Pick<VaultItem,'title'|'url'|'username'|'host'|'credentialType'> & Partial<Pick<VaultItem,'areaUid'|'projectUid'>>){const base=[item.credentialType||'login',item.title,item.host||item.url,item.username].map(value=>(value||'').trim().toLocaleLowerCase()).join('|');return item.areaUid||item.projectUid?base+'|'+JSON.stringify([item.areaUid||null,item.projectUid||null]):base}

const quote=(value:string)=>`"${value.replace(/"/g,'""')}"`
export function vaultImportTemplate(){
  const headers=['名称','凭据类型','状态','网址','用户名','邮箱','密码 / Token','Access Key (AK)','Secret Key (SK)','App ID','App Code','租户 ID','许可证密钥','发行方','TOTP密钥','备用验证码','到期时间','提前提醒天数','分类','环境','主机','端口','数据库','私钥','保密内容','备注','网址2名称','网址2','网址3名称','网址3','归属','所属组织','负责人','标签','最后轮换时间','最后验证时间','归属范围','所属领域','领域ID','所属项目','项目ID']
  const samples=[['示例系统账号','login','active','https://example.com','example-user','user@example.com','请删除示例密码','','','','','','','','','','2027-12-31','30','账号','','','','','','','填写完成后删除示例行','管理后台','https://admin.example.com','API 控制台','https://api.example.com','personal','','本人','常用','',''],['示例云服务密钥','api_key','active','https://console.example.com','','owner@example.com','','EXAMPLE-AK','请删除示例SK','example-app','请删除示例AppCode','tenant-1','','','','','','30','云服务','production','','','','','','填写密钥用途','','','','','work','示例公司','张三','生产,高风险','2026-01-01','2026-06-01'],['示例保密地址','secure_note','active','','','','','','','','','','','','','','','30','私密资料','','','','','','这里可以填写需要隐藏的保密内容','这里填写普通备注','','','','','personal','','本人','私密资料','','']]
  return `\uFEFF${[headers,...samples].map(row=>row.map(quote).join(',')).join('\r\n')}\r\n`
}

export function vaultImportExcelTemplate(){
  const headers=['名称','凭据类型','状态','网址','用户名','邮箱','密码 / Token','Access Key (AK)','Secret Key (SK)','App ID','App Code','租户 ID','许可证密钥','发行方','TOTP密钥','备用验证码','到期时间','提前提醒天数','分类','环境','主机','端口','数据库','私钥','保密内容','备注','网址2名称','网址2','网址3名称','网址3','归属','所属组织','负责人','标签','最后轮换时间','最后验证时间','归属范围','所属领域','领域ID','所属项目','项目ID']
  const samples=[['示例系统账号','login','active','https://example.com','example-user','user@example.com','请删除本行示例密码','','','','','','','','','','2027-12-31','30','账号','','','','','','','填写完成后删除示例行','管理后台','https://admin.example.com','API 控制台','https://api.example.com','personal','','本人','常用','',''],['示例云服务密钥','api_key','active','https://console.example.com','','owner@example.com','','EXAMPLE-AK','请删除示例SK','example-app','请删除示例AppCode','tenant-1','','','','','','30','云服务','production','','','','','','填写密钥用途','','','','','work','示例公司','张三','生产,高风险','2026-01-01','2026-06-01'],['示例保密地址','secure_note','active','','','','','','','','','','','','','','','30','私密资料','','','','','','这里可以填写需要隐藏的保密内容','这里填写普通备注','','','','','personal','','本人','私密资料','','']]
  const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([headers,...samples])
  sheet['!cols']=[18,16,12,30,20,26,24,24,26,22,24,22,24,18,26,32,14,14,16,16,22,10,18,32,36,36,18,30,18,30,14,22,16,26,16,16,14,18,38,20,38].map(wch=>({wch}))
  sheet['!autofilter']={ref:'A1:AO4'}
  XLSX.utils.book_append_sheet(workbook,sheet,'凭据')
  const help=XLSX.utils.aoa_to_sheet([['填写说明'],['必填：名称；密码 / Token、AK、SK、App ID、App Code、租户 ID、私钥、许可证、TOTP 密钥、备用验证码或“保密内容”至少填写一项。'],['主网址填写“网址”；其他网址使用“网址2名称 + 网址2”“网址3名称 + 网址3”。需要更多时可继续添加到网址20，列顺序不限。'],['也可使用“网址：管理后台”“网址：API 控制台”这样的自定义表头，冒号后的文字作为网址名称。'],['App ID、App Code、租户 ID 请分别填写；App Code 与保密内容在详情中默认隐藏。'],['备注用于普通说明并直接展示；不要把密码、App Code 或其他秘密填入备注。'],['归属可填：personal、home、work、enterprise；标签使用逗号分隔。'],['归属范围列仅兼容旧模板，可留空。所属领域和所属项目分别填写，项目可留空；同名项目请补充领域或项目ID。'],['领域可独立填写，不要求关联项目。填写项目时领域必须与项目一致；未填写的历史数据不会自动归为个人。'],['未指定领域或项目等归属信息的记录，可在导入窗口中选择默认领域及可选项目。'],['负责人、最后轮换时间和最后验证时间用于后续审计；日期建议使用 YYYY-MM-DD。'],['旧模板的“保密内容 / 备注”列仍可导入，并统一按保密内容处理。'],['云服务 AK/SK：凭据类型填写 api_key，分别填写“Access Key (AK)”和“Secret Key (SK)”。'],['凭据类型：login、server、database、api_key、cloud、license、totp、recovery_codes、certificate、secure_note、custom。'],['状态：active、expiring、expired、revoked、compromised、archived。'],['备用验证码可用换行、逗号或分号分隔；到期时间建议使用 YYYY-MM-DD。'],['环境可填：local、home、development、testing、staging、production、dmz、internal，或留空。'],['导入前请删除“凭据”工作表中的三条示例行；导入成功后请安全删除本地明文文件。']])
  help['!cols']=[{wch:88}];XLSX.utils.book_append_sheet(workbook,help,'填写说明')
  return XLSX.write(workbook,{bookType:'xlsx',type:'array'}) as ArrayBuffer
}
