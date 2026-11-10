/** 阅读查找只建立 DOM Range，不改写正文 HTML、链接或编辑数据。 */
export function readingMatches(root: HTMLElement | null, query: string): Range[] {
 const term=query.trim();if(!root||!term)return []
 const doc=root.ownerDocument,walker=doc.createTreeWalker(root,4),groups=new Map<Element,Text[]>()
 let current:Node|null
 while((current=walker.nextNode())){
  const node=current as Text,parent=node.parentElement
  if(!parent||parent.closest('script,style,svg,button,input,textarea,[aria-hidden="true"],[hidden]'))continue
  const block=parent.closest('p,h1,h2,h3,h4,h5,h6,li,pre,td,th,blockquote')||root
  const nodes=groups.get(block)||[];nodes.push(node);groups.set(block,nodes)
 }
 const ranges:Range[]=[]
 // 正则仅转义后做字面量匹配；用原文偏移，避免大小写转换改变 Unicode 长度。
 const escaped=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
 for(const nodes of groups.values()){
  const text=nodes.map(node=>node.data).join(''),pattern=new RegExp(escaped,'giu')
  for(const match of text.matchAll(pattern)){
   const start=match.index!,end=start+match[0].length;let offset=0,startNode:Text|undefined,startOffset=0
   for(const node of nodes){
    if(!startNode&&start<offset+node.length){startNode=node;startOffset=start-offset}
    if(startNode&&end<=offset+node.length){const range=doc.createRange();range.setStart(startNode,startOffset);range.setEnd(node,end-offset);ranges.push(range);break}
    offset+=node.length
   }
  }
 }
 return ranges
}
let sequence=0
/** 每个阅读器独占高亮名，离开/切文时必须 clear；旧 WebView 回退为当前匹配的原生选区。 */
export function createReadingFinder(){
 const name=`reader-find-${++sequence}`,activeName=`${name}-active`
 const runtime=globalThis as typeof globalThis & {Highlight?:new(...ranges:Range[])=>unknown;CSS?:{highlights?:Map<string,unknown>}}
 let ranges:Range[]=[],index=-1,ownedSelection:Selection|null=null,style:HTMLStyleElement|null=null
 function clear(){runtime.CSS?.highlights?.delete(name);runtime.CSS?.highlights?.delete(activeName);style?.remove();style=null;if(ownedSelection?.rangeCount&&ranges.some(range=>ownedSelection?.getRangeAt(0)===range))ownedSelection.removeAllRanges();ownedSelection=null;ranges=[];index=-1}
 function activate(next:number,scroll=true){
  if(!ranges.length)return -1
  index=(next+ranges.length)%ranges.length;const range=ranges[index]
  if(runtime.Highlight&&runtime.CSS?.highlights)runtime.CSS.highlights.set(activeName,new runtime.Highlight(range))
  else{ownedSelection=range.startContainer.ownerDocument!.getSelection();ownedSelection?.removeAllRanges();ownedSelection?.addRange(range)}
  if(scroll)(range.startContainer.parentElement)?.scrollIntoView({block:'center',behavior:'smooth'})
  return index
 }
 function scan(root:HTMLElement|null,query:string){
  clear();ranges=readingMatches(root,query)
  if(ranges.length&&root&&runtime.Highlight&&runtime.CSS?.highlights){
   style=root.ownerDocument.createElement('style');style.textContent=`::highlight(${name}){background:#ffe49a;color:#17211b}::highlight(${activeName}){background:#ed9c36;color:#17211b}`;root.ownerDocument.head.append(style)
   runtime.CSS.highlights.set(name,new runtime.Highlight(...ranges))
  }
  return ranges.length
 }
 return {scan,activate,clear}
}
