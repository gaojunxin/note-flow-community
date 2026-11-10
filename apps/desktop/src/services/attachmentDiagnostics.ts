import {inferMediaType} from './filePreview'
import {invoke} from '@tauri-apps/api/core'
import {attachmentDiagnosticSource,openAttachmentContent,redownloadAttachment,revealAttachmentFolder,type AttachmentItem} from './attachments'
import {blobDigest} from './blobDigest'
import {isDesktopClient} from './serverConfig'
import {appInfo} from './appInfo'
import {saveLocalExport} from './localFileExport'
import {captureFileExportBoundary} from './fileExportBoundary'
export type CheckState='pass'|'fail'|'skip'|'warning'
export interface AttachmentCheck {stage:string;state:CheckState;code:string;message:string}
export interface SystemProbe {os:string;distribution?:string;packageType:string;desktopSession:boolean;openerAvailable:boolean;defaultApplication?:boolean}
export interface AttachmentDiagnostic {checkedAt:string;version:string;extension:string;mediaType:string;expectedBytes:number;checks:AttachmentCheck[];environment?:SystemProbe;recent:AttachmentAttempt[];canRedownload:boolean;canReveal:boolean;readable:boolean}
export interface AttachmentAttempt {at:string;action:'preview'|'system'|'download'|'reveal';code:string}
const attempts=new Map<string,AttachmentAttempt[]>()
const key=(owner:string,item:AttachmentItem)=>`${owner}:${item.uid}`
export function attachmentErrorCode(source:unknown){
 const value=String((source as any)?.message||source||'')
 const status=Number((source as any)?.response?.status||(source as any)?.status||0)
 if(status===401||status===403)return'ACCESS_DENIED'
 if(status===404||status===410)return'REMOTE_MISSING'
 if(status>=400)return`HTTP_${status}`
 for(const code of ['SYSTEM_OPENER_MISSING','SYSTEM_OPENER_START_FAILED','SYSTEM_OPEN_STATUS_FAILED','LOCAL_FILE_PERMISSION','LOCAL_FILE_MISSING','INVALID_MEDIA_PATH'])if(value.includes(code))return code
 const exit=value.match(/SYSTEM_OPEN_EXIT:(-?\d+)/);if(exit)return`SYSTEM_OPEN_EXIT:${exit[1]}`
 if(/校验|SHA|checksum/i.test(value))return'CHECKSUM_FAILED'
 if(/permission|权限|denied/i.test(value))return'LOCAL_FILE_PERMISSION'
 if(/丢失|缺失|不存在|not found|No such file/i.test(value))return'LOCAL_FILE_MISSING'
 if(/离线|联网|offline/i.test(value))return'OFFLINE_OR_UNBOUND'
 if(/timeout|超时/i.test(value))return'TIMEOUT'
 return'OPERATION_FAILED'
}
export function attachmentErrorMessage(code:string){
 if(code.startsWith('SYSTEM_OPEN_EXIT:'))return`系统打开程序返回失败（退出码 ${code.split(':')[1]}），请检查文件关联应用。`
 if(code.startsWith('HTTP_'))return`附件服务请求失败（${code.replace('_',' ')}）。`
 return({ACCESS_DENIED:'服务器拒绝访问，请检查登录状态和附件权限。',REMOTE_MISSING:'服务器未找到可访问的附件；可能已删除，或附件地址已失效。',SYSTEM_OPENER_MISSING:'系统打开工具不存在；Ubuntu 请检查 xdg-open 是否已安装。',SYSTEM_OPENER_START_FAILED:'系统打开工具无法启动。',SYSTEM_OPEN_STATUS_FAILED:'无法确认系统打开程序的状态。',LOCAL_FILE_PERMISSION:'没有读取本机文件的权限。',LOCAL_FILE_MISSING:'本机附件文件不存在。',INVALID_MEDIA_PATH:'本机附件路径无效或超出当前空间。',CHECKSUM_FAILED:'文件完整性校验失败，请保留原文件并检查可用的服务器副本。',OFFLINE_OR_UNBOUND:'当前离线或未连接服务器。',TIMEOUT:'请求超时，请检查服务器连接。',OPERATION_FAILED:'操作未完成，可复制诊断信息进一步排查。'} as Record<string,string>)[code]||'未能完成检查。'
}
export function recordAttachmentAttempt(owner:string,item:AttachmentItem,action:AttachmentAttempt['action'],code:string){
 const id=key(owner,item),history=attempts.get(id)||[];attempts.set(id,[...history,{at:new Date().toISOString(),action,code}].slice(-8))
 if(attempts.size>50)attempts.delete(attempts.keys().next().value!)
}
export function attachmentPreviewSupported(item:AttachmentItem){return /^(image\/(jpeg|png|webp|gif|bmp|avif)|audio\/|video\/|text\/|application\/(pdf|json|xml|yaml|x-yaml))/.test(inferMediaType(item.originalFilename,item.mediaType))||/\.(pdf|md|markdown|txt|json|ya?ml|xml|csv|log|ini|conf|js|ts|jsx|tsx|vue|css|scss|html|java|kt|py|rs|go|sql|sh|ps1)$/i.test(item.originalFilename||'')}
export const recentAttachmentAttempts=(owner:string,item:AttachmentItem)=>[...(attempts.get(key(owner,item))||[])]
async function verify(blob:Blob,item:AttachmentItem){
 if(blob.size===0)return{stage:'完整性校验',state:'fail',code:'EMPTY_FILE',message:'附件为空文件。'} as AttachmentCheck
 if(blob.size!==item.sizeBytes)return{stage:'完整性校验',state:'fail',code:'SIZE_MISMATCH',message:`实际 ${blob.size} 字节，与记录的 ${item.sizeBytes} 字节不一致。`} as AttachmentCheck
 if(item.sha256&&await blobDigest(blob)!==item.sha256.toLowerCase())return{stage:'完整性校验',state:'fail',code:'CHECKSUM_FAILED',message:attachmentErrorMessage('CHECKSUM_FAILED')} as AttachmentCheck
 return{stage:'完整性校验',state:item.sha256?'pass':'warning',code:item.sha256?'VERIFIED':'HASH_UNAVAILABLE',message:item.sha256?'大小和 SHA256 校验通过。':'大小一致，但记录中没有 SHA256，无法完整验证。'} as AttachmentCheck
}
async function inspectFileType(blob:Blob,item:AttachmentItem):Promise<AttachmentCheck>{
 const bytes=new Uint8Array(await blob.slice(0,1024).arrayBuffer()),head=new TextDecoder().decode(bytes)
 const extension=(item.originalFilename.match(/\.([a-z0-9]{1,12})$/i)?.[1]||'').toLowerCase()
 let matches:boolean|undefined,kind=''
 if(extension==='pdf'||item.mediaType==='application/pdf'){matches=head.includes('%PDF-');kind='PDF'}
 else if(extension==='png'||item.mediaType==='image/png'){matches=[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);kind='PNG'}
 else if(['jpg','jpeg'].includes(extension)||item.mediaType==='image/jpeg'){matches=bytes[0]===255&&bytes[1]===216;kind='JPEG'}
 else if(extension==='gif'||item.mediaType==='image/gif'){matches=head.startsWith('GIF87a')||head.startsWith('GIF89a');kind='GIF'}
 return {stage:'文件类型',state:matches===false?'warning':matches===true?'pass':'skip',code:matches===false?'FILE_TYPE_MISMATCH':matches===true?'FILE_SIGNATURE_MATCH':'FILE_TYPE_UNVERIFIED',message:matches===false?`文件头与记录的 ${kind} 格式不一致，可能无法预览。`:matches===true?`${kind} 文件头匹配；不代表内容已成功渲染。`:'已读取扩展名和媒体类型；此格式未进行文件头检查。'}
}
export async function diagnoseAttachment(owner:string,item:AttachmentItem):Promise<AttachmentDiagnostic>{
 const checks:AttachmentCheck[]=[],report:AttachmentDiagnostic={checkedAt:new Date().toISOString(),version:appInfo.version,extension:(item.originalFilename.match(/\.([a-z0-9]{1,12})$/i)?.[1]||'').toLowerCase(),mediaType:/^[\w.+-]+\/[\w.+-]+$/.test(item.mediaType||'')?item.mediaType!:'unknown',expectedBytes:item.sizeBytes,checks,recent:[...(attempts.get(key(owner,item))||[])],canRedownload:false,canReveal:false,readable:false}
 let source:Awaited<ReturnType<typeof attachmentDiagnosticSource>>|undefined
 try{source=await attachmentDiagnosticSource(owner,item,'local');report.canReveal=source.canReveal;checks.push({stage:'本机文件',state:source.blob?'pass':'warning',code:source.blob?'LOCAL_READABLE':'LOCAL_UNAVAILABLE',message:source.blob?'本机文件可读取。':'本机没有可读取的副本；尝试检查服务器。'})}catch(error){const code=attachmentErrorCode(error);checks.push({stage:'本机文件',state:'fail',code,message:attachmentErrorMessage(code)})}
 let blob=source?.blob
 // Explicit diagnostic action may fetch the remote file, but never replaces local files.
 if(!blob){try{source=await attachmentDiagnosticSource(owner,item,'remote');blob=source.blob;checks.push({stage:'服务器文件',state:blob?'pass':'skip',code:blob?'REMOTE_READABLE':'REMOTE_UNAVAILABLE',message:blob?'服务器附件可下载。':'没有可用的服务器连接或附件标识。'})}catch(error){const code=attachmentErrorCode(error);checks.push({stage:'服务器文件',state:'fail',code,message:attachmentErrorMessage(code)})}}
 if(blob){const check=await verify(blob,item);checks.push(check);checks.push(await inspectFileType(blob,item));report.readable=check.state!=='fail';report.canRedownload=Boolean(source?.canRedownload)}else checks.push({stage:'完整性校验',state:'skip',code:'NO_BYTES',message:'未取得文件，无法校验。'})
 if(blob&&!report.readable){try{const remote=await attachmentDiagnosticSource(owner,item,'remote');if(remote.blob){const checked=await verify(remote.blob,item);checks.push({...checked,stage:'服务器副本'});report.canRedownload=Boolean(remote.canRedownload&&checked.state!=='fail')}}catch(error){const code=attachmentErrorCode(error);checks.push({stage:'服务器副本',state:'fail',code,message:attachmentErrorMessage(code)})}}
 checks.push({stage:'应用内预览',state:attachmentPreviewSupported(item)?'pass':'warning',code:attachmentPreviewSupported(item)?'PREVIEW_SUPPORTED':'PREVIEW_UNSUPPORTED',message:attachmentPreviewSupported(item)?'支持此类型；实际渲染结果请参考最近打开记录。':'此格式不支持内置预览，请另存或使用系统应用。'})
 if(isDesktopClient()){try{report.environment=await invoke<SystemProbe>('attachment_system_probe',{mediaType:inferMediaType(item.originalFilename,item.mediaType)});const env=report.environment;checks.push({stage:'系统环境',state:!env.desktopSession||!env.openerAvailable||env.defaultApplication===false?'warning':'pass',code:!env.desktopSession?'NO_DESKTOP_SESSION':!env.openerAvailable?'SYSTEM_OPENER_MISSING':env.defaultApplication===false?'NO_DEFAULT_APPLICATION':'SYSTEM_CHECKED',message:!env.desktopSession?'未检测到图形桌面会话。':!env.openerAvailable?attachmentErrorMessage('SYSTEM_OPENER_MISSING'):env.defaultApplication===false?'未检测到此类型的默认应用。':'系统打开工具可用；未自动启动外部应用。'})}catch{checks.push({stage:'系统环境',state:'skip',code:'NATIVE_PROBE_UNAVAILABLE',message:'当前安装包不支持系统检查，请更新客户端。'})}}else checks.push({stage:'系统环境',state:'skip',code:'BROWSER',message:'浏览器无法检查操作系统的文件关联。'})
 return report
}
export const attachmentDiagnosticReport=(report:AttachmentDiagnostic)=>JSON.stringify({schema:'note-flow-attachment-diagnostic/1',...report},null,2)
export async function diagnosticOpen(owner:string,item:AttachmentItem){try{await openAttachmentContent(owner,item);recordAttachmentAttempt(owner,item,'system','OPEN_REQUEST_SUBMITTED')}catch(error){recordAttachmentAttempt(owner,item,'system',attachmentErrorCode(error));throw error}}
export async function diagnosticSaveAs(owner:string,item:AttachmentItem){
 const assertCurrent=captureFileExportBoundary()
 const source=await attachmentDiagnosticSource(owner,item,'local');assertCurrent()
 const blob=source.blob||(await attachmentDiagnosticSource(owner,item,'remote')).blob;assertCurrent()
 if(!blob)throw Error('本机附件内容缺失')
 const check=await verify(blob,item);assertCurrent()
 if(check.state==='fail')throw Error('附件校验失败')
 return saveLocalExport(blob,item.originalFilename||'attachment')
}
export {redownloadAttachment,revealAttachmentFolder}
