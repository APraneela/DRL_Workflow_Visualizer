/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#f8fafc',
          sidebar: '#1e293b',
          text: '#0f172a',
          accent: '#3b82f6',
          success: '#22c55e',
          danger: '#ef4444',
          border: '#e2e8f0',
          muted: '#64748b',
        }
      }
    },
  },
  plugins: [],
}
