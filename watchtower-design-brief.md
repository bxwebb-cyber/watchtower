# Watchtower — Landing Site Design Brief

## The one-liner
Dark, calm, and warm: a near-black sea at night, with the woodcut lighthouse as the single glowing point of light. "We keep watch so you don't have to."

## Reference aesthetic (what to lift from the screenshot)
The attached screenshot is a dark, desaturated, minimal tool UI. Lift its DISCIPLINE, not its colors:

- Near-black base, no pure white anywhere.
- Surfaces are desaturated and slightly lighter than the base, separated by faint borders (low-opacity white), not heavy shadows or cards.
- Monochrome iconography: light-gray/white strokes on dark, one icon = one idea.
- ONE saturated accent color, used sparingly (the screenshot's cyan — we replace it, see below).
- Clean grid, generous whitespace, small precise type, everything aligned to a strict axis.
- No glassmorphism, no gradient wash, no rainbow, no oversized rounded rectangles used as fake hierarchy.

## The brand (LOCKED — do not drift)
- Mascot: a woodcut / tattoo-flash lighthouse — bold black ink linework, red-and-white striped tower, kind face, tiny waves + sailboat at base, warm glowing lantern, small flag. Hand-drawn, NOT Sanrio-kawaii, NOT flat vector, NOT 3D.
  - Final asset: ~/Desktop/watchtower-mascot-v5-woodcut-noboat.png (no boat)
  - Animated beam: ~/Desktop/watchtower-lighthouse-beam.gif (rotating beam + lantern pulse)
- Tagline (locked): "We keep watch so you don't have to."
- Tone: warm, calm, trustworthy. NEVER threatening, NEVER debt-collector, NEVER corporate.
- Product truth: it's an invoice-reminder agent. It reminds BEFORE an invoice is late, applies the late fee the owner already agreed to, and keeps the proof.

## The reconciliation (the whole concept)
The screenshot is cool blue-gray + cyan. We swap the coolness for warmth, and the metaphor does the rest:

- A lighthouse keeps watch through the night so the ships don't have to.
- Watchtower keeps watch on your invoices so you don't have to chase them.
- Visual system: dark sea at night, ONE warm light. The lantern glow (gold) is the single accent. The tower's red stripes are the only other color, used in tiny doses.

This gives you the screenshot's calm/dark/minimal discipline AND the brand's warmth, instead of a cold cyan SaaS tool.

## The brand-character system (reference: clay.global/work/cornerstone)

Secondary reference: the Cornerstone case study by Clay (https://clay.global/work/cornerstone).
Steal its ARCHITECTURE, not its rendering:

What Clay does right (this is the bar):
- ONE consistent cast of brand characters, placed THROUGHOUT the entire site — not a logo parked in the corner. The orange cylinder-with-a-face, the play-button character, the clock character, the loop, the star — a small consistent universe that appears in every section.
- Each category/section gets its OWN character in the SAME style, so the whole site reads as one object collection.
- Tactility + volume: the objects feel physical, squeezable, weighty — "inviting quality," soft shadows, matte surface.
- Methodical motion: characters integrated with motion — a friendly, memorable first impression.

The trap to avoid: Clay renders these as smooth 3D "clay-render" soft-body vinyl toys. That is the OPPOSITE of Watchtower's locked woodcut/tattoo style. Do NOT switch the lighthouse to 3D, soft-body, vinyl, or clay-render. That would destroy the brand.

The bridge (what to actually build):
- The lighthouse is one character in a small world: lighthouse, lantern, tiny waves, sailboat, small flag. That is the cast. Build the WHOLE site from this family, the way Clay builds from its family of toys.
- Each section/step/category gets its own member of the lighthouse-world, in the SAME woodcut ink style: the lantern for "watch," the wave for "remind," the sailboat for "paid/arrived," the flag for "the fee," etc.
- Tactility is woodcut's native strength — it is a printmaking technique, ink pressed into paper. Achieve "physical, touchable" through PAPER GRAIN, INK BLEED, hand-carved block weight, soft paper shadow. "Feels printed, feels physical" — no 3D required.
- The iconography library is woodcut-inked lighthouse-world glyphs, not generic line icons. Every glyph is a small member of the world.
- Motion is the cast coming alive: the beam rotates, the lantern pulses, the tiny waves roll, the flag flutters. Subtle, methodical, one moving element per section at most.

## Design tokens

### Color
- Base (page background): deep warm near-black — #0A0A0A to #101010 range (neutral-leaning, NOT blue-black).
- Surface (cards, header, sections): #151515 to #1A1A1A.
- Borders / dividers: rgba(255,255,255,0.07) — faint, not drawn hard.
- Text: #E8E6E1 (warm off-white) for primary, #9A9890 muted.
- Accent — lantern gold: #C9A84C → #E8C96A gradient (the glow). Use for: key numbers, CTAs, focus, the "recovered $" stat, hover states.
- Accent — tower red: a deep brick #B23A2E / #C0392B, used ONLY for the lighthouse's stripes and tiny marks (badges, one-word emphasis). Do not spread red across the UI.
- Success/paid: a muted sea-green #4E9E7D, used only where money status appears.

### Typography
- Headings / tagline / key numbers: Playfair Display (serif — carries the old-lighthouse/heritage warmth).
- Body / UI / labels: Inter.
- Key numbers (the "recovered $X this month", price, stats): large, Playfair, gold — they are the hero.
- Type as hierarchy first; add color and borders only after the type already works.

### Shape & spacing
- Radii: small-to-medium (8–12px), never pill-everything, never fully-round buttons.
- Buttons: one primary (gold, filled, dark text) + one ghost (faint border, light text). Hit targets 44px min.
- Spacing: generous. Sections breathe. Dense grid for the feature cards, air for the hero.
- Iconography: thin light strokes (1.5–2px) on dark, monochrome — match the screenshot's restraint. No emoji.

### Motion
- Scroll-reveal fade-up (IntersectionObserver), spring easing, subtle.
- The cast comes alive: rotating lighthouse beam + pulsing lantern in the hero, tiny waves rolling in one section, a fluttering flag in another. ONE moving element per section at most.
- Respect prefers-reduced-motion.

## Page structure (landing)
The cast (lighthouse / lantern / wave / sailboat / flag) appears in every section — each section is introduced by its own small woodcut member, the way Clay places a character per category.
1. Hero — dark sea. Lighthouse (woodcut) on the right or center, faint beam rotating. Eyebrow → tagline large in Playfair → one-line sub ("Watchtower reminds your clients before an invoice is late, applies the fee you agreed, and keeps the proof.") → one gold CTA ("Start watching") + one ghost ("See how it works"). Scroll hint.
2. The problem — the night. "14 hours a week chasing invoices. $17,500 owed per business, on average. 85% of freelancers paid late." Present as calm facts, not alarm. The little sailboat lost in the dark waves is the character here.
3. How it works — the watch. 4 steps, the agent chain, each with its own woodcut glyph: Watch (the lantern) → Remind (the wave) → Fee (the flag) → Proof (the lighthouse itself, steady). Warm, never threatening.
4. The differentiator — "Who's always late." Your per-client lateness view. Show the recovered-money stat here: "Watchtower recovered $X this month" in large gold Playfair.
5. Pricing — $29.99/mo per business. One late fee recovered covers the month. Frame as: the fee pays for the tool.
6. Email strip — a sample reminder email, warm, with the lighthouse mascot in it (the tone is the product).
7. Final CTA + footer.

## Anti-slop rules (non-negotiable)
- No stock photos. No fake dashboard crammed with invented numbers — if a number appears, it's real (recovered $, hours, %).
- No generic SaaS feature grid with icon-in-a-box everywhere.
- No aggressive gradients, no glassmorphism, no rainbow palette.
- No emoji. No vague labels ("Insights", "Scale", "Optimize").
- Every element earns its place. One idea per section.
- The ONLY illustrations are the woodcut lighthouse-world cast. No decorative SVG pretending to be product imagery, no stock photos, no generic icon sets.

## Deliverable
One polished, self-contained landing page. Dark, warm, calm. The lighthouse is the single light. If you add anything that isn't in this brief, it should be because it makes the lighthouse keep watch better — otherwise leave it out.

---

# PART TWO — The Command Center (the product surface)

## Reframe: it is NOT a "dashboard"
Do not build a "dashboard" — a wall of 14 charts labeled "Insights / Growth / Optimize" that no one reads and that means nothing on day one. That is the dying trend; that is the thing people are tired of. It is banned.

Build a WORKING SURFACE — the "who owes me" view. A small-business owner opens it and in three seconds knows three things: who's paid, who owes me, who might be late. The list is the meal; the charts are the garnish.

## Three views, not thirty
1. **The Watch (today)** — a "needs attention" list: invoices due soon, overdue, fees pending your approval. One visible action per row (remind now / apply fee / approve).
2. **Clients** — the differentiator: per-client "who's always late" (how often + how many days late), plus total outstanding. This is the locked differentiator AND the seed of a future "vet this client before you invoice" product.
3. **Recovered** — "Watchtower recovered $X this month" in large gold Playfair. The number that makes $29.99/mo self-evident. The hero of the whole surface.

## The empty state is the onboarding (the most important screen)
A brand-new user sees zero data, and the surface tells them ONE next action: "Connect Stripe" → "Create your first invoice." No chart-shaped holes. No demo data. Charts populate from the customer's own real usage — so the first chart anyone ever sees is their own cash, their own late client, their own recovered dollar. The surface comes alive as they use it, never before.

## Status color system (money-status only, on the same dark/gold spec)
- paid = muted sea-green #4E9E7D
- open / owes = warm off-white neutral
- late-risk (approaching) = lantern gold #C9A84C
- overdue = tower red #B23A2E

## Design discipline
Same woodcut world — each view can be introduced by its own small member of the cast (lantern for The Watch, the sailboat for Clients, the lighthouse itself for Recovered). Dense-but-calm, one idea per row, actions visible not buried. Speed of comprehension over decoration. NOT a chart wall.

---

# PART THREE — Starting Point (the decision)

Start from a BLANK screen, not the wireframe template. The wireframe template imposes a generic low-fidelity skeleton that fights this brief's whole purpose. This brief IS the wireframe — it already specifies section order, tokens, cast, and motion. Blank + this brief = the distinctive thing.
