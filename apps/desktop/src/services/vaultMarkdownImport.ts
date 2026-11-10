import type {VaultImportItem,VaultImportPreview} from './vaultImport'

const fieldAliases:Record<string,string>={
 '用户名':'username','账号':'username','账户':'username','user':'username','username':'username','login':'username',
 '密码':'password','口令':'password','password':'password','passwd':'password','token':'password','api key':'password','apikey':'password','secret':'password',
 '网址':'url','网站':'url','url':'url','website':'url','登录地址':'url',
 '主机':'host','服务器':'host','host':'host','hostname':'host','ip':'host','ip地址':'host',
 '端口':'port','port':'port','数据库':'databaseName','数据库名':'databaseName','database':'databaseName','dbname':'databaseName',
 '分类':'category','category':'category','环境':'environment','environment':'environment','env':'environment',
 '许可证':'licenseKey','许可证密钥':'licenseKey','序列号':'licenseKey','license':'licenseKey','license key':'licenseKey',
 '发行方':'issuer','颁发者':'issuer','issuer':'issuer','vendor':'issuer',
 'totp':'totpSecret','totp secret':'totpSecret','otp secret':'totpSecret','动态码密钥':'totpSecret',
 '备用验证码':'recoveryCodes','恢复码':'recoveryCodes','backup codes':'recoveryCodes','recovery codes':'recoveryCodes',
 '到期时间':'expiresAt','过期时间':'expiresAt','expires':'expiresAt','expiry':'expiresAt','备注':'notes','说明':'notes','notes':'notes'
}
const normalizeKey=(value:string)=>value.toLocaleLowerCase().replace(/[*_`#：:（）()[\]]/g,'').replace(/\s+/g,' ').trim()
const cleanValue=(value:string)=>value.trim().replace(/^['"`]|['"`]$/g,'').trim()
const heading=(value:string)=>value.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim()
const sections=(text:string)=>{const matches=[...text.matchAll(/^#{1,2}\s+.+$/gm)];if(matches.length<=1)return[text];return matches.map((match,index)=>text.slice(match.index, matches[index+1]?.index??text.length))}

function parseSection(text:string,fileName:string,index:number):VaultImportItem|null{
 const fields:Record<string,string>={},notes:string[]=[]
 for(const raw of text.split(/\r?\n/)){
  const line=raw.trim().replace(/^[-*+]\s+/,''),match=line.match(/^([^:：]{1,30})[:：]\s*(.+)$/)
  if(!match)continue
  const field=fieldAliases[normalizeKey(match[1])]
  if(field)fields[field]=fields[field]?`${fields[field]}\n${cleanValue(match[2])}`:cleanValue(match[2])
  else if(line.length<500)notes.push(line)
 }
 const privateKey=text.match(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/)?.[0]||''
 const otpauth=text.match(/otpauth:\/\/totp\/[^\s)]+/i)?.[0]
 if(otpauth)fields.totpSecret=otpauth
 const title=heading(text)||fileName.replace(/\.md$/i,'')+(index?` ${index+1}`:'')
 const url=fields.url||text.match(/https?:\/\/[^\s)>]+/)?.[0]||''
 const recoveryCodes=(fields.recoveryCodes||'').split(/[\n,;，；\s]+/).map(value=>value.trim()).filter(value=>value.length>=4).map(value=>({value,used:false}))
 let credentialType:VaultImportItem['credentialType']='login'
 if(fields.totpSecret)credentialType='totp';else if(recoveryCodes.length)credentialType='recovery_codes';else if(fields.licenseKey)credentialType='license';else if(privateKey)credentialType='server';else if(fields.databaseName)credentialType='database';else if(fields.host)credentialType='server';else if(/api|token/i.test(text))credentialType='api_key'
 if(!fields.password&&!privateKey&&!fields.licenseKey&&!fields.totpSecret&&!recoveryCodes.length)return null
 return{title,url,username:fields.username||'',password:fields.password||'',notes:[fields.notes,...notes].filter(Boolean).join('\n'),category:fields.category||'Markdown 导入',scopeType:'personal',projectUid:null,credentialType,status:'active',environment:(['development','testing','staging','production'].includes(fields.environment)?fields.environment:'') as VaultImportItem['environment'],host:fields.host||'',port:fields.port||'',databaseName:fields.databaseName||'',privateKey,licenseKey:fields.licenseKey||'',issuer:fields.issuer||'',accountName:'',totpSecret:fields.totpSecret||'',recoveryCodes,expiresAt:fields.expiresAt||'',rotatedAt:'',lastVerifiedAt:'',revokedReason:'',reminderDays:30,totpAlgorithm:'SHA-1',totpDigits:6,totpPeriod:30}
}

export function parseVaultMarkdown(text:string,fileName='credential.md'):VaultImportPreview{
 const items:VaultImportItem[]=[],errors:VaultImportPreview['errors']=[]
 sections(text).forEach((section,index)=>{const item=parseSection(section,fileName,index);if(item)items.push(item);else errors.push({row:index+1,message:`${fileName}：未识别到密码、私钥、许可证、TOTP 或备用码`})})
 return{items,errors}
}
