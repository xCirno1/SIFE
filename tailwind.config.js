/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        zinc: {
          950: '#09090b',
        },
        sife: {
          bg: '#09090b',
          surface: '#141417',
          border: '#222226',
          text: '#fafafa',
          muted: '#a1a1aa',
          accent: '#a855f7',
          'accent-dim': 'rgba(168,85,247,0.15)',
          'accent-border': 'rgba(168,85,247,0.3)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
      },
    },
  },
  plugins: [],
}
