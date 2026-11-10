import { ref } from 'vue'

// Shared reactive scope for workspace pages. App.vue owns persistence; views only consume it.
export const globalAreaUid = ref('')
