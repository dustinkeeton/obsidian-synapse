import { AIClient, isRecord, parseJson, stripCodeFences, wrapUntrusted } from '../shared';
import type { AIRequestOptions } from '../shared';
import type { SynapseSettings } from '../settings';
import { parseChartData } from './chart';
import { validateMermaid } from './diagram';
import type { IllustrateSpot } from './types';

const MAX_NOTE_CHARS = 12_000;

const SPOT_FIELDS = '"anchor":"<exact heading text, or the first 6-10 words of the paragraph>","caption":"<one sentence>","rationale":"<why a visual helps here>"';

const PHOTO_PROMPT = `You decide where a note would benefit from a reference photo. Respond with JSON only.

Schema:
{"spots":[{"kind":"photo",${SPOT_FIELDS},
  "query":"<2-5 word image search terms>"}]}

Rules:
- Only propose a photo where it materially aids understanding; an empty list is a valid answer.
- A photo is a real reference photograph of a concrete subject (place, organism, object, person, artifact). Never for abstract ideas.
- "anchor" must be copied verbatim from the note so it can be located.
- Skip spots that already have an image, embed, or Mermaid block beneath them.`;

const FULL_PROMPT = `You decide where a note would benefit from a visual and what kind. Respond with JSON only.

Schema:
{"spots":[{"kind":"photo"|"diagram"|"chart",${SPOT_FIELDS},
  "query":"<2-5 word image search terms, photo only>",
  "mermaid":"<complete Mermaid source (flowchart, mindmap, timeline, sequenceDiagram), diagram only>",
  "chart":{"title":"","xLabels":[],"series":[{"label":"","values":[]}],"yLabel":""} (chart only)}]}

Rules:
- Only propose a visual where it materially aids understanding; an empty list is a valid answer.
- "photo": a real reference photograph of a concrete subject (place, organism, object, person, artifact). Never for abstract ideas.
- "diagram": a conceptual relationship, process, hierarchy, or sequence already described in the text.
- "chart": ONLY when the note itself contains the numbers; copy them exactly, never invent or estimate data.
- "anchor" must be copied verbatim from the note so it can be located.
- Skip spots that already have an image, embed, or Mermaid block beneath them.`;

export interface ParseSpotsOptions {
	/** False drops `diagram`/`chart` spots the model emits anyway (illustrate.mermaid off). */
	mermaid?: boolean;
}

/** System prompt for the run: Mermaid off asks for photos only. */
export function buildSystemPrompt(mermaid: boolean): string {
	return mermaid ? FULL_PROMPT : PHOTO_PROMPT;
}

function pickSpot(value: unknown): IllustrateSpot | null {
	if (!isRecord(value)) return null;
	const { kind, anchor, caption, rationale } = value;
	if (typeof anchor !== 'string' || anchor.trim() === '') return null;
	if (typeof caption !== 'string' || caption.trim() === '') return null;
	const base = {
		anchor: anchor.trim(),
		caption: caption.trim(),
		rationale: typeof rationale === 'string' ? rationale.trim() : '',
	};
	if (kind === 'photo') {
		const query = typeof value.query === 'string' ? value.query.trim() : '';
		return query === '' ? null : { ...base, kind, query };
	}
	if (kind === 'diagram') {
		const mermaid = typeof value.mermaid === 'string' ? validateMermaid(value.mermaid) : null;
		return mermaid === null ? null : { ...base, kind, mermaid };
	}
	if (kind === 'chart') {
		const chart = parseChartData(value.chart);
		return chart === null ? null : { ...base, kind, chart };
	}
	return null;
}

/** Narrow an AI response into validated spots; malformed entries are dropped, not thrown. */
export function parseSpots(response: string, maxSpots: number, options: ParseSpotsOptions = {}): IllustrateSpot[] {
	const allowMermaid = options.mermaid ?? true;
	const text = stripCodeFences(response);
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start === -1 || end <= start) return [];
	let parsed: unknown;
	try {
		parsed = parseJson(text.slice(start, end + 1));
	} catch {
		return [];
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.spots)) return [];
	const spots: IllustrateSpot[] = [];
	const seenAnchors = new Set<string>();
	for (const entry of parsed.spots as unknown[]) {
		const spot = pickSpot(entry);
		if (!spot || seenAnchors.has(spot.anchor)) continue;
		if (!allowMermaid && spot.kind !== 'photo') continue;
		seenAnchors.add(spot.anchor);
		spots.push(spot);
		if (spots.length >= maxSpots) break;
	}
	return spots;
}

export class NoteAnalyzer {
	private ai: AIClient;

	constructor(private getSettings: () => SynapseSettings) {
		this.ai = new AIClient(getSettings);
	}

	async analyze(notePath: string, body: string, opts?: AIRequestOptions): Promise<IllustrateSpot[]> {
		const { maxItemsPerNote: max, mermaid } = this.getSettings().illustrate;
		const prompt = [
			`Propose at most ${max} ${mermaid ? 'visuals' : 'photos'} for the note "${notePath}".`,
			'',
			wrapUntrusted(body.slice(0, MAX_NOTE_CHARS), 'note'),
		].join('\n');
		const response = await this.ai.complete(prompt, buildSystemPrompt(mermaid), opts);
		return parseSpots(response, max, { mermaid });
	}
}
