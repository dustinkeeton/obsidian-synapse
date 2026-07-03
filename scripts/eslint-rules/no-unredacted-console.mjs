/**
 * synapse/no-unredacted-console — type-aware ESLint rule enforcing the
 * redactError() contract on console sinks (#418).
 *
 * Contract (see src/shared/redact.ts): redact.ts is the single source of truth
 * for secret redaction. `redactSecrets()` only operates on strings, so logging
 * an `Error`/object directly (`console.error(label, err)`) bypasses redaction —
 * a secret echoed into the error's `message`/`stack` would reach the console
 * verbatim. Every raw-error console sink must go through `redactError()`.
 *
 * What this rule enforces: every value reaching a `console.*` logging call must
 * be statically string-like (string/number/boolean/enum/null/undefined). This
 * is checked at the top level of each argument, inside template-literal
 * substitutions, and on both sides of `+` concatenation. `redactError()` and
 * `redactSecrets()` return `string`, so sanctioned call sites pass naturally —
 * no allowlist of function names exists to drift or be spoofed.
 *
 * Additional tightenings (stringification is not redaction):
 *  - `String(err)` / `JSON.stringify(err)` of a non-string-like value is
 *    flagged: the result is a string, but the secret survives verbatim.
 *  - Direct `.message` / `.stack` property access in a console argument is
 *    flagged even though its type is `string` — those are exactly the fields
 *    redactError() exists to scrub. Use `redactError(err)`; if the property is
 *    genuinely not error-derived, wrap it in `redactSecrets()` (correct for any
 *    string that might embed a secret) instead.
 *
 * Known residual gaps, accepted and consistent with what main already allows:
 *  - An error message aliased through a string variable
 *    (`const msg = err.message; console.warn(`... ${msg}`)`) type-checks as
 *    `string` and passes. Issue #418 scopes the contract to raw Error/object
 *    arguments; pre-existing `${msg}` interpolations are in-contract.
 *  - Explicit casts (`err as unknown as string`) are deliberate evasions left
 *    to code review.
 *
 * Requires type information: the config block enabling this rule must use the
 * typescript-eslint parser with `projectService` (see eslint.config.mjs). The
 * rule fails closed — it throws if type information is unavailable, so a parser
 * misconfiguration cannot silently disable the gate.
 */

import ts from 'typescript';

/** Console methods that write arguments to the log. */
const CONSOLE_METHODS = new Set([
	'error',
	'warn',
	'log',
	'info',
	'debug',
	'trace',
	'dir',
	'table',
]);

/**
 * Type flags considered safe to log: primitives whose printed form cannot
 * embed an unredacted Error message/stack or object dump. Unions are safe only
 * if every constituent is safe; `any`/`unknown`/objects/type params are not.
 */
const SAFE_TYPE_FLAGS =
	ts.TypeFlags.StringLike |
	ts.TypeFlags.NumberLike |
	ts.TypeFlags.BigIntLike |
	ts.TypeFlags.BooleanLike |
	ts.TypeFlags.EnumLike |
	ts.TypeFlags.Undefined |
	ts.TypeFlags.Null |
	ts.TypeFlags.Void |
	ts.TypeFlags.Never;

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require every value reaching a console sink to be string-like or routed through redactError()/redactSecrets() (src/shared/redact.ts)',
		},
		schema: [],
		messages: {
			rawValue:
				"Value of type '{{type}}' reaches a console sink unredacted — a secret inside an Error message/stack (or object field) would be logged verbatim. Route caught errors through redactError() and error-derived strings through redactSecrets() (src/shared/redact.ts).",
			stringified:
				"Stringifying a value of type '{{type}}' is not redaction — a secret inside it still reaches the console verbatim. Use redactError() (src/shared/redact.ts) instead of String()/JSON.stringify().",
			errorProp:
				'Logging .{{prop}} directly bypasses redaction — message/stack are exactly the fields a secret leaks through. Log redactError(err) instead (or wrap in redactSecrets() if this string is not error-derived).',
			unverifiable:
				'This console argument cannot be statically verified against the redactError() contract; pass explicit, string-like arguments.',
		},
	},

	create(context) {
		const services = context.sourceCode.parserServices;
		if (!services?.program || !services.esTreeNodeToTSNodeMap) {
			// Fail closed: without type information this gate would silently
			// stop guarding the contract.
			throw new Error(
				'synapse/no-unredacted-console requires type information — enable parserOptions.projectService with the typescript-eslint parser for the files this rule covers.'
			);
		}
		const checker = services.program.getTypeChecker();

		/** @param {import('typescript').Type} type */
		function isSafeType(type) {
			if (type.isUnion()) {
				return type.types.every(isSafeType);
			}
			return (type.flags & SAFE_TYPE_FLAGS) !== 0;
		}

		/** Report `node` unless its static type is safe to log. */
		function checkType(node, messageId) {
			const tsNode = services.esTreeNodeToTSNodeMap.get(node);
			const type = checker.getTypeAtLocation(tsNode);
			if (!isSafeType(type)) {
				context.report({
					node,
					messageId,
					data: { type: checker.typeToString(type) },
				});
			}
		}

		/** `String(x)` — the global converter, not a user function. */
		function isStringConversion(node) {
			return node.callee.type === 'Identifier' && node.callee.name === 'String';
		}

		/** `JSON.stringify(x)` */
		function isJsonStringify(node) {
			const c = node.callee;
			return (
				c.type === 'MemberExpression' &&
				!c.computed &&
				c.object.type === 'Identifier' &&
				c.object.name === 'JSON' &&
				c.property.type === 'Identifier' &&
				c.property.name === 'stringify'
			);
		}

		/**
		 * Validate an expression appearing in a console sink: recurse through
		 * the constructs whose static type hides their constituents (template
		 * literals type as `string`, `'x' + err` types as `string`, String()/
		 * JSON.stringify() return `string`), then type-check everything else.
		 */
		function checkExpression(node, messageId = 'rawValue') {
			switch (node.type) {
				case 'Literal':
					return;
				case 'TemplateLiteral':
					for (const expr of node.expressions) {
						checkExpression(expr, messageId);
					}
					return;
				case 'BinaryExpression':
					if (node.operator === '+') {
						checkExpression(node.left, messageId);
						checkExpression(node.right, messageId);
						return;
					}
					break;
				case 'CallExpression':
					if (isStringConversion(node) || isJsonStringify(node)) {
						for (const arg of node.arguments) {
							if (arg.type === 'SpreadElement') {
								context.report({ node: arg, messageId: 'unverifiable' });
							} else {
								checkExpression(arg, 'stringified');
							}
						}
						return;
					}
					break;
				case 'MemberExpression':
					if (
						!node.computed &&
						node.property.type === 'Identifier' &&
						(node.property.name === 'message' || node.property.name === 'stack')
					) {
						context.report({
							node,
							messageId: 'errorProp',
							data: { prop: node.property.name },
						});
						return;
					}
					break;
				default:
					break;
			}
			checkType(node, messageId);
		}

		return {
			CallExpression(node) {
				const callee = node.callee;
				if (
					callee.type !== 'MemberExpression' ||
					callee.computed ||
					callee.object.type !== 'Identifier' ||
					callee.object.name !== 'console' ||
					callee.property.type !== 'Identifier' ||
					!CONSOLE_METHODS.has(callee.property.name)
				) {
					return;
				}
				for (const arg of node.arguments) {
					if (arg.type === 'SpreadElement') {
						context.report({ node: arg, messageId: 'unverifiable' });
					} else {
						checkExpression(arg);
					}
				}
			},
		};
	},
};
