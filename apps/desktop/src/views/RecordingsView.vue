<script setup lang="ts">
import { confirmDialog } from '../services/productDialog'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { recordingsService, type RecordingEntity } from '../services/recordings'
import { useNotesStore } from '../stores/notes'

type PlaybackRecord = RecordingEntity & { playbackUrl?: string; loading?: boolean }
const notes = useNotesStore(), items = ref<PlaybackRecord[]>([]), query = ref(''), selectedNoteUid = ref(''), error = ref(''), loading = ref(false)
const recording = ref(false), seconds = ref(0), playingUid = ref('')
let recorder: MediaRecorder | undefined, chunks: Blob[] = [], timer: ReturnType<typeof setInterval> | undefined, player: HTMLAudioElement | undefined
const filtered = computed(() => items.value.filter(item => String(item.name || '').toLowerCase().includes(query.value.trim().toLowerCase())))
const duration = (value = 0) => { const total = Math.round(value / 1000); return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}` }
const size = (value = 0) => value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`
const date = (value?: string) => value ? new Date(value.replace(' ', 'T')).toLocaleString('zh-CN') : ''
function stopPlayback() { player?.pause(); player = undefined; playingUid.value = '' }
async function play(item: PlaybackRecord) { if (playingUid.value === item.uid && player) { stopPlayback(); return } stopPlayback(); try { item.loading = true; if (!item.playbackUrl) item.playbackUrl = URL.createObjectURL(await recordingsService.content(item)); player = new Audio(item.playbackUrl); playingUid.value = item.uid; player.onended = stopPlayback; await player.play() } catch (source) { error.value = source instanceof Error ? source.message : '录音无法播放'; stopPlayback() } finally { item.loading = false } }
async function load() { loading.value = true; error.value = ''; try { items.value.forEach(item => item.playbackUrl && URL.revokeObjectURL(item.playbackUrl)); items.value = await recordingsService.list() } catch (source) { error.value = source instanceof Error ? source.message : '录音加载失败' } finally { loading.value = false } }
async function send(file: File, durationMs = 0) { error.value = ''; try { await recordingsService.upload(file, selectedNoteUid.value, durationMs); await load() } catch (source) { error.value = source instanceof Error ? source.message : '录音保存失败' } }
async function upload(event: Event) { const input = event.target as HTMLInputElement, file = input.files?.[0]; if (file) await send(file); input.value = '' }
async function toggleRecord() {
  if (recording.value) { recorder?.stop(); return }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mime = ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(value => MediaRecorder.isTypeSupported(value))
    chunks = []; seconds.value = 0; recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    recorder.ondataavailable = event => chunks.push(event.data)
    recorder.onstop = async () => { clearInterval(timer); recording.value = false; stream.getTracks().forEach(track => track.stop()); const type = recorder?.mimeType || 'audio/webm', extension = type.includes('mp4') ? 'm4a' : 'webm'; await send(new File(chunks, `录音-${new Date().toISOString()}.${extension}`, { type }), seconds.value * 1000) }
    recorder.start(); recording.value = true; timer = setInterval(() => seconds.value++, 1000)
  } catch (source) { error.value = source instanceof Error ? source.message : '无法使用麦克风，请检查系统权限' }
}
async function remove(item: PlaybackRecord) { if (!await confirmDialog(`删除录音“${item.name || '未命名录音'}”？`)) return; try { await recordingsService.remove(item); await load() } catch (source) { error.value = source instanceof Error ? source.message : '删除失败' } }
onMounted(() => {void load();void notes.load().catch(()=>undefined)})
onBeforeUnmount(() => { clearInterval(timer); stopPlayback(); items.value.forEach(item => item.playbackUrl && URL.revokeObjectURL(item.playbackUrl)); if (recorder?.state === 'recording') recorder.stop() })
</script>

<template><div class="page pc-recordings-page"><header class="recordings-title"><h1>录音</h1><div class="recording-actions"><label class="recording-note-select">保存到<select v-model="selectedNoteUid"><option value="">暂不关联</option><option v-for="note in notes.notes" :key="note.uid" :value="note.uid">{{note.title||'未命名笔记'}}</option></select></label><label class="secondary-action">导入音频<input type="file" accept="audio/*" @change="upload" /></label><button class="primary-action" :class="{recording}" @click="toggleRecord">{{recording?`停止 · ${seconds}s`:'● 开始录音'}}</button></div></header><label class="recording-search">⌕<input v-model="query" placeholder="搜索录音名称"/><span>{{filtered.length}} 条</span></label><p v-if="error" class="recording-message error">{{error}}</p><p v-else-if="loading" class="recording-message">正在加载录音…</p><section v-else-if="!filtered.length" class="surface recording-empty"><strong>{{query?'没有匹配的录音':'还没有录音'}}</strong><p>可以使用麦克风录制，或导入已有音频文件。</p></section><section v-else class="surface recording-table"><div class="recording-row recording-head"><span></span><span>名称</span><span>时长</span><span>大小</span><span>创建时间</span><span></span></div><article v-for="item in filtered" :key="item.uid" class="recording-row"><button class="record-play" :disabled="item.loading" @click="play(item)">{{playingUid===item.uid?'Ⅱ':'▶'}}</button><strong>{{item.name||'未命名录音'}}</strong><span>{{duration(item.durationMs)}}</span><span>{{size(item.fileSize)}}</span><time>{{date(item.createdAt)}}</time><button class="danger-text" @click="remove(item)">删除</button></article></section></div></template>

<style scoped>
.pc-recordings-page{padding-top:18px}
.recordings-title{align-items:center;flex-wrap:wrap;gap:10px 20px;min-height:36px}
.recordings-title h1{margin:0;font-size:16px;font-weight:650;line-height:1.5}
.recording-actions{flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-left:auto}
.recording-actions .primary-action,.recording-actions .secondary-action{min-height:34px;padding:7px 12px;font-size:12px}
.recording-search{margin-top:14px}
@media(max-width:620px){.pc-recordings-page{padding:16px}.recording-actions{width:100%;justify-content:flex-start;margin-left:0}.recording-note-select{flex:1;min-width:0}.recording-note-select select{min-width:0;max-width:100%;width:100%}}
</style>
