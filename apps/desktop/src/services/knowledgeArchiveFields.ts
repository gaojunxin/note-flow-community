import MarkdownIt from 'markdown-it'
import type {KnowledgeEntity} from './contracts/knowledge'

export const knowledgeFieldNames=['title','conclusion','content','applicability','limitations','maturity','confidence','keyPoints','primaryTopicUid','parentKnowledgeUid','sortOrder','areaUid'] as const
export type KnowledgeFields=ReturnType<typeof knowledgeFields>
/** 往返导入只写可编辑字段，不回放服务端版本、来源、使用记录或旧修订。 */
export function knowledgeFields(value:Partial<KnowledgeEntity>){
 return {title:value.title||'',conclusion:value.conclusion||'',content:(value.content||'').replace(/\r\n?/g,'\n'),applicability:value.applicability||'',limitations:value.limitations||'',maturity:value.maturity||'draft',confidence:value.confidence||'medium',keyPoints:value.keyPoints||[],primaryTopicUid:value.primaryTopicUid||'',parentKnowledgeUid:value.parentKnowledgeUid||'',sortOrder:value.sortOrder||0,areaUid:value.areaUid||''}
}
export const sameKnowledge=(left:Partial<KnowledgeEntity>,right:Partial<KnowledgeEntity>)=>JSON.stringify(knowledgeFields(left))===JSON.stringify(knowledgeFields(right))

/** Markdown使用相对附件路径，供AI或普通阅读器离线读取；导入时再映射到目标附件。 */
export function knowledgeAssetPath(documentPath:string,assetPath:string){const from=documentPath.split('/').slice(0,-1),to=assetPath.split('/');let shared=0;while(shared<from.length&&shared<to.length&&from[shared]===to[shared])shared++;return encodeURI('../'.repeat(from.length-shared)+to.slice(shared).join('/')).replace(/#/g,'%23').replace(/\?/g,'%3F').replace(/\(/g,'%28').replace(/\)/g,'%29')}

export function rewriteKnowledgeAsset(content:string,uid:string,target:string){
 const escaped=uid.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
 return content.replace(new RegExp(`(?:https?:\\/\\/[^\\s)"'<>]+)?\\/api\\/v1\\/attachments\\/${escaped}\\/content(?:\\?[^\\s)"'<>]+)?|(?:local-)?attachment:${escaped}(?![\\w-])`,'g'),()=>target)
}
export function portableKnowledgeContent(content:string,documentPath:string,assets:{uid:string;path:string}[],documents:{uid:string;path:string}[]=[],documentPaths=new Map(documents.map(document=>[document.uid,document.path]))){
 const result=assets.reduce((value,asset)=>rewriteKnowledgeAsset(value,asset.uid,knowledgeAssetPath(documentPath,asset.path)),content)
 return result.replace(/(?:https?:\/\/[^\s)"'<>]+)?(?:\/knowledge\/|knowledge:)([a-zA-Z0-9_-]+)/g,(raw,uid)=>{const path=documentPaths.get(uid);return path?knowledgeAssetPath(documentPath,path):raw})
}
/** 只处理正文链接，保留围栏/缩进代码块和行内代码中的示例路径。 */
export function rewriteKnowledgeDestinations(content:string,replace:(raw:string,prefix:string,destination:string)=>string){
 const offsets=[0];for(let index=0;index<content.length;index++)if(content[index]==='\n')offsets.push(index+1)
 const ignored:Array<[number,number]>=[]
 for(const token of new MarkdownIt({html:true}).parse(content,{}))if((token.type==='fence'||token.type==='code_block')&&token.map)ignored.push([offsets[token.map[0]],offsets[token.map[1]]??content.length])
 for(const match of content.matchAll(/(`+)(?!`)([\s\S]*?)\1(?!`)/g))ignored.push([match.index!,match.index!+match[0].length])
 const rewrite=(value:string)=>value.replace(/(\]\()(<[^>]+>|[^\s)>]+)/g,replace).replace(/(^[ \t]{0,3}\[[^\]]+\]:[ \t]*)(<[^>]+>|[^\s>]+)/gm,replace).replace(/((?:src|href)=["'])([^"']+)/gi,replace)
 let cursor=0,result='';for(const [start,end] of ignored.sort((a,b)=>a[0]-b[0])){if(end<=cursor)continue;if(start>cursor)result+=rewrite(content.slice(cursor,start));result+=content.slice(Math.max(cursor,start),end);cursor=end}return result+rewrite(content.slice(cursor))
}

/** 包内正文链接按实际路径解析，导入后指向同一批次的知识身份，并保留章节锚点。 */
export function restoreKnowledgeLinks(content:string,path:string,documents:{uid:string;path:string}[],targets:Record<string,string>){
 const restore=(raw:string,prefix:string,destination:string)=>{
  destination=destination.replace(/^<|>$/g,'')
  if(/^[a-z][a-z\d+.-]*:|^\//i.test(destination))return raw
  try{const resolved=new URL(destination,'https://knowledge-import.invalid/'+encodeURI(path).replace(/#/g,'%23').replace(/\?/g,'%3F')),target=documents.find(document=>document.path===decodeURIComponent(resolved.pathname.slice(1)));return target?prefix+'/knowledge/'+(targets[target.uid]||target.uid)+resolved.hash:raw}catch{return raw}
 }
 return rewriteKnowledgeDestinations(content,restore)
}
