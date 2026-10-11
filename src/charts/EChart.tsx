import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { EChartsCoreOption, ECharts } from 'echarts/core';
import { echarts } from './echarts';

export interface EChartHandle {
  getInstance(): ECharts | null;
}

/** An option, or a function of the chart's width in px (so legends and keys can wrap to fit). */
export type EChartOption = EChartsCoreOption | ((width: number) => EChartsCoreOption);

export const EChart = forwardRef<EChartHandle, { option: EChartOption; height: number | string; style?: React.CSSProperties }>(function EChart({ option, height, style }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const [width, setWidth] = useState(0);
  const last = useRef<EChartOption | null>(null);
  useImperativeHandle(ref, () => ({ getInstance: () => chart.current }));

  useEffect(() => {
    if (!el.current) return;
    const node = el.current;
    const c = echarts.init(node, undefined, { renderer: 'canvas' });
    chart.current = c;
    setWidth(Math.floor(node.clientWidth / 8) * 8);
    const ro = new ResizeObserver(() => {
      c.resize();
      setWidth(Math.floor(node.clientWidth / 8) * 8);
    });
    ro.observe(node);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
      last.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chart.current || (typeof option === 'function' && !width)) return;
    const opt = typeof option === 'function' ? option(width) : option;
    // animate new content, not a re-layout for a new width
    chart.current.setOption(last.current === option ? { ...opt, animation: false } : opt, { notMerge: true });
    last.current = option;
  }, [option, width]);

  return <div ref={el} style={{ width: '100%', height, ...style }} />;
});
