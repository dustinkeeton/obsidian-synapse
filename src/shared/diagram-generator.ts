/**
 * Generates Mermaid diagram code blocks for visualizing
 * deep dive topic trees and organize move operations.
 *
 * Obsidian renders Mermaid code blocks natively, so no
 * plugin dependency is needed.
 */

/** A node in a topic tree for deep dive diagrams. */
export interface TreeNode {
	/** Unique identifier for graph node naming */
	id: string;
	/** Display label */
	label: string;
	/** Children of this node */
	children: TreeNode[];
}

/** A single file move record for organize diagrams. */
export interface MoveRecord {
	/** Original file path before the move */
	originalPath: string;
	/** New file path after the move */
	newPath: string;
}

/**
 * Sanitize a label for use inside Mermaid node definitions.
 * Mermaid uses double quotes inside bracket notation, so we
 * need to escape characters that would break the syntax.
 */
function sanitizeLabel(label: string): string {
	return label
		.replace(/"/g, "'")
		.replace(/[[\]]/g, '')
		.replace(/[<>]/g, '');
}

/**
 * Generate a stable, short node ID from an arbitrary identifier.
 * Mermaid node IDs must be alphanumeric (with underscores).
 */
function toNodeId(prefix: string, index: number): string {
	return `${prefix}${index}`;
}

/**
 * Generate a Mermaid top-down tree diagram from a topic tree.
 *
 * Output format:
 * ```mermaid
 * graph TD
 *     N0["Machine Learning"] --> N1["Neural Networks"]
 *     N0["Machine Learning"] --> N2["Gradient Descent"]
 *     N1["Neural Networks"] --> N3["Backpropagation"]
 *     N1["Neural Networks"] --> N4["Activation Functions"]
 *     N2["Gradient Descent"] --> N5["Learning Rate Schedules"]
 * ```
 */
export function generateTreeDiagram(root: TreeNode): string {
	const edges: string[] = [];
	let counter = 0;
	const idMap = new Map<string, string>();

	function assignId(nodeId: string): string {
		if (!idMap.has(nodeId)) {
			idMap.set(nodeId, toNodeId('N', counter++));
		}
		return idMap.get(nodeId)!;
	}

	function visit(node: TreeNode): void {
		const parentMermaidId = assignId(node.id);
		for (const child of node.children) {
			const childMermaidId = assignId(child.id);
			const parentLabel = sanitizeLabel(node.label);
			const childLabel = sanitizeLabel(child.label);
			edges.push(`    ${parentMermaidId}["${parentLabel}"] --> ${childMermaidId}["${childLabel}"]`);
			visit(child);
		}
	}

	visit(root);

	if (edges.length === 0) {
		// Single node, no edges — show just the root
		const rootMermaidId = assignId(root.id);
		const rootLabel = sanitizeLabel(root.label);
		const lines = [
			'```mermaid',
			'graph TD',
			`    ${rootMermaidId}["${rootLabel}"]`,
			'```',
		];
		return lines.join('\n');
	}

	const lines = [
		'```mermaid',
		'graph TD',
		...edges,
		'```',
	];
	return lines.join('\n');
}

/**
 * Generate a Mermaid left-right flowchart showing file moves.
 *
 * Output format:
 * ```mermaid
 * graph LR
 *     subgraph Before
 *         A0["notes/neural-networks.md"]
 *         A1["notes/gradient-descent.md"]
 *     end
 *     subgraph After
 *         B0["AI & ML/Neural Networks/neural-networks.md"]
 *         B1["AI & ML/Optimization/gradient-descent.md"]
 *     end
 *     A0 --> B0
 *     A1 --> B1
 * ```
 */
export function generateMoveDiagram(moves: MoveRecord[]): string {
	if (moves.length === 0) {
		return '```mermaid\ngraph LR\n    EMPTY["No files moved"]\n```';
	}

	const beforeNodes: string[] = [];
	const afterNodes: string[] = [];
	const arrows: string[] = [];

	for (let i = 0; i < moves.length; i++) {
		const fromId = toNodeId('A', i);
		const toId = toNodeId('B', i);
		const fromLabel = sanitizeLabel(moves[i].originalPath);
		const toLabel = sanitizeLabel(moves[i].newPath);

		beforeNodes.push(`        ${fromId}["${fromLabel}"]`);
		afterNodes.push(`        ${toId}["${toLabel}"]`);
		arrows.push(`    ${fromId} --> ${toId}`);
	}

	const lines = [
		'```mermaid',
		'graph LR',
		'    subgraph Before',
		...beforeNodes,
		'    end',
		'    subgraph After',
		...afterNodes,
		'    end',
		...arrows,
		'```',
	];
	return lines.join('\n');
}

/**
 * Generate a full organize summary note with a move diagram.
 *
 * Output includes a heading, timestamp, move count, and the Mermaid diagram.
 */
export function generateOrganizeSummary(
	moves: MoveRecord[],
	timestamp: string
): string {
	const date = timestamp.split('T')[0] || timestamp;
	const lines: string[] = [];

	lines.push('# Organize Summary');
	lines.push('');
	lines.push(`**Date:** ${date}`);
	lines.push(`**Files moved:** ${moves.length}`);
	lines.push('');
	lines.push('## Move Diagram');
	lines.push('');
	lines.push(generateMoveDiagram(moves));
	lines.push('');
	lines.push('## Details');
	lines.push('');

	for (const move of moves) {
		lines.push(`- \`${move.originalPath}\` -> \`${move.newPath}\``);
	}

	return lines.join('\n');
}
