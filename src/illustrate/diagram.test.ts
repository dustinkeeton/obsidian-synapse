import { describe, it, expect } from 'vitest';
import { validateMermaid, mermaidBlock } from './diagram';

describe('validateMermaid', () => {
	it('accepts a bare flowchart body', () => {
		expect(validateMermaid('flowchart TD\n  A --> B')).toBe('flowchart TD\n  A --> B');
	});

	it('strips wrapping code fences and a leading mermaid tag', () => {
		expect(validateMermaid('```mermaid\nmindmap\n  root\n```')).toBe('mindmap\n  root');
		expect(validateMermaid('mermaid\ntimeline\n  2020 : a')).toBe('timeline\n  2020 : a');
	});

	it('rejects empty, unknown-type, and oversized bodies', () => {
		expect(validateMermaid('')).toBeNull();
		expect(validateMermaid('Here is a diagram: A --> B')).toBeNull();
		expect(validateMermaid('flowchart TD\n' + 'A --> B\n'.repeat(1000))).toBeNull();
	});

	it('rejects nested fences and script-like content', () => {
		expect(validateMermaid('flowchart TD\n```\nA')).toBeNull();
		expect(validateMermaid('flowchart TD\nA["<script>x</script>"]')).toBeNull();
		expect(validateMermaid('flowchart TD\nclick A "javascript:alert(1)"')).toBeNull();
	});

	it('accepts an xychart-beta body', () => {
		expect(validateMermaid('xychart-beta\n    title "T"\n    x-axis ["a"]\n    bar [1]')).not.toBeNull();
	});
});

describe('mermaidBlock', () => {
	it('wraps the source in a mermaid fence', () => {
		expect(mermaidBlock('flowchart TD\nA')).toBe('```mermaid\nflowchart TD\nA\n```');
	});
});
