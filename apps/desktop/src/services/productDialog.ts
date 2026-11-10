import { reactive } from 'vue'

export type ProductDialogTone='default'|'danger'|'warning'
export interface ProductDialogOptions { title:string;message?:string;confirmText?:string;cancelText?:string;tone?:ProductDialogTone;inputLabel?:string;inputValue?:string;inputPlaceholder?:string;inputRequired?:boolean;inputType?:'text'|'password';multiline?:boolean;confirmationText?:string }
type DialogState=ProductDialogOptions&{open:boolean;mode:'confirm'|'prompt';value:string;resolve?:((value:boolean|string|null)=>void)}

export const productDialogState=reactive<DialogState>({open:false,mode:'confirm',title:'',value:''})

function open<T extends boolean|string|null>(mode:'confirm'|'prompt',options:ProductDialogOptions){
  if(productDialogState.open)productDialogState.resolve?.(productDialogState.mode==='confirm'?false:null)
  Object.assign(productDialogState,{open:true,mode,value:options.inputValue||'',message:'',inputLabel:'',inputValue:'',inputPlaceholder:'',confirmationText:'',tone:'default',confirmText:mode==='confirm'?'确认':'保存',cancelText:'取消',inputRequired:false,inputType:'text',multiline:false,...options})
  return new Promise<T>(resolve=>{productDialogState.resolve=resolve as (value:boolean|string|null)=>void})
}
export const confirmDialog=(options:ProductDialogOptions|string)=>open<boolean>('confirm',typeof options==='string'?{title:'请确认',message:options}:options)
export const promptDialog=(options:ProductDialogOptions|string,defaultValue='')=>open<string|null>('prompt',typeof options==='string'?{title:options,inputLabel:options,inputValue:defaultValue}:options)
export function settleProductDialog(confirmed:boolean){const resolve=productDialogState.resolve;if(!resolve)return;const value=confirmed?(productDialogState.mode==='confirm'?true:productDialogState.value):productDialogState.mode==='confirm'?false:null;productDialogState.open=false;productDialogState.resolve=undefined;productDialogState.value='';productDialogState.inputValue='';resolve(value)}
