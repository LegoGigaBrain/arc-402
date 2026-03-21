# ARC-402 Landing Page — Design Decisions

*Captured 2026-03-21. Reference for all future web surfaces.*

---

## Typography

**Headings:** Times New Roman, bold (700)
- Intentional serif — not accidental browser default. Originally landed on this when CSS variable chain broke and the page fell back to system serif. Lego liked the academic/whitepaper feel. Made it deliberate.
- Set explicitly as `'Times New Roman', Times, serif` — owns the choice.
- Bold everywhere it appears: hero title, section titles, thesis statement, metric values.

**Body:** Roboto (Google Fonts), weights 400/500/700
- Clean, neutral, high readability. No personality conflict with the serif headings.
- CSS variable: `--sans: var(--font-roboto), 'Roboto', sans-serif`

**The pairing principle:** Serif authority on top, sans-serif readability underneath. The contrast is the point — academic gravitas meets modern clarity.

---

## Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#f8f7f4` | Page background — warm off-white, not pure white |
| `--ink` | `#0a0a0a` | Primary text, headings, footer background |
| `--ink-muted` | `#5a5a5a` | Secondary text, descriptions |
| `--ink-faint` | `#b0afa8` | Labels, section numbers, subtle text |
| `--blue` | `#2563eb` | Accent — CTAs, protocol flow labels, quick start headings |
| `--terminal-bg` | `#0a0a0a` | Terminal window background |
| `--terminal-text` | `#e8e8e8` | Terminal command text |
| `--terminal-green` | `#4ade80` | Terminal success/result text |
| `--terminal-blue` | `#60a5fa` | Terminal prompt (`$`) |
| `--terminal-dim` | `#6b7280` | Terminal metadata, window title |

**Dark sections:** Footer uses `--ink` background with muted link colors. Metrics grid uses `--ink` cards on `--bg` background. Terminal is full dark.

**Light-dominant:** The page is mostly off-white. Dark elements (terminal, metrics, footer) create rhythm, not darkness.

---

## Layout Principles

- **Max width 900px**, centered. No sidebar. No grid complexity.
- **Generous vertical padding** — `clamp(80px, 12vw, 140px)` on hero, 80px on sections.
- **Section pattern:** number label (mono, faint) + title (serif, bold) + content below.
- **Protocol flow:** table-like rows with index / label / description. Horizontal lines as dividers.
- **Metrics:** 4-column grid of dark cards. Label on top (tiny, uppercase), value on bottom (serif, large).

---

## Quick Start Blocks

- **Heading above the box** (not inside) — blue, serif bold, `0.85rem`
- **Description below heading** — muted, regular weight (not italic)
- **Code block** has its own border (`1px solid #d0cfc8`, `border-radius: 8px`)
- **Copy button** top-right of code block, mono font, subtle until hover
- Each block is a vertical stack: heading → description → code. No colored background on heading/description.

---

## Terminal Animation

- **Auto-plays on page load** (near top of page, no scroll trigger needed)
- **Typing speed:** ~40-50ms per character + random jitter for realism
- **Commands type character by character**, responses appear instantly (fade in with 4px upward slide)
- **Discover results stagger** — each agent appears with 200ms delay
- **Plays once** — no loop. Stays with full output and blinking cursor at end.
- **Cursor:** inline block, `0.55em` wide, terminal text color, blinks via CSS `step-end` animation
- **Fade-in animation:** `opacity 0→1, translateY(4px→0)` over 150ms

---

## Favicon

- White ARC-402 logo SVG (primary) + white round logo PNG (fallback)
- Source files in `brand/` directory
- Dark favicon on light browser chrome — stands out in tab bar

---

## Mobile

- Hero title scales down via `clamp(3rem, 14vw, 4rem)`
- Flow rows collapse to 2-column (index + content stacked)
- Metrics grid goes to 2-column
- CTAs stack vertically, full width (max 280px)
- Terminal body padding reduces, font scales down
- Footer stacks vertically

---

## What We Intentionally Don't Have

- No gradients
- No illustrations or hero images
- No animations except the terminal typewriter
- No testimonials or social proof
- No pricing
- No newsletter signup
- No hamburger menu (no nav at all — the page is the nav)

The page sells through **substance**: real contract addresses, real CLI commands, real protocol flow. The terminal animation is the only "trick" — and it shows real commands that actually work.

---

*When building future ARC-402 web surfaces (app, docs, dashboard), start from this palette and these type decisions. The serif/sans pairing and off-white/dark rhythm should carry across.*
