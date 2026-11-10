<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElDialog, ElInput, ElOption, ElPagination, ElSelect } from 'element-plus'
import 'element-plus/es/components/pagination/style/css'
import type { VaultItem } from '../services/vault'
import { vaultBulkChanges, vaultBulkPatch, type VaultBulkChange } from '../services/vaultBulkEditing'
import { batchVaultAttribution } from '../services/vaultAttribution'
import { confirmDialog } from '../services/productDialog'

/** 打开时拍下管理字段快照；筛选和勾选不会写库，保存由页面校验当前会话后提交。 */
const props = defineProps<{
  items: VaultItem[]; projects: {uid:string;name:string;areaUid?:string|null}[]
  initialSelection: string[]; busy: boolean; error: string; masked: boolean
}>()
const emit = defineEmits<{ close: []; save: [changes: VaultBulkChange[]] }>()
// 不在草稿中复制密码、备注等凭据正文；标题仅用于列表识别。
const originals:VaultItem[] = JSON.parse(JSON.stringify(props.items.map(item => ({...vaultBulkPatch(item),uid:item.uid,title:item.title,updatedAt:item.updatedAt})))).sort((a:VaultItem,b:VaultItem)=>a.title.localeCompare(b.title,'zh-CN',{numeric:true}))
const drafts = ref<VaultItem[]>(JSON.parse(JSON.stringify(originals)))
const selected = ref([...props.initialSelection])
const query=ref(''), statusFilter=ref(''), projectFilter=ref('')
const status=ref(''), project=ref(''), environment=ref(''), category=ref(''), tags=ref('')
const localError=ref('')
const statuses=[['active','有效'],['expiring','即将过期'],['expired','已过期'],['revoked','已作废'],['compromised','疑似泄露'],['archived','已归档']]
const environments=[['local','本机'],['home','家庭'],['development','开发'],['testing','测试'],['staging','预发布'],['production','生产'],['dmz','DMZ'],['internal','内网']]
const visible=computed(()=>drafts.value.filter(item=>{
  const projectName=props.projects.find(value=>value.uid===item.projectUid)?.name||''
  return (!query.value||[item.title,item.category,...(item.tags||[]),projectName].join(' ').toLowerCase().includes(query.value.toLowerCase()))
    &&(!statusFilter.value||(item.status||'active')===statusFilter.value)
    &&(!projectFilter.value||(item.projectUid||'personal')===projectFilter.value)
}))
const page=ref(1),pageSize=50
const pageItems=computed(()=>visible.value.slice((page.value-1)*pageSize,page.value*pageSize))
watch([query,statusFilter,projectFilter],()=>{page.value=1})
watch(()=>visible.value.length,count=>{page.value=Math.min(page.value,Math.max(1,Math.ceil(count/pageSize)))})
const selectedSet=computed(()=>new Set(selected.value))
const visibleSelected=computed(()=>visible.value.filter(item=>selectedSet.value.has(item.uid)).length)
const changes=computed(()=>vaultBulkChanges(originals,drafts.value))
const dirtySet=computed(()=>new Set(changes.value.map(change=>change.uid)))
const hasBatchValues=computed(()=>status.value||project.value||environment.value||category.value.trim()||tags.value.trim())
function toggleVisible(event:Event){
  const ids=new Set(visible.value.map(item=>item.uid))
  selected.value=(event.target as HTMLInputElement).checked?[...new Set([...selected.value,...ids])]:selected.value.filter(uid=>!ids.has(uid))
}
function move(item:VaultItem,target:string){
  if(target==='personal')Object.assign(item,batchVaultAttribution(item,props.projects,'personal'))
  else Object.assign(item,batchVaultAttribution(item,props.projects,'project',target))
}
function applySelected(){
  localError.value=''
  if(project.value&&project.value!=='personal'&&!props.projects.some(value=>value.uid===project.value)){localError.value='目标项目已变化，请重新选择';return}
  for(const item of drafts.value.filter(item=>selectedSet.value.has(item.uid))){
    if(status.value)item.status=status.value as VaultItem['status']
    if(project.value)move(item,project.value)
    if(environment.value)item.environment=environment.value==='clear'?'':environment.value as VaultItem['environment']
    if(category.value.trim())item.category=category.value.trim()
    if(tags.value.trim())item.tags=[...new Set([...(item.tags||[]),...parseTags(tags.value)])]
  }
}
function parseTags(value:string){return [...new Set(value.split(/[,，\n]/).map(value=>value.trim()).filter(Boolean))]}
async function close(){
  if(props.busy)return
  if(changes.value.length&&!await confirmDialog({message:'放弃本次尚未保存的批量修改？',title:'放弃修改',confirmText:'放弃修改',cancelText:'继续编辑'}))return
  emit('close')
}
function save(){
  if(changes.value.some(change=>change.patch.projectUid&&!props.projects.some(project=>project.uid===change.patch.projectUid))){localError.value='目标项目已变化，请重新选择';return}
  emit('save',changes.value)
}
</script>

<template>
  <ElDialog :model-value="true" title="批量编辑保险箱" append-to-body width="min(1240px, 96vw)" top="4vh" :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" :before-close="close" class="vault-bulk-dialog">
    <section class="vault-bulk-editor" :aria-busy="busy">
      <p class="bulk-hint">当前范围共 {{drafts.length}} 条。可逐行编辑，也可勾选后统一设置；保存前修改只在此窗口暂存。</p>
      <div class="bulk-filters">
        <ElInput v-model="query" clearable placeholder="搜索名称、项目、分类或标签" aria-label="搜索批量记录" :disabled="busy||masked" />
        <ElSelect v-model="statusFilter" clearable placeholder="全部状态" aria-label="筛选状态" :disabled="busy"><ElOption v-for="[value,label] in statuses" :key="value" :value="value" :label="label"/></ElSelect>
        <ElSelect v-model="projectFilter" clearable filterable placeholder="全部项目" aria-label="筛选项目" :disabled="busy"><ElOption value="personal" label="未归入项目"/><ElOption v-for="item in projects" :key="item.uid" :value="item.uid" :label="masked?'项目 '+(projects.indexOf(item)+1):item.name"/></ElSelect>
      </div>
      <fieldset class="bulk-settings" :disabled="busy">
        <legend>统一设置 · 已选 {{selected.length}} 条</legend>
        <ElSelect v-model="status" clearable placeholder="状态：不修改" aria-label="批量状态" :disabled="busy"><ElOption v-for="[value,label] in statuses" :key="value" :value="value" :label="label"/></ElSelect>
        <ElSelect v-model="project" clearable filterable placeholder="项目：不修改" aria-label="批量项目" :disabled="busy"><ElOption value="personal" label="移出项目（保留领域）"/><ElOption v-for="item in projects" :key="item.uid" :value="item.uid" :label="masked?'项目 '+(projects.indexOf(item)+1):item.name"/></ElSelect>
        <ElSelect v-model="environment" clearable placeholder="环境：不修改" aria-label="批量环境" :disabled="busy"><ElOption value="clear" label="清空环境"/><ElOption v-for="[value,label] in environments" :key="value" :value="value" :label="label"/></ElSelect>
        <ElInput v-model="category" placeholder="分类：留空不修改" aria-label="批量分类" :disabled="busy"/>
        <ElInput v-model="tags" placeholder="追加标签，逗号分隔" aria-label="批量追加标签" :disabled="busy"/>
        <ElButton :disabled="busy||!selected.length||!hasBatchValues" @click="applySelected">应用到所选</ElButton>
      </fieldset>
      <div class="bulk-counts"><span>显示 {{visible.length}} 条 · 已选 {{selected.length}} 条 · 待保存 {{changes.length}} 条</span><ElButton text size="small" :disabled="busy||!selected.length" @click="selected=[]">清除选择</ElButton></div>
      <div class="bulk-table-scroll">
        <table class="bulk-table">
          <thead><tr><th><input type="checkbox" aria-label="选择当前筛选全部记录" :checked="visible.length>0&&visibleSelected===visible.length" :indeterminate="visibleSelected>0&&visibleSelected<visible.length" :disabled="busy||!visible.length" @change="toggleVisible"></th><th>名称</th><th>状态</th><th>项目</th><th>环境</th><th>分类</th><th>标签（逗号分隔）</th></tr></thead>
          <tbody><tr v-for="item in pageItems" :key="item.uid" :class="{'bulk-row-dirty':dirtySet.has(item.uid)}">
            <td><input v-model="selected" type="checkbox" :value="item.uid" :aria-label="'选择 '+(masked?'记录':item.title)" :disabled="busy"></td>
            <td><span class="bulk-title" :title="masked?'':item.title">{{masked?'••••••••':item.title}}</span><small v-if="dirtySet.has(item.uid)">待保存</small></td>
            <td><ElSelect :model-value="item.status||'active'" :aria-label="'记录状态'" size="small" :disabled="busy" @update:model-value="item.status=$event"><ElOption v-for="[value,label] in statuses" :key="value" :value="value" :label="label"/></ElSelect></td>
            <td><ElSelect :model-value="item.projectUid||'personal'" size="small" filterable aria-label="记录项目" :disabled="busy" @update:model-value="move(item,$event)"><ElOption value="personal" label="未归入项目"/><ElOption v-if="item.projectUid&&!projects.some(project=>project.uid===item.projectUid)" :value="item.projectUid" label="原项目不可用" disabled/><ElOption v-for="projectItem in projects" :key="projectItem.uid" :value="projectItem.uid" :label="masked?'项目 '+(projects.indexOf(projectItem)+1):projectItem.name"/></ElSelect></td>
            <td><ElSelect v-model="item.environment" size="small" placeholder="未设置" aria-label="记录环境" :disabled="busy"><ElOption value="" label="未设置"/><ElOption v-for="[value,label] in environments" :key="value" :value="value" :label="label"/></ElSelect></td>
            <td><ElInput v-if="!masked" v-model="item.category" size="small" aria-label="记录分类" :disabled="busy"/><span v-else>••••••••</span></td>
            <td><ElInput v-if="!masked" :model-value="(item.tags||[]).join(', ')" size="small" aria-label="记录标签" :disabled="busy" @update:model-value="item.tags=parseTags($event)"/><span v-else>••••••••</span></td>
          </tr><tr v-if="!visible.length"><td colspan="7" class="bulk-empty">当前筛选下没有记录</td></tr></tbody>
        </table>
      </div>
      <ElPagination v-if="visible.length>pageSize" v-model:current-page="page" :page-size="pageSize" :total="visible.length" layout="total, prev, pager, next" :disabled="busy" small />
      <p class="bulk-hint">归入项目会同步调整所属领域；移出项目保留领域。状态修改不清除到期日，已到期记录仍会提示过期。保存后可在主列表撤销本次修改。</p>
      <p v-if="error||localError" class="bulk-error" role="alert">{{error||localError}}</p>
    </section>
    <template #footer><ElButton :disabled="busy" @click="close">取消</ElButton><ElButton type="primary" :loading="busy" :disabled="busy||!changes.length" @click="save">保存 {{changes.length}} 条修改</ElButton></template>
  </ElDialog>
</template>

<style scoped>
:global(.vault-bulk-dialog){display:flex;flex-direction:column;max-height:92vh;margin-bottom:0}
:global(.vault-bulk-dialog .el-dialog__body){display:flex;flex-direction:column;min-height:0;overflow:hidden}
:global(.vault-bulk-dialog .el-dialog__header),:global(.vault-bulk-dialog .el-dialog__footer){flex-shrink:0}

.vault-bulk-editor{display:flex;flex-direction:column;gap:12px;min-height:0;overflow:hidden}.vault-bulk-editor>*{flex-shrink:0}
.bulk-hint{margin:0;color:var(--pc-muted);font-size:12px;line-height:1.6}
.bulk-filters{display:grid;grid-template-columns:minmax(200px,1fr) 160px 220px;gap:10px}
.bulk-settings{margin:0;padding:12px;display:grid;grid-template-columns:140px 200px 140px minmax(120px,1fr) minmax(140px,1fr) auto;gap:8px;border:1px solid var(--pc-border);border-radius:var(--radius-md,8px)}
.bulk-settings legend{font-size:12px;color:var(--pc-muted);padding:0 6px}
.bulk-counts{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--pc-muted)}
.bulk-table-scroll{flex:1 1 auto;min-height:80px;max-height:48vh;overflow:auto;border:1px solid var(--pc-border);border-radius:var(--radius-md,8px)}
.bulk-table{width:100%;min-width:1030px;border-collapse:separate;border-spacing:0;font-size:13px;table-layout:fixed}
.bulk-table th{position:sticky;top:0;z-index:2;background:var(--pc-background);text-align:left;font-weight:500}
.bulk-table th,.bulk-table td{padding:9px 8px;border-bottom:1px solid var(--pc-border)}
.bulk-table th:first-child{width:30px}.bulk-table th:nth-child(2){width:195px}.bulk-table th:nth-child(3){width:110px}.bulk-table th:nth-child(4){width:165px}.bulk-table th:nth-child(5){width:110px}.bulk-table th:nth-child(6){width:130px}
.bulk-table .el-select{width:100%}.bulk-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bulk-table small{color:var(--el-color-primary);font-size:11px}
.bulk-row-dirty{background:var(--el-color-primary-light-9)}.bulk-error{color:var(--el-color-danger);margin:0}.bulk-empty{text-align:center;color:var(--pc-muted);height:90px}
@media(max-width:1100px){.bulk-settings{grid-template-columns:repeat(3,minmax(0,1fr))}.bulk-filters{grid-template-columns:minmax(180px,1fr) 140px 180px}}
</style>
