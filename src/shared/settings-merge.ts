function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merge persisted settings over defaults. Nested records recurse; arrays and
 * primitives overwrite; `__proto__`/`constructor`/`prototype` keys are dropped.
 * Not a deep clone: untouched nested defaults are shared by reference.
 */
export function deepMergeSettings<T extends object>(target: T, source: Record<string, unknown>): T {
	const output: Record<string, unknown> = { ...(target as Record<string, unknown>) };
	for (const key of Object.keys(source)) {
		if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
			continue;
		}
		const sourceValue = source[key];
		const targetValue = output[key];
		if (isPlainRecord(sourceValue) && isPlainRecord(targetValue)) {
			output[key] = deepMergeSettings(targetValue, sourceValue);
		} else {
			output[key] = sourceValue;
		}
	}
	return output as T;
}
