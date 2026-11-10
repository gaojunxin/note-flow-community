<script setup lang="ts">
import {acquireInert} from '../services/inertLease'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { productDialogState as dialog, settleProductDialog } from '../services/productDialog'
const input=ref<HTMLInputElement|HTMLTextAreaElement|null>(null)
const card=ref<HTMLFormElement|null>(null)
const route=useRoute()
const valid=computed(()=>dialog.mode==='confirm'||(!dialog.inputRequired||dialog.value.trim())&&(!dialog.confirmationText||dialog.value.trim()===dialog.confirmationText))
let origin:HTMLElement|null=null
let root:HTMLElement|null=null
let savedOverflow='',active=false,releaseInert=()=>{}
function close(){settleProductDialog(false)}
function submit(){if(valid.value)settleProductDialog(true)}
function keydown(event:KeyboardEvent){
  if(!dialog.open)return
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();return}
  if(event.key!=='Tab'||!card.value)return
  const nodes=[...card.value.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(node=>node.getClientRects().length)
  const first=nodes[0],last=nodes.at(-1)
  if(!first){event.preventDefault();card.value.focus();return}
  if(!card.value.contains(document.activeElement)||document.activeElement===card.value){event.preventDefault();(event.shiftKey?last:first)?.focus()}
  else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
}
function cleanup(){
  if(!active)return
  active=false
  document.removeEventListener('keydown',keydown,true)
  document.body.style.overflow=savedOverflow
  releaseInert()
  root=null
  if(origin?.isConnected)origin.focus({preventScroll:true})
  origin=null
}
watch(()=>dialog.open,async open=>{
  if(!open){cleanup();return}
  origin=document.activeElement instanceof HTMLElement?document.activeElement:null
  savedOverflow=document.body.style.overflow
  root=document.querySelector<HTMLElement>('#app')
  releaseInert=acquireInert(root)
  document.body.style.overflow='hidden'
  active=true
  document.addEventListener('keydown',keydown,true)
  await nextTick()
  if(dialog.open)(dialog.mode==='prompt'?input.value:card.value)?.focus({preventScroll:true})
})
watch(()=>route.fullPath,()=>{if(dialog.open)close()})
onBeforeUnmount(()=>{if(dialog.open)close();cleanup()})
</script>

<template>
  <Teleport to="body"><Transition name="product-dialog">
    <div v-if="dialog.open" class="product-dialog-backdrop" @click.self="close" >
      <form ref="card" tabindex="-1" class="product-dialog-card" :class="`tone-${dialog.tone}`" role="dialog" aria-modal="true" :aria-labelledby="'product-dialog-title'" @submit.prevent="submit">
        <header><span class="product-dialog-mark">{{dialog.tone==='danger'?'!':dialog.tone==='warning'?'!':'✓'}}</span><div><h2 id="product-dialog-title">{{dialog.title}}</h2><p v-if="dialog.message">{{dialog.message}}</p></div><button type="button" aria-label="关闭" @click="close">×</button></header>
        <label v-if="dialog.mode==='prompt'" class="product-dialog-input"><span>{{dialog.inputLabel||'请输入'}}</span><textarea v-if="dialog.multiline&&dialog.inputType!=='password'" ref="input" v-model="dialog.value" :placeholder="dialog.inputPlaceholder" rows="7"/><input v-else :type="dialog.inputType||'text'" :spellcheck="dialog.inputType==='password'?false:undefined" ref="input" v-model="dialog.value" :placeholder="dialog.inputPlaceholder" autocomplete="off"/><small v-if="dialog.confirmationText">请输入“{{dialog.confirmationText}}”以启用确认按钮</small></label>
        <footer><button type="button" @click="close">{{dialog.cancelText}}</button><button class="product-dialog-confirm" :disabled="!valid" type="submit">{{dialog.confirmText}}</button></footer>
      </form>
    </div>
  </Transition></Teleport>
</template>
