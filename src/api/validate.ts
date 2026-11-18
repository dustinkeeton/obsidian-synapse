import { VERB_DEFINITIONS } from './capabilities';

type Schema = Record<string, unknown>;

function typeError(value: unknown, schema: Schema, at: string): string | null {
	switch (schema.type) {
		case 'string': return typeof value === 'string' ? null : `${at} must be a string`;
		case 'boolean': return typeof value === 'boolean' ? null : `${at} must be true or false`;
		case 'integer': return Number.isInteger(value) ? null : `${at} must be an integer`;
		case 'array': return Array.isArray(value) ? null : `${at} must be an array`;
		case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value) ? null : `${at} must be an object`;
		default: return null;
	}
}

/** Checks the JSON Schema subset `VERB_DEFINITIONS` uses: type, enum, minimum, maximum, properties, required, additionalProperties: false, items, oneOf. */
function check(value: unknown, schema: Schema, at: string): string | null {
	if (Array.isArray(schema.oneOf)) {
		const errors = (schema.oneOf as Schema[]).map((branch) => check(value, branch, at));
		return errors.includes(null) ? null : errors[0];
	}
	const wrongType = typeError(value, schema, at);
	if (wrongType) return wrongType;
	if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `${at} must be one of: ${schema.enum.join(', ')}`;
	if (typeof value === 'number') {
		if (typeof schema.minimum === 'number' && value < schema.minimum) return `${at} must be at least ${schema.minimum}`;
		if (typeof schema.maximum === 'number' && value > schema.maximum) return `${at} must be at most ${schema.maximum}`;
	}
	if (Array.isArray(value) && schema.items) {
		for (const [i, item] of value.entries()) {
			const error = check(item, schema.items as Schema, `${at}[${i}]`);
			if (error) return error;
		}
	}
	if (schema.type === 'object' && value && typeof value === 'object') {
		const properties = (schema.properties ?? {}) as Record<string, Schema>;
		const missing = ((schema.required ?? []) as string[]).find((key) => (value as Record<string, unknown>)[key] === undefined);
		if (missing) return `${at}.${missing} is required`;
		for (const [key, field] of Object.entries(value)) {
			if (!(key in properties)) {
				if (schema.additionalProperties === false) return `${at} has unknown option "${key}"`;
				continue;
			}
			if (field === undefined) continue;
			const error = check(field, properties[key], `${at}.${key}`);
			if (error) return error;
		}
	}
	return null;
}

/** First problem with a verb's positional arguments against its `VERB_DEFINITIONS` schemas; null when they are valid. */
export function validateArgs(verb: string, args: readonly unknown[]): string | null {
	const definition = VERB_DEFINITIONS.find((v) => v.name === verb);
	if (!definition) return `Unknown verb: ${verb}`;
	for (const [i, param] of definition.params.entries()) {
		const value = args[i];
		if (value === undefined) {
			if (param.required) return `${param.name} is required`;
			continue;
		}
		const error = check(value, param.schema, param.name);
		if (error) return error;
	}
	return null;
}
