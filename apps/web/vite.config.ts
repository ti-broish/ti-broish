import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { buildApiBase } from './src/signup/api-base'

const config = defineConfig(({ command }) => ({
  // The old API for this build (src/signup/api-base.ts): production for CLOUDFLARE_ENV=production, staging for other builds.
  define: {
    'import.meta.env.VITE_TIBROISH_API': JSON.stringify(
      buildApiBase({ command, cloudflareEnv: process.env.CLOUDFLARE_ENV, override: process.env.VITE_TIBROISH_API }),
    ),
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
}))

export default config
