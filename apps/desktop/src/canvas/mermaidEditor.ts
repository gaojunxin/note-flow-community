export interface MermaidTemplate {id:string;label:string;source:string}

export const mermaidTemplates:readonly MermaidTemplate[]=Object.freeze([
  {id:'flowchart',label:'流程图',source:'flowchart TD\n  A[开始] --> B{需要处理?}\n  B -->|是| C[执行任务]\n  B -->|否| D[结束]\n  C --> D'},
  {id:'sequence',label:'时序图',source:'sequenceDiagram\n  participant U as 用户\n  participant A as 应用\n  U->>A: 发起请求\n  A-->>U: 返回结果'},
  {id:'state',label:'状态图',source:'stateDiagram-v2\n  [*] --> 待处理\n  待处理 --> 进行中\n  进行中 --> 已完成\n  已完成 --> [*]'},
  {id:'class',label:'类图',source:'classDiagram\n  class Document {\n    +String title\n    +save()\n  }\n  Document <|-- Canvas'},
])

export function mermaidExportName(title:string,extension:'mmd'|'svg'){
  const safe=title.trim().replace(/[\\/:*?"<>|\s]+/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'')||'mermaid-canvas'
  return`${safe}.${extension}`
}
