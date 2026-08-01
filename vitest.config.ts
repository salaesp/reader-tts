import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The EPUB parser and segmenter run in the browser and rely on DOMParser,
    // so the whole suite runs against jsdom.
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'functions/**/*.test.ts'],
    globals: false,
  },
})
