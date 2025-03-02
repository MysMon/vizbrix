import '@emotion/react';
import { Theme as AppTheme } from './theme';

declare module '@emotion/react' {
  // Interface merging with empty interface will cause ESLint warning, but it's necessary for proper type augmentation
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  export interface Theme extends AppTheme {}
}
