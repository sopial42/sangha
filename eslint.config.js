import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'vendor/**', 'workspaces/**', 'data/**', 'apps/web/scripts/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      // Unused values are bugs or leftovers; a leading underscore marks one kept on purpose.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            // The configured one knows Sangha's type scale; the raw one drops colour classes next to it.
            { name: 'cn', message: 'Import cn from "@/lib/utils".' },
            { name: 'clsx', message: 'Import cn from "@/lib/utils".' },
            { name: 'tailwind-merge', message: 'Import cn from "@/lib/utils".' },
          ],
          patterns: [{ group: ['lucide-react', 'lucide-react/*'], message: 'Icons come from @hugeicons/react.' }],
        },
      ],
    },
  },
  {
    // Zustand: a selector that builds a new object each call re-renders forever (v5). Select fields one by one.
    files: ['apps/web/src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.name='useApp'][arguments.length=0]", message: 'Select what you need: useApp((s) => s.field).' },
      ],
    },
  },
  {
    // shadcn components are generated: keep them close to upstream.
    files: ['apps/web/src/components/ui/**'],
    rules: { 'react-hooks/exhaustive-deps': 'off', '@typescript-eslint/no-unused-vars': 'off' },
  },
)
