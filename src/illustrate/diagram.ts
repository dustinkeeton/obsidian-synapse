import { stripCodeFences } from '../shared';

const DIAGRAM_KEYWORDS = [
	'flowchart', 'graph', 'mindmap', 'timeline', 'sequenceDiagram', 'classDiagram',
	'stateDiagram', 'stateDiagram-v2', 'erDiagram', 'journey', 'gantt', 'pie',
	'quadrantChart', 'xychart-beta',
];

const MAX_MERMAID_CHARS = 4000;

/** Strip fences, reject empty/oversized/unknown-type bodies; returns the clean Mermaid source or `null`. */
export function validateMermaid(raw: string): string | null {
	let body = stripCodeFences(raw).trim();
	body = body.replace(/^mermaid\s*\n/i, '').trim();
	if (body === '' || body.length > MAX_MERMAID_CHARS) return null;
	if ((body.match(/```/g) ?? []).length > 0) return null;
	if (/<\s*script\b|javascript:|<\s*iframe\b/i.test(body)) return null;
	const firstToken = body.split(/\s+/)[0] ?? '';
	if (!DIAGRAM_KEYWORDS.some((keyword) => firstToken === keyword || firstToken.startsWith(`${keyword} `))) return null;
	return body;
}

export function mermaidBlock(source: string): string {
	return ['```mermaid', source, '```'].join('\n');
}
