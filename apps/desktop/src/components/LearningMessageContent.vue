<script setup lang="ts">
import {copyLearningText} from '../services/learningClipboard'
import {computed,ref} from 'vue'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
const props=defineProps<{content:string;streaming?:boolean}>()
const copied=ref(false),copyError=ref('')
// Disable raw HTML and remote images: reading a response must not contact third parties.
const markdown=new MarkdownIt({html:false,linkify:true,breaks:true})
markdown.renderer.rules.image=(tokens,index)=>markdown.utils.escapeHtml(tokens[index].content||'图片')
const fence=markdown.renderer.rules.fence!
markdown.renderer.rules.fence=(tokens,index,options,env,self)=>`<div class="learning-code-block"><button type="button" data-copy-code="true" aria-label="复制代码">复制代码</button>${fence(tokens,index,options,env,self)}</div>`
const html=computed(()=>DOMPurify.sanitize(markdown.render(props.content),{FORBID_TAGS:['img','iframe','style','form','input'],FORBID_ATTR:['style']}))
async function copyCode(event:MouseEvent){const target=event.target as HTMLElement;if(!target.closest('[data-copy-code]'))return;const code=target.closest('.learning-code-block')?.querySelector('code');if(!code)return;try{copyError.value='';await copyLearningText(code.textContent||'');copied.value=true;setTimeout(()=>copied.value=false,1500)}catch{copyError.value='复制失败，请选择代码复制'}}
</script>
<template><pre v-if="streaming" class="streaming-text">{{content}}</pre><div v-else class="learning-markdown" @click="copyCode" v-html="html"/><small v-if="copied" role="status">代码已复制</small><small v-if="copyError" role="alert">{{copyError}}</small></template>
<style scoped>
.streaming-text{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.85;margin:0}.learning-markdown :deep(.learning-code-block){position:relative;padding-top:30px;background:var(--pc-bg,#f3f6f4);border-radius:12px;margin:16px 0}.learning-markdown :deep([data-copy-code]){position:absolute;right:10px;top:5px;border:0;background:transparent;color:var(--pc-muted,#74847a);font-size:12px;cursor:pointer;padding:5px}.learning-markdown :deep(.learning-code-block pre){margin:0;border:0}.learning-markdown{font-size:15px;line-height:1.85;overflow-wrap:anywhere;min-width:0}
.learning-markdown :deep(p){margin:0 0 14px}.learning-markdown :deep(h1),.learning-markdown :deep(h2),.learning-markdown :deep(h3){line-height:1.5;margin:22px 0 10px;font-weight:650}.learning-markdown :deep(h1){font-size:22px}.learning-markdown :deep(h2){font-size:19px}.learning-markdown :deep(h3){font-size:16px}.learning-markdown :deep(:first-child){margin-top:0}.learning-markdown :deep(ul),.learning-markdown :deep(ol){padding-left:24px;margin:10px 0 16px}.learning-markdown :deep(li){margin:5px 0}.learning-markdown :deep(pre){background:var(--pc-bg,#f3f6f4);border:1px solid var(--pc-border,#e1e8e3);border-radius:12px;padding:16px;overflow:auto;white-space:pre;font-size:13px;line-height:1.7;cursor:text}.learning-markdown :deep(code){font-family:ui-monospace,Consolas,monospace;background:var(--pc-bg,#f3f6f4);padding:2px 5px;border-radius:4px;font-size:.9em}.learning-markdown :deep(pre code){padding:0;background:none}.learning-markdown :deep(blockquote){margin:14px 0;padding:5px 16px;border-left:3px solid var(--pc-primary,#34775c);color:var(--pc-muted,#74847a)}.learning-markdown :deep(table){display:block;max-width:100%;overflow:auto;border-collapse:collapse;margin:16px 0;font-size:14px}.learning-markdown :deep(th),.learning-markdown :deep(td){border:1px solid var(--pc-border,#e1e8e3);padding:8px 12px;text-align:left}.learning-markdown :deep(th){background:var(--pc-bg,#f3f6f4)}.learning-markdown :deep(a){color:var(--pc-primary,#34775c);text-decoration:underline}.learning-markdown :deep(hr){border:0;border-top:1px solid var(--pc-border,#e1e8e3);margin:20px 0}small{color:var(--pc-muted,#74847a)}
</style>
