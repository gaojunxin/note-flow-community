<script setup lang="ts">
import {ref, shallowRef} from 'vue'
import {createEditionReturn, decodeEditionTransferFile, importEditionTransfer, serializeEditionTransfer, type EditionTransfer} from '@note-flow/core/community'
import {getCommunityWorkspace} from './runtime'
import {COMMUNITY_PROFILE_KEY, createCommunityWorkspace} from './workspace'
import {exportCommunityFile} from './fileExport'
import {useAuthStore} from '../stores/auth'
import {useNotesStore} from '../stores/notes'
const busy = ref(false), message = ref(''), pending = shallowRef<EditionTransfer>()
async function preview(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''; if (!file) return
  busy.value = true; pending.value = undefined; message.value = ''
  try {const value = await decodeEditionTransferFile(await file.text()); if (value.schema !== 'note-flow-edition-transfer') throw new Error('请选择官方版导出的切换档案'); pending.value = value}
  catch (error) {message.value = error instanceof Error ? error.message : '档案读取失败'} finally {busy.value = false}
}
async function confirmImport() {
  const transfer = pending.value; if (!transfer || busy.value) return
  busy.value = true; message.value = ''
  const next = createCommunityWorkspace(crypto.randomUUID())
  try {
    await next.initialize(); const result = await importEditionTransfer(next.host, next.context, transfer)
    localStorage.setItem(COMMUNITY_PROFILE_KEY, next.context.profileId)
    await useAuthStore().fetchUser(); useNotesStore().$reset(); await useNotesStore().load()
    window.dispatchEvent(new Event('note-flow:workspace-change')); pending.value = undefined
    message.value = `已导入新的本地空间，原空间保留。${result.media.missing.length ? `${result.media.missing.length} 项媒体缺失，原路径与元数据保持保留。` : ''}官方保险箱密文保留在完整档案中，原账号与主密码保持不变。`
  } catch (error) {message.value = error instanceof Error ? error.message : '导入失败，原空间仍保留'} finally {await next.dispose(); busy.value = false}
}
async function exportReturn() {
  if (busy.value) return; busy.value = true; message.value = ''
  try {const workspace = await getCommunityWorkspace(), value = createEditionReturn(await workspace.host.exportWorkspace(workspace.context)); const saved = await exportCommunityFile(new Blob([await serializeEditionTransfer(value)], {type: 'application/json'}), `note-flow-edition-return-${value.transfer.transferId}.json`); message.value = saved ? '已导出返回官方版文件；请在原账号中预览并确认恢复，不会直接重放旧同步队列。' : '已取消导出，本地数据保持不变'}
  catch (error) {message.value = error instanceof Error ? error.message : '返回文件导出失败'} finally {busy.value = false}
}
</script>
<template>
  <section class="edition-transfer"><h2>官方与社区版本切换</h2><p>导入官方版完整切换档案到新空间。原空间保留；离线编辑后可导出返回文件。</p>
    <div class="actions"><label>导入官方版切换文件<input type="file" accept="application/json,.json" :disabled="busy" @change="preview"></label><button :disabled="busy" @click="exportReturn">导出返回官方版文件</button></div>
    <div v-if="pending"><p>将导入 {{pending.baseline.entities.length}} 条记录到独立新空间；原始字段、旧操作和密文档案保持保留。</p><div class="actions"><button :disabled="busy" @click="confirmImport">确认导入新空间</button><button :disabled="busy" @click="pending=undefined;message='已取消，本地数据未改变'">取消切换</button></div></div>
    <p v-if="message" role="status">{{message}}</p>
  </section>
</template>
<style scoped>
.edition-transfer{padding:20px;border:1px solid var(--border-color,#ddd);border-radius:12px}.edition-transfer p{line-height:1.6}.actions{display:flex;gap:12px;flex-wrap:wrap}button,label{min-height:44px}input{display:block}
</style>
