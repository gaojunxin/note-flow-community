<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props=withDefaults(defineProps<{modelValue?:string|null;includeTime?:boolean;ariaLabel?:string;placeholder?:string;helper?:'clear'|'today';teleported?:boolean;disabled?:boolean}>(),{modelValue:'',includeTime:false,ariaLabel:'选择日期',placeholder:'选择日期',helper:'clear',teleported:true})
const emit=defineEmits<{(event:'update:modelValue',value:string):void;(event:'confirm',value:string):void}>()
const panel=ref<HTMLElement|null>(null)
const open=ref(false),trigger=ref<HTMLElement|null>(null),popoverPosition=ref({top:0,left:0}),draftDate=ref(''),draftTime=ref('09:00'),month=ref(new Date(new Date().getFullYear(),new Date().getMonth(),1))
const pad=(value:number)=>String(value).padStart(2,'0')
const dateKey=(date:Date)=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`
const todayKey=()=>dateKey(new Date())
const splitValue=(value?:string|null)=>{const [date,time]=String(value||'').split('T');return {date:/^\d{4}-\d{2}-\d{2}$/.test(date)?date:'',time:time?.slice(0,5)||'09:00'}}
const display=computed(()=>{if(!props.modelValue)return props.placeholder;const value=String(props.modelValue);return props.includeTime?value.replace('T',' '):value})
const days=computed(()=>{const year=month.value.getFullYear(),index=month.value.getMonth(),first=new Date(year,index,1),start=new Date(year,index,1-(first.getDay()||7)+1);return Array.from({length:42},(_,offset)=>{const date=new Date(start);date.setDate(start.getDate()+offset);return {key:dateKey(date),day:date.getDate(),outside:date.getMonth()!==index,today:dateKey(date)===todayKey()}})})
const monthTitle=computed(()=>`${month.value.getFullYear()}年 ${month.value.getMonth()+1}月`)
function positionPopover(){
  const rect=trigger.value?.getBoundingClientRect(),card=panel.value
  if(!rect||!card)return
  const width=card.offsetWidth,height=card.offsetHeight
  const below=rect.bottom+7
  popoverPosition.value={left:Math.max(8,Math.min(innerWidth-width-8,rect.right-width)),top:Math.max(8,Math.min(innerHeight-height-8,below+height<=innerHeight-8?below:rect.top-height-7))}
}
function show(){if(props.disabled)return;const value=splitValue(props.modelValue);draftDate.value=value.date;draftTime.value=value.time;const basis=value.date?new Date(`${value.date}T12:00:00`):new Date();month.value=new Date(basis.getFullYear(),basis.getMonth(),1);open.value=true}
function close(){open.value=false}
function choose(value:string){draftDate.value=value}
function move(amount:number){month.value=new Date(month.value.getFullYear(),month.value.getMonth()+amount,1)}
function useHelper(){if(props.helper==='today'){draftDate.value=todayKey();month.value=new Date()}else draftDate.value=''}
function confirm(){if(props.disabled)return;const value=draftDate.value?(props.includeTime?`${draftDate.value}T${draftTime.value||'09:00'}`:draftDate.value):'';emit('update:modelValue',value);emit('confirm',value);close()}
function keydown(event:KeyboardEvent){
  if(!open.value)return
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();return}
  if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();event.stopImmediatePropagation();confirm();return}
  if(event.key!=='Tab'||!panel.value)return
  const nodes=[...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(node=>node.getClientRects().length)
  const first=nodes[0],last=nodes.at(-1)
  if(!panel.value.contains(document.activeElement)||document.activeElement===panel.value){event.preventDefault();(event.shiftKey?last:first)?.focus()}
  else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
}
watch(()=>props.disabled,value=>{if(value)close()})
watch(open,async value=>{if(value){window.addEventListener('keydown',keydown,true);window.addEventListener('resize',positionPopover);await nextTick();if(open.value){positionPopover();panel.value?.focus({preventScroll:true})}}else{window.removeEventListener('keydown',keydown,true);window.removeEventListener('resize',positionPopover);trigger.value?.focus({preventScroll:true})}})
onBeforeUnmount(()=>{window.removeEventListener('keydown',keydown,true);window.removeEventListener('resize',positionPopover)})
</script>

<template>
  <span class="pc-date-picker">
    <button ref="trigger" type="button" class="pc-date-trigger" :disabled="disabled" :aria-label="ariaLabel" :aria-expanded="open" @click="show"><svg viewBox="0 0 24 24"><path d="M4 6h16v14H4zM8 3v6M16 3v6M4 10h16"/></svg><span :class="{placeholder:!modelValue}">{{display}}</span></button>
    <Teleport to="body" :disabled="!teleported"><span v-if="open" class="pc-date-scrim" @click="close"/>
    <section v-if="open" ref="panel" tabindex="-1" class="pc-date-popover" :style="{top:`${popoverPosition.top}px`,left:`${popoverPosition.left}px`}" role="dialog" aria-modal="true" :aria-label="ariaLabel" @click.stop>
      <header><button type="button" aria-label="上个月" @click="move(-1)">‹</button><strong>{{monthTitle}}</strong><button type="button" aria-label="下个月" @click="move(1)">›</button></header>
      <div class="pc-date-week"><span v-for="item in ['一','二','三','四','五','六','日']" :key="item">{{item}}</span></div>
      <div class="pc-date-grid"><button v-for="item in days" :key="item.key" type="button" :class="{outside:item.outside,today:item.today,selected:item.key===draftDate}" @click="choose(item.key)">{{item.day}}</button></div>
      <label v-if="includeTime" class="pc-date-time"><span>时间</span><input v-model="draftTime" type="time"/></label>
      <footer><button type="button" class="date-helper" @click="useHelper">{{props.helper==='today'?'今天':'清除'}}</button><i/><button type="button" @click="close">取消</button><button type="button" class="primary" @click="confirm">确定</button></footer>
    </section></Teleport>
  </span>
</template>
