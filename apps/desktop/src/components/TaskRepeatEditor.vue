<template>
  <form ref="form" class="task-repeat-editor" @submit.prevent="!draftMode&&submit()">
    <label>重复频率<select aria-label="重复频率" v-model="frequency" :disabled="saving||protectedRule"><option value="">不重复</option><option v-for="item in frequencies" :key="item.value" :value="item.value" :disabled="isCommunityEdition&&item.value==='lunarYearly'">{{item.label}}</option></select></label>
    <template v-if="frequency">
      <label v-if="frequency==='lunarYearly'">农历月份<select v-model.number="lunarMonth" :disabled="saving||protectedRule"><option v-for="month in 12" :key="month" :value="month">{{month}}月</option></select></label>
      <label v-if="frequency==='lunarYearly'">农历日期<input v-model.number="lunarDay" type="number" min="1" max="30" required :disabled="saving||protectedRule"/></label>
      <label v-if="frequency==='lunarYearly'"><input v-model="lunarLeapMonth" type="checkbox" :disabled="saving||protectedRule"/>闰月生日</label>
      <p v-if="frequency==='lunarYearly'">每年按农历日期计算。三十遇小月按二十九；无对应闰月时按同名普通月份。本次日期可单独调整。</p>
      <label>间隔<input v-model.number="interval" type="number" min="1" max="365" required :disabled="saving||protectedRule"/><span>每 {{interval || 1}} {{unit}}重复</span></label>
      <label>重复方式<select v-model="repeatFrom" :disabled="saving||protectedRule"><option value="due">到期重复</option><option v-if="frequency!=='lunarYearly'" value="completion" :disabled="isCommunityEdition">完成重复</option></select></label>
      <p>{{repeatFrom==='completion'?'从实际完成或跳过的日期计算下个周期。':'按原计划日期推进；调整本次日期不改变后续周期。'}}</p>
      <label>结束重复<select v-model="ending" :disabled="saving||protectedRule"><option value="never">一直重复</option><option value="date">按日期结束</option><option value="count">按次数结束</option></select></label>
      <label v-if="ending==='date'">最后日期<input v-model="endDate" type="date" required :disabled="saving||protectedRule"/></label>
      <label v-if="ending==='count'">总次数<input v-model.number="count" type="number" min="1" max="100000" required :disabled="saving||protectedRule"/><span>包含当前系列已有周期</span></label>
    </template>
    <p v-if="protectedRule">当前高级或自定义重复规则仅供查看，原文保持保留。社区版不会重新计算或改写此规则。</p>
    <p v-else-if="isCommunityEdition">社区版支持公历基础重复，农历与完成后重复由高级组件提供。</p>
    <p v-if="error" role="alert">{{error}}</p>
    <button v-if="!draftMode" type="submit" :disabled="saving||protectedRule">{{saving?'保存中…':submitLabel||'保存'}}</button>
  </form>
</template>
<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {isCommunityEdition} from '../services/clientCapabilities'
import {basicRepeatCapability} from '@note-flow/core/community'
import {parseTaskRepeatRule} from '@note-flow/core/task-recurrence'
const props=defineProps<{rule?:string|null;saving?:boolean;error?:string;submitLabel?:string;draftMode?:boolean}>()
const emit=defineEmits<{save:[value:string|null];change:[value:string|null]}>()
const form=ref<HTMLFormElement>()
defineExpose({valid:()=>form.value?.checkValidity()??true,validate:()=>form.value?.reportValidity()??true})
const protectedRule=computed(()=>isCommunityEdition&&basicRepeatCapability(props.rule).kind==='protected')
const initial=parseTaskRepeatRule(props.rule)
const lunarMonth=ref(initial?.lunarMonth||1),lunarDay=ref(initial?.lunarDay||1),lunarLeapMonth=ref(initial?.lunarLeapMonth||false)
const frequency=ref(initial?.calendar==='lunar'?'lunarYearly':initial?.frequency||''),interval=ref(initial?.interval||1),repeatFrom=ref(initial?.repeatFrom||'due')
const ending=ref(initial?.endDate?'date':initial?.count?'count':'never'),endDate=ref(initial?.endDate||''),count=ref(initial?.count||10)
const frequencies=[{value:'daily',label:'每天'},{value:'weekdays',label:'工作日'},{value:'weekly',label:'每周'},{value:'monthly',label:'每月'},{value:'yearly',label:'每年'},{value:'lunarYearly',label:'农历每年'}]
const unit=computed(()=>(({daily:'天',weekdays:'个工作日',weekly:'周',monthly:'月',yearly:'年',lunarYearly:'年'} as Record<string,string>)[frequency.value]||''))
watch(frequency,value=>{if(value==='lunarYearly')repeatFrom.value='due'})
function draftRule(){return frequency.value?JSON.stringify({frequency:frequency.value==='lunarYearly'?'yearly':frequency.value,...(frequency.value==='lunarYearly'?{calendar:'lunar',lunarMonth:Number(lunarMonth.value),lunarDay:Number(lunarDay.value),lunarLeapMonth:lunarLeapMonth.value}:{}),interval:Number(interval.value),repeatFrom:repeatFrom.value,...(ending.value==='date'?{endDate:endDate.value}:ending.value==='count'?{count:Number(count.value)}:{})}):null}
function submit(){if(protectedRule.value||isCommunityEdition&&(frequency.value==='lunarYearly'||repeatFrom.value==='completion'))return;emit('save',draftRule())}
watch([frequency,interval,repeatFrom,ending,endDate,count,lunarMonth,lunarDay,lunarLeapMonth],()=>{if(props.draftMode&&!protectedRule.value)emit('change',draftRule())})
</script>
<style scoped>
.task-repeat-editor{display:flex;flex-direction:column;gap:12px;padding:12px;font-size:13px}.task-repeat-editor label{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.task-repeat-editor select,.task-repeat-editor input{min-height:44px;max-width:100%;padding:8px;border:1px solid #d7ded9;border-radius:8px;background:var(--pc-surface,#fff);color:inherit;font:inherit}.task-repeat-editor input[type=number]{width:95px}.task-repeat-editor p,.task-repeat-editor label>span{margin:0;color:#66766d;font-size:12px;line-height:1.6}.task-repeat-editor button{min-height:44px;border:0;border-radius:8px;background:#26764c;color:#fff;font:inherit}.task-repeat-editor [role=alert]{color:#b54738}
</style>
