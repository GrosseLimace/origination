/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Scoular brand green mapped to the 'green' scale so existing
        // green-* utility classes automatically use Scoular brand colors.
        green: {
          50:  '#E6F7F2',
          100: '#C0EDE0',
          200: '#8BD9C5',
          300: '#4EC5A5',
          400: '#1AB589',
          500: '#00A36F', // Scoular Green (PMS 340C)
          600: '#00875F', // Scoular Green accessible ← primary interactive color
          700: '#006B4C',
          800: '#004F37',
          900: '#003325',
        },
        // Full Scoular brand palette — use scoular-* classes for new work
        scoular: {
          'blue':        '#007CC0', // PMS 3005C
          'blue-medium': '#00588E', // PMS 7691C
          'blue-dark':   '#00395D', // PMS 2955C
          'yellow':      '#E8B30D', // PMS 110C
          'yellow-bright':'#FFD400', // PMS 109C
          'gray':        '#576269', // PMS 431C
          'teal':        '#1CB3B4', // PMS 3262C
          'red':         '#EF4623', // PMS 1665C
          'red-accessible':'#DF3410',
          'green':       '#00A36F', // PMS 340C
          'green-accessible':'#00875F',
          'cream':       '#FBF7E2', // PMS 15% 109C
        },
      },
      fontFamily: {
        sans: ['Open Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
