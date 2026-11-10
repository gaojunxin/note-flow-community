<script setup lang="ts">
defineProps<{name:'calendar'|'bell'|'clock'|'folder'|'tag'|'repeat'|'created'}>()
const paths={calendar:'M8 3v4M16 3v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z',bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v6l4 2',folder:'M3 7V5h7l2 3h9v12H3V7Z',tag:'M3 3h8l10 10-8 8L3 11V3ZM7 7h.01',repeat:'M20 7H7a4 4 0 0 0-4 4M16 3l4 4-4 4M4 17h13a4 4 0 0 0 4-4M8 21l-4-4 4-4',created:'M7 3v4M17 3v4M4 10h16M4 5h16v16H4V5ZM8 14h8M8 17h5'}
</script>
<template><span class="task-property-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path :d="paths[name]"/></svg></span></template>
<style scoped>.task-property-icon{display:grid;place-items:center;box-sizing:border-box;width:34px;height:34px;border:1px solid var(--pc-border);border-radius:7px;color:var(--pc-muted);background:#fbfcfd}.task-property-icon svg{width:17px;height:17px}</style>
