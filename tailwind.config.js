/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Sampled from the design.
        canvas: '#f6f8fb',
        ink: {
          DEFAULT: '#0f1729',
          muted: '#64748b',
          subtle: '#94a3b8'
        },
        line: '#e8ecf2',
        brand: {
          50: '#eef4ff',
          100: '#dbe7ff',
          200: '#bcd3ff',
          500: '#2f6fed',
          600: '#1f5fe0',
          700: '#1a4fc0'
        }
      },
      fontFamily: {
        sans: [
          'Inter',
          'Segoe UI Variable',
          'Segoe UI',
          'system-ui',
          '-apple-system',
          'sans-serif'
        ]
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 41, 0.04), 0 1px 3px rgba(15, 23, 41, 0.03)',
        pop: '0 8px 24px rgba(15, 23, 41, 0.10), 0 2px 6px rgba(15, 23, 41, 0.05)',
        button: '0 1px 2px rgba(31, 95, 224, 0.24)'
      },
      borderRadius: {
        card: '14px'
      }
    }
  },
  plugins: []
}
