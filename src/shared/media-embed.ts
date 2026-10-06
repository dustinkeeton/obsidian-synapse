/** `![[file]]` link for a media file downloaded into the vault; undefined when the path carries no file name. */
export function mediaEmbedFor(videoVaultPath: string): string | undefined {
	const fileName = videoVaultPath.split('/').pop();
	return fileName ? `![[${fileName}]]` : undefined;
}

/**
 * Note lines that embed a downloaded media file above the content block
 * that produced it. Empty when the setting is off, nothing was downloaded,
 * or `noteContent` already carries the exact embed.
 */
export function buildMediaEmbedLines(
	videoVaultPath: string | undefined,
	embedInNote: boolean,
	noteContent?: string
): string[] {
	if (!embedInNote || !videoVaultPath) return [];
	const embed = mediaEmbedFor(videoVaultPath);
	if (!embed || noteContent?.includes(embed)) return [];
	return [embed, ''];
}
