import path from 'node:path'
import build from '@hono/vite-build/cloudflare-workers'
import adapter from '@hono/vite-dev-server/cloudflare'
import tailwindcss from '@tailwindcss/vite'
import honox from 'honox/vite'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => {
  if (mode === 'client') {
    return {
      resolve: {
        alias: { '@': path.resolve(__dirname) },
      },
      build: {
        rollupOptions: {
          input: ['./app/client.ts', './app/style.css'],
          output: {
            entryFileNames: 'static/[name].js',
            chunkFileNames: 'static/assets/[name]-[hash].js',
            assetFileNames: 'static/assets/[name].[ext]',
          },
        },
        manifest: true,
        emptyOutDir: false,
      },
      plugins: [tailwindcss()],
    }
  }

  return {
    resolve: {
      alias: { '@': path.resolve(__dirname) },
    },
    ssr: {
      external: ['react', 'react-dom'],
    },
    plugins: [
      honox({
        devServer: { adapter },
        client: { input: ['/app/client.ts', '/app/style.css'] },
      }),
      tailwindcss(),
      build(),
    ],
  }
})
