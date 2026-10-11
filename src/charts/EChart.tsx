import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { EChartsCoreOption, ECharts } from 'echarts/core';
import { echarts } from './echarts';

export interface EChartHandle {
  getInstance(): ECharts | null;
}

export const EChart = forwardRef<EChartHandle, { option: EChartsCoreOption; height: number | string; style?: React.CSSProperties }>(function EChart({ option, height, style }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  useImperativeHandle(ref, () => ({ getInstance: () => chart.current }));

  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: 'canvas' });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={el} style={{ width: '100%', height, ...style }} />;
});
