<script setup lang="ts">
import type {NoteListPreview} from '../services/noteListPresentation'
withDefaults(defineProps<{title:string;icon:string;iconClass?:string;typeLabel:string;updatedLabel:string;updatedAt?:string;syncStatus?:string;preview?:NoteListPreview;directoryPath?:string;tags?:{uid:string;name:string;color?:string}[]}>(),{tags:()=>[]})
defineEmits<{tag:[uid:string]}>()
</script>
<template>
  <div class="note-list-title note-table-grid">
    <span class="note-content-icon" :class="iconClass" :title="typeLabel">
      <svg v-if="!iconClass?.includes('file')&&(!iconClass||iconClass==='kind-note')" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 2.5h6l3 3v11H5v-13a1 1 0 0 1 1-1Z"/><path d="M11.5 2.5v4H15M7.5 9h5M7.5 12h3"/><circle cx="13.5" cy="15" r="2.2"/></svg>
      <template v-else>{{icon}}</template>
    </span>
    <span class="note-title-cell"><strong :title="title">{{title||'未命名笔记'}}</strong>
      <span v-if="syncStatus==='conflict'" class="note-row-status conflict" title="存在同步冲突，需要处理" role="img" aria-label="存在同步冲突">!</span>
      <span v-else-if="syncStatus==='pending'" class="note-row-status pending" title="等待同步" role="img" aria-label="等待同步">◷</span>
    </span>
    <span class="note-row-tags" :title="tags.map(tag=>tag.name).join('、')">
      <button v-for="tag in tags.slice(0,2)" :key="tag.uid" type="button" class="note-row-tag" :style="tag.color&&/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(tag.color)?{'--note-tag-color':tag.color}:undefined" :aria-label="`筛选标签 ${tag.name}`" @click.stop="$emit('tag',tag.uid)">{{tag.name}}</button>
      <small v-if="tags.length>2" class="note-tag-more note-tag-more-wide">+{{tags.length-2}}</small>
      <small v-if="tags.length>1" class="note-tag-more note-tag-more-narrow">+{{tags.length-1}}</small>
    </span>
    <time :datetime="updatedAt" :title="updatedAt?new Date(updatedAt).toLocaleString('zh-CN'):undefined">{{updatedLabel}}</time>
  </div>
  <p v-if="preview" class="note-row-preview">{{preview.before}}<mark v-if="preview.match">{{preview.match}}</mark>{{preview.after}}</p>
  <small v-if="directoryPath" class="note-row-path" :title="directoryPath">{{directoryPath}}</small>
</template>
<style scoped>
.note-list-title{min-width:0;min-height:24px;align-items:center!important}
.note-title-cell{display:flex;align-items:center;min-width:0;gap:5px}.note-title-cell>strong{display:block;flex:1;min-width:0;font-size:13px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.5}
.note-content-icon{display:grid;place-items:center;width:25px;height:25px;border:1px solid var(--pc-border);border-radius:5px;background:#fff;color:var(--pc-primary);font-size:11px;line-height:1}.note-content-icon svg{width:18px;height:18px;stroke:currentColor;stroke-width:1.1;stroke-linecap:round;stroke-linejoin:round}.note-content-icon.file{font-size:8px;font-weight:650}.kind-pdf{color:#ec4359;border-color:#ffdde2;background:#fff9fa}.kind-word{color:#3478ee;border-color:#dbe7ff;background:#f7faff;font-size:13px!important}.kind-excel,.kind-csv{color:#218756}.kind-powerpoint{color:#d3602f}.kind-xmind{color:#6954c8}
.note-row-tags{display:flex;align-items:center;gap:4px;min-width:0;overflow:hidden}.note-row-tag{--note-tag-color:#6878cf;display:block;flex:0 1 auto;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 5px;border:1px solid color-mix(in srgb,var(--note-tag-color) 22%,white);border-radius:4px;background:color-mix(in srgb,var(--note-tag-color) 8%,white);color:var(--note-tag-color);font:inherit;font-size:10px;line-height:1.35;cursor:pointer}.note-row-tag:focus-visible{outline:2px solid var(--pc-primary);outline-offset:1px}.note-tag-more{flex:none;font-size:9px}.note-tag-more-narrow{display:none}
.note-list-title>time{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px!important;color:var(--pc-muted);font-variant-numeric:tabular-nums;letter-spacing:-.2px;text-align:right}
.note-row-status{display:grid;flex:none;place-items:center;width:14px;height:14px;font-size:10px}.conflict{border-radius:50%;background:#fff0ec;color:#ac3826;font-weight:700}.pending{color:var(--pc-muted)}
p.note-row-preview{margin:4px 0 0 36px!important;overflow:hidden;color:var(--pc-muted);text-overflow:ellipsis;white-space:nowrap;line-height:1.5}.note-row-preview mark{background:#fff0b3;color:var(--pc-text);border-radius:2px}.note-row-path{display:block;overflow:hidden;margin:3px 0 0 36px;text-overflow:ellipsis;white-space:nowrap;line-height:1.4}
</style>
