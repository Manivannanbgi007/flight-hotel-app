/**
 * Colors of the illustrations: the design tokens of src/index.css as plain hex (SVG gradient stops and fills), plus
 * the staff role accents (Tailwind indigo, teal, violet). palette.test.ts checks that the brand, accent and semantic
 * values here equal the tokens, so the drawings always match the UI.
 */
export const P = {
  white: '#ffffff',
  ink: '#0f172a',

  brand50: '#f0f6ff',
  brand100: '#e1ecff',
  brand200: '#c4d9ff',
  brand300: '#98bcff',
  brand400: '#6496ff',
  brand500: '#3b76f8',
  brand600: '#1f5ce8',
  brand700: '#1a4bc8',
  brand800: '#1b40a0',
  brand900: '#1b3a7e',
  brand950: '#13224b',

  accent50: '#fff6ed',
  accent100: '#ffead4',
  accent200: '#ffd1a8',
  accent300: '#ffb070',
  accent400: '#ff8a3d',
  accent500: '#f26b1d',
  accent600: '#c2490b',

  success100: '#d1fadf',
  success500: '#12b76a',
  success600: '#067647',
  danger100: '#fee4e2',
  danger500: '#f04438',
  danger600: '#b42318',
  warning500: '#f79009',

  slate50: '#f8fafc',
  slate100: '#f1f5f9',
  slate200: '#e2e8f0',
  slate300: '#cbd5e1',
  slate400: '#94a3b8',
  slate500: '#64748b',
  slate600: '#475569',
  slate700: '#334155',
  slate800: '#1e293b',

  indigo100: '#e0e7ff',
  indigo200: '#c7d2fe',
  indigo300: '#a5b4fc',
  indigo400: '#818cf8',
  indigo500: '#6366f1',
  indigo600: '#4f46e5',
  indigo700: '#4338ca',
  indigo900: '#312e81',

  teal100: '#ccfbf1',
  teal200: '#99f6e4',
  teal300: '#5eead4',
  teal400: '#2dd4bf',
  teal500: '#14b8a6',
  teal600: '#0d9488',
  teal700: '#0f766e',
  teal800: '#115e59',
  teal900: '#134e4a',

  violet100: '#ede9fe',
  violet200: '#ddd6fe',
  violet300: '#c4b5fd',
  violet400: '#a78bfa',
  violet500: '#8b5cf6',
  violet600: '#7c3aed',
  violet700: '#6d28d9',
  violet900: '#4c1d95',

  leaf: '#12b76a',
  leafDark: '#067647',
} as const;
