import { describe, it, expect } from 'vitest';
import { parseChartData, buildXyChart } from './chart';

const valid = { title: 'Revenue', xLabels: ['2022', '2023'], series: [{ label: 'USD', values: [10, 12.5] }], yLabel: 'M' };

describe('parseChartData', () => {
	it('accepts well-formed data and coerces numeric labels to strings', () => {
		expect(parseChartData({ ...valid, xLabels: [2022, 2023] })).toEqual({ ...valid, xLabels: ['2022', '2023'] });
	});

	it('rejects a series whose length differs from the labels', () => {
		expect(parseChartData({ ...valid, series: [{ values: [1] }] })).toBeNull();
	});

	it('rejects non-finite or non-numeric values', () => {
		expect(parseChartData({ ...valid, series: [{ values: [1, NaN] }] })).toBeNull();
		expect(parseChartData({ ...valid, series: [{ values: ['1', '2'] }] })).toBeNull();
	});

	it('rejects a missing title or empty labels', () => {
		expect(parseChartData({ ...valid, title: '' })).toBeNull();
		expect(parseChartData({ ...valid, xLabels: [], series: [{ values: [] }] })).toBeNull();
	});

	it('drops an empty yLabel', () => {
		expect(parseChartData({ ...valid, yLabel: ' ' })?.yLabel).toBeUndefined();
	});
});

describe('buildXyChart', () => {
	it('renders a single series as bars with quoted labels', () => {
		expect(buildXyChart(valid)).toBe([
			'xychart-beta',
			'    title "Revenue"',
			'    x-axis ["2022", "2023"]',
			'    y-axis "M"',
			'    bar [10, 12.5]',
		].join('\n'));
	});

	it('renders multiple series as lines and scrubs quotes from labels', () => {
		const chart = buildXyChart({ title: 'A "b"', xLabels: ['x'], series: [{ values: [1] }, { values: [2] }] });
		expect(chart).toContain('title "A  b"');
		expect(chart).toContain('    line [1]\n    line [2]');
	});
});
