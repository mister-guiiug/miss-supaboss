// Config partagée famille miss-* / mister-* (flat config, React 19).
import base from '@mister-guiiug/dev-wpa-config/eslint-react';

export default [
  ...base,
  { ignores: ['dist/**', 'coverage/**', 'playwright-report/**', 'data/**'] },
];
