import { render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import uPlot from 'uplot';
import { TimeChart } from './TimeChart.jsx';

vi.mock('uplot', () => ({
  default: vi.fn(function () {
    this.setSize = vi.fn();
    this.setData = vi.fn();
    this.destroy = vi.fn();
    this.select = { left: 0, top: 0, width: 0, height: 0 };
    this.posToVal = vi.fn();
    this.setSelect = vi.fn();
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
});

it('updates polling data without recreating the chart and uses the latest selection callback', () => {
  const first = vi.fn();
  const next = vi.fn();
  const { rerender } = render(
    <TimeChart
      data={[
        [100, 200],
        [1, 2],
      ]}
      series={[{ label: 'Requests' }]}
      onSelectRange={first}
    />
  );
  const plot = uPlot.mock.instances[0];
  rerender(
    <TimeChart
      data={[
        [200, 300],
        [2, 3],
      ]}
      series={[{ label: 'Requests' }]}
      onSelectRange={next}
    />
  );
  expect(uPlot).toHaveBeenCalledTimes(1);
  expect(plot.destroy).not.toHaveBeenCalled();
  expect(plot.setData).toHaveBeenLastCalledWith([
    [200, 300],
    [2, 3],
  ]);
  plot.select = { left: 0, width: 40 };
  plot.posToVal.mockImplementation((p) => (p ? 300 : 200));
  uPlot.mock.calls[0][0].hooks.setSelect[0](plot);
  expect(next).toHaveBeenCalledWith({ from: 200000, to: 300000 });
  expect(first).not.toHaveBeenCalled();
});

it('anchors a single-point time range to the timestamp, not expanded library bounds', () => {
  const timestamp = Date.UTC(2026, 9, 26) / 1000;
  render(<TimeChart data={[[timestamp], [4]]} series={[{ label: 'Configs' }]} />);
  const options = uPlot.mock.calls[0][0];
  expect(options.scales.x.range(null, 0, timestamp * 2)).toEqual([
    timestamp - 43200,
    timestamp + 43200,
  ]);
});

it('emits selected chart bounds as epoch milliseconds without zooming the chart', () => {
  const onSelectRange = vi.fn();
  const from = 1_798_000_000;
  const to = from + 900;
  render(
    <TimeChart
      data={[
        [from, to],
        [4, 8],
      ]}
      series={[{ label: 'Requests' }]}
      onSelectRange={onSelectRange}
    />
  );

  const options = uPlot.mock.calls[0][0];
  const plot = uPlot.mock.instances[0];
  plot.select = { left: 20, top: 0, width: 40, height: 100 };
  plot.posToVal.mockImplementation((position) => (position === 20 ? from : to));
  options.hooks.setSelect[0](plot);

  expect(options.cursor.drag.setScale).toBe(false);
  expect(onSelectRange).toHaveBeenCalledWith({ from: from * 1000, to: to * 1000 });
  expect(plot.setSelect).toHaveBeenCalledWith({ left: 0, top: 0, width: 0, height: 0 }, false);
});
