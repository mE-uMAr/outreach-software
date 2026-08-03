/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Exact tokens from the Figma Make export.
        canvas: '#F8FAFC',
        ink: {
          DEFAULT: '#0F172A',
          muted: '#64748B',
          subtle: '#94A3B8'
        },
        line: '#E2E8F0',
        brand: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          200: '#BFDBFE',
          500: '#2563EB',
          600: '#2563EB',
          700: '#1D4ED8'
        },
        success: '#10B981',
        warn: '#F59E0B',
        accent: '#8B5CF6',
        danger: '#EF4444'
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
        card: '0 1px 3px rgba(0, 0, 0, 0.06), 0 4px 16px rgba(0, 0, 0, 0.06)',
        cardHover: '0 4px 20px rgba(0, 0, 0, 0.09)',
        kpi: '0 8px 24px rgba(0, 0, 0, 0.10)',
        pop: '0 8px 24px rgba(15, 23, 41, 0.10), 0 2px 6px rgba(15, 23, 41, 0.05)',
        topbar: '0 1px 3px rgba(0, 0, 0, 0.04)',
        button: '0 4px 12px rgba(37, 99, 235, 0.27)'
      },
      borderRadius: {
        card: '12px'
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        slideIn: {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'translateX(0)' }
        },
        fadeSlideUp: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        // Create-campaign modal: orb, rings and status text.
        orbGlow: {
          '0%, 100%': {
            boxShadow: '0 0 40px 16px rgba(37,99,235,0.27), 0 0 80px 32px rgba(37,99,235,0.13)'
          },
          '50%': {
            boxShadow: '0 0 60px 24px rgba(37,99,235,0.40), 0 0 120px 48px rgba(37,99,235,0.20)'
          }
        },
        pulseRing: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.6' },
          '50%': { transform: 'scale(1.18)', opacity: '0.2' }
        },
        // Fades in and holds: the last status line must stay readable until the
        // next one replaces it, so this must not end at opacity 0.
        msgFade: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        checkPop: {
          '0%': { transform: 'scale(0)', opacity: '0' },
          '70%': { transform: 'scale(1.2)' },
          '100%': { transform: 'scale(1)', opacity: '1' }
        },
        successBurst: {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '60%': { transform: 'scale(1.05)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' }
        },
        overlayIn: {
          from: { opacity: '0' },
          to: { opacity: '1' }
        },
        modalIn: {
          from: { opacity: '0', transform: 'translateY(12px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' }
        }
      },
      animation: {
        fadeIn: 'fadeIn 0.4s ease both',
        slideIn: 'slideIn 0.3s ease',
        fadeSlideUp: 'fadeSlideUp 0.45s ease both',
        orbGlow: 'orbGlow 3s ease-in-out infinite',
        pulseRing: 'pulseRing 2.4s ease-in-out infinite',
        spinSlow: 'spin 6s linear infinite',
        spinReverse: 'spin 9s linear infinite reverse',
        msgFade: 'msgFade 0.35s ease both',
        checkPop: 'checkPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        successBurst: 'successBurst 0.5s ease both',
        overlayIn: 'overlayIn 0.2s ease both',
        modalIn: 'modalIn 0.28s cubic-bezier(0.16, 1, 0.3, 1) both'
      }
    }
  },
  plugins: []
}
