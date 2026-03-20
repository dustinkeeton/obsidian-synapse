import { describe, it, expect } from 'vitest';
import { formatTimestamp, MIN_SLIDER_DURATION } from './duration-detector';

describe('formatTimestamp', () => {
	it('formats 0 seconds as 00:00', () => {
		expect(formatTimestamp(0)).toBe('00:00');
	});

	it('formats seconds under a minute', () => {
		expect(formatTimestamp(45)).toBe('00:45');
	});

	it('formats exactly one minute', () => {
		expect(formatTimestamp(60)).toBe('01:00');
	});

	it('formats minutes and seconds', () => {
		expect(formatTimestamp(90)).toBe('01:30');
	});

	it('formats exactly one hour', () => {
		expect(formatTimestamp(3600)).toBe('01:00:00');
	});

	it('formats hours, minutes, and seconds', () => {
		expect(formatTimestamp(5400)).toBe('01:30:00');
	});

	it('formats large durations with hours', () => {
		expect(formatTimestamp(7261)).toBe('02:01:01');
	});

	it('pads single-digit values', () => {
		expect(formatTimestamp(61)).toBe('01:01');
	});

	it('handles durations just under an hour as MM:SS', () => {
		expect(formatTimestamp(3599)).toBe('59:59');
	});

	it('clamps negative values to 00:00', () => {
		expect(formatTimestamp(-5)).toBe('00:00');
	});

	it('floors fractional seconds', () => {
		expect(formatTimestamp(90.7)).toBe('01:30');
	});
});

describe('MIN_SLIDER_DURATION', () => {
	it('is 10 seconds', () => {
		expect(MIN_SLIDER_DURATION).toBe(10);
	});
});
