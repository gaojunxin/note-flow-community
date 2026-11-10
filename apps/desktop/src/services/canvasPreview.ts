import type {CanvasEntity} from './canvases'
const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!))
export async function renderCanvasPreview(canvas:CanvasEntity):Promise<Blob|undefined>{
 const source=canvas.documentData||canvas.sceneData
 if(canvas.canvasType==='mindmap'){
  const {parseMindmapEditorDocument,layoutMindmap}=await import('../canvas/mindmapEditor')
  const parsed=parseMindmapEditorDocument(source);if(parsed.error)throw Error(parsed.error)
  const positions=layoutMindmap(parsed.document),byId=new Map(positions.map(item=>[item.id,item])),nodes=new Map(parsed.document.nodes.map(item=>[item.id,item]))
  const width=Math.max(320,...positions.map(item=>item.x+214)),height=Math.max(140,...positions.map(item=>item.y+90))
  const paths=positions.map(item=>{const parentId=nodes.get(item.id)?.parentId,parent=parentId&&byId.get(parentId);return parent?`<path d="M ${parent.x+174} ${parent.y+25} C ${parent.x+194} ${parent.y+25}, ${item.x-20} ${item.y+25}, ${item.x} ${item.y+25}"/>`:''}).join('')
  const boxes=positions.map(item=>{
   const text=nodes.get(item.id)?.text||'',characters=Array.from(text),lines:string[]=[];for(let index=0;index<characters.length&&lines.length<3;index+=12)lines.push(characters.slice(index,index+12).join(''))
   if(characters.length>36)lines[2]=lines[2].slice(0,-1)+'…'
   return `<g><title>${escape(text)}</title><rect x="${item.x}" y="${item.y}" width="174" height="50" rx="8" fill="${item.depth?'#f4f8f5':'#2f7d5b'}" stroke="#b5d1c1"/><text x="${item.x+87}" y="${item.y+25-(lines.length-1)*7}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="12" fill="${item.depth?'#263c31':'#ffffff'}">${lines.map((line,index)=>`<tspan x="${item.x+87}" dy="${index?14:0}">${escape(line)}</tspan>`).join('')}</text></g>`
  }).join('')
  return new Blob([`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/><g fill="none" stroke="#9db8a8" stroke-width="2">${paths}</g>${boxes}</svg>`],{type:'image/svg+xml'})
 }
 if(canvas.canvasType==='flowchart'){
  const {validateMermaidText,MERMAID_STRICT_CONFIG}=await import('./mermaidText')
  const validation=await validateMermaidText(source);if(!validation.valid)throw Error(validation.diagnostics[0]?.message||'流程图语法无效')
  const {default:mermaid}=await import('mermaid'),{default:DOMPurify}=await import('dompurify')
  mermaid.initialize(MERMAID_STRICT_CONFIG)
  const {svg}=await mermaid.render(`note-canvas-${crypto.randomUUID()}`,source)
  return new Blob([DOMPurify.sanitize(svg,{USE_PROFILES:{svg:true,svgFilters:true}})],{type:'image/svg+xml'})
 }
}
