import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

const PALETTE = [
  '#70d7b6',
  '#f18683',
  '#edc36a',
  '#8cbbe8',
  '#b6bea0',
  '#dd9d7e',
  '#8acbd1',
  '#b0b8b2',
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
          ...(single ? { range: () => [data[0][0] - 43200, data[0][0] + 43200] } : {}),
        },
      },
      axes: [
        {
          stroke: '#929da4',
          grid: { stroke: '#303638', width: 1 },
          font: '11px "Avenir Next", sans-serif',
        },
        {
          stroke: '#929da4',
          grid: { stroke: '#303638', width: 1 },
          label: yLabel,
          size: 56,
          font: '11px "Avenir Next", sans-serif',
        },
      ],
      series: [
        {},
        ...series.map((s, i) => ({
          label: s.label,
          stroke: s.color || PALETTE[i % PALETTE.length],
          width: 2,
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
