import { describe, it, expect } from 'vitest';
import {
	computeTraversalOrder,
	wikiLink,
	buildBreadcrumbs,
	buildNavigationContext,
	renderNavigationBlock,
	syllabusTitle,
	syllabusPath,
	renderSyllabusContent,
	injectNavigationBlock,
	buildTreeFromNodes,
	TraversalNode,
} from './syllabus-navigator';
import { DeepDiveProposal, DeepDiveRun } from './types';

// ── Test factories ──

function makeProposal(overrides: Partial<DeepDiveProposal> = {}): DeepDiveProposal {
	return {
		id: 'p1',
		runId: 'run-1',
		sourceNotePath: 'notes/Machine Learning.md',
		topic: {
			title: 'Neural Networks',
			description: 'A topic about neural networks',
			relevance: 0.9,
			existsInVault: false,
			relatedUrls: [],
		},
		proposedPath: 'Deep Dives/Machine Learning/Neural Networks.md',
		proposedContent: '# Neural Networks',
		depth: 0,
		qualityScore: {
			score: 0.8,
			topicCount: 3,
			wordCount: 200,
			isTooGeneric: false,
			hasHighOverlap: false,
			reasoning: 'Good',
		},
		childProposalIds: [],
		createdAt: '2026-03-16T00:00:00.000Z',
		status: 'pending',
		...overrides,
	};
}

function makeRun(overrides: Partial<DeepDiveRun> = {}): DeepDiveRun {
	return {
		id: 'run-1',
		rootNotePath: 'notes/Machine Learning.md',
		maxDepth: 3,
		qualityThreshold: 0.4,
		proposalIds: [],
		stats: { totalProposals: 0, byDepth: {}, earlyTerminations: 0 },
		createdAt: '2026-03-16T00:00:00.000Z',
		status: 'completed',
		...overrides,
	};
}

/**
 * Build a complete test tree:
 *
 * Machine Learning (root note, not a proposal)
 *   -> Neural Networks (p1, depth 0)
 *       -> Backpropagation (p2, depth 1)
 *       -> Activation Functions (p3, depth 1)
 *   -> Gradient Descent (p4, depth 0)
 *       -> Learning Rate Schedules (p5, depth 1)
 *   -> Regularization Techniques (p6, depth 0)
 */
function buildTestTree() {
	const proposals: DeepDiveProposal[] = [
		makeProposal({
			id: 'p1',
			topic: { title: 'Neural Networks', description: '', relevance: 0.9, existsInVault: false, relatedUrls: [] },
			proposedPath: 'Deep Dives/Machine Learning/Neural Networks.md',
			depth: 0,
			childProposalIds: ['p2', 'p3'],
			status: 'accepted',
		}),
		makeProposal({
			id: 'p2',
			sourceNotePath: 'Deep Dives/Machine Learning/Neural Networks.md',
			topic: { title: 'Backpropagation', description: '', relevance: 0.85, existsInVault: false, relatedUrls: [] },
			proposedPath: 'Deep Dives/Machine Learning/Neural Networks/Backpropagation.md',
			depth: 1,
			childProposalIds: [],
			status: 'accepted',
		}),
		makeProposal({
			id: 'p3',
			sourceNotePath: 'Deep Dives/Machine Learning/Neural Networks.md',
			topic: { title: 'Activation Functions', description: '', relevance: 0.8, existsInVault: false, relatedUrls: [] },
			proposedPath: 'Deep Dives/Machine Learning/Neural Networks/Activation Functions.md',
			depth: 1,
			childProposalIds: [],
			status: 'accepted',
		}),
		makeProposal({
			id: 'p4',
			topic: { title: 'Gradient Descent', description: '', relevance: 0.9, existsInVault: false, relatedUrls: [] },
			proposedPath: 'Deep Dives/Machine Learning/Gradient Descent.md',
			depth: 0,
			childProposalIds: ['p5'],
			status: 'accepted',
		}),
		makeProposal({
			id: 'p5',
			sourceNotePath: 'Deep Dives/Machine Learning/Gradient Descent.md',
			topic: { title: 'Learning Rate Schedules', description: '', relevance: 0.75, existsInVault: false, relatedUrls: [] },
			proposedPath: 'Deep Dives/Machine Learning/Gradient Descent/Learning Rate Schedules.md',
			depth: 1,
			childProposalIds: [],
			status: 'accepted',
		}),
		makeProposal({
			id: 'p6',
			topic: { title: 'Regularization Techniques', description: '', relevance: 0.85, existsInVault: false, relatedUrls: [] },
			proposedPath: 'Deep Dives/Machine Learning/Regularization Techniques.md',
			depth: 0,
			childProposalIds: [],
			status: 'accepted',
		}),
	];

	const run = makeRun({
		proposalIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
	});

	return { proposals, run };
}

// ── Tests ──

describe('wikiLink', () => {
	it('extracts basename from a full path', () => {
		expect(wikiLink('Deep Dives/Machine Learning/Neural Networks.md')).toBe('[[Neural Networks]]');
	});

	it('handles root-level paths', () => {
		expect(wikiLink('Machine Learning.md')).toBe('[[Machine Learning]]');
	});

	it('handles paths without .md extension', () => {
		expect(wikiLink('notes/Topic')).toBe('[[Topic]]');
	});
});

describe('computeTraversalOrder', () => {
	it('produces depth-first order for a complete tree', () => {
		const { proposals, run } = buildTestTree();
		const nodes = computeTraversalOrder(proposals, run);

		expect(nodes.map(n => n.title)).toEqual([
			'Neural Networks',
			'Backpropagation',
			'Activation Functions',
			'Gradient Descent',
			'Learning Rate Schedules',
			'Regularization Techniques',
		]);
	});

	it('assigns correct indices', () => {
		const { proposals, run } = buildTestTree();
		const nodes = computeTraversalOrder(proposals, run);

		expect(nodes.map(n => n.index)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it('assigns correct parent IDs', () => {
		const { proposals, run } = buildTestTree();
		const nodes = computeTraversalOrder(proposals, run);

		expect(nodes[0].parentId).toBeNull();          // Neural Networks -> root
		expect(nodes[1].parentId).toBe('p1');           // Backpropagation -> Neural Networks
		expect(nodes[2].parentId).toBe('p1');           // Activation Functions -> Neural Networks
		expect(nodes[3].parentId).toBeNull();           // Gradient Descent -> root
		expect(nodes[4].parentId).toBe('p4');           // Learning Rate Schedules -> Gradient Descent
		expect(nodes[5].parentId).toBeNull();           // Regularization Techniques -> root
	});

	it('skips rejected proposals', () => {
		const { proposals, run } = buildTestTree();
		// Reject Backpropagation
		proposals[1].status = 'rejected';
		const nodes = computeTraversalOrder(proposals, run);

		expect(nodes.map(n => n.title)).toEqual([
			'Neural Networks',
			'Activation Functions',
			'Gradient Descent',
			'Learning Rate Schedules',
			'Regularization Techniques',
		]);
	});

	it('skips pending proposals', () => {
		const { proposals, run } = buildTestTree();
		// Mark Gradient Descent and its child as pending
		proposals[3].status = 'pending';
		proposals[4].status = 'pending';
		const nodes = computeTraversalOrder(proposals, run);

		expect(nodes.map(n => n.title)).toEqual([
			'Neural Networks',
			'Backpropagation',
			'Activation Functions',
			'Regularization Techniques',
		]);
	});

	it('returns empty array when no proposals are accepted', () => {
		const { proposals, run } = buildTestTree();
		for (const p of proposals) p.status = 'rejected';
		const nodes = computeTraversalOrder(proposals, run);

		expect(nodes).toEqual([]);
	});

	it('handles a single accepted proposal', () => {
		const proposals = [
			makeProposal({
				id: 'p1',
				topic: { title: 'Topic A', description: '', relevance: 0.9, existsInVault: false, relatedUrls: [] },
				proposedPath: 'Deep Dives/Root/Topic A.md',
				depth: 0,
				status: 'accepted',
			}),
		];
		const run = makeRun({ proposalIds: ['p1'] });
		const nodes = computeTraversalOrder(proposals, run);

		expect(nodes.length).toBe(1);
		expect(nodes[0].title).toBe('Topic A');
		expect(nodes[0].parentId).toBeNull();
	});

	it('excludes accepted children of rejected parents from traversal', () => {
		const { proposals, run } = buildTestTree();
		// Reject Neural Networks — its children should not appear since
		// they are children of a rejected node, even though they are 'accepted'.
		// The tree structure means they only appear through their parent.
		proposals[0].status = 'rejected';

		const nodes = computeTraversalOrder(proposals, run);

		// Backpropagation and Activation Functions should be excluded because
		// their parent Neural Networks is rejected, and they are only reachable
		// through Neural Networks in the tree.
		expect(nodes.map(n => n.title)).toEqual([
			'Gradient Descent',
			'Learning Rate Schedules',
			'Regularization Techniques',
		]);
	});
});

describe('buildBreadcrumbs', () => {
	it('builds breadcrumbs for a root-level node', () => {
		const { proposals, run } = buildTestTree();
		const nodes = computeTraversalOrder(proposals, run);
		const crumbs = buildBreadcrumbs(nodes[0], nodes, 'Machine Learning');

		expect(crumbs).toEqual(['Machine Learning', 'Neural Networks']);
	});

	it('builds breadcrumbs for a depth-1 node', () => {
		const { proposals, run } = buildTestTree();
		const nodes = computeTraversalOrder(proposals, run);
		const crumbs = buildBreadcrumbs(nodes[1], nodes, 'Machine Learning');

		expect(crumbs).toEqual(['Machine Learning', 'Neural Networks', 'Backpropagation']);
	});

	it('builds breadcrumbs for a nested child of a different parent', () => {
		const { proposals, run } = buildTestTree();
		const nodes = computeTraversalOrder(proposals, run);
		// Learning Rate Schedules is child of Gradient Descent
		const crumbs = buildBreadcrumbs(nodes[4], nodes, 'Machine Learning');

		expect(crumbs).toEqual(['Machine Learning', 'Gradient Descent', 'Learning Rate Schedules']);
	});
});

describe('buildNavigationContext', () => {
	it('builds context for the first node', () => {
		const { proposals, run } = buildTestTree();
		const nodes = computeTraversalOrder(proposals, run);
		const ctx = buildNavigationContext('p1', nodes, run, 'Deep Dives/Machine Learning/Deep Dive -- Machine Learning.md');

		expect(ctx).not.toBeNull();
		expect(ctx!.root.title).toBe('Machine Learning');
		expect(ctx!.up).toBeNull();
		expect(ctx!.prev).toBeNull();
		expect(ctx!.next!.title).toBe('Backpropagation');
		expect(ctx!.position).toBe(1);
		expect(ctx!.total).toBe(6);
		expect(ctx!.breadcrumbs).toEqual(['Machine Learning', 'Neural Networks']);
	});

	it('builds context for a middle node with prev and next', () => {
		const { proposals, run } = buildTestTree();
		const nodes = computeTraversalOrder(proposals, run);
		const ctx = buildNavigationContext('p3', nodes, run, 'Deep Dives/Machine Learning/Deep Dive -- Machine Learning.md');

		expect(ctx).not.toBeNull();
		expect(ctx!.prev!.title).toBe('Backpropagation');
		expect(ctx!.next!.title).toBe('Gradient Descent');
		expect(ctx!.up!.title).toBe('Neural Networks');
		expect(ctx!.position).toBe(3);
	});

	it('builds context for the last node', () => {
		const { proposals, run } = buildTestTree();
		const nodes = computeTraversalOrder(proposals, run);
		const ctx = buildNavigationContext('p6', nodes, run, 'Deep Dives/Machine Learning/Deep Dive -- Machine Learning.md');

		expect(ctx).not.toBeNull();
		expect(ctx!.next).toBeNull();
		expect(ctx!.prev!.title).toBe('Learning Rate Schedules');
		expect(ctx!.position).toBe(6);
	});

	it('returns null for a proposal not in the traversal', () => {
		const { proposals, run } = buildTestTree();
		const nodes = computeTraversalOrder(proposals, run);
		const ctx = buildNavigationContext('non-existent', nodes, run, 'syllabus.md');

		expect(ctx).toBeNull();
	});
});

describe('renderNavigationBlock', () => {
	it('renders a complete navigation block with all links', () => {
		const { proposals, run } = buildTestTree();
		const nodes = computeTraversalOrder(proposals, run);
		const ctx = buildNavigationContext('p2', nodes, run, 'Deep Dives/Machine Learning/Deep Dive -- Machine Learning.md')!;
		const block = renderNavigationBlock(ctx);

		expect(block).toContain('> [!auto-notes-nav] Deep Dive Navigation');
		expect(block).toContain('Machine Learning > Neural Networks > Backpropagation');
		expect(block).toContain('**Root:** [[Machine Learning]]');
		expect(block).toContain('**Up:** [[Neural Networks]]');
		expect(block).toContain('**Prev:** [[Neural Networks]]');
		expect(block).toContain('**Next:** [[Activation Functions]]');
		expect(block).toContain('*Part 2 of 6 in [[Deep Dive -- Machine Learning]]*');
	});

	it('omits Up link for root-level proposals', () => {
		const { proposals, run } = buildTestTree();
		const nodes = computeTraversalOrder(proposals, run);
		const ctx = buildNavigationContext('p1', nodes, run, 'Deep Dives/Machine Learning/Deep Dive -- Machine Learning.md')!;
		const block = renderNavigationBlock(ctx);

		expect(block).not.toContain('**Up:**');
	});

	it('omits Prev link for the first proposal', () => {
		const { proposals, run } = buildTestTree();
		const nodes = computeTraversalOrder(proposals, run);
		const ctx = buildNavigationContext('p1', nodes, run, 'Deep Dives/Machine Learning/Deep Dive -- Machine Learning.md')!;
		const block = renderNavigationBlock(ctx);

		expect(block).not.toContain('**Prev:**');
		expect(block).toContain('**Next:**');
	});

	it('omits Next link for the last proposal', () => {
		const { proposals, run } = buildTestTree();
		const nodes = computeTraversalOrder(proposals, run);
		const ctx = buildNavigationContext('p6', nodes, run, 'Deep Dives/Machine Learning/Deep Dive -- Machine Learning.md')!;
		const block = renderNavigationBlock(ctx);

		expect(block).toContain('**Prev:**');
		expect(block).not.toContain('**Next:**');
	});
});

describe('syllabusTitle', () => {
	it('builds title from root note path', () => {
		expect(syllabusTitle('notes/Machine Learning.md')).toBe('Deep Dive -- Machine Learning');
	});

	it('handles root-level note path', () => {
		expect(syllabusTitle('Topic.md')).toBe('Deep Dive -- Topic');
	});
});

describe('syllabusPath', () => {
	it('builds path using output folder', () => {
		const path = syllabusPath('notes/Machine Learning.md', 'Deep Dives');
		expect(path).toBe('Deep Dives/Machine Learning/Deep Dive -- Machine Learning.md');
	});

	it('falls back to source folder when output folder is empty', () => {
		const path = syllabusPath('notes/Machine Learning.md', '');
		expect(path).toBe('notes/Deep Dive -- Machine Learning.md');
	});
});

describe('renderSyllabusContent', () => {
	it('renders a complete syllabus with numbered outline and topic map', () => {
		const { proposals, run } = buildTestTree();
		const nodes = computeTraversalOrder(proposals, run);
		const content = renderSyllabusContent(nodes, run);

		expect(content).toContain('# Deep Dive: Machine Learning');
		expect(content).toContain('## Topics');
		expect(content).toContain('1. [[Neural Networks]]');
		expect(content).toContain('   1. [[Backpropagation]]');
		expect(content).toContain('   2. [[Activation Functions]]');
		expect(content).toContain('2. [[Gradient Descent]]');
		expect(content).toContain('   1. [[Learning Rate Schedules]]');
		expect(content).toContain('3. [[Regularization Techniques]]');
		expect(content).toContain('## Topic Map');
		expect(content).toContain('```mermaid');
		expect(content).toContain('graph TD');
		expect(content).toContain('["Machine Learning"]');
		expect(content).toContain('["Neural Networks"]');
		expect(content).toContain('*Generated from [[Machine Learning]] -- 6 notes across 2 depths*');
	});

	it('renders correctly with partial acceptance', () => {
		const { proposals, run } = buildTestTree();
		// Reject Backpropagation and Gradient Descent subtree
		proposals[1].status = 'rejected';
		proposals[3].status = 'rejected';
		proposals[4].status = 'rejected';

		const nodes = computeTraversalOrder(proposals, run);
		const content = renderSyllabusContent(nodes, run);

		expect(content).toContain('1. [[Neural Networks]]');
		expect(content).toContain('   1. [[Activation Functions]]');
		expect(content).toContain('2. [[Regularization Techniques]]');
		// Rejected topics should not appear in the Topics outline
		expect(content).not.toContain('[[Backpropagation]]');
		expect(content).not.toContain('[[Gradient Descent]]');
		expect(content).toContain('-- 3 notes across 2 depths');
	});

	it('renders correctly with a single accepted proposal', () => {
		const proposals = [
			makeProposal({
				id: 'p1',
				topic: { title: 'Topic A', description: '', relevance: 0.9, existsInVault: false, relatedUrls: [] },
				proposedPath: 'Deep Dives/Root/Topic A.md',
				depth: 0,
				status: 'accepted',
			}),
		];
		const run = makeRun({ proposalIds: ['p1'] });
		const nodes = computeTraversalOrder(proposals, run);
		const content = renderSyllabusContent(nodes, run);

		expect(content).toContain('1. [[Topic A]]');
		expect(content).toContain('## Topic Map');
		expect(content).toContain('-- 1 note across 1 depth');
	});

	it('omits topic map section when there are no nodes', () => {
		const { proposals, run } = buildTestTree();
		for (const p of proposals) p.status = 'rejected';
		const nodes = computeTraversalOrder(proposals, run);
		const content = renderSyllabusContent(nodes, run);

		expect(content).not.toContain('## Topic Map');
		expect(content).not.toContain('```mermaid');
	});
});

describe('buildTreeFromNodes', () => {
	it('builds a tree with root and top-level children', () => {
		const { proposals, run } = buildTestTree();
		const nodes = computeTraversalOrder(proposals, run);
		const tree = buildTreeFromNodes(nodes, 'Machine Learning');

		expect(tree.label).toBe('Machine Learning');
		expect(tree.children.length).toBe(3); // NN, GD, Reg
		expect(tree.children[0].label).toBe('Neural Networks');
		expect(tree.children[1].label).toBe('Gradient Descent');
		expect(tree.children[2].label).toBe('Regularization Techniques');
	});

	it('builds nested children correctly', () => {
		const { proposals, run } = buildTestTree();
		const nodes = computeTraversalOrder(proposals, run);
		const tree = buildTreeFromNodes(nodes, 'Machine Learning');

		// Neural Networks should have Backpropagation and Activation Functions
		const nn = tree.children[0];
		expect(nn.children.length).toBe(2);
		expect(nn.children[0].label).toBe('Backpropagation');
		expect(nn.children[1].label).toBe('Activation Functions');

		// Gradient Descent should have Learning Rate Schedules
		const gd = tree.children[1];
		expect(gd.children.length).toBe(1);
		expect(gd.children[0].label).toBe('Learning Rate Schedules');

		// Regularization Techniques should have no children
		expect(tree.children[2].children.length).toBe(0);
	});

	it('handles empty node list', () => {
		const tree = buildTreeFromNodes([], 'Root');

		expect(tree.label).toBe('Root');
		expect(tree.children.length).toBe(0);
	});
});

describe('injectNavigationBlock', () => {
	const navBlock = '> [!auto-notes-nav] Deep Dive Navigation\n> **Root:** [[Root]]';

	it('prepends nav block to content without frontmatter', () => {
		const content = '# Neural Networks\n\nContent here.';
		const result = injectNavigationBlock(content, navBlock);

		expect(result).toBe(
			'> [!auto-notes-nav] Deep Dive Navigation\n> **Root:** [[Root]]\n\n# Neural Networks\n\nContent here.'
		);
	});

	it('inserts nav block after frontmatter', () => {
		const content = '---\ntags: [topic]\n---\n# Neural Networks\n\nContent here.';
		const result = injectNavigationBlock(content, navBlock);

		expect(result).toBe(
			'---\ntags: [topic]\n---\n> [!auto-notes-nav] Deep Dive Navigation\n> **Root:** [[Root]]\n\n# Neural Networks\n\nContent here.'
		);
	});

	it('replaces existing nav block', () => {
		const content = '> [!auto-notes-nav] Old Nav\n> Old content\n> More old content\n\n# Neural Networks\n\nContent here.';
		const result = injectNavigationBlock(content, navBlock);

		expect(result).toContain('> [!auto-notes-nav] Deep Dive Navigation');
		expect(result).toContain('> **Root:** [[Root]]');
		expect(result).not.toContain('Old Nav');
		expect(result).not.toContain('Old content');
		expect(result).toContain('# Neural Networks');
	});

	it('replaces existing nav block after frontmatter', () => {
		const content = '---\ntags: [topic]\n---\n> [!auto-notes-nav] Old Nav\n> Old stuff\n\n# Neural Networks';
		const result = injectNavigationBlock(content, navBlock);

		expect(result).toContain('---\ntags: [topic]\n---\n');
		expect(result).toContain('> [!auto-notes-nav] Deep Dive Navigation');
		expect(result).not.toContain('Old Nav');
	});
});
