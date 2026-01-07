/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  env: {
    browser: true,
    es2021: true,
    node: true
  },
  extends: [
    'eslint:recommended',
    'plugin:astro/recommended',
    'plugin:jsx-a11y/strict',
    'plugin:tailwindcss/recommended',
    'prettier'
  ],
  plugins: ['astro'],
  overrides: [
    {
      files: ['*.astro'],
      parser: 'astro-eslint-parser',
      parserOptions: {
        parser: '@typescript-eslint/parser',
        extraFileExtensions: ['.astro']
      }
    },
    {
      files: ['*.ts', '*.tsx'],
      parser: '@typescript-eslint/parser',
      extends: ['plugin:@typescript-eslint/recommended', 'prettier'],
      plugins: ['@typescript-eslint']
    },
    {
      files: ['src/server/**/*.ts', 'scripts/**/*.ts'],
      env: {
        node: true
      }
    }
  ],
  settings: {
    tailwindcss: {
      callees: ['clsx', 'cva']
    }
  }
};
