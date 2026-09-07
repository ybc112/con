/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 新主题色 - 翠绿金色
        accent: {
          primary: '#00D9A5',
          secondary: '#00B88A',
          gold: '#FFB800',
          orange: '#FF8A00',
          warm: '#FF6B6B',
        },
        // 背景色
        dark: {
          primary: '#0B1120',
          secondary: '#111827',
          card: '#1A2332',
          elevated: '#232D3F',
        },
        // 文字色
        text: {
          primary: '#F8FAFC',
          secondary: '#94A3B8',
          muted: '#64748B',
        }
      },
      fontFamily: {
        sans: ['Space Grotesk', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-primary': 'linear-gradient(135deg, #00D9A5, #00B88A)',
        'gradient-gold': 'linear-gradient(135deg, #FFB800, #FF8A00)',
        'gradient-mixed': 'linear-gradient(135deg, #00D9A5, #FFB800)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 6s ease-in-out infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'shimmer': 'shimmer 2s linear infinite',
        'spin-slow': 'spin 8s linear infinite',
        'bounce-soft': 'bounce-soft 2s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-15px)' },
        },
        glow: {
          '0%': { boxShadow: '0 0 20px rgba(0, 217, 165, 0.3)' },
          '100%': { boxShadow: '0 0 40px rgba(0, 217, 165, 0.5)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'bounce-soft': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        }
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'glow-primary': '0 0 20px rgba(0, 217, 165, 0.3), 0 0 40px rgba(0, 217, 165, 0.15)',
        'glow-gold': '0 0 20px rgba(255, 184, 0, 0.3), 0 0 40px rgba(255, 184, 0, 0.15)',
      }
    },
  },
  plugins: [],
}
