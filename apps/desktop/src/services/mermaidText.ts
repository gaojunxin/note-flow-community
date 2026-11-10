/** Offline Mermaid text format support. Rendering is deliberately lazy-loaded. */
export const MERMAID_TEXT_FORMAT='mermaid-text' as const
export const MERMAID_TEXT_VERSION=1 as const
export const MERMAID_RUNTIME_VERSION='11.17.2' as const
export const MERMAID_LICENSE='MIT' as const

export interface MermaidTextDocument{
  kind:typeof MERMAID_TEXT_FORMAT
  version:typeof MERMAID_TEXT_VERSION
  source:string
}

export interface MermaidDiagnostic{
  severity:'error'|'warning'
  code:'empty'|'unsupported-diagram'|'unsafe-directive'|'html-disabled'|'interaction-disabled'|'remote-resource'|'syntax-error'
  message:string
  line:number
  column:number
}

export interface MermaidValidationResult{
  valid:boolean
  diagnostics:MermaidDiagnostic[]
}

/** Configuration shared by preview/editor hosts. Documents may not override it. */
export const MERMAID_STRICT_CONFIG=Object.freeze({
  startOnLoad:false,
  securityLevel:'strict' as const,
  suppressErrorRendering:true,
  htmlLabels:false,
  flowchart:Object.freeze({htmlLabels:false}),
})

const diagramHeader=/^(?:---[\s\S]*?---\s*)?(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|requirementDiagram|gitGraph|xychart-beta|block-beta|packet-beta|architecture-beta|kanban)\b/i

const locate=(source:string,index:number)=>{
  const before=source.slice(0,Math.max(0,index)).split('\n')
  return{line:before.length,column:(before.at(-1)?.length??0)+1}
}

const diagnostic=(source:string,index:number,code:MermaidDiagnostic['code'],message:string):MermaidDiagnostic=>({
  severity:'error',code,message,...locate(source,index),
})

export function createMermaidTextDocument(source=''):MermaidTextDocument{
  return{kind:MERMAID_TEXT_FORMAT,version:MERMAID_TEXT_VERSION,source}
}

export function parseMermaidTextDocument(value:unknown):MermaidTextDocument{
  if(!value||typeof value!=='object')throw new Error('Mermaid 文档必须是对象')
  const candidate=value as Partial<MermaidTextDocument>
  if(candidate.kind!==MERMAID_TEXT_FORMAT)throw new Error('不是 mermaid-text 文档')
  if(candidate.version!==MERMAID_TEXT_VERSION)throw new Error(`不支持的 Mermaid 文档版本：${String(candidate.version)}`)
  if(typeof candidate.source!=='string')throw new Error('Mermaid 文档缺少文本源码')
  return createMermaidTextDocument(candidate.source)
}

export function serializeMermaidTextDocument(document:MermaidTextDocument):string{
  return JSON.stringify(parseMermaidTextDocument(document))
}

/** Search text is derived locally and never includes Mermaid control syntax. */
export function buildMermaidTextIndex(source:string):string{
  const labels:Array<string>=[]
  const patterns=[
    /\[([^\]]+)\]/g, /\(([^()]+)\)/g, /\{([^{}]+)\}/g,
    /(?:^|\n)\s*(?:participant|actor)\s+(?:\S+\s+as\s+)?([^\n]+)/gi,
    /(?:-->|---|==>|-.->)(?:\|([^|]+)\|)?/g,
  ]
  for(const pattern of patterns)for(const match of source.matchAll(pattern))if(match[1])labels.push(match[1])
  const commentsRemoved=source.replace(/^\s*%%(?!\{).*$/gm,' ')
  const identifiers=commentsRemoved
    .replace(/%%\{[\s\S]*?\}%%/g,' ')
    .replace(/[^\p{L}\p{N}_-]+/gu,' ')
    .split(/\s+/)
    .filter(word=>word.length>1&&!/^(flowchart|graph|subgraph|end|direction|classDiagram|sequenceDiagram)$/i.test(word))
  return [...new Set([...labels,...identifiers].map(value=>value.trim()).filter(Boolean))].join(' ')
}

export function inspectMermaidSafety(source:string):MermaidDiagnostic[]{
  const diagnostics:MermaidDiagnostic[]=[]
  const checks:Array<[RegExp,MermaidDiagnostic['code'],string]>=[
    [/%%\{/i,'unsafe-directive','禁止 Mermaid 初始化指令覆盖宿主安全配置'],
    // Mermaid treats bare <br> as a line break even with SVG-only labels.
    // Attributes and all other HTML remain disallowed.
    [/<(?!br\s*\/?>)\/?[a-z][^>]*>/i,'html-disabled','严格模式不允许 HTML 标签'],
    [/^\s*click\s+/im,'interaction-disabled','严格模式不允许 click 交互或链接'],
    [/\b(?:href|link)\s*[:=]/i,'interaction-disabled','严格模式不允许文档内链接'],
    [/(?:https?:|data:|file:|javascript:|ftp:|\/\/)[^\s"')\]]*/i,'remote-resource','禁止远程或可执行资源'],
  ]
  for(const[pattern,code,message]of checks){const match=pattern.exec(source);if(match)diagnostics.push(diagnostic(source,match.index,code,message))}
  return diagnostics
}

function syntaxLocation(error:unknown){
  const candidate=error as{hash?:{loc?:{first_line?:number;first_column?:number}};message?:string}
  return{
    line:candidate.hash?.loc?.first_line??1,
    column:(candidate.hash?.loc?.first_column??0)+1,
    message:candidate.message?.split('\n')[0]||'Mermaid 语法错误',
  }
}

function inspectBalancedDelimiters(source:string):MermaidDiagnostic|undefined{
  const stack:Array<{character:string;index:number}>=[],pairs:Record<string,string>={']':'[',')':'(','}':'{'}
  let quote=''
  for(let index=0;index<source.length;index++){
    const character=source[index]
    if(character==='"'||character==="'"){
      if(!quote)quote=character
      else if(quote===character&&source[index-1]!=='\\')quote=''
      continue
    }
    if(quote)continue
    if(character==='['||character==='('||character==='{')stack.push({character,index})
    else if(character in pairs){
      const opening=stack.pop()
      if(!opening||opening.character!==pairs[character])return diagnostic(source,index,'syntax-error',`括号 ${character} 没有匹配`)
    }
  }
  const opening=stack.pop()
  return opening?diagnostic(source,opening.index,'syntax-error',`括号 ${opening.character} 没有闭合`):undefined
}

export async function validateMermaidText(source:string):Promise<MermaidValidationResult>{
  if(!source.trim())return{valid:false,diagnostics:[diagnostic(source,0,'empty','Mermaid 文本不能为空')]}
  const diagnostics=inspectMermaidSafety(source)
  if(!diagramHeader.test(source))diagnostics.push(diagnostic(source,0,'unsupported-diagram','无法识别 Mermaid 图表类型'))
  const delimiterDiagnostic=inspectBalancedDelimiters(source)
  if(delimiterDiagnostic)diagnostics.push(delimiterDiagnostic)
  if(diagnostics.length)return{valid:false,diagnostics}
  // Mermaid's complete parser uses browser sanitization. Node-side indexing and
  // imports still get deterministic safety/header/delimiter validation.
  if(typeof document==='undefined')return{valid:true,diagnostics:[]}
  try{
    const runtime=(await import('mermaid')).default
    runtime.initialize(MERMAID_STRICT_CONFIG)
    await runtime.parse(source,{suppressErrors:false})
    return{valid:true,diagnostics:[]}
  }catch(error){
    const location=syntaxLocation(error)
    return{valid:false,diagnostics:[{severity:'error',code:'syntax-error',...location}]}
  }
}
