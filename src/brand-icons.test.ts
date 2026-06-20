import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { addIcon } from 'obsidian';
import { SYNAPSE_ICONS, SYNAPSE_ICON_SVG, registerSynapseIcons } from './brand-icons';
import { COMMAND_REGISTRY, FEATURE_ICONS, resolveActionIcon } from './commands';

const registeredNames = () => new Set(Object.keys(SYNAPSE_ICONS));

const BRAND_DIR = join(process.cwd(), 'assets', 'brand');
/** Normalized inner content of an asset SVG (strip the <svg> wrapper, collapse whitespace). */
const assetInner = (file: string): string =>
	readFileSync(join(BRAND_DIR, file), 'utf8')
		.replace(/^[\s\S]*?<svg[^>]*>/, '')
		.replace(/<\/svg>[\s\S]*$/, '')
		.replace(/\s+/g, ' ')
		.trim();
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

describe('brand-icons', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('registers every glyph body via addIcon', () => {
		registerSynapseIcons();
		const names = Object.keys(SYNAPSE_ICONS);
		expect((addIcon as ReturnType<typeof vi.fn>).mock.calls.length).toBe(names.length);
		for (const name of names) {
			expect(addIcon).toHaveBeenCalledWith(name, SYNAPSE_ICONS[name]);
		}
	});

	it('keeps the synapse identity mark byte-synced with SYNAPSE_ICON_SVG', () => {
		expect(SYNAPSE_ICONS.synapse).toBe(SYNAPSE_ICON_SVG);
	});

	it('stays in sync with the authored SVG assets in assets/brand/', () => {
		// synapse mirrors icon-mono.svg; every other glyph mirrors glyphs/<name>.svg.
		expect(norm(SYNAPSE_ICONS.synapse), 'icon-mono.svg').toBe(assetInner('icon-mono.svg'));
		for (const name of Object.keys(SYNAPSE_ICONS)) {
			if (name === 'synapse') continue;
			expect(norm(SYNAPSE_ICONS[name]), `glyphs/${name}.svg`).toBe(assetInner(`glyphs/${name}.svg`));
		}
	});

	it('draws every glyph as a non-empty currentColor silhouette with no baked palette color', () => {
		for (const [name, body] of Object.entries(SYNAPSE_ICONS)) {
			expect(body, name).toBeTruthy();
			// Color comes from the host UI (mono ribbon/palette, CSS tint in the
			// sidebar) — the bodies must use currentColor and never a hardcoded hex.
			expect(body, name).toContain('currentColor');
			expect(body.includes('#'), `${name} must not bake a hex color`).toBe(false);
		}
	});

	it('registers a glyph for every active palette action (feature default or override)', () => {
		const names = registeredNames();
		for (const entry of COMMAND_REGISTRY) {
			if (entry.status !== 'active' || !entry.flows.includes('palette')) continue;
			const icon = resolveActionIcon(entry);
			expect(icon, entry.id).toBeTruthy();
			expect(names.has(icon), `${entry.id} -> ${icon} is not a registered glyph`).toBe(true);
		}
	});

	it('registers a glyph for every feature default', () => {
		const names = registeredNames();
		for (const [feature, icon] of Object.entries(FEATURE_ICONS)) {
			expect(names.has(icon), `${feature} -> ${icon} is not a registered glyph`).toBe(true);
		}
	});

	it('registers a glyph for every per-action icon override in the registry', () => {
		const names = registeredNames();
		for (const entry of COMMAND_REGISTRY) {
			if (!entry.icon) continue;
			expect(names.has(entry.icon), `${entry.id} -> ${entry.icon} is not a registered glyph`).toBe(true);
		}
	});
});
