<script setup lang="ts">
import {ElButton} from 'element-plus'
import {computed,defineAsyncComponent,onBeforeUnmount,ref,shallowRef,watch} from 'vue'
import {cachedAttachment,pinAttachmentCache,openAttachmentContent,type AttachmentItem} from '../services/attachments'
import {isDesktopClient} from '../services/serverConfig'
import {inferMediaType,isAudioPreviewFile,isImagePreviewFile,isPdfPreviewFile,isTextPreviewFile,isVideoPreviewFile} from '../services/filePreview'
import {formatPreviewText,highlightText,syntaxLanguage} from '../services/syntaxHighlight'
import AttachmentDiagnosticDialog from './AttachmentDiagnosticDialog.vue'
import {diagnosticOpen,recordAttachmentAttempt,attachmentErrorCode} from '../services/attachmentDiagnostics'
import MarkdownPreview from './MarkdownPreview.vue'
import AttachmentCacheStatus from './AttachmentCacheStatus.vue'

const transfer=ref({loaded:0,total:0}),cacheState=ref<{source:string;persistent:boolean;pinned:boolean}|null>(null);let downloadController:AbortController|undefined
const PdfDocumentPreview=defineAsyncComponent(()=>import('./PdfDocumentPreview.vue'))
const pdfBlob=shallowRef<Blob>()
/** 外层已展示相同名称时可关闭showFilename；类型、大小和原有文件操作仍保留。 */
const props=withDefaults(defineProps<{ownerId:string;item:AttachmentItem;showFilename?:boolean}>(),{showFilename:true})
const diagnosticOpenState=ref(false)
const url=ref(''),text=ref(''),loading=ref(false),error=ref('');let request=0
const filename=computed(()=>props.item.originalFilename||'文件')
const pdf=computed(()=>isPdfPreviewFile(filename.value,props.item.mediaType||''))
const image=computed(()=>isImagePreviewFile(filename.value,props.item.mediaType||''))
const audio=computed(()=>isAudioPreviewFile(filename.value,props.item.mediaType||''))
const video=computed(()=>isVideoPreviewFile(filename.value,props.item.mediaType||''))
const textLike=computed(()=>isTextPreviewFile(filename.value,props.item.mediaType||''))
const markdown=computed(()=>/\.(md|markdown)$/i.test(filename.value))
const highlighted=computed(()=>highlightText(text.value,filename.value)),language=computed(()=>syntaxLanguage(filename.value))
function release(){downloadController?.abort();if(url.value)URL.revokeObjectURL(url.value);url.value='';text.value='';pdfBlob.value=undefined}
async function load(){const current=++request;release();error.value='';loading.value=true;transfer.value={loaded:0,total:0};cacheState.value=null;downloadController=new AbortController();try{const blob=await cachedAttachment(props.ownerId,props.item,{signal:downloadController.signal,onDownloadProgress:event=>{if(current===request)transfer.value={loaded:event.loaded,total:event.total||0}},onState:value=>{if(current===request)cacheState.value=value}});if(current!==request)return;if(pdf.value)pdfBlob.value=blob;else if(textLike.value){if(blob.size>5*1024*1024)throw new Error('文本文件超过 5 MB，请使用系统程序打开');const content=await blob.text();if(current!==request)return;text.value=markdown.value?content:formatPreviewText(content,filename.value)}else url.value=URL.createObjectURL(blob.slice(0,blob.size,inferMediaType(filename.value,props.item.mediaType)))}catch(source){if(current===request){error.value=downloadController?.signal.aborted?'下载已取消，可点击重试':source instanceof Error?source.message:'文件预览失败';recordAttachmentAttempt(props.ownerId,props.item,'preview',attachmentErrorCode(source))}}finally{if(current===request)loading.value=false}}
// PDF保留引擎的具体失败原因；图片和媒体的原生事件继续使用通用提示。
function previewFailed(source?:unknown){error.value=typeof source==='string'?source:'附件渲染失败，请检查格式或使用系统程序打开';recordAttachmentAttempt(props.ownerId,props.item,'preview','RENDER_FAILED')}
async function open(){try{await diagnosticOpen(props.ownerId,props.item)}catch(source){error.value=source instanceof Error?source.message:'文件打开失败'}}
watch(()=>[props.ownerId,props.item.uid,props.item.contentUrl,props.item.sha256],()=>void load(),{immediate:true});onBeforeUnmount(()=>{request++;release()})
async function toggleOffline(){const item=props.item;if(!item||!cacheState.value)return;try{cacheState.value.pinned=await pinAttachmentCache(props.ownerId,item,!cacheState.value.pinned)}catch(source){error.value=source instanceof Error?source.message:'离线保留失败'}}
</script>

<template><section class="file-inline-preview" :class="{'pdf-reader-ready':pdf&&pdfBlob&&!loading&&!error}"><header v-if="!pdf||!pdfBlob||loading||error"><div><strong v-if="showFilename">{{filename}}</strong><small>{{item.mediaType||'未知媒体类型'}} · {{Math.ceil(item.sizeBytes/1024)}} KB<template v-if="textLike"> · {{language.toUpperCase()}}</template></small></div><nav><AttachmentCacheStatus v-if="!loading&&cacheState" :state="cacheState" @toggle="toggleOffline"/><button @click="open">{{isDesktopClient()?'用默认程序打开':'下载原文件'}}</button></nav></header><main :class="{document:pdf||textLike,pdf,media:audio||video,'transfer-state':loading||Boolean(error)}"><p v-if="loading">正在下载文件 {{Math.ceil(transfer.loaded/1024)}} KB<template v-if="transfer.total"> / {{Math.ceil(transfer.total/1024)}} KB</template> <button @click="downloadController?.abort()">取消</button></p><p v-else-if="error" class="error">{{error}} <button @click="load">重试下载</button> <button @click="diagnosticOpenState=true">检查附件</button></p><PdfDocumentPreview v-else-if="pdf&&pdfBlob" :blob="pdfBlob" :owner-id="ownerId" :filename="filename" @error="previewFailed"><template #document-info><div class="pdf-file-info" :title="`${filename} · ${Math.ceil(item.sizeBytes/1024)} KB`"><strong v-if="showFilename">{{filename}}</strong><small>PDF · {{Math.ceil(item.sizeBytes/1024)}} KB</small></div></template><template #document-actions><AttachmentCacheStatus v-if="cacheState" :state="cacheState" @toggle="toggleOffline"/><ElButton text size="small" :aria-label="isDesktopClient()?'用默认程序打开':'下载原文件'" :title="isDesktopClient()?'用默认程序打开':'下载原文件'" @click="open">{{isDesktopClient()?'打开':'下载'}}</ElButton></template></PdfDocumentPreview><img v-else-if="image&&url" :src="url" @error="previewFailed" :alt="filename"/><MarkdownPreview v-else-if="markdown" :content="text"/><pre v-else-if="textLike" class="syntax-preview"><code v-html="highlighted"/></pre><audio v-else-if="audio&&url" :src="url" @error="previewFailed" controls/><video v-else-if="video&&url" :src="url" @error="previewFailed" controls/></main></section><AttachmentDiagnosticDialog v-if="diagnosticOpenState" :owner-id="ownerId" :item="item" @close="diagnosticOpenState=false"/></template>

<style scoped>
.file-inline-preview{display:grid;grid-template-rows:auto minmax(360px,1fr);min-height:min(680px,calc(100vh - 250px));margin:18px 0;border:1px solid var(--pc-border);border-radius:12px;overflow:hidden;background:#edf1ef}.file-inline-preview>header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:10px 13px;border-bottom:1px solid var(--pc-border);background:#fff}.file-inline-preview header>div{display:grid;min-width:0;gap:2px}.file-inline-preview strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}.file-inline-preview small{color:var(--pc-muted);font-size:8px}.file-inline-preview button{padding:7px 10px;border:1px solid var(--pc-border);border-radius:7px;background:#fff;color:var(--pc-primary);font-size:9px}.file-inline-preview main{display:grid;min-height:0;place-items:center;overflow:auto}.file-inline-preview main.document{display:block;padding:12px}.file-inline-preview main.media{background:#172019}.file-inline-preview iframe{width:100%;height:100%;min-height:520px;border:0;border-radius:7px;background:#fff}.file-inline-preview img{display:block;max-width:calc(100% - 32px);max-height:calc(100% - 32px);object-fit:contain}.file-inline-preview pre{box-sizing:border-box;min-height:100%;margin:0;padding:22px;border-radius:7px;background:#fff;color:#27342d;font:11px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-word}.file-inline-preview audio{width:min(680px,calc(100% - 48px))}.file-inline-preview video{max-width:calc(100% - 48px);max-height:calc(100% - 48px)}.file-inline-preview main>p{padding:10px 13px;border-radius:7px;background:#fff;color:var(--pc-muted);font-size:9px}.file-inline-preview main>p.error{color:#a14444}
.syntax-preview :deep(.syntax-comment){color:#8b9890;font-style:italic}.syntax-preview :deep(.syntax-key),.syntax-preview :deep(.syntax-tag){color:#176d50;font-weight:650}.syntax-preview :deep(.syntax-string){color:#a24d32}.syntax-preview :deep(.syntax-number){color:#315fa5}.syntax-preview :deep(.syntax-literal),.syntax-preview :deep(.syntax-keyword){color:#7652b5;font-weight:600}.syntax-preview :deep(.syntax-variable){color:#a66a16}.syntax-preview :deep(.syntax-punctuation){color:#77837c}
</style>

<style scoped>.file-inline-preview{grid-template-rows:auto minmax(0,1fr)}.file-inline-preview header>nav{display:flex;align-items:center;gap:8px}.file-inline-preview main.pdf{display:flex;padding:0;overflow:hidden}.file-inline-preview main.pdf>.pdf-document-preview{flex:1}</style>

<style scoped>.file-inline-preview.pdf-reader-ready{grid-template-rows:minmax(0,1fr)}.pdf-file-info{display:grid;min-width:0;gap:1px}.pdf-file-info strong{font-size:12px;line-height:16px}.pdf-file-info small{font-size:10px;line-height:14px;white-space:nowrap}</style>

<style scoped>
/* 文档/PDF正文使用不同布局，传输与错误提示独立居中，不能继承正文的左上排列。 */
.file-inline-preview main.transfer-state{display:grid;place-items:center;padding:16px;box-sizing:border-box}
.file-inline-preview main.transfer-state>p{max-width:100%;margin:0;box-sizing:border-box;text-align:center;overflow-wrap:anywhere}
</style>
