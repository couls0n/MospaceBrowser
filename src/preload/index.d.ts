import type { XussApi } from '@preload/index'

declare global {
  interface Window {
    api: XussApi
  }
}

export {}
