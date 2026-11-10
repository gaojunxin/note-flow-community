<script setup lang="ts">
import {saveLocalExport} from '../services/localFileExport'
import MoreIcon from '../components/MoreIcon.vue'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElDropdown, ElDropdownMenu, ElDropdownItem, ElDialog, type DropdownInstance } from 'element-plus'
import 'element-plus/es/components/dropdown/style/css'
import 'element-plus/es/components/dialog/style/css'
import { useRouter } from 'vue-router'
import { dataProtectionService, type DataProtectionStatus, type RecoveryPoint } from '../services/dataProtection'
import { confirmDialog } from '../services/productDialog'

const props=defineProps<{embedded?:boolean}>()
const router=useRouter(),status=ref<DataProtectionStatus|null>(null),points=ref<RecoveryPoint[]>([]),loading=ref(true),busy=ref(false),message=ref(''),pointBusy=ref('')
const dropdowns=new Map<string,DropdownInstance>()
function closeMenus(event:KeyboardEvent){if(event.key==='Escape')dropdowns.forEach(menu=>menu.handleClose())}
const restorePoint=ref<RecoveryPoint|null>(null)
const restoreOpen=ref(false)
function openRestore(point:RecoveryPoint){restorePoint.value=point;restoreOpen.value=true}
const showAll=ref(false)
const visiblePoints=computed(()=>showAll.value?points.value:points.value.slice(0,5))
const verification=ref<Record<string,{valid:boolean;checkedAt:string}>>({})
function verificationLabel(point:RecoveryPoint){const result=verification.value[point.uid];return result?(result.valid?'本次校验通过':'本次校验失败'):(point.checksumAvailable?'待校验':'缺少校验清单')}
let timer:number|undefined
const title=computed(()=>!status.value?'服务器备份状态暂不可用':status.value.health==='good'?'数据保护正常':status.value?.health==='running'?'正在创建恢复点':status.value?.health==='never'?'尚未生成备份':status.value?.health==='warning'?'备份已超过一天':'服务器尚未配置自动备份')
const tone=computed(()=>status.value?.health==='good'?'good':status.value?.health==='running'?'running':status.value?.health==='unavailable'?'error':'warning')
const detail=computed(()=>status.value?.latest?`最近成功：${new Date(status.value.latest.createdAt).toLocaleString('zh-CN')} · ${status.value.recoveryPointCount} 个恢复点`:'数据库、附件和保险箱密文需要生成第一个完整恢复点')
function size(bytes:number){if(bytes<1024*1024)return`${Math.max(1,Math.round(bytes/1024))} KB`;return`${(bytes/1024/1024).toFixed(1)} MB`}
function reason(value:string){const known=({scheduled:'自动备份',manual:'手动备份',pre_upgrade:'升级前备份',pre_restore:'恢复前备份',pre_reset:'重置前备份'} as Record<string,string>)[value];if(known)return known;if(/upgrade/i.test(value))return '升级前备份';if(/predeploy|deploy/i.test(value))return '部署前备份';return '其他备份'}
async function load(){try{[status.value,points.value]=await Promise.all([dataProtectionService.status(),dataProtectionService.points()]);message.value=status.value.activeRun?.status==='failed'?status.value.activeRun.error||'最近一次备份失败':message.value}catch(source){message.value=source instanceof Error?source.message:'无法读取数据保护状态'}finally{loading.value=false}}
async function backup(){busy.value=true;message.value='正在启动备份…';try{await dataProtectionService.backup();message.value='备份已开始，可以继续使用迹语';await load()}catch(source){message.value=source instanceof Error?source.message:'无法启动备份'}finally{busy.value=false}}
async function verifyPoint(point:RecoveryPoint){delete verification.value[point.uid];pointBusy.value=point.uid;message.value='正在校验恢复点…';try{const result=await dataProtectionService.verify(point.uid);verification.value[point.uid]={valid:result.valid,checkedAt:result.checkedAt};message.value=result.valid?`校验通过：${result.checkedFiles} 个文件完整`:`校验失败：${result.error||'文件不完整'}`}catch(source){message.value=source instanceof Error?source.message:'无法校验恢复点'}finally{pointBusy.value=''}}
async function downloadPoint(point:RecoveryPoint){pointBusy.value=point.uid;message.value='正在准备恢复点文件…';try{const blob=await dataProtectionService.download(point.uid);if(!await saveLocalExport(blob,`${point.uid}.zip`))return;message.value='恢复点已下载，请复制到另一块磁盘妥善保存'}catch(source){message.value=source instanceof Error?source.message:'无法下载恢复点'}finally{pointBusy.value=''}}
async function removePoint(point:RecoveryPoint){if(!await confirmDialog({title:'删除这个恢复点？',message:`将永久删除 ${new Date(point.createdAt).toLocaleString('zh-CN')} 创建的备份，删除后无法恢复。`,confirmText:'永久删除',tone:'danger'}))return;pointBusy.value=point.uid;message.value='正在删除恢复点…';try{await dataProtectionService.remove(point.uid);message.value='恢复点已删除';await load()}catch(source){message.value=source instanceof Error?source.message:'无法删除恢复点'}finally{pointBusy.value=''}}
onMounted(()=>{document.addEventListener('keydown',closeMenus);void load();timer=window.setInterval(()=>{if(status.value?.running)void load()},5000)})
onUnmounted(()=>{document.removeEventListener('keydown',closeMenus);dropdowns.clear();if(timer)window.clearInterval(timer)})
</script>

<template>
  <section class="protection-page" :class="{embedded:props.embedded}">
    <header v-if="!props.embedded"><button @click="router.push('/settings?tab=protection')">← 设置</button><div><h1>服务器备份</h1><p>保护服务器上的数据库与资源，不包含设备上尚未同步的内容。</p></div></header>
    <p v-if="loading" class="loading">正在检查服务器备份状态…</p>
    <template v-else>
      <section class="health" :class="tone">
        <i aria-hidden="true"/><div><h2>{{title}}</h2><p>{{detail}}</p><p>服务器恢复点不包含本机未同步内容，不能替代个人备份。</p></div>
        <button :disabled="busy||status?.running||!status?.available" @click="backup">{{status?.running?'正在创建…':'创建服务器恢复点'}}</button>
      </section>
      <div class="policy"><b>{{status?(status.enabled?'自动备份已开启':'自动备份未开启'):'自动备份状态暂不可用'}}</b><p>由服务器配置管理执行时间与保留策略，当前页面暂不支持修改。</p></div>
      <p v-if="message" class="message" role="status">{{message}}</p>
      <section class="points" aria-label="服务器恢复点列表">
        <header class="points-heading"><h2>最近恢复点 <span>{{points.length}}</span></h2></header>
        <p v-if="!points.length" class="empty">暂无恢复点，可先创建一个服务器恢复点。</p>
        <article v-for="point in visiblePoints" :key="point.uid">
          <div class="point-info"><b>{{new Date(point.createdAt).toLocaleString('zh-CN')}}</b><small :title="'原始标识：'+point.reason">{{reason(point.reason)}} · {{size(point.sizeBytes)}} · <span :class="{invalid:verification[point.uid]?.valid===false}" :title="verification[point.uid]?'校验时间：'+new Date(verification[point.uid].checkedAt).toLocaleString():undefined">{{verificationLabel(point)}}</span></small></div>
          <div class="point-actions">
            <button :disabled="!!pointBusy" @click="openRestore(point)">恢复</button>
            <button :disabled="!!pointBusy" @click="downloadPoint(point)">{{pointBusy===point.uid?'处理中…':'下载'}}</button>
            <ElDropdown :ref="(el)=>{if(el)dropdowns.set(point.uid,el as DropdownInstance);else dropdowns.delete(point.uid)}" trigger="click" placement="bottom-end" popper-class="recovery-point-menu" :disabled="!!pointBusy" @command="(command:string)=>command==='verify'?verifyPoint(point):removePoint(point)">
              <button class="pc-more-trigger more-button" :disabled="!!pointBusy" :aria-label="'恢复点操作 '+point.uid" title="更多操作"><MoreIcon/></button>
              <template #dropdown><ElDropdownMenu><ElDropdownItem command="verify">校验完整性</ElDropdownItem><ElDropdownItem command="remove" divided class="recovery-delete">删除恢复点</ElDropdownItem></ElDropdownMenu></template>
            </ElDropdown>
          </div>
        </article>
        <button v-if="points.length>5" class="show-points" :aria-expanded="showAll" @click="showAll=!showAll">{{showAll?'收起，仅显示最近 5 个':`查看全部 ${points.length} 个恢复点`}}</button>
        <p class="restore-help">整机恢复需由服务器管理员停机执行；请先下载并校验恢复点。</p>
      </section>
    </template>
    <ElDialog v-model="restoreOpen" title="恢复服务器备份" width="560px" append-to-body class="server-restore-dialog" :close-on-click-modal="false">
      <template v-if="restorePoint">
        <p>所选恢复点：<strong>{{new Date(restorePoint.createdAt).toLocaleString('zh-CN')}}</strong> · {{size(restorePoint.sizeBytes)}}</p>
        <p class="restore-id">{{restorePoint.uid}}</p>
        <p>这是整个服务器的恢复点，涉及所有账号的数据库与附件，不是个人 JSON 备份。当前服务端不支持从页面直接执行恢复，需要管理员停机操作。</p>
        <div class="restore-check"><span>{{verificationLabel(restorePoint)}}</span><button :disabled="!!pointBusy" @click="verifyPoint(restorePoint)">{{pointBusy===restorePoint.uid?'正在校验…':'校验此恢复点'}}</button></div>
        <p v-if="message" role="status">{{message}}</p>
        <ol><li>先创建并妥善保存当前服务器的恢复点，保留回退来源。</li><li>下载所选备份 ZIP，解压后保留恢复点目录及 COMPLETE、SHA256SUMS 等文件。</li><li>停止迹语服务，准备隔离的空数据库与空附件目录；设置恢复环境变量后，在服务器运行 <code>ops/scripts/restore-instance.sh</code>。</li><li>按部署文档核对数据库、附件、配置和 Redis；验证通过后再切换服务。不要直接覆盖仍在运行的实例。</li></ol>
        <p>恢复脚本需要 BACKUP_DIR、DB_HOST、DB_NAME、DB_USERNAME、DB_PASSWORD、UPLOAD_PATH，并显式设置 RESTORE_CONFIRM=RESTORE_NOTE_FLOW_INSTANCE。详细流程见部署仓库 docs/guides/deployment-and-recovery.md 的“恢复演练”。</p>
      </template>
      <template #footer><button @click="restoreOpen=false">关闭</button><button :disabled="!!pointBusy||!restorePoint" @click="restorePoint&&downloadPoint(restorePoint)">下载所选备份</button></template>
    </ElDialog>
  </section>
</template>

<style scoped>
.protection-page{max-width:900px;margin:0 auto;padding:34px;color:var(--pc-text,#233b32)}
.protection-page.embedded{max-width:none;margin:0;padding:0}
.protection-page>header{display:flex;gap:22px;align-items:flex-start}
.protection-page>header button{border:0;background:none;color:var(--pc-muted,#718078);cursor:pointer}
h1{margin:3px 0;font-size:24px}h2{margin:0;font-size:13px}
.health{display:grid;grid-template-columns:10px minmax(0,1fr) auto;align-items:center;gap:16px;padding:20px 0 16px}
.health>i{width:9px;height:9px;border-radius:50%;background:#c7902e}.health.good>i{background:#258b63}.health.error>i{background:#c65353}.health.running>i{background:#4387c9}
.health p,.policy p{font-size:12px;line-height:1.7;color:var(--pc-muted,#718078);margin:4px 0}
.protection-page button{display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;min-height:34px;padding:6px 12px;border:1px solid var(--pc-border,#dfe8e3);border-radius:7px;background:var(--pc-surface,#fff);color:var(--pc-primary,#25684f);font:inherit;font-size:12px;cursor:pointer;box-sizing:border-box}
.protection-page button:hover{background:var(--pc-primary-soft,#eef5f1)}.protection-page button:disabled{opacity:.55;cursor:not-allowed}.protection-page button:focus-visible{outline:2px solid var(--pc-primary,#26765b);outline-offset:2px}
.policy{padding:0 0 16px 26px;border-bottom:1px solid var(--pc-border,#e4ebe6);font-size:12px}.policy b{font-weight:500}
.message{padding:10px 14px;border-radius:7px;background:var(--pc-primary-soft,#eef5f1);font-size:12px;line-height:1.7;overflow-wrap:anywhere}
.points-heading{padding:18px 0 12px}.points-heading h2{display:flex;align-items:center;gap:8px}.points-heading span{font-weight:400;color:var(--pc-muted,#718078)}
.points article{display:flex;align-items:center;gap:16px;min-height:68px;padding:10px 0;border-top:1px solid var(--pc-border,#e4ebe6);box-sizing:border-box}
.point-info{flex:1;min-width:0;display:grid;gap:5px;font-size:12px}.point-info small{color:var(--pc-muted,#718078);font-size:11px;line-height:1.6;overflow-wrap:anywhere}.point-info .invalid{color:var(--pc-danger,#bd4949)}
.point-actions{display:flex;flex:0 0 auto;align-items:center;gap:8px}.point-actions .more-button{width:34px;padding:0;font-size:20px;line-height:1;letter-spacing:1px}
.protection-page .show-points{margin:10px 0 0;border:0;background:transparent;padding-left:0}
.restore-help,.empty,.loading{font-size:12px;line-height:1.8;color:var(--pc-muted,#718078)}.restore-help{margin:12px 0 0}
@media(max-width:600px){.health{grid-template-columns:10px minmax(0,1fr)}.health>button{grid-column:2;justify-self:start}.points article{gap:8px}.point-actions{gap:6px}.protection-page{padding:20px}}
</style>
<style>
.recovery-point-menu.el-dropdown__popper{min-width:150px;border:1px solid var(--pc-border,#e4ebe6);border-radius:8px;background:var(--pc-surface,#fff);box-shadow:0 8px 24px #1436291f}
.recovery-point-menu .el-dropdown-menu{margin:0;padding:5px;list-style:none;background:transparent}.recovery-point-menu .el-dropdown-menu__item{font-size:12px;min-height:34px;border-radius:5px}.recovery-point-menu .el-dropdown-menu__item.recovery-delete{color:var(--pc-danger,#bd4949)}
</style>

<style>
.server-restore-dialog{max-width:calc(100vw - 32px)}.server-restore-dialog p,.server-restore-dialog li{font-size:13px;line-height:1.8;overflow-wrap:anywhere}.server-restore-dialog li{margin:8px 0}.server-restore-dialog .restore-id{font-size:12px;color:var(--pc-muted,#718078)}.server-restore-dialog .restore-check{display:flex;justify-content:space-between;align-items:center;gap:12px;border-block:1px solid var(--pc-border,#e4ebe6);padding:12px 0}.server-restore-dialog button{padding:7px 12px;border:1px solid var(--pc-border,#dfe8e3);border-radius:6px;background:var(--pc-surface,#fff);color:var(--pc-primary,#25684f);cursor:pointer}.server-restore-dialog button:disabled{opacity:.55;cursor:not-allowed}.server-restore-dialog .el-dialog__footer{display:flex;justify-content:flex-end;gap:8px}
</style>
