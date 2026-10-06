export const meta = {
  name: 'audit-stage-2',
  description: 'Audit chain, stage 2 of 2: compliance, the docs skill, then security pass 2 — refuses to run past an un-signed-off stage 1 stop',
  whenToUse: 'Run after audit-stage-1 with args { stage1: <its result>, signedOff?: boolean, focus?: string }. If stage 1 stopped (stoppedAt set), a human reviews its findings first and this stage is run with signedOff: true; the prose audit skill is the fallback wherever workflows are unavailable.',
  phases: [
    { title: 'Compliance', detail: 'the project-specific compliance pass (Task 3) of the audit skill' },
    { title: 'Docs', detail: 'the docs skill, step by step: read-only change report → docs-agent → docs-human' },
    { title: 'Security 2', detail: 'security pass 2 (Task 5) of the audit skill — re-audits every change made above' },
  ],
}

// Sequencing only: every phase runs a section of the audit or docs skill, which stay the source of truth.
const AUDIT = '.claude/skills/audit/SKILL.md'
const DOCS = '.claude/skills/docs/SKILL.md'

const opts = args && typeof args === 'object' ? args : {}
const focus = typeof args === 'string' ? args.trim() : (typeof opts.focus === 'string' ? opts.focus.trim() : '')
const focusLine = focus ? ` Focus area: ${focus} — pay special attention to it while still performing the full pass.` : ''
const stage1 = opts.stage1 && typeof opts.stage1 === 'object' ? opts.stage1 : null
const signedOff = opts.signedOff === true

// The sign-off gate lives BETWEEN the two runs: a stopped stage 1 needs an explicit human override.
if (stage1 && stage1.stoppedAt && !signedOff) {
  return {
    refused: true,
    reason: `stage 1 stopped at ${stage1.stoppedAt} with Critical/High findings and this run was not signed off — a human reviews those findings, then re-runs audit-stage-2 with { stage1, signedOff: true }`,
  }
}
if (!stage1) log('no stage1 result supplied — running stage 2 without the architecture/security-1 context')

const FINDINGS = {
  type: 'object',
  required: ['findings', 'fixesApplied', 'severity'],
  properties: {
    findings: { type: 'array', items: { type: 'string' }, description: 'one line per finding, highest severity first' },
    fixesApplied: { type: 'array', items: { type: 'string' }, description: 'one line per fix actually applied ([] if report-only)' },
    severity: { enum: ['none', 'low', 'medium', 'high', 'critical'], description: 'the highest severity still OPEN after fixes' },
  },
}

phase('Compliance')
const compliance = await agent(
  `Run the obsidian compliance pass (Task 3) exactly as \`${AUDIT}\` documents it, including its "Agent Prompts" rules.${focusLine}`,
  { label: 'compliance', agentType: 'plugin-architect', schema: FINDINGS },
)

// The docs skill's three steps, in its order, each fed by the one before — mirrored here as
// sequencing only; every prompt is the skill's own.
phase('Docs')
const changeReport = await agent(
  `Run Step 1 (Architecture Audit) of \`${DOCS}\` exactly as it documents it — the read-only change report. Output ONLY the report; do NOT modify any files.${focusLine}`,
  { label: 'docs-change-report', agentType: 'lead-engineer' },
)
const machineDocs = await agent(
  `Run Step 2 (Agent Documentation) of \`${DOCS}\` exactly as it documents it, using the change report below as its step-1 output.${focusLine}\n\n` +
    (changeReport ? changeReport : '(the change report step returned nothing — derive the changes from the source itself)'),
  { label: 'docs-agent', agentType: 'docs-agent' },
)
const humanDocs = await agent(
  `Run Step 3 (Human Documentation) of \`${DOCS}\` exactly as it documents it — docs-agent has just completed.${focusLine}`,
  { label: 'docs-human', agentType: 'docs-human' },
)

phase('Security 2')
const security2 = await agent(
  `Run Security Pass 2 (Task 5) exactly as \`${AUDIT}\` documents it, including its "Agent Prompts" rules — every change made by stage 1, the compliance pass and the docs pipeline is in scope.${focusLine}`,
  { label: 'security-2', agentType: 'security-engineer', schema: FINDINGS },
)

return {
  refused: false,
  signedOff,
  compliance,
  docs: { changeReport, machineDocs, humanDocs },
  security2,
  next: 'Present the consolidated summary table from the audit skill ("Summary Format"): stage 1 covers rows 1–2, this result rows 3–5.',
}
