import MarkdownIt from 'markdown-it'
import {linkedCanvasUid} from './linkedNoteCanvas'
import {attachmentImageItem} from './attachmentImages'

export function createMarkdownPreviewParser(){
  const parser=new MarkdownIt({html:false,linkify:true,breaks:true,typographer:true})
  // 仅识别无其他属性的空锚点；保持html:false，不允许借定位标签执行任意HTML。
  parser.inline.ruler.before('text','explicit_anchor',(state,silent)=>{
    const match=/^<a\s+(?:id|name)\s*=\s*(["'])([A-Za-z0-9_\-:.\u0080-\uFFFF]+)\1\s*>\s*<\/a\s*>/i.exec(state.src.slice(state.pos))
    if(!match)return false
    if(!silent){const token=state.push('explicit_anchor','span',0);token.attrSet('data-markdown-anchor',match[2])}
    state.pos+=match[0].length;return true
  })
  parser.renderer.rules.explicit_anchor=(tokens,index)=>`<span data-markdown-anchor="${parser.utils.escapeHtml(String(tokens[index].attrGet('data-markdown-anchor')||''))}"></span>`
  const image=parser.renderer.rules.image!
  parser.renderer.rules.image=(tokens,index,options,env,renderer)=>{
    const token=tokens[index],source=String(token.attrGet('src')||'')
    if(attachmentImageItem(source)){
      token.attrs=(token.attrs||[]).filter(([name])=>name!=='src')
      token.attrSet('data-attachment-source',source)
    }
    return image(tokens,index,options,env,renderer)
  }
  const linkOpen=parser.renderer.rules.link_open||((tokens,index,options,_env,renderer)=>renderer.renderToken(tokens,index,options))
  parser.renderer.rules.link_open=(tokens,index,options,env,renderer)=>{
    const token=tokens[index],id=/^note-flow-canvas:([A-Za-z0-9_-]+)$/.exec(String(token.attrGet('title')||''))?.[1]
    if(id&&attachmentImageItem(String(token.attrGet('href')||''))){token.attrSet('href','#');token.attrSet('data-note-canvas',id);token.attrSet('class','note-canvas-preview');token.attrSet('title','点击编辑画布')}
    const linked=linkedCanvasUid(String(token.attrGet('href')||''))
    if(linked){token.attrSet('href','#');token.attrSet('data-linked-canvas',linked);token.attrSet('class','note-linked-canvas');token.attrSet('title','打开原画布编辑');return linkOpen(tokens,index,options,env,renderer)+`<span data-linked-canvas-preview="${linked}"></span>`}
    return linkOpen(tokens,index,options,env,renderer)
  }
  const fence=parser.renderer.rules.fence!
  parser.renderer.rules.fence=(tokens,index,options,env,renderer)=>{
    const language=tokens[index].info.trim().split(/\s+/)[0].toLowerCase()
    const code=fence(tokens,index,options,env,renderer)
    return language==='mermaid'?`<figure class="markdown-mermaid">${code}</figure>\n`:code
  }
  return parser
}
