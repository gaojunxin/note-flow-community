<script setup lang="ts">
import {computed,nextTick,ref,watch} from 'vue'
import {ElDialog,ElButton} from 'element-plus'
import 'element-plus/es/components/dialog/style/css'
import 'element-plus/es/components/button/style/css'
import MarkdownEditor from './MarkdownEditor.vue'
import MarkdownPreview from './MarkdownPreview.vue'
import LogMarkdownToolbar,{type LogMarkdownAction,type LogMarkdownMode} from './LogMarkdownToolbar.vue'
import {confirmDialog} from '../services/productDialog'
const props=withDefaults(defineProps<{open:boolean;modelValue:string;title:string;ownerId?:string;busy?:boolean;error?:string;preserveOnClose?:boolean;saveLabel?:string;metadataDirty?:boolean}>(),{saveLabel:'保存'})
const emit=defineEmits<{'update:open':[value:boolean];'update:modelValue':[value:string];save:[];'attachment-files':[files:File[]]}>()
const editor=ref<InstanceType<typeof MarkdownEditor>>(),preview=ref<InstanceType<typeof MarkdownPreview>>()
const mode=ref<LogMarkdownMode>('source'),outlineOpen=ref(false),fullscreen=ref(false),baseline=ref('')
const dirty=computed(()=>props.modelValue!==baseline.value||props.metadataDirty)
const headings=computed(()=>{let fence=false;return props.modelValue.split('\n').flatMap((line,index)=>{if(/^\s*(```|~~~)/.test(line)){fence=!fence;return []}const match=!fence&&line.match(/^(#{1,6})\s+(.+)$/);return match?[{text:match[2],level:match[1].length,line:index+1}]:[]})})
watch(()=>props.open,async open=>{if(open){baseline.value=props.modelValue;mode.value='source';outlineOpen.value=false;fullscreen.value=false;await nextTick();editor.value?.focus()}},{immediate:true})
async function close(done?:()=>void){if(props.busy)return;if(dirty.value&&!props.preserveOnClose){if(!await confirmDialog({title:'放弃未保存的修改？',message:'关闭后将保留上次保存的内容。',confirmText:'放弃修改',cancelText:'继续编辑'}))return;if(props.busy)return;emit('update:modelValue',baseline.value)}if(done)done();else emit('update:open',false)}
function format(action:LogMarkdownAction){const value=editor.value;if(!value)return;if(action==='heading')value.setHeading(2);else if(action==='bold')value.replaceSelection('**','**','粗体文本');else if(action==='italic')value.replaceSelection('*','*','斜体文本');else if(action==='link')value.replaceSelection('[','](https://)','链接文字');else if(action==='code')value.replaceSelection('\n```\n','\n```\n','代码');else value.prefixLines(action==='task'?'- [ ] ':action==='quote'?'> ':'- ')}
function jump(index:number){if(mode.value==='preview')preview.value?.scrollToHeading(index);else editor.value?.scrollToLine(headings.value[index].line)}
defineExpose({replaceSelection:(...args:Parameters<NonNullable<typeof editor.value>['replaceSelection']>)=>editor.value?.replaceSelection(...args),focus:()=>editor.value?.focus()})
</script>
<template>
 <ElDialog :model-value="open" :title="title" width="min(1180px,96vw)" :fullscreen="fullscreen" :before-close="close" :show-close="false" :close-on-click-modal="false" append-to-body destroy-on-close @opened="editor?.focus()" class="log-markdown-dialog" @update:model-value="emit('update:open',$event)">
  <template #header="{titleId}"><div class="log-editor-heading"><h2 :id="titleId">{{title}}</h2><div class="log-editor-window-actions"><ElButton v-if="headings.length>1" class="log-editor-outline-toggle" text :aria-pressed="outlineOpen" @click="outlineOpen=!outlineOpen">目录</ElButton><ElButton text :aria-pressed="fullscreen" @click="fullscreen=!fullscreen">{{fullscreen?'还原窗口':'最大化'}}</ElButton><ElButton class="log-editor-close" text :disabled="busy" aria-label="关闭编辑器" @click="close()">×</ElButton></div></div></template>
  <div class="log-editor-context"><slot/></div>
  <LogMarkdownToolbar v-model:mode="mode" :disabled="busy" @command="format"/>
  <div class="log-editor-body" :class="{'has-outline':outlineOpen&&headings.length>1}">
   <nav v-if="outlineOpen&&headings.length>1" class="log-editor-outline" aria-label="正文标题导航"><span>正文目录</span><ElButton text v-for="(heading,index) in headings" :key="heading.line" :style="{paddingLeft:`${10+(heading.level-1)*10}px`}" @click="jump(index)">{{heading.text}}</ElButton></nav>
   <div class="log-editor-panes" :class="{'is-split':mode==='split'}"><MarkdownEditor ref="editor" v-show="mode!=='preview'" :model-value="modelValue" :owner-id="ownerId" :readonly="busy" @update:model-value="emit('update:modelValue',$event)" @attachment-files="emit('attachment-files',$event)" @submit="emit('save')"/><section v-if="mode!=='source'" class="log-editor-preview"><MarkdownPreview ref="preview" :content="modelValue" :owner-id="ownerId"/></section></div>
  </div>
  <p v-if="error" class="log-editor-error" role="alert">{{error}}</p>
  <template #footer><div class="log-editor-footer"><span class="log-editor-save-state" :class="{'is-dirty':dirty}" role="status"><i/>{{busy?'保存中…':dirty?'修改未保存':'内容未修改'}}</span><small>{{modelValue.length}} 字符<span class="log-editor-save-hint"> · {{preserveOnClose?'收起后保留本页草稿':'Ctrl / ⌘ + Enter 保存'}}</span></small><ElButton :disabled="busy" @click="close()">{{preserveOnClose?'收起编辑器':'取消'}}</ElButton><ElButton type="primary" :loading="busy" :disabled="!modelValue.trim()" @click="emit('save')">{{saveLabel}}</ElButton></div></template>
 </ElDialog>
</template>
<style>
.log-markdown-dialog{display:flex;flex-direction:column;height:min(800px,calc(100dvh - 32px));max-height:calc(100dvh - 32px);margin:16px auto!important;padding:18px 20px 16px;border-radius:12px}
.log-markdown-dialog.is-fullscreen{height:100dvh;max-height:100dvh;margin:0!important;border-radius:0}
.log-markdown-dialog .el-dialog__header{flex:none;margin:0;padding:0 0 12px}
.log-markdown-dialog .el-dialog__body{display:flex;flex-direction:column;min-height:0;flex:1;overflow:hidden}
.log-markdown-dialog .el-dialog__footer{flex:none;padding:12px 0 0}
.log-editor-heading,.log-editor-window-actions,.log-editor-footer{display:flex;align-items:center;gap:8px}
.log-editor-heading{justify-content:space-between}.log-editor-heading h2{margin:0;font-size:18px;font-weight:650;line-height:32px;color:var(--pc-text)}
.log-editor-window-actions .el-button{margin:0;font-size:12px;color:var(--pc-muted)}.log-editor-window-actions .log-editor-close{font-size:24px;min-width:30px;padding:4px}
.log-editor-context{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 16px;flex:none;padding:0 2px 12px;color:var(--pc-muted);font-size:13px;line-height:1.5}.log-editor-context:empty{display:none}.log-editor-context p{margin:0}.log-editor-context .project-log-types{margin:0;gap:6px}.log-editor-context .project-log-types button{min-height:28px;padding:4px 10px;font-size:12px}
.log-editor-body{display:grid;grid-template-columns:minmax(0,1fr);min-height:0;flex:1;overflow:hidden;border:1px solid var(--pc-border);border-top:0;border-radius:0 0 8px 8px;background:#fff}
.log-editor-body.has-outline{grid-template-columns:180px minmax(0,1fr)}
.log-editor-outline{overflow:auto;border-right:1px solid var(--pc-border);padding:12px 8px;background:#fafcfb}.log-editor-outline>span{display:block;margin:0 10px 8px;font-size:11px;color:var(--pc-muted)}.log-editor-outline button{display:block;margin:0;height:auto;white-space:normal;width:100%;padding:7px 10px;border:0;border-radius:5px;background:transparent;text-align:left;overflow-wrap:anywhere;color:var(--pc-text);font-size:12px;line-height:1.5}.log-editor-outline button:hover,.log-editor-outline button:focus-visible{background:var(--pc-primary-soft);color:var(--pc-primary)}
.log-editor-panes{display:grid;grid-template-columns:minmax(0,1fr);min-height:0;overflow:hidden}.log-editor-panes.is-split{grid-template-columns:repeat(2,minmax(0,1fr))}
.log-markdown-dialog .log-editor-panes .markdown-editor{min-width:0;min-height:0;margin:0;padding:0;overflow:hidden}.log-markdown-dialog .log-editor-panes .cm-editor{height:100%;background:transparent}.log-markdown-dialog .log-editor-panes .cm-scroller{overflow:auto;overscroll-behavior:contain;line-height:1.8}.log-markdown-dialog .log-editor-panes .cm-content{box-sizing:border-box;min-height:100%;padding:18px 22px;font-size:15px;line-height:1.8;color:var(--pc-text);caret-color:var(--pc-primary)}
.log-editor-preview{min-width:0;overflow:auto;overscroll-behavior:contain;padding:18px 24px;overflow-wrap:anywhere}.is-split>.log-editor-preview{border-left:1px solid var(--pc-border)}.log-editor-preview>.markdown-preview{max-width:80ch;margin:0 auto}
.log-editor-error{flex:none;max-height:60px;overflow:auto;margin:10px 0 0;padding:8px 12px;border-radius:6px;background:#fff1f0;color:var(--pc-danger,#a33);font-size:12px}
.log-editor-save-state{display:inline-flex;align-items:center;gap:6px;flex:none;font-size:12px;color:var(--pc-muted)}.log-editor-save-state i{width:6px;height:6px;border-radius:50%;background:#9aa99f}.log-editor-save-state.is-dirty i{background:#ce9639}.log-editor-footer>small{margin-right:auto;color:var(--pc-muted);font-size:12px}.log-editor-footer>.el-button{margin:0;min-width:76px}
@media(max-width:800px){.log-markdown-dialog{padding:14px;height:calc(100dvh - 20px);max-height:calc(100dvh - 20px);margin:10px auto!important}.log-editor-body.has-outline{grid-template-columns:minmax(0,1fr)}.log-editor-outline,.log-editor-outline-toggle,.log-editor-save-hint{display:none!important}.log-editor-panes.is-split{grid-template-columns:minmax(0,1fr);grid-template-rows:1fr 1fr}.is-split>.log-editor-preview{border-left:0;border-top:1px solid var(--pc-border)}.log-editor-footer{flex-wrap:wrap}.log-editor-heading h2{font-size:16px}}
</style>

