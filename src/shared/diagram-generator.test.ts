import { describe, it, expect } from 'vitest';
import {
	generateTreeDiagram,
	generateMoveDiagram,
	generateOrganizeSummary,
	TreeNode,
	MoveRecord,
} from './diagram-generator';

// ── generateTreeDiagram ──

describe('generateTreeDiagram', () => {
	it('generates a tree diagram from a multi-level topic tree', () => {
		const root: TreeNode = {
			id: 'ml',
			label: 'Machine Learning',
			children: [
				{
					id: 'nn',
					label: 'Neural Networks',
					children: [
						{ id: 'bp', label: 'Backpropagation', children: [] },
						{ id: 'af', label: 'Activation Functions', children: [] },
					],
				},
				{
					id: 'gd',
					label: 'Gradient Descent',
					children: [
						{ id: 'lr', label: 'Learning Rate Schedules', children: [] },
					],
				},
			],
		};

		const result = generateTreeDiagram(root);

		expect(result).toContain('```mermaid');
		expect(result).toContain('graph TD');
		expect(result).toContain('["Machine Learning"]');
		expect(result).toContain('["Neural Networks"]');
		expect(result).toContain('["Backpropagation"]');
		expect(result).toContain('["Activation Functions"]');
		expect(result).toContain('["Gradient Descent"]');
		expect(result).toContain('["Learning Rate Schedules"]');
		expect(result).toMatch(/N\d+\[".+?"\] --> N\d+\[".+?"\]/);
		expect(result).toContain('```');
	});

	it('handles a single-node tree with no children', () => {
		const root: TreeNode = {
			id: 'solo',
			label: 'Solo Topic',
			children: [],
		};

		const result = generateTreeDiagram(root);

		expect(result).toContain('```mermaid');
		expect(result).toContain('graph TD');
		expect(result).toContain('["Solo Topic"]');
		expect(result).not.toContain('-->');
	});

	it('sanitizes labels with special characters', () => {
		const root: TreeNode = {
			id: 'root',
			label: 'Topic [with] "special" <chars>',
			children: [
				{ id: 'child', label: 'Child "node"', children: [] },
			],
		};

		const result = generateTreeDiagram(root);

		// Double quotes should be replaced with single quotes
		expect(result).toContain("Topic with 'special' chars");
		expect(result).toContain("Child 'node'");
		// Brackets and angle brackets should be removed
		expect(result).not.toContain('[with]');
		expect(result).not.toContain('<chars>');
	});

	it('handles deeply nested trees', () => {
		const root: TreeNode = {
			id: 'a',
			label: 'Level 0',
			children: [{
				id: 'b',
				label: 'Level 1',
				children: [{
					id: 'c',
					label: 'Level 2',
					children: [{
						id: 'd',
						label: 'Level 3',
						children: [],
					}],
				}],
			}],
		};

		const result = generateTreeDiagram(root);

		// Should have 3 edges: 0->1, 1->2, 2->3
		const arrowCount = (result.match(/-->/g) || []).length;
		expect(arrowCount).toBe(3);
	});

	it('wraps output in mermaid code fence', () => {
		const root: TreeNode = {
			id: 'r',
			label: 'Root',
			children: [{ id: 'c', label: 'Child', children: [] }],
		};

		const result = generateTreeDiagram(root);
		const lines = result.split('\n');

		expect(lines[0]).toBe('```mermaid');
		expect(lines[lines.length - 1]).toBe('```');
	});
});

// ── generateMoveDiagram ──

describe('generateMoveDiagram', () => {
	it('generates a move diagram from file move records', () => {
		const moves: MoveRecord[] = [
			{
				originalPath: 'notes/neural-networks.md',
				newPath: 'AI & ML/Neural Networks/neural-networks.md',
			},
			{
				originalPath: 'notes/gradient-descent.md',
				newPath: 'AI & ML/Optimization/gradient-descent.md',
			},
		];

		const result = generateMoveDiagram(moves);

		expect(result).toContain('```mermaid');
		expect(result).toContain('graph LR');
		expect(result).toContain('subgraph Before');
		expect(result).toContain('subgraph After');
		expect(result).toContain('["notes/neural-networks.md"]');
		expect(result).toContain('["AI & ML/Neural Networks/neural-networks.md"]');
		expect(result).toContain('["notes/gradient-descent.md"]');
		expect(result).toContain('["AI & ML/Optimization/gradient-descent.md"]');
		expect(result).toMatch(/A0 --> B0/);
		expect(result).toMatch(/A1 --> B1/);
	});

	it('handles empty move list', () => {
		const result = generateMoveDiagram([]);

		expect(result).toContain('```mermaid');
		expect(result).toContain('No files moved');
	});

	it('handles a single move', () => {
		const moves: MoveRecord[] = [
			{
				originalPath: 'inbox/note.md',
				newPath: 'projects/note.md',
			},
		];

		const result = generateMoveDiagram(moves);

		expect(result).toContain('subgraph Before');
		expect(result).toContain('subgraph After');
		expect(result).toContain('A0 --> B0');
		// Should only have one arrow
		const arrowCount = (result.match(/A\d+ --> B\d+/g) || []).length;
		expect(arrowCount).toBe(1);
	});

	it('wraps output in mermaid code fence', () => {
		const moves: MoveRecord[] = [
			{ originalPath: 'a.md', newPath: 'b/a.md' },
		];

		const result = generateMoveDiagram(moves);
		const lines = result.split('\n');

		expect(lines[0]).toBe('```mermaid');
		expect(lines[lines.length - 1]).toBe('```');
	});

	it('sanitizes labels with special characters in paths', () => {
		const moves: MoveRecord[] = [
			{
				originalPath: 'notes/topic [draft].md',
				newPath: 'final/topic draft.md',
			},
		];

		const result = generateMoveDiagram(moves);

		expect(result).not.toContain('[draft]');
		expect(result).toContain('notes/topic draft.md');
	});
});

// ── generateOrganizeSummary ──

describe('generateOrganizeSummary', () => {
	it('generates a complete summary note with diagram', () => {
		const moves: MoveRecord[] = [
			{
				originalPath: 'inbox/note-1.md',
				newPath: 'projects/note-1.md',
			},
			{
				originalPath: 'inbox/note-2.md',
				newPath: 'reference/note-2.md',
			},
		];

		const result = generateOrganizeSummary(moves, '2026-03-16T12:00:00.000Z');

		expect(result).toContain('# Organize Summary');
		expect(result).toContain('**Date:** 2026-03-16');
		expect(result).toContain('**Files moved:** 2');
		expect(result).toContain('## Move Diagram');
		expect(result).toContain('```mermaid');
		expect(result).toContain('## Details');
		expect(result).toContain('`inbox/note-1.md` -> `projects/note-1.md`');
		expect(result).toContain('`inbox/note-2.md` -> `reference/note-2.md`');
	});

	it('handles empty moves', () => {
		const result = generateOrganizeSummary([], '2026-03-16T12:00:00.000Z');

		expect(result).toContain('**Files moved:** 0');
		expect(result).toContain('No files moved');
	});

	it('extracts date from ISO timestamp', () => {
		const result = generateOrganizeSummary([], '2026-01-15T09:30:00.000Z');

		expect(result).toContain('**Date:** 2026-01-15');
	});
});
