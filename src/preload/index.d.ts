import type { OutreachApi } from './index.js'

declare global {
  interface Window {
    outreach: OutreachApi
  }
}

export {}
