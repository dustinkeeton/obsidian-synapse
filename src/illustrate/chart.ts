import type { ChartData } from './types';
import { isRecord } from '../shared';

const MAX_POINTS = 24;
const MAX_SERIES = 4;

function isFiniteNumberArray(value: unknown): value is number[] {
	return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/** Structural guard for AI-emitted chart data; every series must match the label count. */
export function parseChartData(value: unknown): ChartData | null {
	if (!isRecord(value)) return null;
	const { title, xLabels, series, yLabel } = value;
	if (typeof title !== 'string' || title.trim() === '') return null;
	if (!Array.isArray(xLabels) || xLabels.length === 0 || xLabels.length > MAX_POINTS) return null;
	if (!xLabels.every((label) => typeof label === 'string' || typeof label === 'number')) return null;
	if (!Array.isArray(series) || series.length === 0 || series.length > MAX_SERIES) return null;
	const labels = xLabels.map((label) => String(label));
	const parsedSeries: ChartData['series'] = [];
	for (const entry of series) {
		if (!isRecord(entry) || !isFiniteNumberArray(entry.values)) return null;
		if (entry.values.length !== labels.length) return null;
		parsedSeries.push({
			label: typeof entry.label === 'string' ? entry.label : undefined,
			values: entry.values,
		});
	}
	return {
		title: title.trim(),
		xLabels: labels,
		series: parsedSeries,
		yLabel: typeof yLabel === 'string' && yLabel.trim() !== '' ? yLabel.trim() : undefined,
	};
}

function quote(label: string): string {
	return `"${label.replace(/["\n\r]/g, ' ').trim()}"`;
}

/** Render a Mermaid `xychart-beta` bar chart (line for multi-series) from extracted note data. */
export function buildXyChart(data: ChartData): string {
	const lines = ['xychart-beta', `    title ${quote(data.title)}`];
	lines.push(`    x-axis [${data.xLabels.map(quote).join(', ')}]`);
	if (data.yLabel) lines.push(`    y-axis ${quote(data.yLabel)}`);
	const shape = data.series.length > 1 ? 'line' : 'bar';
	for (const entry of data.series) {
		lines.push(`    ${shape} [${entry.values.join(', ')}]`);
	}
	return lines.join('\n');
}
