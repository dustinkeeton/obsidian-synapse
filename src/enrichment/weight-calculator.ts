import { WeightConfig } from './types';

/**
 * Pure function: compute a proximity weight between two file paths.
 *
 * The weight reflects how "close" the target is to the source in the
 * vault's folder hierarchy. Same folder → highest weight; distant
 * folders → lowest (but never below config.minWeight).
 *
 * Algorithm:
 * 1. Split paths into folder segments.
 * 2. Find the longest common prefix (shared ancestor depth).
 * 3. Compute hops = (sourceDepth - shared) + (targetDepth - shared).
 * 4. Map to a weight tier based on hop count.
 * 5. Apply linear decay per additional hop beyond the tier minimum.
 * 6. Clamp to [config.minWeight, tierWeight].
 */
export function computeProximityWeight(
	sourcePath: string,
	targetPath: string,
	config: WeightConfig
): number {
	const sourceSegments = folderSegments(sourcePath);
	const targetSegments = folderSegments(targetPath);

	const sharedDepth = commonPrefixLength(sourceSegments, targetSegments);
	const hops =
		(sourceSegments.length - sharedDepth) +
		(targetSegments.length - sharedDepth);

	const { tierWeight, tierMinHops } = getTier(hops, config);
	const decayed = tierWeight - (hops - tierMinHops) * config.decayPerLevel;

	return Math.max(config.minWeight, Math.min(tierWeight, decayed));
}

/** Extract folder segments from a file path (excludes the filename). */
function folderSegments(filePath: string): string[] {
	const parts = filePath.split('/');
	// Remove the file name — keep only folder path
	parts.pop();
	return parts;
}

/** Length of the longest common prefix between two string arrays. */
function commonPrefixLength(a: string[], b: string[]): number {
	let len = 0;
	const max = Math.min(a.length, b.length);
	for (let i = 0; i < max; i++) {
		if (a[i] === b[i]) len++;
		else break;
	}
	return len;
}

/** Map hop count to a weight tier. */
function getTier(
	hops: number,
	config: WeightConfig
): { tierWeight: number; tierMinHops: number } {
	if (hops === 0) return { tierWeight: config.sameFolder, tierMinHops: 0 };
	if (hops <= 1) return { tierWeight: config.siblingFolder, tierMinHops: 1 };
	if (hops <= 2) return { tierWeight: config.cousinFolder, tierMinHops: 2 };
	return { tierWeight: config.distantFolder, tierMinHops: 3 };
}
