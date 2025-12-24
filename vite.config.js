import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // IMPORTANT: Set base to your repo name for GitHub Pages
  base: '/sunken-dkp/',
  build: {
    // Increase the chunk size warning limit (in kB)
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching
        manualChunks: {
          // Vendor chunk for React
          'vendor-react': ['react', 'react-dom'],
          // Supabase in its own chunk
          'vendor-supabase': ['@supabase/supabase-js'],
        }
      }
    }
  }
})