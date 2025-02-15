import { ComponentType, ReactNode, ReactElement, Component } from 'react';
import { TreemapDataPoint } from './charts';

export interface TreemapContentProps {
  root: TreemapDataPoint;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  name: string;
  value: number;
}

declare module 'recharts' {
  export interface TreemapProps {
    data?: Array<TreemapDataPoint>;
    dataKey?: string;
    aspectRatio?: number;
    stroke?: string;
    fill?: string;
    content?: ReactElement | ComponentType<TreemapContentProps> | ((props: TreemapContentProps) => ReactElement);
    children?: ReactNode;
  }

  export class Treemap extends Component<TreemapProps & SVGProps<SVGElement>> {}
} 