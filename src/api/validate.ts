import { VERB_DEFINITIONS } from './capabilities';

type Schema = Record<string, unknown>;

function typeError(value: unknown, schema: Schema, at: string): string | null {
	if (Array.isArray(schema.type)) {
		const types = schema.type as string[];
		if (value === null && types.includes('null')) return null;
		return types.some((type) => type !== 'null' && typeError(value, { type }, at) === null) ? null : `${at} must be ${types.join(' or ')}`;
	}
	switch (schema.type) {
		case 'string': return typeof value === 'string' ? null : `${at} must be a string`;
		case 'boolean': return typeof value === 'boolean' ? null : `${at} must be true or false`;
		case 'integer': return Number.isInteger(value) ? null : `${at} must be an integer`;
		case 'number': return typeof value === 'number' ? null : `${at} must be a number`;
		case 'null': return value === null ? null : `${at} must be null`;
		case 'array': return Array.isArray(value) ? null : `${at} must be an array`;
		case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value) ? null : `${at} must be an object`;
		default: return null;
	}
}

/** Checks the JSON Schema subset `VERB_DEFINITIONS` uses: type (one or a list), enum, minimum, maximum, properties, required, additionalProperties: false, items, oneOf. */
export function checkSchema(value: unknown, schema: Schema, at: string): string | null {
	if (Array.isArray(schema.oneOf)) {
		const branches = schema.oneOf as Schema[];
		const errors = branches.map((branch) => checkSchema(value, branch, at));
		if (errors.includes(null)) return null;
		// Report against a branch of the value's own type, so `{ proposalId: 1 }` hears about proposalId, not "must be a string".
		const sameType = branches.findIndex((branch) => typeError(value, branch, at) === null);
		return errors[sameType === -1 ? 0 : sameType];
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
			const error = checkSchema(item, schema.items as Schema, `${at}[${i}]`);
			if (error) return error;
		}
	}
	const types = Array.isArray(schema.type) ? schema.type : [schema.type];
	if (types.includes('object') && value !== null && typeof value === 'object' && !Array.isArray(value)) {
		const properties = (schema.properties ?? {}) as Record<string, Schema>;
		const missing = ((schema.required ?? []) as string[]).find((key) => (value as Record<string, unknown>)[key] === undefined);
		if (missing) return `${at}.${missing} is required`;
		for (const [key, field] of Object.entries(value)) {
			if (!Object.prototype.hasOwnProperty.call(properties, key)) {
				if (schema.additionalProperties === false) return `${at} has unknown option "${key}"`;
				continue;
			}
			if (field === undefined) continue;
			const error = checkSchema(field, properties[key], `${at}.${key}`);
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
		const error = checkSchema(value, param.schema, param.name);
		if (error) return error;
	}
	return null;
}
