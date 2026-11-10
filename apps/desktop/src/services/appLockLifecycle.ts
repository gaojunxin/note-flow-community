import {acquireInert} from './inertLease'
import {clearWorkspaceUnlockSession} from './workspaceUnlockSession'
import {nextTick,watch} from 'vue'
import {appLock,APP_LOCK_KEY,APP_LOCK_SIGNAL} from './appLock'
import {clearVaultSession} from './vaultSession'
import {settleProductDialog} from './productDialog'
import {closeContextMenu} from './contextMenu'

export function installAppLockLifecycle(){
 const activityKey=APP_LOCK_KEY+':activity'
 let lastActivity=Date.now(),lastBroadcast=0,observer:MutationObserver|undefined
 function shareActivity(){if(!appLock.enabled.value||Date.now()-lastBroadcast<1000)return;lastBroadcast=Date.now();try{localStorage.setItem(activityKey,String(lastBroadcast))}catch{/* Local activity still resets the current window timer. */}}
 const hidden=new Map<HTMLElement,{release:()=>void;aria:string|null}>()
 function conceal(){if(!appLock.locked.value)return;for(const element of [...document.body.children]){if(!(element instanceof HTMLElement)||element.matches('[data-app-lock-screen]')||element.querySelector('[data-app-lock-screen]'))continue;if(!hidden.has(element))hidden.set(element,{release:acquireInert(element),aria:element.getAttribute('aria-hidden')});element.setAttribute('aria-hidden','true')}}
 function reveal(){observer?.disconnect();observer=undefined;for(const [element,previous] of hidden){previous.release();if(previous.aria===null)element.removeAttribute('aria-hidden');else element.setAttribute('aria-hidden',previous.aria)}hidden.clear()}
 const expired=()=>Boolean(appLock.config.value?.idleMinutes&&Date.now()-lastActivity>=appLock.config.value.idleMinutes*60000)
 const activity=(event:Event)=>{if(appLock.locked.value)return;if(expired()){appLock.lock();if(event.cancelable)event.preventDefault();event.stopImmediatePropagation();return}lastActivity=Date.now();shareActivity()}
 const focus=()=>{if(!appLock.locked.value&&expired())appLock.lock()}
 const background=()=>{if(appLock.config.value?.lockOnBackground)appLock.lock()}
 const visibility=()=>{if(document.hidden)background();else focus()}
 const storage=(event:StorageEvent)=>{if(event.key===APP_LOCK_KEY)appLock.refresh();if(event.key===APP_LOCK_SIGNAL)appLock.lock(false);if(event.key===activityKey){const value=Number(event.newValue);if(Number.isFinite(value)&&value>lastActivity&&value<=Date.now()+1000)lastActivity=value}}
 const keys=(event:KeyboardEvent)=>{
  if(appLock.locked.value){
   if(event.key==='Tab'){
    const fields=[...document.querySelectorAll<HTMLElement>('[data-app-lock-screen] input:not(:disabled),[data-app-lock-screen] button:not(:disabled)')]
    if(fields.length){const index=fields.indexOf(document.activeElement as HTMLElement);event.preventDefault();fields[(index+(event.shiftKey?-1:1)+fields.length)%fields.length].focus()}
   }else if((event.ctrlKey||event.metaKey)&&!(event.target instanceof HTMLInputElement&&['a','c','v','x'].includes(event.key.toLowerCase()))||event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation()}
   return
  }
  if(appLock.enabled.value&&(event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==='l'){event.preventDefault();event.stopImmediatePropagation();appLock.lock()}
 }
 const stop=watch(appLock.locked,locked=>{lastActivity=Date.now();if(locked){settleProductDialog(false);closeContextMenu();clearVaultSession();clearWorkspaceUnlockSession();document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog=>dialog.close());window.dispatchEvent(new Event('note-flow:app-locked'));void nextTick(()=>{if(!appLock.locked.value)return;conceal();observer?.disconnect();observer=new MutationObserver(conceal);observer.observe(document.body,{childList:true})})}else{reveal();shareActivity()}},{immediate:true,flush:'sync'})
 const timer=setInterval(()=>{const minutes=appLock.config.value?.idleMinutes||0;if(minutes&&!appLock.locked.value&&Date.now()-lastActivity>=minutes*60000)appLock.lock()},1000)
 for(const name of ['pointerdown','pointermove','keydown','wheel','touchstart'])window.addEventListener(name,activity,true)
 window.addEventListener('keydown',keys,true);window.addEventListener('blur',background);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',visibility);window.addEventListener('storage',storage)
 return()=>{stop();reveal();clearInterval(timer);for(const name of ['pointerdown','pointermove','keydown','wheel','touchstart'])window.removeEventListener(name,activity,true);window.removeEventListener('keydown',keys,true);window.removeEventListener('blur',background);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('storage',storage)}
}
