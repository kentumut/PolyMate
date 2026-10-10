import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTypescript,
  { settings: { next: { rootDir: 'apps/web/' } } },
  { ignores: ['.local/**', '**/.next/**', '**/dist/**', '**/node_modules/**', '**/next-env.d.ts', 'coverage/**'] },
];
export default config;
