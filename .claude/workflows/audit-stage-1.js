export const meta = {
  name: 'audit-stage-1',
  description: 'Audit chain, stage 1 of 2: architecture pass, then security pass 1 — stops for human sign-off on Critical/High findings',
  whenToUse: 'The Claude-workflow variant of the audit skill. args is an optional focus string (or { focus }). Read the returned stoppedAt / signOffRequired before running audit-stage-2; the prose audit skill is the fallback wherever workflows are unavailable.',
  phases: [
    { title: 'Architecture', detail: 'the architecture pass (Task 1) of the audit skill — fixes structure directly' },
    { title: 'Security 1', detail: 'security pass 1 (Task 2) of the audit skill — severity-ranked findings, fixed where the role permits' },
  ],
}

// Sequencing only: every phase runs a section of the audit skill, which stays the source of truth.
const SKILL = '.claude/skills/audit/SKILL.md'

const focus = typeof args === 'string'
  ? args.trim()
  : (args && typeof args.focus === 'string' ? args.focus.trim() : '')
const focusLine = focus ? ` Focus area: ${focus} — pay special attention to it while still performing the full pass.` : ''

// `severity` is REQUIRED: a gate keyed on an optional field is decorative.
const FINDINGS = {
  type: 'object',
  required: ['findings', 'fixesApplied', 'severity'],
  properties: {
    findings: { type: 'array', items: { type: 'string' }, description: 'one line per finding, highest severity first' },
    fixesApplied: { type: 'array', items: { type: 'string' }, description: 'one line per fix actually applied ([] if report-only)' },
    severity: { enum: ['none', 'low', 'medium', 'high', 'critical'], description: 'the highest severity still OPEN after fixes' },
  },
}

phase('Architecture')
const architecture = await agent(
  `Run the Architecture pass (Task 1) exactly as \`${SKILL}\` documents it, including its "Agent Prompts" rules.${focusLine}`,
  { label: 'architecture', agentType: 'lead-engineer', schema: FINDINGS },
)

phase('Security 1')
const security1 = await agent(
  `Run Security Pass 1 (Task 2) exactly as \`${SKILL}\` documents it, including its "Agent Prompts" rules.${focusLine}`,
  { label: 'security-1', agentType: 'security-engineer', schema: FINDINGS },
)

// The prose skill's gate after pass 1 cannot ask mid-run, so it becomes a hard stop between the two
// stages: a skipped or dead security agent (null) must also stop — never fail open.
const HALT = ['high', 'critical']
const stoppedAt = security1 === null || HALT.includes(security1.severity) ? 'security-1' : null
if (stoppedAt) {
  log(security1 === null
    ? 'security pass 1 returned nothing — sign-off required before stage 2'
    : `security pass 1 left ${security1.severity} findings open — sign-off required before stage 2`)
}

return {
  stoppedAt,
  signOffRequired: stoppedAt !== null,
  architecture,
  security1,
  next: stoppedAt
    ? 'Present the security findings to the user. Do NOT run audit-stage-2 until a human has reviewed them; then run it with args { stage1: <this result>, signedOff: true }.'
    : 'No Critical/High findings. Run audit-stage-2 with args { stage1: <this result> } to finish the chain.',
}
