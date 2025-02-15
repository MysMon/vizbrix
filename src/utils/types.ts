export interface GroupedData<T> {
  [key: string]: T[] | string;
  items: T[];
} 