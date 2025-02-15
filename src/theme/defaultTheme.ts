import { Theme } from '../types/theme';

export const defaultTheme: Theme = {
  colors: {
    primary: '#1976d2',
    secondary: '#dc004e',
    success: '#4caf50',
    warning: '#ff9800',
    error: '#f44336',
    text: '#000000',
    background: '#ffffff',
    grid: '#e0e0e0',
  },
  typography: {
    fontSize: {
      title: '18px',
      body: '14px',
      label: '12px',
      value: '16px',
      tooltip: '12px',
    },
    fontWeight: {
      normal: 400,
      bold: 700,
    },
  },
  spacing: {
    small: '8px',
    medium: '16px',
    large: '24px',
    chart: 20,
    grid: 10,
    padding: 8,
  },
  borderRadius: {
    small: '4px',
    medium: '8px',
    large: '12px',
  },
  shadows: {
    small: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)',
    medium: '0 3px 6px rgba(0,0,0,0.15), 0 2px 4px rgba(0,0,0,0.12)',
    large: '0 10px 20px rgba(0,0,0,0.15), 0 3px 6px rgba(0,0,0,0.10)',
  },
  transition: {
    duration: '0.3s',
    timing: 'ease-in-out',
  },
}; 