import {KNOWLEDGE_ARCHIVE_MAX_BYTES} from './knowledgeArchiveLimits'
import {blobDigest} from './blobDigest'
import {createZip} from './localZip'
import {knowledgeFields,portableKnowledgeContent} from './knowledgeArchiveFields'
import {safeArchiveName} from './localVaultArchive'

export interface DownloadDirectory {uid:string;parentUid?:string|null;name:string;metadata:unknown}
export interface DownloadDocument {uid:string;directoryUid?:string|null;title:string;content:string;metadata:unknown}
export interface DownloadAsset {uid:string;name:string;blob:Blob;documentUid:string}
/** 统一分配目录、正文及附件路径并处理大小写重名；knowledge模式附带可核验的三方基线和AI编辑说明。 */
export async function buildAiDownloadArchive(directories:DownloadDirectory[],documents:DownloadDocument[],assets:DownloadAsset[]=[],kind?:'knowledge'){
 const encoder=new TextEncoder(),files:{name:string;bytes:Uint8Array}[]=[],used=new Set(['metadata.json',...(kind?['README-AI.md']:[])]),paths=new Map<string,string>(),visiting=new Set<string>()
 const allocate=(parent:string,name:string,extension='')=>{const base=safeArchiveName(name);let path=parent+base+extension,index=2;while(used.has(path.toLowerCase()))path=parent+base+` (${index++})`+extension;used.add(path.toLowerCase());return path}
 const directoryPath=(uid:string):string=>{if(paths.has(uid))return paths.get(uid)!;if(visiting.has(uid))throw Error('目录结构存在循环，无法下载');const directory=directories.find(value=>value.uid===uid);if(!directory)return '';visiting.add(uid);const parent=directory.parentUid?directoryPath(directory.parentUid):'',path=allocate(parent,directory.name)+'/';visiting.delete(uid);paths.set(uid,path);files.push({name:path,bytes:new Uint8Array()});return path}
 for(const directory of directories)directoryPath(directory.uid)
 const entries=[]
 for(const document of documents){const parent=document.directoryUid?directoryPath(document.directoryUid):'',path=allocate(parent,document.title,'.md');files.push({name:path,bytes:encoder.encode(document.content)});entries.push({uid:document.uid,path,directoryUid:document.directoryUid,metadata:document.metadata,...(kind?{baseline:knowledgeFields({...document.metadata as object,content:document.content}),baselineSha256:await blobDigest(new Blob([JSON.stringify(knowledgeFields({...document.metadata as object,content:document.content}))]))}: {})})}
 const media=[]
 if(assets.length){const root=allocate('','attachments')+'/';for(const asset of assets){const path=allocate(root,asset.name);files.push({name:path,bytes:new Uint8Array(await asset.blob.arrayBuffer())});media.push({uid:asset.uid,documentUid:asset.documentUid,path,...(kind?{sha256:await blobDigest(asset.blob)}:{})})}}
 const documentPaths=new Map(entries.map(entry=>[entry.uid,entry.path]))
 if(kind)for(const entry of entries){const document=documents.find(value=>value.uid===entry.uid)!,portable=portableKnowledgeContent(document.content,entry.path,media.filter(asset=>asset.documentUid===entry.uid),entries,documentPaths);files.find(file=>file.name===entry.path)!.bytes=encoder.encode(portable);entry.baseline=knowledgeFields({...document.metadata as object,content:portable});entry.baselineSha256=await blobDigest(new Blob([JSON.stringify(entry.baseline)]))}
 if(kind)files.push({name:'README-AI.md',bytes:encoder.encode('知识库 AI 往返编辑包\n\n请保留 metadata.json、文件路径和 UID，只修改 Markdown 正文。标题、结论、要点和状态可修改 documents[].metadata 对应字段；baseline 是导出基线，请勿修改。新增知识可新增 .md 文件，放在现有主题目录中（标题取文件名）。已有文件移动或改名需同步 documents[].path，主题与父子关系请修改 metadata.primaryTopicUid / parentKnowledgeUid；不要修改目录 UID。未列入清单的新增目录会按主题导入。附件使用相对路径，可直接离线读取；请保留 attachments 清单和正文相对引用，可修改附件文件内容。不要删除旧附件清单，删除文件不会删除应用中的知识。外部链接保持原样；旧来源、使用和修订记录仅供参考，不作为本次写入。\n\n导入会预览三方差异：导出基线、当前知识、导入内容。双端修改同一字段时需逐项选择保留当前、使用导入或创建副本。请将全部文件重新压缩为 ZIP，metadata.json 应在根目录。\n')})
 files.push({name:'metadata.json' ,bytes:encoder.encode(JSON.stringify({format:'note-flow-ai-download',version:kind?2:1,...(kind?{kind}:{}),exportedAt:new Date().toISOString(),directories:directories.map(value=>({...value,path:paths.get(value.uid)})),documents:entries,attachments:media,resourcePolicy:'附件原始引用与 attachments 中的 uid 对照；外链保留原地址。'},null,2))})
 const maxBytes=kind?KNOWLEDGE_ARCHIVE_MAX_BYTES:64*1024*1024,maxMiB=maxBytes/1024/1024
 if(files.length>10000||files.reduce((total,file)=>total+file.bytes.length,0)>maxBytes)throw Error(`下载最多支持 10000 个文件、${maxMiB} MiB，请按子目录分批下载`)
 const zip=createZip(files);if(zip.size>maxBytes)throw Error(`下载ZIP超过${maxMiB} MiB，请按子目录分批下载`);return zip
}
export async function downloadAiArchive(blob:Blob,name:string,assertCurrent?:()=>void,kind?:'knowledge'):Promise<boolean>{
 const {saveLocalExport}=await import('./localFileExport')
 return saveLocalExport(blob,safeArchiveName(name)+'.zip',kind?{kind:'knowledge-archive'}:{},assertCurrent)
}
export function descendantUids(values:{uid:string;parentUid?:string|null}[],root:string){const selected=new Set([root]);let changed=true;while(changed){changed=false;for(const value of values)if(value.parentUid&&selected.has(value.parentUid)&&!selected.has(value.uid)){selected.add(value.uid);changed=true}}return selected}
