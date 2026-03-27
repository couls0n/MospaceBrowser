import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

const alias = {
  '@main': resolve('src/main'),
  '@preload': resolve('src/preload'),
  '@renderer': resolve('src/renderer'),
  '@shared': resolve('src/shared')
}

export default defineConfig({
  main: {
    resolve: {
      alias
    }
  },
  preload: {
    resolve: {
      alias
    }
  },
  renderer: {
    resolve: {
      alias
    },
    plugins: [vue()]
  }
})
