<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { closeContextMenu, contextMenuState as menu, type ContextMenuCommand } from '../services/contextMenu'
const host=ref<HTMLElement>(),position=ref({left:0,top:0}),busy=ref('')
function place(){const node=host.value;if(!node)return;position.value={left:Math.max(8,Math.min(menu.x,window.innerWidth-node.offsetWidth-8)),top:Math.max(8,Math.min(menu.y,window.innerHeight-node.offsetHeight-8))}}
watch(()=>menu.open,open=>{if(open)nextTick(()=>{place();host.value?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()})})
async function execute(command:ContextMenuCommand){if(command.disabled||busy.value)return;busy.value=command.id;closeContextMenu();try{await command.run()}finally{busy.value=''}}
function keydown(event:KeyboardEvent){if(!menu.open)return;if(event.key==='Escape'){closeContextMenu();return}if(!['ArrowDown','ArrowUp'].includes(event.key))return;event.preventDefault();const values=[...host.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]],index=values.indexOf(document.activeElement as HTMLButtonElement),next=event.key==='ArrowDown'?(index+1)%values.length:(index-1+values.length)%values.length;values[next]?.focus()}
onMounted(()=>{window.addEventListener('pointerdown',closeContextMenu);window.addEventListener('keydown',keydown);window.addEventListener('resize',closeContextMenu);window.addEventListener('scroll',closeContextMenu,true)})
onBeforeUnmount(()=>{window.removeEventListener('pointerdown',closeContextMenu);window.removeEventListener('keydown',keydown);window.removeEventListener('resize',closeContextMenu);window.removeEventListener('scroll',closeContextMenu,true)})
</script>
<template><Teleport :to="menu.target||'body'"><nav v-if="menu.open" ref="host" class="pc-context-menu pc-menu" :style="{left:`${position.left}px`,top:`${position.top}px`}" role="menu" @pointerdown.stop @contextmenu.prevent><template v-for="command in menu.commands" :key="command.id"><i v-if="command.separator"/><button class="pc-menu__item" :class="{danger:command.danger}" :disabled="command.disabled||Boolean(busy)" role="menuitem" @click="execute(command)"><b>{{command.label}}</b></button></template></nav></Teleport></template>

<style scoped>.pc-context-menu>button{display:block;padding:7px 10px}.pc-context-menu>button b{font-size:12px;font-weight:450;line-height:1.5}</style>
