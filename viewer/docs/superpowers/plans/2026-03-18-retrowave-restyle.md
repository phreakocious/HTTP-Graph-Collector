# Retrowave Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the HTTP Graph Viewer with a retrowave/vaporwave aesthetic — new color palette, fonts, neon outline interactions, and perspective grid background.

**Architecture:** CSS-only restyle plus a Google Fonts link in the HTML head. Two files change: `style.css` (full rewrite of custom properties and affected rules) and `index.html` (one `<link>` tag). No JS changes.

**Tech Stack:** CSS custom properties, Google Fonts (Michroma, Oxanium), CSS transforms for perspective grid.

**Spec:** `docs/superpowers/specs/2026-03-18-retrowave-restyle-design.md`

---

### Task 1: Add Google Fonts to index.html

**Files:**
- Modify: `viewer/index.html:26` (before the stylesheet link)

- [ ] **Step 1: Add the Google Fonts link tag**

Insert immediately before the `<link rel="stylesheet" href="style.css">` line:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Michroma&family=Oxanium:wght@400;600&display=swap" rel="stylesheet">
```

- [ ] **Step 2: Commit**

```bash
git add viewer/index.html
git commit -m "add Michroma and Oxanium Google Fonts for retrowave restyle"
```

---

### Task 2: Replace CSS custom properties, fonts, and migrate all variable references

**Files:**
- Modify: `viewer/style.css:1-17` (`:root` block)
- Modify: `viewer/style.css:22` (body font-family)
- Modify: `viewer/style.css:42-57` (h1, h2 rules)
- Modify: `viewer/style.css` — every rule referencing `--blue`, `--blue-hover`, or `--green`

This task is atomic: the `:root` variable rename and all reference migrations happen in one commit so no intermediate broken state exists.

- [ ] **Step 1: Update the theme comment**

Change line 1 from:
```css
/* nullphase dark theme for HTTP Graph Viewer */
```
to:
```css
/* retrowave theme for HTTP Graph Viewer */
```

- [ ] **Step 2: Replace the entire `:root` block**

Replace the current `:root` with:

```css
:root {
  --bg-page: #0d0221;
  --bg-card: #150533;
  --bg-input: #1a0a3e;
  --bg-hover: #2a0f5a;
  --border: #3d1a7a;
  --border-focus: #ff71ce;
  --text-primary: #f0e6ff;
  --text-secondary: #b8a0d4;
  --text-muted: #7a5fa0;
  --accent-pink: #ff71ce;
  --accent-pink-hover: #ff99dd;
  --accent-cyan: #01cdfe;
  --accent-violet: #b967ff;
  --accent-yellow: #fffb96;
  --accent-mint: #05ffa1;
  --red: #ef4444;
}
```

- [ ] **Step 3: Update font families**

Change body `font-family` to:
```css
font-family: 'Oxanium', sans-serif;
```

Add `font-family: 'Michroma', sans-serif;` to both `#sidebar h1` and `#sidebar h2` rules.

- [ ] **Step 4: Migrate all old variable references**

Apply these replacements (skipping `.file-btn` and `.file-btn:hover` which are fully replaced in Task 3):

| Location | Old | New | Reason |
|---|---|---|---|
| `.hint a, #sidebar a` color | `var(--blue)` | `var(--accent-pink)` | Links → pink |
| `button.active` background | `var(--blue)` | `rgba(1, 205, 254, 0.1)` | Subtle cyan tint |
| `button.active` border-color | `var(--blue)` | `var(--accent-cyan)` | Cyan active |
| `.setting-row label span` color | `var(--blue)` | `var(--accent-cyan)` | Slider values → cyan |
| `input[type="range"]` accent-color | `var(--blue)` | `var(--accent-cyan)` | Ranges → cyan |
| `input[type="checkbox"]` accent-color | `var(--blue)` | `var(--accent-cyan)` | Checkboxes → cyan |
| `#tooltip .tt-label` color | `var(--blue)` | `var(--accent-pink)` | Tooltip label → pink |
| `#live-status.connected` color | `var(--green)` | `var(--accent-mint)` | Connected → mint |

- [ ] **Step 5: Commit**

```bash
git add viewer/style.css
git commit -m "replace palette, fonts, and migrate all variable references to retrowave theme"
```

---

### Task 3: Update interactive element styles (neon outline)

**Files:**
- Modify: `viewer/style.css` — h2 rule, button rules, file-btn rules, input rules

- [ ] **Step 1: Update h2 color**

Change `#sidebar h2` color from `var(--text-muted)` to `var(--accent-violet)`.

- [ ] **Step 2: Update file-btn to outline neon style**

Replace the `.file-btn` and `.file-btn:hover` rules with:

```css
.file-btn {
  display: inline-block;
  padding: 8px 14px;
  background: var(--bg-input);
  color: var(--accent-pink);
  border: 1px solid var(--accent-pink);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
  transition: background-color 0.15s, box-shadow 0.15s;
}
.file-btn:hover {
  background: var(--bg-hover);
  box-shadow: 0 0 10px var(--accent-pink);
}
```

- [ ] **Step 3: Update button base transition**

Change the `button` rule's transition from:
```css
transition: background-color 0.15s;
```
to:
```css
transition: background-color 0.15s, box-shadow 0.15s, border-color 0.15s;
```

- [ ] **Step 4: Update button hover to add neon glow**

Change `button:hover` to:
```css
button:hover {
  background: var(--bg-hover);
  border-color: var(--accent-pink);
  box-shadow: 0 0 8px var(--accent-pink);
}
```

- [ ] **Step 5: Update button.active to outline neon style**

Change `button.active` to:
```css
button.active {
  background: rgba(1, 205, 254, 0.1);
  border-color: var(--accent-cyan);
  color: var(--accent-cyan);
  box-shadow: 0 0 8px var(--accent-cyan);
}
```

- [ ] **Step 6: Update text input transition and focus glow**

Change `input[type="text"]` transition from:
```css
transition: border-color 0.15s;
```
to:
```css
transition: border-color 0.15s, box-shadow 0.15s;
```

Change `input[type="text"]:focus` to:
```css
input[type="text"]:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 8px rgba(255, 113, 206, 0.3);
}
```

- [ ] **Step 7: Add link hover color**

Change `.hint a:hover, #sidebar a:hover` to:
```css
.hint a:hover, #sidebar a:hover {
  color: var(--accent-pink-hover);
  text-decoration: underline;
}
```

- [ ] **Step 8: Commit**

```bash
git add viewer/style.css
git commit -m "add neon outline styles to buttons, inputs, and links"
```

---

### Task 4: Update tooltip and context menu shadows

**Files:**
- Modify: `viewer/style.css` — `#tooltip` and `#context-menu` rules

- [ ] **Step 1: Update box-shadow on tooltip and context menu**

Change both `box-shadow` values from `0 4px 12px rgba(0,0,0,0.5)` to:
```css
box-shadow: 0 4px 12px rgba(13, 2, 33, 0.8);
```

- [ ] **Step 2: Commit**

```bash
git add viewer/style.css
git commit -m "update tooltip and context menu shadows to deep purple"
```

---

### Task 5: Add perspective grid background

**Files:**
- Modify: `viewer/style.css` — add `#graph-container::before` rule after the `#graph-container` rule

- [ ] **Step 1: Add the perspective grid pseudo-element**

Add after the `#graph-container` rule:

```css
#graph-container::before {
  content: '';
  position: absolute;
  inset: 0;
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
  transform-origin: center bottom;
  transform: perspective(400px) rotateX(45deg);
  z-index: 0;
  pointer-events: none;
}
```

- [ ] **Step 2: Verify visually**

Open `viewer/index.html` in a browser. Confirm:
- Faint violet grid lines are visible on the graph background
- Grid recedes toward the top with perspective
- Grid does NOT obscure sigma canvas interactions (hover, click, drag still work)
- If grid appears on top of nodes, add contingency rule: `#graph-container > canvas { position: relative; z-index: 1; }`

- [ ] **Step 3: Commit**

```bash
git add viewer/style.css
git commit -m "add retrowave perspective grid background to graph container"
```

---

### Task 6: Visual verification pass

**Files:** None (verification only)

- [ ] **Step 1: Open viewer in browser and verify**

Check the following against the spec:
- Michroma font on h1 and h2 headings
- Oxanium font on all other text
- Deep purple-black background (`#0d0221`)
- Sidebar has slightly lighter purple (`#150533`)
- All buttons show neon outline style (no filled backgrounds except subtle active tint)
- Hover states produce pink glow on buttons and inputs
- Active buttons show cyan glow
- Links are hot pink, hover to lighter pink
- Slider value labels are cyan
- Section headings (h2) are violet
- Connected status is neon mint
- Perspective grid visible behind graph area
- Tooltip and context menu have deep purple shadows

- [ ] **Step 2: Final commit if any tweaks needed**

```bash
git add viewer/style.css
git commit -m "retrowave restyle: final visual tweaks"
```
