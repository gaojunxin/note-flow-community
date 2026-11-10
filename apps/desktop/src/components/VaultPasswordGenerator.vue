<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElButton, ElCard, ElCheckbox, ElInput, ElInputNumber, ElSlider } from 'element-plus'
import { CopyDocument, Refresh } from '@element-plus/icons-vue'
import { createVaultPassword } from '../services/vaultPassword'
import 'element-plus/es/components/card/style/css'
import 'element-plus/es/components/checkbox/style/css'
import 'element-plus/es/components/slider/style/css'
const emit=defineEmits<{use:[password:string];copy:[password:string]}>()
const options=reactive({length:16,uppercase:true,lowercase:true,digits:true,symbols:true,avoidSimilar:true})
const password=ref(''),error=ref('')
const characterGroups=computed(()=>[options.uppercase,options.lowercase,options.digits,options.symbols].filter(Boolean).length)
function generate(){try{password.value=createVaultPassword(options);error.value=''}catch(source){password.value='';error.value=source instanceof Error?source.message:'生成失败'}}
watch(options,generate,{immediate:true})
</script>
<template>
  <ElCard shadow="never" class="vault-generator">
    <template #header><div class="vault-card-heading"><strong>密码生成器</strong><ElButton text :icon="Refresh" aria-label="重新生成密码" @click="generate" /></div></template>
    <ElInput :model-value="password" readonly aria-label="生成的密码"><template #append><ElButton :icon="CopyDocument" :disabled="!password" aria-label="复制生成的密码" @click="emit('copy',password)" /></template></ElInput>
    <p class="vault-helper">本机随机生成 · {{characterGroups}} 类字符</p>
    <div class="vault-generator-length"><span>长度</span><ElSlider v-model="options.length" :min="8" :max="64" aria-label="密码长度" /><ElInputNumber v-model="options.length" :min="8" :max="64" :controls="false" aria-label="密码长度" /></div>
    <ElCheckbox v-model="options.uppercase">包含大写字母（A–Z）</ElCheckbox>
    <ElCheckbox v-model="options.lowercase">包含小写字母（a–z）</ElCheckbox>
    <ElCheckbox v-model="options.digits">包含数字（0–9）</ElCheckbox>
    <ElCheckbox v-model="options.symbols">包含特殊字符（!@#$…）</ElCheckbox>
    <ElCheckbox v-model="options.avoidSimilar">避免相似字符（0 O 1 I l）</ElCheckbox>
    <p v-if="error" role="alert" class="vault-error">{{error}}</p>
    <ElButton class="vault-generator-use" :disabled="!password" @click="emit('use',password)">使用此密码</ElButton>
  </ElCard>
</template>
