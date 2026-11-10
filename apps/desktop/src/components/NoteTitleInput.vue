<script setup lang="ts">
import {nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
const props=defineProps<{modelValue:string;readonly?:boolean}>()
const emit=defineEmits<{'update:modelValue':[value:string];submit:[]}>()
const input=ref<HTMLTextAreaElement>()
let observer:ResizeObserver|undefined,lastWidth=0
function resize(){const element=input.value;if(!element)return;element.style.height='auto';element.style.height=`${element.scrollHeight}px`}
function update(event:Event){const element=event.target as HTMLTextAreaElement,value=element.value.replace(/[\r\n]+/g,' ');element.value=value;emit('update:modelValue',value);resize()}
watch(()=>props.modelValue,()=>{void nextTick(resize)})
onMounted(()=>{resize();observer=new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width;if(width!==lastWidth){lastWidth=width;resize()}});if(input.value)observer.observe(input.value)})
onBeforeUnmount(()=>observer?.disconnect())
</script>
<template><textarea ref="input" class="note-title-input" :value="modelValue" :readonly="readonly" rows="1" aria-label="笔记标题" placeholder="未命名笔记" @input="update" @keydown.enter.prevent="emit('submit')"/></template>
<style scoped>
.note-title-input{display:block;box-sizing:border-box;width:100%;min-width:0;min-height:34px;margin:0;padding:0;border:0;border-radius:0;outline:none;resize:none;overflow:hidden;background:transparent;color:var(--pc-text);font:inherit;font-size:26px;font-weight:650;line-height:1.3;overflow-wrap:anywhere}
.note-title-input:focus-visible{box-shadow:0 1px 0 var(--pc-border)}.note-title-input[readonly]{box-shadow:none}
</style>
