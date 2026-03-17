import { DeepDiveProposal, DeepDiveRun } from './types';

/**
 * A node in the depth-first traversal of accepted proposals.
 * Used to compute prev/next/up/root relationships.
 */
export interface TraversalNode {
	proposalId: string;
	title: string;
	proposedPath: string;
	depth: number;
	/** Index in the DFS order (0-based) */
	index: number;
	/** Parent proposal ID (null for root-level proposals) */
	parentId: string | null;
	/** Child proposal IDs that are accepted */
	childIds: string[];
}

/**
 * Navigation context for a single accepted proposal.
 */
export interface NavigationContext {
	/** Root note title and path */
	root: { title: string; path: string };
	/** Parent proposal (null for depth-0 proposals) */
	up: { title: string; path: string } | null;
	/** Previous proposal in DFS order (null for first) */
	prev: { title: string; path: string } | null;
	/** Next proposal in DFS order (null for last) */
	next: { title: string; path: string } | null;
	/** 1-based position in the traversal */
	position: number;
	/** Total accepted proposals */
	total: number;
	/** Breadcrumb path from root: ["Machine Learning", "Neural Networks", "Backpropagation"] */
	breadcrumbs: string[];
	/** Title and path of the syllabus note */
	syllabus: { title: string; path: string };
}

/**
 * Compute depth-first traversal order from accepted proposals in a run.
 *
 * The traversal follows the tree structure: for each parent node, visit its
 * accepted children in order before moving to the next sibling. Only
 * proposals with status 'accepted' are included.
 */
export function computeTraversalOrder(
	proposals: DeepDiveProposal[],
	run: DeepDiveRun
): TraversalNode[] {
	const proposalMap = new Map<string, DeepDiveProposal>();
	for (const p of proposals) {
		proposalMap.set(p.id, p);
	}

	// Find root-level proposals: those whose sourceNotePath matches the run's rootNotePath
	const rootProposals = run.proposalIds
		.map(id => proposalMap.get(id))
		.filter((p): p is DeepDiveProposal =>
			p !== undefined &&
			p.status === 'accepted' &&
			p.sourceNotePath === run.rootNotePath
		);

	const nodes: TraversalNode[] = [];

	function visit(proposalId: string, parentId: string | null): void {
		const proposal = proposalMap.get(proposalId);
		if (!proposal || proposal.status !== 'accepted') return;

		const acceptedChildIds = proposal.childProposalIds.filter(cid => {
			const child = proposalMap.get(cid);
			return child && child.status === 'accepted';
		});

		const node: TraversalNode = {
			proposalId: proposal.id,
			title: proposal.topic.title,
			proposedPath: proposal.proposedPath,
			depth: proposal.depth,
			index: nodes.length,
			parentId,
			childIds: acceptedChildIds,
		};
		nodes.push(node);

		// Recurse into accepted children
		for (const childId of acceptedChildIds) {
			visit(childId, proposal.id);
		}
	}

	for (const rp of rootProposals) {
		visit(rp.id, null);
	}

	return nodes;
}

/**
 * Build a wiki-link for Obsidian from a file path.
 * Extracts the basename (without extension) for the link text.
 */
export function wikiLink(path: string): string {
	const basename = path.replace(/\.md$/, '').split('/').pop() || path;
	return `[[${basename}]]`;
}

/**
 * Build the breadcrumb path from root to a given node.
 */
export function buildBreadcrumbs(
	node: TraversalNode,
	nodes: TraversalNode[],
	rootTitle: string
): string[] {
	const crumbs: string[] = [rootTitle];
	const nodeMap = new Map<string, TraversalNode>();
	for (const n of nodes) {
		nodeMap.set(n.proposalId, n);
	}

	// Walk up the parent chain
	const ancestors: string[] = [];
	let current: TraversalNode | undefined = node;
	while (current?.parentId) {
		const parent = nodeMap.get(current.parentId);
		if (parent) {
			ancestors.unshift(parent.title);
		}
		current = parent;
	}

	crumbs.push(...ancestors, node.title);
	return crumbs;
}

/**
 * Build the navigation context for a given proposal.
 */
export function buildNavigationContext(
	proposalId: string,
	nodes: TraversalNode[],
	run: DeepDiveRun,
	syllabusPath: string
): NavigationContext | null {
	const nodeIndex = nodes.findIndex(n => n.proposalId === proposalId);
	if (nodeIndex === -1) return null;

	const node = nodes[nodeIndex];
	const nodeMap = new Map<string, TraversalNode>();
	for (const n of nodes) {
		nodeMap.set(n.proposalId, n);
	}

	const rootTitle = run.rootNotePath.replace(/\.md$/, '').split('/').pop() || run.rootNotePath;
	const syllabusTitle = `Deep Dive -- ${rootTitle}`;

	// Find parent (up)
	let up: { title: string; path: string } | null = null;
	if (node.parentId) {
		const parent = nodeMap.get(node.parentId);
		if (parent) {
			up = { title: parent.title, path: parent.proposedPath };
		}
	}

	// Find prev/next in DFS order
	const prev = nodeIndex > 0
		? { title: nodes[nodeIndex - 1].title, path: nodes[nodeIndex - 1].proposedPath }
		: null;
	const next = nodeIndex < nodes.length - 1
		? { title: nodes[nodeIndex + 1].title, path: nodes[nodeIndex + 1].proposedPath }
		: null;

	const breadcrumbs = buildBreadcrumbs(node, nodes, rootTitle);

	return {
		root: { title: rootTitle, path: run.rootNotePath },
		up,
		prev,
		next,
		position: nodeIndex + 1,
		total: nodes.length,
		breadcrumbs,
		syllabus: { title: syllabusTitle, path: syllabusPath },
	};
}

/**
 * Render the navigation callout block for a deep dive note.
 *
 * Format:
 * > [!auto-notes-nav] Deep Dive Navigation
 * > Machine Learning > Neural Networks > Backpropagation
 * > **Root:** [[Machine Learning]] | **Up:** [[Neural Networks]]
 * > **Prev:** [[Activation Functions]] | **Next:** [[Regularization Techniques]]
 * > *Part 3 of 6 in [[Deep Dive -- Machine Learning]]*
 */
export function renderNavigationBlock(ctx: NavigationContext): string {
	const lines: string[] = [];
	lines.push('> [!auto-notes-nav] Deep Dive Navigation');

	// Breadcrumb line
	const breadcrumbLine = ctx.breadcrumbs.join(' > ');
	lines.push(`> ${breadcrumbLine}`);

	// Root and Up line
	const rootLink = `**Root:** ${wikiLink(ctx.root.path)}`;
	if (ctx.up) {
		lines.push(`> ${rootLink} | **Up:** ${wikiLink(ctx.up.path)}`);
	} else {
		lines.push(`> ${rootLink}`);
	}

	// Prev and Next line
	const parts: string[] = [];
	if (ctx.prev) {
		parts.push(`**Prev:** ${wikiLink(ctx.prev.path)}`);
	}
	if (ctx.next) {
		parts.push(`**Next:** ${wikiLink(ctx.next.path)}`);
	}
	if (parts.length > 0) {
		lines.push(`> ${parts.join(' | ')}`);
	}

	// Position indicator
	lines.push(`> *Part ${ctx.position} of ${ctx.total} in ${wikiLink(ctx.syllabus.path)}*`);

	return lines.join('\n');
}

/**
 * Build the syllabus note title from a root note path.
 */
export function syllabusTitle(rootNotePath: string): string {
	const rootTitle = rootNotePath.replace(/\.md$/, '').split('/').pop() || rootNotePath;
	return `Deep Dive -- ${rootTitle}`;
}

/**
 * Build the syllabus note file path.
 */
export function syllabusPath(rootNotePath: string, noteOutputFolder: string): string {
	const rootBasename = rootNotePath.replace(/\.md$/, '').split('/').pop() || 'Unknown';
	const folder = noteOutputFolder
		? `${noteOutputFolder}/${rootBasename}`
		: rootNotePath.substring(0, rootNotePath.lastIndexOf('/')) || '';
	const title = syllabusTitle(rootNotePath);
	return folder ? `${folder}/${title}.md` : `${title}.md`;
}

/**
 * Render the full syllabus index note content.
 *
 * Output:
 * # Deep Dive: Machine Learning
 *
 * ## Topics
 *
 * 1. [[Neural Networks]]
 *    1. [[Backpropagation]]
 *    2. [[Activation Functions]]
 * 2. [[Gradient Descent]]
 *    1. [[Learning Rate Schedules]]
 * 3. [[Regularization Techniques]]
 *
 * ---
 * *Generated from [[Machine Learning]] -- 6 notes across 2 depths*
 */
export function renderSyllabusContent(
	nodes: TraversalNode[],
	run: DeepDiveRun
): string {
	const rootTitle = run.rootNotePath.replace(/\.md$/, '').split('/').pop() || run.rootNotePath;

	const lines: string[] = [];
	lines.push(`# Deep Dive: ${rootTitle}`);
	lines.push('');
	lines.push('## Topics');
	lines.push('');

	// Build numbered outline from tree structure
	// Track numbering per parent (null = root level)
	const counterByParent = new Map<string | null, number>();

	for (const node of nodes) {
		const parentKey = node.parentId;
		const count = (counterByParent.get(parentKey) || 0) + 1;
		counterByParent.set(parentKey, count);

		const indent = '   '.repeat(node.depth);
		const link = wikiLink(node.proposedPath);
		lines.push(`${indent}${count}. ${link}`);
	}

	// Compute stats
	const depthSet = new Set(nodes.map(n => n.depth));
	const depthCount = depthSet.size;

	lines.push('');
	lines.push('---');
	lines.push(`*Generated from ${wikiLink(run.rootNotePath)} -- ${nodes.length} note${nodes.length === 1 ? '' : 's'} across ${depthCount} depth${depthCount === 1 ? '' : 's'}*`);

	return lines.join('\n');
}

/**
 * Prepend or update the navigation block in a note's content.
 *
 * If the note already has a `> [!auto-notes-nav]` callout, replace it.
 * Otherwise, prepend it at the top (after frontmatter if present).
 */
export function injectNavigationBlock(
	content: string,
	navBlock: string
): string {
	// Pattern to match an existing nav block (callout lines starting with >)
	const navPattern = /^> \[!auto-notes-nav\][^\n]*(?:\n>[^\n]*)*\n?/m;

	if (navPattern.test(content)) {
		return content.replace(navPattern, navBlock + '\n');
	}

	// Check for frontmatter (---\n...\n---\n)
	const frontmatterPattern = /^---\n[\s\S]*?\n---\n/;
	const fmMatch = content.match(frontmatterPattern);

	if (fmMatch) {
		const afterFm = content.slice(fmMatch[0].length);
		return fmMatch[0] + navBlock + '\n\n' + afterFm;
	}

	return navBlock + '\n\n' + content;
}
