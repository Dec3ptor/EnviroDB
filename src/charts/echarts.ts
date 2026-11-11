import * as echarts from 'echarts/core';
import { LineChart, ScatterChart, BarChart, BoxplotChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, MarkAreaComponent, TitleComponent, GraphicComponent, DataZoomComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([LineChart, ScatterChart, BarChart, BoxplotChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, MarkAreaComponent, TitleComponent, GraphicComponent, DataZoomComponent, CanvasRenderer]);

export { echarts };
