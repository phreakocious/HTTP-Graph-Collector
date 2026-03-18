# Retrowave Restyle — HTTP Graph Viewer

## Overview

Restyle the HTTP Graph Viewer from its current GitHub-dark aesthetic to a retrowave/vaporwave theme influenced by the design-style-taxonomy-v2.html reference. The restyle touches CSS (style.css) and the HTML head (Google Fonts import). No changes to app.js logic or node color generation.

## Fonts

- **Headings** (`h1`, `h2`): `font-family: 'Michroma', sans-serif`
- **Body/UI** (everything else): `font-family: 'Oxanium', sans-serif`
- Google Fonts link in index.html `<head>`:
  ```html
  <link href="https://fonts.googleapis.com/css2?family=Michroma&family=Oxanium:wght@400;600&display=swap" rel="stylesheet">
  ```

## Variable Migration

Old CSS variables are removed and replaced:

| Old variable | New variable | Context |
|---|---|---|
| `--blue` | `--accent-pink` (links, labels) / `--accent-cyan` (active states, ranges) | Context-dependent split |
| `--blue-hover` | `--accent-pink-hover` | File button hover |
| `--green` | `--accent-mint` | Connected status |

## Color Palette

Derived from the taxonomy's Vaporwave/Retrowave entry:

| Variable | Value | Role |
|---|---|---|
| `--bg-page` | `#0d0221` | Deep purple-black page/graph background |
| `--bg-card` | `#150533` | Sidebar background |
| `--bg-input` | `#1a0a3e` | Input/button background |
| `--bg-hover` | `#2a0f5a` | Hover state background |
| `--border` | `#3d1a7a` | Default borders (violet-tinted) |
| `--border-focus` | `#ff71ce` | Focus ring color (hot pink) |
| `--text-primary` | `#f0e6ff` | Primary text (slightly pink-tinted white) |
| `--text-secondary` | `#b8a0d4` | Secondary text (lavender) |
| `--text-muted` | `#7a5fa0` | Muted text (dim violet) |
| `--accent-pink` | `#ff71ce` | Primary accent — links, primary buttons, file-btn |
| `--accent-pink-hover` | `#ff99dd` | Pink hover state |
| `--accent-cyan` | `#01cdfe` | Secondary accent — active buttons, ranges |
| `--accent-violet` | `#b967ff` | Tertiary — section headings uppercase color |
| `--accent-yellow` | `#fffb96` | Highlights, warnings |
| `--accent-mint` | `#05ffa1` | Success states (connected status) |
| `--red` | `#ef4444` | Error states (unchanged) |

## Interactive Elements — Outline Neon Style

All interactive elements (buttons, inputs, file-btn) use thin neon-colored borders. On hover/focus, a subtle `box-shadow` glow appears. No filled neon backgrounds.

### Buttons
- Default: `--bg-input` background, `--border` border (1px solid)
- Hover: `--bg-hover` background, border color shifts to `--accent-pink`, subtle `box-shadow: 0 0 8px var(--accent-pink)`
- Active (`.active`): `--accent-cyan` border, `box-shadow: 0 0 8px var(--accent-cyan)`, text color `--accent-cyan`, subtle tinted background `rgba(1, 205, 254, 0.1)` for visual distinction in button groups

### File button (`.file-btn`)
- Default: `--bg-input` background, `--accent-pink` border, `color: var(--accent-pink)`
- Hover: `box-shadow: 0 0 10px var(--accent-pink)`

### Text inputs
- Default: `--bg-input` background, `--border` border
- Focus: `--accent-pink` border, `box-shadow: 0 0 8px rgba(255, 113, 206, 0.3)`

### Range inputs & checkboxes
- `accent-color: var(--accent-cyan)`

## Perspective Grid Background

CSS-only approach using a `::before` pseudo-element on `#graph-container`:

```css
#graph-container::before {
  content: '';
  position: absolute;
  inset: 0;
  /* Horizontal + vertical grid lines */
  background:
    repeating-linear-gradient(
      90deg,
      rgba(185, 103, 255, 0.07) 0px,
      transparent 1px,
      transparent 60px
    ),
    repeating-linear-gradient(
      0deg,
      rgba(185, 103, 255, 0.07) 0px,
      transparent 1px,
      transparent 60px
    );
  /* Perspective transform to create receding grid floor */
  transform-origin: center bottom;
  transform: perspective(400px) rotateX(45deg);
  z-index: 0;
  pointer-events: none;
}
```

- Sits behind the sigma canvas — child elements naturally stack above `::before` pseudo-elements in the same stacking context, so sigma's canvases will layer on top without explicit z-index
- Faint violet lines (`rgba(185, 103, 255, 0.07)`) — visible but not distracting
- `pointer-events: none` so it doesn't interfere with sigma interaction
- Contingency: if grid renders on top, add `#graph-container > canvas { position: relative; z-index: 1; }`

## Element-Specific Color Mapping

- `#sidebar h2`: `color: var(--accent-violet)` (was `--text-muted`)
- `.setting-row label span` (slider values): `color: var(--accent-cyan)` (was `--blue`)
- `.hint a`, `#sidebar a`: `color: var(--accent-pink)` (was `--blue`)
- Link hover: `color: var(--accent-pink-hover)` + `text-decoration: underline`

## Sidebar Styling

- Border-right changes from solid gray to `1px solid var(--border)` (violet-tinted)
- Optional: very subtle top-to-bottom gradient on sidebar from `--bg-card` to slightly darker

## Tooltip & Context Menu

- Background: `--bg-card`
- Border: `--border`
- `.tt-label` color: `--accent-pink` (was `--blue`)
- Box-shadow (both tooltip and context menu): `0 4px 12px rgba(13, 2, 33, 0.8)` (deep purple shadow)

## Links

- Color: `--accent-pink` (was `--blue`)
- Hover: `--accent-pink-hover`

## Status Colors

- `.connected`: `--accent-mint` (`#05ffa1`)
- `.error`: `--red` (unchanged)
- `.disconnected`: `--text-muted`

## Scope

### Files changed
- `style.css` — full palette swap, glow effects, grid background, font-family changes
- `index.html` — add Google Fonts `<link>` for Michroma and Oxanium

### Files NOT changed
- `app.js` — no logic changes, no node color palette changes
- Node type colors remain the existing HSV-generated 26-hue + grayscale palette

## Out of Scope

- Glitch effects or animations
- Japanese text / katakana decorations
- Greek bust imagery
- Any changes to graph interaction behavior
