import React, { createContext, useContext, ReactNode, useMemo } from 'react';
import { Theme } from '../types/theme';

// デフォルトテーマの定義
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

interface ThemeContextType {
  theme: Theme;
}

interface ThemeProviderProps {
  children: ReactNode;
  theme?: Partial<Theme>;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Theme型のオブジェクトを深くマージする関数
 * @param target マージ先のThemeオブジェクト
 * @param source マージ元のThemeオブジェクト
 * @returns マージされたThemeオブジェクト
 */
function deepMergeTheme(target: Theme, source?: Partial<Theme>): Theme {
  if (!source) return { ...target };
  
  const result = { ...target };
  
  // colors
  if (source.colors) {
    result.colors = { ...target.colors, ...source.colors };
  }
  
  // typography
  if (source.typography) {
    result.typography = {
      ...target.typography,
      ...source.typography
    };
    
    // fontSize
    if (source.typography.fontSize) {
      result.typography.fontSize = {
        ...target.typography.fontSize,
        ...source.typography.fontSize
      };
    }
    
    // fontWeight
    if (source.typography.fontWeight) {
      result.typography.fontWeight = {
        ...target.typography.fontWeight,
        ...source.typography.fontWeight
      };
    }
  }
  
  // spacing
  if (source.spacing) {
    result.spacing = { ...target.spacing, ...source.spacing };
  }
  
  // borderRadius
  if (source.borderRadius) {
    result.borderRadius = { ...target.borderRadius, ...source.borderRadius };
  }
  
  // shadows
  if (source.shadows) {
    result.shadows = { ...target.shadows, ...source.shadows };
  }
  
  // transition
  if (source.transition) {
    result.transition = { ...target.transition, ...source.transition };
  }
  
  return result;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ 
  children, 
  theme 
}) => {
  // テーマをマージして、メモ化する
  const mergedTheme = useMemo(() => {
    return deepMergeTheme(defaultTheme, theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme: mergedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}; 