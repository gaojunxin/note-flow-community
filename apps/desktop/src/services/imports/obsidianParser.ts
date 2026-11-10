import {findMarkdownImages} from '../attachmentReferences'
import {decompressFromBase64} from 'lz-string'

export type ObsidianCategory = 'personal'|'work'|'inbox'|'private'
export interface ObsidianClassification { category:ObsidianCategory; journal:boolean; workJournal:boolean; mobile:boolean; reason:string }

export interface ObsidianImportItem {
  sourcePath: string
  sourceId: string
  title: string
  content: string
  noteType: 'note'|'excalidraw'
  status: 'active'
  tags: string
  originalCreatedAt?: string
  classification: ObsidianClassification
}

export interface ObsidianScan {
  rootName: string
  items: ObsidianImportItem[]
  attachmentCount: number
  ignoredCount: number
  templateOnlyJournalCount: number
  wikiLinkCount: number
  tagCount: number
  remoteImageCount: number
  remoteImages: Array<{ sourcePath: string; url: string; host?: string }>
  attachments: Array<{ sourcePath: string; file: File }>
  sensitiveFiles: Array<{ sourcePath:string; reason:string; kind:'note'|'file' }>
  standaloneFileCount: number
  classification: {personal:number;work:number;inbox:number;private:number;journal:number;workJournal:number;mobile:number}
}

export interface ImportBatch {
  uid: string
  totalCount: number
  successCount: number
  skippedCount: number
  failedCount: number
  status: string
}

export interface ImportRecord {
  uid: string
  sourcePath: string
  result: string
  errorMessage?: string
  noteId?: number
  noteUid?: string
  canvasUid?: string
}
export interface AttachmentImportRecord { sourcePath: string; noteSourcePath: string; noteUid?: string; originalReference?: string; result: 'success'|'failed'; errorMessage?: string }
export interface RemoteImageImportRecord { url: string; noteSourcePath: string; noteUid?: string; result: 'success'|'failed'; errorMessage?: string }
export interface TaskImportRecord { title:string;noteSourcePath:string;noteUid?:string;taskUid?:string;completed:boolean;result:'success'|'failed';errorMessage?:string }
export interface ObsidianImportOptions { remoteImages?: 'preserve'|'private'; organization?: 'folders'|'flat'; projectStrategy?:'none'|'existing'|'top-level-folders'; targetAreaUid?:string|null; targetProjectUid?:string|null; importStandaloneFiles?:boolean }

export function obsidianImportDirectoryParts(sourcePath:string,projectStrategy:ObsidianImportOptions['projectStrategy']){
  const parts=sourcePath.replace(/\\/g,'/').split('/').filter(Boolean)
  // The project itself is rendered as the virtual root in the note library;
  // only its internal folders are persisted to avoid a duplicated Project/Project level.
  // Classification assigns an area; it must not remove source directories.
  const start=projectStrategy==='top-level-folders'?2:1
  return parts.slice(start,-1)
}
export function importErrorMessage(source: unknown, fallback = '未知错误') {
  if (source instanceof Error && source.message.trim()) return source.message.trim()
  if (typeof source === 'string' && source.trim()) return source.trim()
  if (source && typeof source === 'object') {
    const value = source as Record<string, unknown>
    for (const candidate of [value.message, value.error, value.reason, value.details]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    }
    try {
      const serialized = JSON.stringify(source)
      if (serialized && serialized !== '{}') return serialized
    } catch { /* Use the product fallback below. */ }
  }
  return fallback
}
function markdownTasks(content:string){return content.split(/\r?\n/).flatMap(line=>{const match=line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/);if(!match)return[];const title=match[2].replace(/\s+#[\p{L}\p{N}_/-]+/gu,'').trim();return title?[{title,completed:match[1].toLocaleLowerCase()==='x'}]:[]})}
export function isTemplateOnlyJournal(item: ObsidianImportItem) {
  if (!item.classification.journal) return false
  let content = item.content.replace(/^\uFEFF/, '')
  if (/^---\s*\r?\n/.test(content)) {
    content = content.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '')
  }
  content = content
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/```(?:dataview|dataviewjs|templater)[^\n]*\n[\s\S]*?```/gi, '')
    .replace(/<%[\s\S]*?%>/g, '')
    .replace(/{{[^{}]*}}/g, '')
  const meaningful = content.split(/\r?\n/).map(line => line.trim()).filter(line =>
    line
    && !/^#{1,6}(?:\s+.*)?$/.test(line)
    && !/^[-*_]{3,}$/.test(line)
    && !/^>\s*$/.test(line)
    && !/^[-*+]\s*$/.test(line)
    && !/^[-*+]\s+\[[ xX]\]\s*$/.test(line)
    && !/^\d+[.)]\s*$/.test(line)
    && !/^(?:日期|天气|心情|今日计划|今日总结|今日复盘|复盘|记录|备注)\s*[:：]?\s*$/.test(line)
  )
  return meaningful.length === 0
}

const markdownExtension = /\.md$/i
const excalidrawExtension = /\.excalidraw(?:\.md)?$/i
const yamlBoundary = /^---\s*$/

function cleanYamlValue(value: string) {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1)
  return trimmed
}

function yamlMetadata(content: string) {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  const values: Record<string, string> = {}
  const tags: string[] = []
  if (!yamlBoundary.test(lines[0] || '')) return { values, tags }
  let listKey = ''
  for (let index = 1; index < lines.length; index += 1) {
    if (yamlBoundary.test(lines[index])) break
    const list = lines[index].match(/^\s*-\s+(.+)$/)
    if (list && listKey === 'tags') { tags.push(cleanYamlValue(list[1])); continue }
    const field = lines[index].match(/^([\w-]+):\s*(.*)$/)
    if (!field) continue
    listKey = field[1].toLowerCase()
    values[listKey] = cleanYamlValue(field[2])
    if (listKey === 'tags' && field[2].trim()) {
      const raw = field[2].trim().replace(/^\[/, '').replace(/\]$/, '')
      tags.push(...raw.split(',').map(cleanYamlValue).filter(Boolean))
    }
  }
  return { values, tags }
}

function dateTime(value: string | undefined, fallback: number) {
  const date = value ? new Date(value) : new Date(fallback)
  if (Number.isNaN(date.getTime())) return undefined
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function parseObsidianMarkdown(sourcePath: string, content: string, lastModified = Date.now()): ObsidianImportItem {
  const metadata = yamlMetadata(content)
  const filename = sourcePath.split('/').pop()?.replace(markdownExtension, '') || '未命名笔记'
  const title = metadata.values.title || metadata.values.name || filename
  const inlineTags = [...content.matchAll(/(^|\s)#([\p{L}\p{N}_/-]+)/gu)].map(match => match[2])
  const tags = [...new Set([...metadata.tags, ...inlineTags].map(tag => tag.replace(/^#/, '').trim()).filter(Boolean))]
  return {
    sourcePath,
    sourceId: sourcePath.normalize('NFC'),
    title: title.slice(0, 255),
    content: extractExcalidrawScene(content,sourcePath)??content,
    noteType: isExcalidrawDocument(content,sourcePath)?'excalidraw':'note',
    status: 'active',
    tags: tags.join(','),
    originalCreatedAt: dateTime(metadata.values.created || metadata.values.date || metadata.values.createdat, lastModified),
    classification: classifyObsidianPath(sourcePath)
  }
}

export function isExcalidrawDocument(content:string,sourcePath=''){if(excalidrawExtension.test(sourcePath))return true;const text=content.replace(/^\uFEFF/,'');if(/(?:^|\n)excalidraw-plugin\s*:/i.test(text)||/^# Excalidraw Data\s*$/im.test(text))return true;try{const value=JSON.parse(text);return value?.type==='excalidraw'&&Array.isArray(value.elements)}catch{return false}}
export function extractExcalidrawScene(content:string,sourcePath=''){if(!isExcalidrawDocument(content,sourcePath))return null;const text=content.replace(/^\uFEFF/,'').trim();let raw=text;const block=text.match(/`{3,}(compressed-json|json)\s*\r?\n([\s\S]*?)\r?\n`{3,}/i);if(block){raw=block[1].toLowerCase()==='compressed-json'?(decompressFromBase64(block[2].replace(/\s+/g,''))||''):block[2].trim()}try{const scene=JSON.parse(raw);if(scene?.type!=='excalidraw'||!Array.isArray(scene.elements))throw new Error();return JSON.stringify({...scene,type:'excalidraw',version:Number(scene.version)||2,source:'note-flow'})}catch{throw new Error(`${sourcePath||'文件'}：无法解析 Excalidraw 画布数据`)}}

export function classifyObsidianPath(sourcePath:string):ObsidianClassification {
  const path=sourcePath.replace(/\\/g,'/').normalize('NFC'),lower=path.toLocaleLowerCase(),file=path.split('/').pop()||''
  const mobile=/(^|\/)(移动端|mobile)(\/|$)/i.test(path)
  const privateConfig=/(^|\/)(私密|隐私|private|secret|secrets|凭据|密码|配置|config|configs|\.env)(\/|\.|$)/i.test(path)
  const work=/(^|\/)(工作笔记|工作目录|工作|work)(\/|$)/i.test(path)
  const personal=/(^|\/)(个人笔记|个人|personal)(\/|$)/i.test(path)
  const journal=/(^|\/)(日记|日志|daily|journal|工作目录)(\/|$)/i.test(path)||/^\d{4}[-_.年]\d{1,2}[-_.月]\d{1,2}日?(?:\s|\.|$)/.test(file)
  const category:ObsidianCategory=privateConfig?'private':work?'work':personal?'personal':'inbox'
  return{category,journal,workJournal:journal&&work,mobile,reason:privateConfig?'路径包含私密配置关键词':work?'路径归属工作':personal?'路径归属个人':'未识别明确领域'}
}

const sensitiveFileExtension=/\.(?:key|p12|pfx|jks|keystore|kdbx|ovpn|env)$/i
const certificateExtension=/\.(?:pem|crt|cer|der)$/i
const sensitiveTextPatterns:Array<[RegExp,string]>=[
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,'包含私钥内容'],
  [/(?:password|passwd|pwd|密码)\s*[:=]\s*[^\s#]{4,}/i,'包含疑似密码'],
  [/(?:access[_-]?key|secret[_-]?key|accesskeyid|accesskeysecret|ak|sk)\s*[:=]\s*["']?[A-Za-z0-9/+_.-]{8,}/i,'包含疑似访问密钥'],
  [/(?:token|api[_-]?key|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9/+_.-]{12,}/i,'包含疑似令牌或 API 密钥'],
  [/(?:mysql|postgres(?:ql)?|mongodb|redis):\/\/[^\s/:]+:[^\s@]+@/i,'连接串中包含账号密码']
]
export function pathSensitivity(sourcePath:string){
  if(sensitiveFileExtension.test(sourcePath))return'高风险密钥或配置文件'
  if(certificateExtension.test(sourcePath))return'证书或 PEM 文件，需人工确认是否包含私钥'
  return''
}
function contentSensitivity(content:string){return sensitiveTextPatterns.find(([pattern])=>pattern.test(content))?.[1]||''}

export async function scanObsidianVault(files: FileList | File[]): Promise<ObsidianScan> {
  const all = Array.from(files)
  const paths = all.map(file => file.webkitRelativePath || file.name)
  const rootName = paths[0]?.split('/')[0] || 'Obsidian Vault'
  const markdown = all.filter((file, index) => (markdownExtension.test(file.name)||excalidrawExtension.test(file.name)) && !paths[index].split('/').includes('.obsidian'))
  const attachments = all.map((file,index)=>({file,sourcePath:paths[index]})).filter(item => !markdownExtension.test(item.file.name)&&!excalidrawExtension.test(item.file.name) && !item.sourcePath.split('/').includes('.obsidian'))
  const attachmentCount = attachments.length
  const parsedItems = await Promise.all(markdown.map(async file => parseObsidianMarkdown(file.webkitRelativePath || file.name, await file.text(), file.lastModified)))
  for(const item of parsedItems){const reason=contentSensitivity(item.content);if(reason&&item.classification.category!=='private')item.classification={...item.classification,category:'private',reason}}
  const templateOnlyJournalCount = parsedItems.filter(isTemplateOnlyJournal).length
  const items = parsedItems.filter(item => !isTemplateOnlyJournal(item))
  const ignoredCount = all.length - markdown.length - attachmentCount + templateOnlyJournalCount
  const remoteImages = items.flatMap(item => findMarkdownImages(item.content).filter(image => image.kind === 'remote').map(image => ({ sourcePath: item.sourcePath, url: image.url, host: image.host })))
  const classified={personal:0,work:0,inbox:0,private:0,journal:0,workJournal:0,mobile:0}
  for(const item of items){classified[item.classification.category]++;if(item.classification.journal)classified.journal++;if(item.classification.workJournal)classified.workJournal++;if(item.classification.mobile)classified.mobile++}
  const sensitiveFiles=[...items.filter(item=>item.classification.category==='private').map(item=>({sourcePath:item.sourcePath,reason:item.classification.reason,kind:'note' as const})),...attachments.map(item=>({sourcePath:item.sourcePath,reason:pathSensitivity(item.sourcePath),kind:'file' as const})).filter(item=>item.reason)]
  return {
    rootName,
    items,
    attachmentCount,
    ignoredCount,
    templateOnlyJournalCount,
    wikiLinkCount: items.reduce((count, item) => count + (item.content.match(/\[\[[^\]]+\]\]/g)?.length || 0), 0),
    tagCount: new Set(items.flatMap(item => item.tags.split(',').filter(Boolean))).size,
    remoteImageCount: remoteImages.length,
    remoteImages,
    attachments,
    sensitiveFiles,
    standaloneFileCount:attachments.filter(item=>!pathSensitivity(item.sourcePath)).length,
    classification:classified
  }
}

