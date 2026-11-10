<script setup lang="ts">
import {inferMediaType} from '../services/filePreview'
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {cachedAttachment,type AttachmentItem} from '../services/attachments'
const props=defineProps<{ownerId:string;item:AttachmentItem}>()
const host=ref<HTMLElement>(),url=ref(''),snippet=ref(''),loading=ref(false),failed=ref(false);let observer:IntersectionObserver|undefined,generation=0
const extension=computed(()=>{const match=props.item.originalFilename.match(/\.([^.]+)$/);return(match?.[1]||props.item.mediaType?.split('/')[1]||'FILE').slice(0,8).toUpperCase()})
const raster=computed(()=>/^image\/(jpeg|png|webp|gif|bmp|avif)$/i.test(inferMediaType(props.item.originalFilename,props.item.mediaType||'')))
const textLike=computed(()=>/^(text\/|application\/(json|xml|yaml|x-yaml))/.test(props.item.mediaType||'')||/\.(md|markdown|txt|json|ya?ml|xml|csv|log|ini|conf|js|ts|jsx|tsx|vue|css|scss|html|java|kt|py|rs|go|sql|sh|ps1)$/i.test(props.item.originalFilename))
function release(){if(url.value)URL.revokeObjectURL(url.value);url.value=''}
async function load(){if((!raster.value&&!textLike.value)||url.value||snippet.value||loading.value)return;const request=++generation;loading.value=true;failed.value=false;try{const blob=await cachedAttachment(props.ownerId,props.item);if(request!==generation)return;if(raster.value)url.value=URL.createObjectURL(blob.slice(0,blob.size,inferMediaType(props.item.originalFilename,props.item.mediaType)));else snippet.value=(await blob.slice(0,1600).text()).replace(/\s+/g,' ').trim().slice(0,220)}catch{if(request===generation)failed.value=true}finally{if(request===generation)loading.value=false}}
function observe(){observer?.disconnect();if(!host.value||(!raster.value&&!textLike.value))return;observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){void load();observer?.disconnect()}},{rootMargin:'240px'});observer.observe(host.value)}
watch(()=>props.item.uid,()=>{generation++;release();snippet.value='';failed.value=false;observe()})
onMounted(observe);onBeforeUnmount(()=>{generation++;observer?.disconnect();release()})
</script>
<template><span ref="host" class="attachment-thumb" :class="{image:Boolean(url),loading,failed,text:Boolean(snippet)}"><img v-if="url" :src="url" :alt="item.originalFilename" loading="lazy"><span v-else-if="snippet" class="snippet">{{snippet}}</span><span v-else class="format"><b>{{extension}}</b><small>{{failed?'预览失败':loading?'加载中':raster?'图片':textLike?'文本':'文件'}}</small></span><em v-if="item.mediaType==='image/gif'">GIF</em></span></template>
<style scoped>
.attachment-thumb{position:relative;display:grid;width:100%;height:100%;min-height:56px;place-items:center;overflow:hidden;border-radius:9px;background:linear-gradient(145deg,#edf4ef,#f8faf9);color:#476454}.attachment-thumb img{width:100%;height:100%;object-fit:cover}.format{display:grid;place-items:center;gap:4px}.format b{max-width:90px;padding:5px 8px;border-radius:6px;background:#fff;box-shadow:0 3px 12px #23402e17;color:#466052;font-size:11px;letter-spacing:.4px}.format small{color:#849189;font-size:8px}.snippet{align-self:stretch;padding:14px;overflow:hidden;background:#fbfcfb;color:#58675f;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:8px;line-height:1.65;text-align:left;white-space:normal}.loading .format{opacity:.65}.failed .format b{color:#a05252}.attachment-thumb em{position:absolute;right:6px;bottom:6px;padding:3px 5px;border-radius:4px;background:#17251dbb;color:#fff;font-size:7px;font-style:normal}
</style>
