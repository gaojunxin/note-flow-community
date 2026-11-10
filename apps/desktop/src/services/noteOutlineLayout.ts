import MarkdownIt from 'markdown-it'
let parser:InstanceType<typeof MarkdownIt>|undefined
/** Decide the automatic outline column before the async preview mounts.
 * Block parsing uses the same Markdown rules as preview, without rendering inline media.
 */
export function hasAutomaticNoteOutline(content:string):boolean{
 const markdown=parser??=(new MarkdownIt({html:false,linkify:true,breaks:true,typographer:true}))
 const tokens:ReturnType<typeof markdown.parse>=[]
 markdown.block.parse(content,markdown,{},tokens)
 let count=0
 for(const token of tokens)if(token.type==='heading_open'&&++count>2)return true
 return false
}
