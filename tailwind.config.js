/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
    },
    extend: {
      colors: {
        maroon: '#8A1538',
        cream: '#F5F2ED',
        gold: '#C99A44',
      },
      boxShadow: {
        soft: '0 20px 45px rgba(138, 21, 56, 0.12)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
