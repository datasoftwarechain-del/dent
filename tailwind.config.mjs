import forms from '@tailwindcss/forms';
import typography from '@tailwindcss/typography';

export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx}', './public/**/*.html'],
  theme: {
    extend: {
      colors: {
        primary: '#214d66',
        accent: '#38bdf8'
      }
    }
  },
  plugins: [forms, typography]
};
