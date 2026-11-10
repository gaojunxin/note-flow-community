<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { safeAccountAvatarPath } from '@note-flow/core'
import api from '../services/api'
const props = defineProps({ path: { type: String, default: '' }, name: { type: String, default: '' }, preview: { type: String, default: '' } })
const image = ref(''); let generation = 0
function clear() { if (image.value) URL.revokeObjectURL(image.value); image.value = '' }
watch(() => props.path, async path => {
  const request = ++generation; clear(); const safe = safeAccountAvatarPath(path)
  if (!safe) return
  try {
    const response = await api.get(safe, { responseType: 'blob' }); const blob = response.data
    if (request !== generation || !(blob instanceof Blob) || !blob.type.startsWith('image/')) return
    image.value = URL.createObjectURL(blob)
  } catch { /* Show initials when the avatar is unavailable offline. */ }
}, { immediate: true })
onBeforeUnmount(() => { generation++; clear() })
</script>
<template><span class="account-avatar"><img v-if="preview || image" :src="preview || image" alt="用户头像" /><span v-else>{{ Array.from(name || '迹语')[0] }}</span></span></template>
<style scoped>.account-avatar{display:grid;place-items:center;flex-shrink:0;width:var(--account-avatar-size,72px);height:var(--account-avatar-size,72px);overflow:hidden;border-radius:50%;background:linear-gradient(140deg,#e1eee4,#cfdfd6);color:#316e4b;font-size:30px;font-weight:700;box-shadow:0 0 0 4px var(--surface,#fff),0 4px 18px #173b2810}.account-avatar img{width:100%;height:100%;object-fit:cover}</style>
