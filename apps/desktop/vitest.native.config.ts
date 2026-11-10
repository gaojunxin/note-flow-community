import {defineConfig} from 'vitest/config'
export default defineConfig({test: {include: ['native-test/**/*.integration.ts','test/communityVault.test.ts'], testTimeout: 15000}})
