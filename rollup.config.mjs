import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

export default [
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.js',
        format: 'esm',
        sourcemap: true,
      },
    ],
    external: [
      'react',
      'react-dom',
      'recharts',
      '@emotion/styled',
      '@emotion/react',
      'react-grid-layout',
      'react-resizable'
    ],
    plugins: [
      typescript({
        sourceMap: true
      })
    ],
  },
  {
    input: 'dist/types/index.d.ts',
    output: [{ file: 'dist/index.d.ts', format: 'esm' }],
    plugins: [dts()],
  },
];
