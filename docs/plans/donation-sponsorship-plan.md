# Donation & Sponsorship Support — Plan

**Date**: 2026-06-11
**Status**: Proposed — for maintainer review
**Issue**: [#13](https://github.com/dustinkeeton/obsidian-synapse/issues/13)
**Scope**: Planning only. This document changes no code or configuration. It recommends a strategy and shows exactly what a follow-up implementation would do.

---

## Recommendation at a glance

> **Offer two channels: GitHub Sponsors (primary) and Buy Me a Coffee (secondary).**
> Surface them through Obsidian's native `fundingUrl` manifest field and a `.github/FUNDING.yml`, plus one tasteful README "Support" section. No in-app prompts, toasts, or nags — the link sits where users look *after* they are already satisfied, never mid-task.

| | |
|---|---|
| **Primary** | GitHub Sponsors — 0% platform fee on personal accounts, native "Sponsor" button, supports one-time and recurring |
| **Secondary** | Buy Me a Coffee — lowest-friction one-time tip, the most common platform in the Obsidian ecosystem |
| **Surfaced via** | `manifest.json` `fundingUrl` (covers both the community-plugin list **and** the settings panel automatically) + `.github/FUNDING.yml` + README badge |
| **Explicitly not now** | Patreon, Open Collective (wrong shape for a solo, free plugin) |

---

## Why this, why now

Synapse is free and open source. As adoption grows, users who find it valuable should have a clear, optional path to support continued development — this is standard practice for Obsidian plugins and helps sustain the project. Today the repository has **no** `.github/FUNDING.yml`, no `fundingUrl` in `manifest.json`, and no support link in the README. This plan closes that gap tastefully.

Two principles shape every recommendation below:

1. **The user is the threshold.** Synapse's whole model is *propose, the user decides*. A donation ask is the same: presented once, never forced, never interrupting work.
2. **Match the ecosystem.** Obsidian users already recognize a small set of funding patterns. Meeting that expectation is more effective — and less intrusive — than inventing a new one.

---

## 1. Platform comparison

Fees verified June 2026. Platforms change terms (Patreon overhauled its pricing in August 2025), so **confirm current rates at signup**. Unless noted, all platforms also pass through the payment processor's fee (~2.9% + $0.30 per transaction); GitHub Sponsors absorbs this for personal accounts.

| Platform | Platform fee | Recurring | One-time | Payout | Supporter needs | Dev-ecosystem fit | Used by Obsidian plugins? |
|---|---|---|---|---|---|---|---|
| **GitHub Sponsors** | **0%** (personal accounts) | ✅ | ✅ | Stripe Connect, monthly, ~$100 min threshold; first payout ~60 days | GitHub account | **High** — native repo button, dev-trusted | **Common** |
| **Buy Me a Coffee** | 5% | ✅ (memberships) | ✅ ("coffees") | Instant or weekly (Stripe/PayPal) | None (card) | Medium | **Most common** |
| **Ko-fi** | **0%** on donations (free tier); Gold tier $6/mo removes other fees¹ | ✅ (memberships) | ✅ | Instant (PayPal/Stripe) | None (card) | Medium | Common (2nd tier) |
| **Patreon** | 8–10% (10% for pages created after Aug 2025) | ✅ (core model) | ⚠️ limited | Monthly | Patreon account | Low for tools | **Not observed** |
| **Open Collective** | ~5% platform + fiscal-host fee (Open Source Collective ~10%) | ✅ | ✅ | Expense/invoice approval flow | None (card) | Medium (teams/orgs) | Rare |
| **PayPal** (link only) | 0% platform (processing only) | ⚠️ | ✅ | To PayPal balance | PayPal/card | Low (no discovery) | Common as a secondary `custom:` link |

¹ Ko-fi's headline is 0% platform fee on one-time donations (free tier). Some third-party 2026 comparisons report a 5% free-tier fee on donations/memberships, removable with Ko-fi Gold ($6/mo). The discrepancy is exactly why rates should be re-checked at signup.

### Quick read per platform

- **GitHub Sponsors** — Best economics (keep ~100% on personal accounts) and the best fit for a developer-facing audience already on GitHub. Renders a one-click **Sponsor** button on the repo. Supports both monthly tiers and one-time amounts. Trade-off: payout requires Stripe Connect and clears monthly above a ~$100 threshold, and the supporter needs a GitHub account.
- **Buy Me a Coffee** — The path of least resistance for a casual one-time tip; no account required for the supporter, instant/weekly payouts, friendly "buy a coffee" framing. The 5% fee is the cost of that reach. This is the single most common platform across the plugins surveyed below.
- **Ko-fi** — Functionally the fee-minimizing twin of Buy Me a Coffee (0% on donations, free tier). A reasonable swap for Buy Me a Coffee if fee avoidance matters more than matching the most common ecosystem default.
- **Patreon** — Membership-first and the most expensive (8–10%). Overkill for a free plugin with no gated content, and **not used by any Obsidian plugin surveyed**. Not recommended.
- **Open Collective** — Built for *collectives*: transparent shared budgets, fiscal hosting, multi-maintainer accountability. Adds host fees and process for benefits a solo maintainer does not need yet. Revisit only if Synapse grows into a funded multi-contributor project.
- **PayPal** — No platform fee and universally recognized, but it offers no discoverability or community surface on its own. Best role: an *optional* third `custom:` link, not a primary channel.

### Obsidian community norms (evidence)

A survey of 14 popular Obsidian plugins (raw `FUNDING.yml`, `manifest.json` `fundingUrl`, and README badges) shows a clear, narrow convention:

| Platform | Plugins using it (of those with any funding) |
|---|---|
| Buy Me a Coffee | 6 — Dataview, Calendar, Periodic Notes, Advanced Tables, QuickAdd, Recent Files |
| GitHub Sponsors | 6 — Templater, Tasks, Advanced Tables, Omnisearch, Recent Files, … |
| PayPal | 6 — Templater, Dataview, Calendar, Periodic Notes, Advanced Tables, Recent Files |
| Ko-fi | 4 — Templater, Excalidraw, Omnisearch, Homepage |
| Patreon | **0** |

Takeaways:

- **GitHub Sponsors + Buy Me a Coffee + PayPal is the de-facto "starter set."** Ko-fi is the common single-platform alternative. **Patreon is effectively absent** despite appearing in Obsidian's own docs example.
- The most consistent setups (e.g. `tgrosinger`'s Advanced Tables / Recent Files) mirror the **same** platforms across both `FUNDING.yml` and `fundingUrl` — GitHub Sponsors + Buy Me a Coffee + PayPal.
- Single-platform plugins use the **string** form of `fundingUrl`; multi-platform plugins use the **object** (labeled) form.

---

## 2. Two delivery mechanisms (they are different)

Donation visibility comes from two independent fields. The plan uses both, kept in sync.

| Mechanism | File | What it drives | Audience |
|---|---|---|---|
| **GitHub Sponsor button** | `.github/FUNDING.yml` | The "Sponsor" button on the GitHub repo page and sidebar | People browsing the source on GitHub |
| **Obsidian support link** | `manifest.json` `fundingUrl` | A heart/support link **in the community-plugin list and in the plugin's settings**, rendered by Obsidian | People who installed the plugin inside Obsidian |

The key insight: the issue lists "plugin settings panel" and "community plugin listing metadata" as *separate* integration points, but **a single `fundingUrl` field satisfies both** — Obsidian generates the link in each location automatically. There is no need to hand-build a settings button.

`fundingUrl` accepts either a single URL string or an object of labeled URLs ([Obsidian manifest docs](https://docs.obsidian.md/Reference/Manifest)). We use the object form so both channels appear with clear labels.

---

## 3. Integration points (concrete)

Below is exactly what a follow-up implementation issue would add. **Handles in code blocks are placeholders** — the maintainer fills in real account names when the GitHub Sponsors / Buy Me a Coffee profiles are created. The GitHub Sponsors target derives from the project's existing public author handle (`dustinkeeton`).

### a) `.github/FUNDING.yml` — GitHub "Sponsor" button

```yaml
# .github/FUNDING.yml
github: [dustinkeeton]
custom: ["https://www.buymeacoffee.com/<bmc-handle>"]
```

- `github:` accepts up to four usernames; `custom:` accepts up to four URLs (URLs containing colons must be quoted).
- This is what makes the **Sponsor** button appear on the repo.

### b) `manifest.json` `fundingUrl` — in-Obsidian support link

```json
{
  "fundingUrl": {
    "GitHub Sponsors": "https://github.com/sponsors/dustinkeeton",
    "Buy Me a Coffee": "https://www.buymeacoffee.com/<bmc-handle>"
  }
}
```

- Added alongside the existing `manifest.json` fields (`id`, `name`, `version`, …).
- Obsidian renders these labels as support links in **both** the community-plugin list and the plugin's settings — no extra UI code required.
- Object keys are free text; keep them exactly `"GitHub Sponsors"` and `"Buy Me a Coffee"` for clarity.

### c) README — one "Support" section

Placement: **near the bottom**, after Features / Install / Usage — never in the hero banner. A single section with two badges:

```markdown
## Support

Synapse is free and open source. If it has earned a place in your workflow,
you can support continued development:

[![Sponsor on GitHub](https://img.shields.io/badge/Sponsor-GitHub-8b5cf6?logo=github)](https://github.com/sponsors/dustinkeeton)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-5b21b6?logo=buymeacoffee&logoColor=white)](https://www.buymeacoffee.com/<bmc-handle>)
```

(Badge colors above use the brand violets — Synapse Violet `#8b5cf6` and Threshold Violet `#5b21b6` — so the section reads as part of the identity rather than stock badge clutter.)

### d) Settings panel (optional, non-intrusive)

Obsidian already renders the `fundingUrl` link in settings, so a manual control is **optional**. If a dedicated line is wanted, add a single static row at the **bottom** of the existing settings — in an "About" group, below all functional settings — never a banner, never a callout, never a button that pulses or animates:

> **About** — Synapse is free and open source.
> Support development → GitHub Sponsors · Buy Me a Coffee

No counters ("you've run 50 elaborations…"), no time-delayed reveal, no dismissable notice that reappears.

### e) Obsidian community listing metadata

Covered entirely by (b). When the listing/manifest carries `fundingUrl`, the directory entry shows the support affordance. Nothing additional to do.

---

## 4. Tone & placement guidelines

Written to the [Synapse brand voice](../../.claude/skills/brand-guidelines/SKILL.md): charged not hyped, precise, deferential at the threshold, dry warmth. The donation ask is held to the same bar as any other Synapse surface.

### Placement rules

- **Never interrupt a task.** No modal, no toast, no notice triggered by usage count or elapsed time. The firing model is *the user is the threshold* — a money prompt that fires on its own breaks that contract.
- **Set it once.** Configure the static links and stop. A support link the user can find is generous; a support link that finds the user is nagging.
- **Place it where satisfaction lives.** Settings "About" (bottom), README "Support" (bottom), GitHub sidebar. These are read by people who are *already* getting value — exactly the right moment, with zero pressure.
- **One ask, not three.** Two channels, presented together, once per surface. No stacking of every platform "just in case."

### Copy rules (brand voice)

- **Name treatment:** always **Synapse** — capital S, one word. Never "Synapse AI", "the Synapse", or all-caps. (The deferential safety model is the point; do not append "AI".)
- **No exclamation points, no emoji, no guilt.** "It really helps!! ❤️" is banned by voice rules 1 and 5.
- **State the mechanism plainly.** "free and open source", "support continued development" — precise, understated, true.
- **Don't anthropomorphize or beg.** No "help me keep the lights on", no sad-puppy framing.

### Example copy — do / don't

| | Copy |
|---|---|
| ✅ **Do** (README / settings) | *"Synapse is free and open source. If it has earned a place in your workflow, you can support continued development."* |
| ✅ **Do** (compact settings line) | *"Support development → GitHub Sponsors · Buy Me a Coffee"* |
| ❌ **Don't** (hype + emoji + pressure) | *"❤️ Enjoying Synapse?! Buy me a coffee — it really helps!!!"* — exclamation, emoji, guilt; violates voice rules 1 & 5 |
| ❌ **Don't** (interrupting toast) | A notice after every 50 elaborations: *"You've used Synapse a lot — consider donating."* — fires on its own; breaks the threshold model |
| ❌ **Don't** (wrong name) | *"Support Synapse AI development"* — never append "AI"; never all-caps the name |

---

## 5. Recommendation & rationale

**Adopt GitHub Sponsors (primary) + Buy Me a Coffee (secondary), surfaced via `fundingUrl` (object form) and `.github/FUNDING.yml`, plus one README "Support" section.**

### Why this pairing

- **GitHub Sponsors carries the best economics and trust.** 0% platform fee on personal accounts means ~100% reaches the developer. The audience for a power-user Obsidian plugin skews technical and is already on GitHub; the native Sponsor button meets them where they are, and it supports both one-time and recurring support. The Sponsors target also derives cleanly from the project's existing public author identity (`dustinkeeton`).
- **Buy Me a Coffee removes friction for everyone else.** Not every supporter has — or wants to use — a GitHub account. Buy Me a Coffee is the single most common Obsidian-plugin platform, needs nothing from the supporter, pays out fast, and frames a one-time tip in low-stakes terms. The 5% fee buys that reach.
- **Together they cover both supporter types** (recurring/dev-native vs. one-time/casual) without choice overload, and they mirror the most consistent, proven setup in the ecosystem.
- **`fundingUrl` does double duty.** One manifest field lights up both the settings panel and the community listing, so the in-app footprint stays minimal and fully native.

### Pros / cons of the recommendation

| Pros | Cons / trade-offs |
|---|---|
| Best fee profile available (GitHub Sponsors ~0%) | GitHub Sponsors payout needs Stripe Connect + ~$100 monthly threshold (first payout ~60 days) |
| Matches the dominant Obsidian convention; nothing exotic for users to learn | Two accounts to create and maintain |
| One-time **and** recurring both covered | Buy Me a Coffee's 5% fee on tips routed through it |
| Minimal, fully native in-app surface via `fundingUrl` | Requires creating/verifying the Buy Me a Coffee profile before launch |
| Brand-consistent, non-intrusive placement | — |

### Why not the others

- **Patreon** — Membership-first, 8–10% fees, zero presence in the Obsidian ecosystem. Wrong model for a free plugin with no gated tiers.
- **Open Collective** — Built for transparent multi-contributor budgets with fiscal hosting; adds fees and process a solo maintainer does not need. Reconsider only if Synapse becomes a funded team project.
- **Ko-fi** — A perfectly good, lower-fee alternative to Buy Me a Coffee. If fee-minimization outweighs matching the most common default, **swap Buy Me a Coffee → Ko-fi** with no other change to this plan.
- **PayPal-only** — No discoverability surface. Fine to add later as an *optional* third `custom:` link, not as a primary channel.

---

## 6. Risks & considerations

- **Account setup precedes any merge.** The GitHub Sponsors profile (Stripe Connect, tax/identity verification) and Buy Me a Coffee profile must exist before the links go live, or they 404. Implementation should be gated on real handles.
- **Fee terms drift.** Re-verify rates at signup (see the June 2026 caveat above).
- **Keep the two files in sync.** If a platform is added or removed, update **both** `.github/FUNDING.yml` and `manifest.json` `fundingUrl`.
- **Scope creep into nagging.** The biggest risk is not the platform choice but the placement. Hold the line on "no usage-triggered prompts."

---

## 7. Out of scope (for a follow-up implementation issue)

This document is the deliverable for [#13](https://github.com/dustinkeeton/obsidian-synapse/issues/13). It intentionally **does not** change any files. A separate implementation issue, once the maintainer approves and the accounts exist, would:

1. Add `.github/FUNDING.yml` (section 3a).
2. Add `fundingUrl` to `manifest.json` and bump `versions.json` if needed (section 3b).
3. Add the README "Support" section with brand-violet badges (section 3c).
4. (Optional) Add the static "About → Support" line at the bottom of the settings panel (section 3d).
5. Replace all `<bmc-handle>` placeholders with the real Buy Me a Coffee handle and confirm the GitHub Sponsors URL resolves.

---

## Sources

- [Obsidian — Manifest reference (`fundingUrl`)](https://docs.obsidian.md/Reference/Manifest)
- [GitHub — Displaying a sponsor button (`FUNDING.yml` keys)](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/displaying-a-sponsor-button-in-your-repository)
- [GitHub — About sponsorships, fees, and taxes](https://docs.github.com/en/sponsors/sponsoring-open-source-contributors/about-sponsorships-fees-and-taxes)
- [GitHub Sponsors billing](https://docs.github.com/en/billing/concepts/third-party-payments/github-sponsors)
- [Patreon vs Ko-fi vs Buy Me a Coffee — fee comparison](https://alitu.com/creator/content-creation/patreon-vs-ko-fi-vs-buy-me-a-coffee/)
- [Ko-fi vs Buy Me a Coffee (2026)](https://talks.co/p/kofi-vs-buy-me-a-coffee/)
- [Open Collective — Fees](https://docs.oscollective.org/how-it-works/fees)
- Obsidian plugin funding survey (June 2026): raw `FUNDING.yml` / `manifest.json` / README for Dataview, Templater, Excalidraw, Tasks, Calendar, Periodic Notes, Kanban, Style Settings, Advanced Tables, QuickAdd, Omnisearch, Iconize, Recent Files, Homepage.
