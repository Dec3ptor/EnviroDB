import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { EChartsCoreOption, ECharts } from 'echarts/core';
import { echarts } from './echarts';

export interface EChartHandle {
  getInstance(): ECharts | null;
}

/**
 * An option, or a function of the chart's width in px (so legends and keys can wrap to fit) and of the series
 * switched off in the legend (so the axes can fit the ones shown).
 */
export type EChartOption = EChartsCoreOption | ((width: number, hidden: ReadonlySet<string>) => EChartsCoreOption);

export const EChart = forwardRef<EChartHandle, { option: EChartOption; height: number | string; style?: React.CSSProperties }>(function EChart({ option, height, style }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const [width, setWidth] = useState(0);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
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
    // a series switched on or off in the legend: rebuild, so the axes fit what is shown
    c.on('legendselectchanged', (e) => {
      const selected = (e as { selected: Record<string, boolean> }).selected;
      setHidden(new Set(Object.entries(selected).filter(([, on]) => !on).map(([name]) => name)));
    });
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
      last.current = null;
    };
  }, []);

  const lastHidden = useRef(hidden);
  useEffect(() => {
    if (!chart.current || (typeof option === 'function' && !width)) return;
    const opt = typeof option === 'function' ? option(width, hidden) : option;
    // animate new content and changed axes, not a re-layout for a new width
    const relayout = last.current === option && lastHidden.current === hidden;
    chart.current.setOption(relayout ? { ...opt, animation: false } : opt, { notMerge: true });
    last.current = option;
    lastHidden.current = hidden;
  }, [option, width, hidden]);

  return <div ref={el} style={{ width: '100%', height, ...style }} />;
});
