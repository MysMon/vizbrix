export interface Theme {
  colors: {
    primary: string;
    secondary: string;
    success: string;
    warning: string;
    error: string;
    text: string;
    background: string;
    grid: string;
  };
  typography: {
    fontSize: {
      title: string;
      body: string;
      label: string;
      value: string;
      tooltip: string;
    };
    fontWeight: {
      normal: number;
      bold: number;
    };
  };
  spacing: {
    small: string;
    medium: string;
    large: string;
    chart: number;
    grid: number;
    padding: number;
  };
  borderRadius: {
    small: string;
    medium: string;
    large: string;
  };
  shadows: {
    small: string;
    medium: string;
    large: string;
  };
  transition: {
    duration: string;
    timing: string;
  };
} 