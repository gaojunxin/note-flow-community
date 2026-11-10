<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Compartment, EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, keymap, placeholder, ViewPlugin, type DecorationSet, type ViewUpdate, WidgetType } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import {linkedCanvasEmbeds,resolveLinkedCanvas} from '../services/linkedNoteCanvas'
import {noteCanvasEmbeds} from '../services/noteCanvas'
import {cachedAttachment} from '../services/attachments'
import {attachmentImageItem} from '../services/attachmentImages'
import * as Y from 'yjs'
import { yCollab } from 'y-codemirror.next'

const props = withDefaults(defineProps<{ modelValue: string; readonly?: boolean; livePreview?: boolean;ownerId?:string }>(), { readonly: false, livePreview: false,ownerId:'local' })
const emit = defineEmits<{ 'update:modelValue': [value: string];'attachment-files':[files:File[]];'selection-text':[text:string];'canvas-edit':[id:string];'linked-canvas-open':[uid:string];submit:[] }>()
const host = ref<HTMLElement>()
let view: EditorView | undefined
let ydoc: Y.Doc | undefined
const editable = new Compartment()
const livePreviewConfig = new Compartment()

class ImageWidget extends WidgetType {
 private released=false
 private url:string|undefined
 constructor(readonly source:string,readonly label:string,readonly owner:string){super()}
 eq(other:ImageWidget){return other.source===this.source&&other.owner===this.owner&&other.label===this.label}
 toDOM(view:EditorView){
  const wrapper=document.createElement('span'),image=document.createElement('img');wrapper.className='cm-attachment-image';image.alt=this.label;wrapper.append(image)
  const item=attachmentImageItem(this.source)
  if(item)void cachedAttachment(this.owner,item).then(blob=>{if(this.released)return;this.url=URL.createObjectURL(blob);image.onload=()=>view.requestMeasure();image.src=this.url;view.requestMeasure()}).catch(error=>{if(this.released)return;image.alt=`${this.label}（${error instanceof Error?error.message:'加载失败'}）`;wrapper.title=image.alt;view.requestMeasure()})
  else image.src=this.source
  return wrapper
 }
 destroy(){this.released=true;if(this.url)URL.revokeObjectURL(this.url)}
 ignoreEvent(){return false}
}
class LinkedCanvasWidget extends WidgetType {
 private released=false;private url:string|undefined;private generation=0;private refresh:(()=>void)|undefined
 constructor(readonly uid:string,readonly owner:string){super()}
 eq(other:LinkedCanvasWidget){return other instanceof LinkedCanvasWidget&&other.uid===this.uid&&other.owner===this.owner}
 toDOM(view:EditorView){
  const wrapper=document.createElement('span'),button=document.createElement('button'),preview=document.createElement('span');wrapper.className='cm-attachment-image cm-note-canvas';button.type='button';button.textContent='打开画布';wrapper.append(preview,button)
  button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();emit('linked-canvas-open',this.uid)})
  this.refresh=()=>{const generation=++this.generation;void resolveLinkedCanvas(this.owner,this.uid).then(result=>{
   if(this.released||generation!==this.generation)return
   if(this.url)URL.revokeObjectURL(this.url);this.url=undefined;preview.replaceChildren();button.textContent=`画布：${result.canvas.title||'未命名画布'} · 打开编辑`
   if(result.preview){const image=document.createElement('img');this.url=URL.createObjectURL(result.preview);image.src=this.url;image.alt=result.canvas.title||'画布';image.onload=()=>view.requestMeasure();preview.append(image)}else preview.textContent=result.canvas.canvasType==='excalidraw'?'画布暂无绘制内容':'此类型暂不支持内嵌预览，点击打开画布';view.requestMeasure()
  }).catch(error=>{if(!this.released&&generation===this.generation){preview.textContent=error instanceof Error?error.message:'画布预览不可用';view.requestMeasure()}})}
  window.addEventListener('note-flow:canvas-change',this.refresh);window.addEventListener('focus',this.refresh);this.refresh();return wrapper
 }
 destroy(){this.released=true;this.generation++;if(this.url)URL.revokeObjectURL(this.url);if(this.refresh){window.removeEventListener('note-flow:canvas-change',this.refresh);window.removeEventListener('focus',this.refresh)}}
 ignoreEvent(){return true}
}
class CanvasWidget extends ImageWidget {
 constructor(readonly canvasId:string,source:string,owner:string){super(source,'画布',owner)}
 eq(other:CanvasWidget){return other instanceof CanvasWidget&&other.canvasId===this.canvasId&&super.eq(other)}
 toDOM(view:EditorView){const wrapper=super.toDOM(view),button=document.createElement('button');wrapper.classList.add('cm-note-canvas');button.type='button';button.textContent='编辑画布';button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();emit('canvas-edit',this.canvasId)});wrapper.append(button);return wrapper}
 ignoreEvent(){return true}
}
function livePreviewDecorations(view: EditorView) {
  const ranges: Range<Decoration>[] = []
  const activeLine = view.state.doc.lineAt(view.state.selection.main.head).number
  for (let number = 1; number <= view.state.doc.lines; number++) {
    const line = view.state.doc.line(number)
    const linked=linkedCanvasEmbeds(line.text)
    if(linked.length){for(const canvas of linked)ranges.push(Decoration.replace({widget:new LinkedCanvasWidget(canvas.uid,props.ownerId)}).range(line.from+canvas.from,line.from+canvas.to));continue}
    const canvases=noteCanvasEmbeds(line.text)
    if(canvases.length){for(const canvas of canvases)ranges.push(Decoration.replace({widget:new CanvasWidget(canvas.id,canvas.preview,props.ownerId)}).range(line.from+canvas.from,line.from+canvas.to));continue}
    const heading = /^(#{1,6})\s+/.exec(line.text)
    if (heading) ranges.push(Decoration.line({ class: `cm-live-heading cm-live-heading-${heading[1].length}` }).range(line.from))
    else if (/^>\s?/.test(line.text)) ranges.push(Decoration.line({ class: 'cm-live-quote' }).range(line.from))
    else if (/^\s*```/.test(line.text)) ranges.push(Decoration.line({ class: 'cm-live-fence' }).range(line.from))
    if (number === activeLine) continue
    const imagePattern=/!\[([^\]\n]*)\]\((attachment:[a-zA-Z0-9_-]+|\/api\/v1\/attachments\/[a-zA-Z0-9_-]+\/content)\)/g
    let image:RegExpExecArray|null,hasImages=false
    while((image=imagePattern.exec(line.text))){hasImages=true;ranges.push(Decoration.replace({widget:new ImageWidget(image[2],image[1]||'图片',props.ownerId)}).range(line.from+image.index,line.from+image.index+image[0].length))}
    if(hasImages)continue
    if (heading) ranges.push(Decoration.replace({}).range(line.from, line.from + heading[0].length))
    const patterns = [
      { regex: /(\*\*|__)(.+?)\1/g, className: 'cm-live-strong' },
      { regex: /(?<!\*)\*([^*\n]+)\*(?!\*)/g, className: 'cm-live-em' },
      { regex: /~~(.+?)~~/g, className: 'cm-live-strike' },
      { regex: /`([^`\n]+)`/g, className: 'cm-live-code' }
    ]
    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.regex.exec(line.text))) {
        const from = line.from + match.index
        const opening = match[1] && (match[1] === '**' || match[1] === '__') ? match[1].length : pattern.className === 'cm-live-strike' ? 2 : 1
        ranges.push(Decoration.replace({}).range(from, from + opening))
        ranges.push(Decoration.mark({ class: pattern.className }).range(from + opening, from + match[0].length - opening))
        ranges.push(Decoration.replace({}).range(from + match[0].length - opening, from + match[0].length))
      }
    }
    const linkPattern = /\[([^\]\n]+)\]\(([^)\n]+)\)/g
    let link: RegExpExecArray | null
    while ((link = linkPattern.exec(line.text))) {
      const from = line.from + link.index
      ranges.push(Decoration.replace({}).range(from, from + 1))
      ranges.push(Decoration.mark({ class: 'cm-live-link' }).range(from + 1, from + 1 + link[1].length))
      ranges.push(Decoration.replace({}).range(from + 1 + link[1].length, from + link[0].length))
    }
  }
  return Decoration.set(ranges,true)
}

const livePreviewExtension = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = livePreviewDecorations(view) }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = livePreviewDecorations(update.view)
  }
}, { decorations: value => value.decorations })

function replaceSelection(before: string, after = before, placeholderText = '文本') {
  if (!view || props.readonly) return
  const range = view.state.selection.main
  const selected = view.state.sliceDoc(range.from, range.to) || placeholderText
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: `${before}${selected}${after}` },
    selection: { anchor: range.from + before.length, head: range.from + before.length + selected.length },
    scrollIntoView: true
  })
  view.focus()
}
function prefixLines(prefix: string) {
  if (!view || props.readonly) return
  const range = view.state.selection.main
  const from = view.state.doc.lineAt(range.from).from
  const to = view.state.doc.lineAt(range.to).to
  const selected = view.state.sliceDoc(from, to)
  const replacement = selected.split('\n').map(line => `${prefix}${line}`).join('\n')
  view.dispatch({ changes: { from, to, insert: replacement }, selection: { anchor: from, head: from + replacement.length }, scrollIntoView: true })
  view.focus()
}
function setHeading(level: number) {
  if (!view || props.readonly) return
  const range = view.state.selection.main
  const line = view.state.doc.lineAt(range.from)
  const content = line.text.replace(/^#{1,6}\s+/, '')
  const prefix = level ? `${'#'.repeat(level)} ` : ''
  view.dispatch({ changes: { from: line.from, to: line.to, insert: `${prefix}${content}` }, scrollIntoView: true })
  view.focus()
}
function runUndo() { if (view) undo(view) }
function runRedo() { if (view) redo(view) }
function focus() { view?.focus() }
function insertText(text:string){
 if(!view||props.readonly)return
 const range=view.state.selection.main,before=range.from>0&&view.state.doc.sliceString(range.from-1,range.from)!=='\n'?'\n':'',insert=before+text
 view.dispatch({changes:{from:range.from,to:range.to,insert},selection:{anchor:range.from+insert.length},scrollIntoView:true});view.focus()
}
function scrollToLine(number:number){if(!view)return;const line=view.state.doc.line(Math.max(1,Math.min(number,view.state.doc.lines)));view.dispatch({selection:{anchor:line.from},effects:EditorView.scrollIntoView(line.from,{y:'start'})});view.focus()}
defineExpose({ scrollToLine,insertText,replaceSelection, prefixLines, setHeading, undo: runUndo, redo: runRedo, focus })

onMounted(() => {
  ydoc = new Y.Doc()
  const ytext = ydoc.getText('content')
  if (props.modelValue) ytext.insert(0, props.modelValue)
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        yCollab(ytext, null), history(), markdown(), keymap.of([
          { key: 'Mod-Enter', run: () => { emit('submit'); return true } },
          { key: 'Mod-b', run: () => { replaceSelection('**', '**', '粗体文本'); return true } },
          { key: 'Mod-i', run: () => { replaceSelection('*', '*', '斜体文本'); return true } },
          { key: 'Mod-k', run: () => { replaceSelection('[', '](https://)', '链接文字'); return true } },
          { key: 'Mod-Shift-7', run: () => { prefixLines('1. '); return true } },
          { key: 'Mod-Shift-8', run: () => { prefixLines('- '); return true } },
          ...defaultKeymap, ...historyKeymap
        ]), placeholder('开始书写…'),
        EditorView.lineWrapping, editable.of(EditorView.editable.of(!props.readonly)), livePreviewConfig.of(props.livePreview ? livePreviewExtension : []),EditorView.domEventHandlers({paste(event){const files=[...(event.clipboardData?.files||[])];if(files.length){event.preventDefault();emit('attachment-files',files);return true}return false},drop(event){const files=[...(event.dataTransfer?.files||[])];if(files.length){event.preventDefault();emit('attachment-files',files);return true}return false}}),
        EditorView.updateListener.of(update => { if (update.docChanged) emit('update:modelValue', update.state.doc.toString());if(update.selectionSet||update.docChanged){const range=update.state.selection.main;emit('selection-text',update.state.sliceDoc(range.from,range.to))} })
      ]
    })
  })
})

// 外部值与当前文档相同时不再派发编辑事务，避免父子更新回环并扰动光标/撤销历史。
watch(() => props.modelValue, value => {
  if (!view || value === view.state.doc.toString()) return
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
})
watch(() => props.readonly, value => view?.dispatch({ effects: editable.reconfigure(EditorView.editable.of(!value)) }))
watch(()=>props.ownerId,()=>view?.dispatch({effects:livePreviewConfig.reconfigure(props.livePreview?livePreviewExtension:[])}))
watch(() => props.livePreview, value => view?.dispatch({ effects: livePreviewConfig.reconfigure(value ? livePreviewExtension : []) }))

// 编辑器视图和Y.Doc都属于组件生命周期，卸载时一并释放其监听器与内部状态。
onBeforeUnmount(() => { view?.destroy();ydoc?.destroy() })
</script>

<template><div ref="host" class="markdown-editor" :class="{'live-preview':livePreview}" /></template>

<style scoped>.markdown-editor :deep(.cm-note-canvas){border:1px solid var(--pc-border,#e0e7e2);border-radius:8px;padding:10px}.markdown-editor :deep(.cm-note-canvas button){display:block;margin:8px auto 0;padding:6px 12px;border:1px solid var(--pc-border,#e0e7e2);border-radius:6px;background:#fff;color:var(--pc-primary,#2f7d5b);cursor:pointer}.markdown-editor :deep(.cm-attachment-image){display:inline-block;max-width:100%;padding:8px 0}.markdown-editor :deep(.cm-attachment-image img){display:block;max-width:100%;max-height:520px;object-fit:contain;border-radius:8px}</style>
