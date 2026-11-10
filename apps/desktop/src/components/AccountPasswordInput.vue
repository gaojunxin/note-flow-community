<script setup lang="ts">
import { ref, watch } from 'vue'
const props = defineProps({ modelValue: { type: String, default: '' }, label: { type: String, required: true }, autocomplete: { type: String, default: 'current-password' }, name: { type: String, required: true } })
const emit = defineEmits(['update:modelValue'])
const visible = ref(false)
watch(() => props.modelValue, value => { if (!value) visible.value = false })
</script>
<template>
  <label class="account-field"><span>{{ label }}</span><div class="account-password-input">
    <input :value="modelValue" :name="name" :type="visible ? 'text' : 'password'" :autocomplete="autocomplete" maxlength="20" required @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
    <button type="button" :aria-label="(visible ? '隐藏' : '显示') + label" :aria-pressed="visible" @click.prevent="visible = !visible">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/><path v-if="visible" d="m3 3 18 18"/></svg>
    </button>
  </div></label>
</template>
<style scoped>
.account-field{display:grid;gap:8px;font-size:13px;font-weight:600;color:var(--ink,var(--pc-text,#253b30))}.account-password-input{display:flex;align-items:center;border:1px solid var(--border,var(--pc-border,#dce4de));border-radius:12px;background:var(--surface,#fff)}.account-password-input:focus-within{border-color:var(--brand,var(--pc-primary,#2f7657));box-shadow:0 0 0 3px #397e5714}.account-password-input input{box-sizing:border-box;min-width:0;flex:1;width:100%;padding:13px 14px;border:0;border-radius:12px;background:transparent;color:inherit;font:inherit;outline:0}.account-password-input button{display:grid;place-items:center;flex-shrink:0;width:44px;min-height:44px;padding:0;border:0;background:transparent;color:var(--muted,var(--pc-muted,#718278));cursor:pointer}.account-password-input svg{width:20px;height:20px}
</style>
