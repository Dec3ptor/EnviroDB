import * as echarts from 'echarts/core';
import { LineChart, ScatterChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, TitleComponent, GraphicComponent, DataZoomComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([LineChart, ScatterChart, BarChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, TitleComponent, GraphicComponent, DataZoomComponent, CanvasRenderer]);

export { echarts };
