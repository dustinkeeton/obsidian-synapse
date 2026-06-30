import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PROPOSAL_KINDS } from './types';
import {
	SYNAPSE_COLOR_TOKENS,
	FEATURE_COLOR_TOKENS,
	cardClass,
	badgeClass,
	reviewPaneLabelClass,
	actionsGroupClass,
} from './proposal-styles';

/** styles.css lives at the repo root (two levels up from src/views/). */
const stylesCss = fs.readFileSync(path.resolve(__dirname, '../../styles.css'), 'utf8');

describe('semantic color tokens (#342)', () => {
	it('maps every proposal kind to its --synapse-color-* token', () => {
		for (const kind of PROPOSAL_KINDS) {
			expect(SYNAPSE_COLOR_TOKENS[kind]).toBe(`--synapse-color-${kind}`);
		}
	});

	it('has exactly one token entry per proposal kind (no extras, no gaps)', () => {
		expect(Object.keys(SYNAPSE_COLOR_TOKENS).sort()).toEqual([...PROPOSAL_KINDS].sort());
	});

	it('declares every proposal-kind token in styles.css', () => {
		for (const token of Object.values(SYNAPSE_COLOR_TOKENS)) {
			expect(stylesCss).toContain(`${token}:`);
		}
	});

	it('declares every feature token in styles.css (sidebar coverage)', () => {
		for (const token of Object.values(FEATURE_COLOR_TOKENS)) {
			expect(stylesCss).toContain(`${token}:`);
		}
	});

	it('feature tokens are a superset of proposal-kind tokens', () => {
		// Every proposal kind that is also a feature must point at the same token.
		for (const kind of PROPOSAL_KINDS) {
			if (kind in FEATURE_COLOR_TOKENS) {
				expect(FEATURE_COLOR_TOKENS[kind as keyof typeof FEATURE_COLOR_TOKENS]).toBe(
					SYNAPSE_COLOR_TOKENS[kind]
				);
			}
		}
	});
});

describe('class-name helpers (#342)', () => {
	it('cardClass returns the kind modifier', () => {
		expect(cardClass('elaboration')).toBe('synapse-card--elaboration');
		expect(cardClass('deep-dive')).toBe('synapse-card--deep-dive');
	});

	it('badgeClass returns the kind modifier', () => {
		expect(badgeClass('rem')).toBe('synapse-badge--rem');
		expect(badgeClass('title')).toBe('synapse-badge--title');
	});

	it('reviewPaneLabelClass returns the kind modifier', () => {
		expect(reviewPaneLabelClass('organize')).toBe('synapse-review-pane-label--organize');
		expect(reviewPaneLabelClass('enrichment')).toBe('synapse-review-pane-label--enrichment');
	});

	it('actionsGroupClass returns the feature modifier', () => {
		expect(actionsGroupClass('video')).toBe('synapse-actions-group--video');
		expect(actionsGroupClass('main')).toBe('synapse-actions-group--main');
	});

	it('produces card/badge/label classes for every kind, and styles.css defines each', () => {
		for (const kind of PROPOSAL_KINDS) {
			expect(stylesCss).toContain(`.${cardClass(kind)}`);
			expect(stylesCss).toContain(`.${badgeClass(kind)}`);
			expect(stylesCss).toContain(`.${reviewPaneLabelClass(kind)}`);
		}
	});
});

describe('title collision styles (#414)', () => {
	it('defines the previously-dead conflict classes so the callout actually renders', () => {
		// Regression guard for #414: `.synapse-title-conflict` shipped with zero
		// rules, so the collision hint rendered as ordinary muted text. The callout
		// box, its heading, body, and the Conflict badge modifier must all exist.
		expect(stylesCss).toContain('.synapse-title-conflict {');
		expect(stylesCss).toContain('.synapse-title-conflict-heading');
		expect(stylesCss).toContain('.synapse-title-conflict-body');
		expect(stylesCss).toContain('.synapse-badge--conflict');
	});
});
