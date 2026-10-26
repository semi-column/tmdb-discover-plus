import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

const PALETTE = [
  '#4a9eff',
  '#ef4444',
  '#facc15',
  '#4ade80',
  '#c084fc',
  '#f97316',
  '#22d3ee',
  '#a3a3a3',
];

/** Thin uPlot wrapper. `data` = [timestampsSec[], ...seriesValues[]], `series` = [{ label, color? }]. */
export function TimeChart({ data, series, height = 220, yLabel }) {
  const ref = useRef(null);
  const plotRef = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !data?.[0]?.length) return undefined;
    // A single timestamp makes uPlot auto-range the x axis across years; pad it to a day.
    const single = data[0].length === 1;
    const opts = {
      width: el.clientWidth || 600,
      height,
      cursor: { drag: { x: true, y: false } },
      legend: { live: true },
      scales: {
        x: {
          time: true,
          ...(single ? { range: (u, min, max) => [min - 43200, max + 43200] } : {}),
        },
      },
      axes: [
        { stroke: '#8a8a8a', grid: { stroke: '#2a2a2a' } },
        { stroke: '#8a8a8a', grid: { stroke: '#2a2a2a' }, label: yLabel, size: 60 },
      ],
      series: [
        {},
        ...series.map((s, i) => ({
          label: s.label,
          stroke: s.color || PALETTE[i % PALETTE.length],
          width: 1.5,
          spanGaps: true,
        })),
      ],
    };
    plotRef.current = new uPlot(opts, data, el);
    const observer = new ResizeObserver(() => {
      plotRef.current?.setSize({ width: el.clientWidth, height });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [data, series, height, yLabel]);

  if (!data?.[0]?.length) return <div className="adm-empty">No data in this range</div>;
  return <div ref={ref} className="adm-chart" />;
}
