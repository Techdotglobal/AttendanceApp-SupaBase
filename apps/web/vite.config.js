import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Expose NEXT_PUBLIC_* to import.meta.env (same pattern as Next.js) for Vercel env vars.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
});
