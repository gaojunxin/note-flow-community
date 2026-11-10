import {reactive} from 'vue'
// Transient UI state only; account credentials and local work remain untouched.
export const sessionRecovery=reactive({required:false})
export function clearSessionRecovery(){sessionRecovery.required=false}
