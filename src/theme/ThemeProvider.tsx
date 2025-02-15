import { createContext, FC, ReactNode, useContext } from 'react';
import { Theme } from '../types/theme';

const defaultTheme: Theme = {
  colors: {
    primary: '#8884d8',
    secondary: '#82ca9d',
    background: '#ffffff',
    text: '#333333',
    grid: '#f5f5f5',
    success: '#4caf50',
    warning: '#ff9800',
    error: '#f44336'
  },
  typography: {
    fontSize: {
      title: '16px',
      body: '14px',
      label: '12px',
      value: '14px',
      tooltip: '12px'
    },
    fontWeight: {
      normal: 400,
      bold: 600
    }
  },
  spacing: {
    small: '4px',
    medium: '8px',
    large: '16px',
    chart: 16,
    grid: 16,
    padding: 8
  },
  borderRadius: {
    small: '4px',
    medium: '8px',
    large: '12px'
  },
  shadows: {
    small: '0 1px 3px rgba(0,0,0,0.12)',
    medium: '0 4px 6px rgba(0,0,0,0.12)',
    large: '0 10px 20px rgba(0,0,0,0.12)'
  },
  transition: {
    duration: '0.3s',
    timing: 'ease-in-out'
  }
};

const ThemeContext = createContext<Theme | null>(null);

export const useTheme = () => {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return theme;
};

interface ThemeProviderProps {
  theme?: Partial<Theme>;
  children: ReactNode;
}

export const ThemeProvider: FC<ThemeProviderProps> = ({
  theme,
  children,
}) => {
  const mergedTheme = {
    ...defaultTheme,
    ...theme,
    colors: {
      ...defaultTheme.colors,
      ...theme?.colors,
    },
    typography: {
      ...defaultTheme.typography,
      ...theme?.typography,
      fontSize: {
        ...defaultTheme.typography.fontSize,
        ...theme?.typography?.fontSize,
      },
      fontWeight: {
        ...defaultTheme.typography.fontWeight,
        ...theme?.typography?.fontWeight,
      },
    },
    spacing: {
      ...defaultTheme.spacing,
      ...theme?.spacing,
    },
    borderRadius: {
      ...defaultTheme.borderRadius,
      ...theme?.borderRadius,
    },
    shadows: {
      ...defaultTheme.shadows,
      ...theme?.shadows,
    },
    transition: {
      ...defaultTheme.transition,
      ...theme?.transition,
    },
  };

  return (
    <ThemeContext.Provider value={mergedTheme}>
      {children}
    </ThemeContext.Provider>
  );
}; 