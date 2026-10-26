import { render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import uPlot from 'uplot';
import { TimeChart } from './TimeChart.jsx';

vi.mock('uplot', () => ({
  default: vi.fn(function () {
    this.setSize = vi.fn();
    this.destroy = vi.fn();
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

it('anchors a single-point time range to the timestamp, not expanded library bounds', () => {
  const timestamp = Date.UTC(2026, 9, 26) / 1000;
  render(<TimeChart data={[[timestamp], [4]]} series={[{ label: 'Configs' }]} />);
  const options = uPlot.mock.calls[0][0];
  expect(options.scales.x.range(null, 0, timestamp * 2)).toEqual([
    timestamp - 43200,
    timestamp + 43200,
  ]);
});
