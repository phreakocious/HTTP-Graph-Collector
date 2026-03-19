# Layout Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inline the connection status with the Connect button and standardize sidebar spacing to 16px between sections / 8px within.

**Architecture:** Small CSS + HTML + JS change. Move a span in HTML, adjust gap/margin in CSS, add two lines of JS init.

**Tech Stack:** CSS flexbox, vanilla JS.

**Spec:** `docs/superpowers/specs/2026-03-18-layout-fixes-design.md`

---

### Task 1: Move live-status inline with Connect button

**Files:**
- Modify: `viewer/index.html:47-49` (live section btn-group)
- Modify: `viewer/app.js:252` (after liveStatus declaration)

- [ ] **Step 1: Move #live-status inside the .btn-group in HTML**

In `viewer/index.html`, change:

```html
      <div class="btn-group">
        <button id="btn-live">Connect</button>
      </div>
      <span id="live-status"></span>
```

to:

```html
      <div class="btn-group">
        <button id="btn-live">Connect</button>
        <span id="live-status">Disconnected</span>
      </div>
```

- [ ] **Step 2: Set initial status in JS**

In `viewer/app.js`, immediately after line 252 (`const liveStatus = document.getElementById("live-status");`), add:

```js
  liveStatus.textContent = "Disconnected";
  liveStatus.className = "disconnected";
```

- [ ] **Step 3: Commit**

```bash
git add viewer/index.html viewer/app.js
git commit -m "move live-status inline with Connect button, show Disconnected by default"
```

---

### Task 2: Standardize vertical spacing

**Files:**
- Modify: `viewer/style.css` — sidebar gap, section gap, btn-group align-items, remove 7 ad-hoc margins

- [ ] **Step 1: Update sidebar gap**

Change `#sidebar` rule's `gap` from `12px` to `16px`.

- [ ] **Step 2: Update section internal gap**

Change `section` rule's `gap` from `6px` to `8px`.

- [ ] **Step 3: Add align-items to btn-group**

Change `.btn-group` from:
```css
.btn-group { display: flex; gap: 4px; flex-wrap: wrap; }
```
to:
```css
.btn-group { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
```

- [ ] **Step 4: Remove ad-hoc margins**

Remove these properties (the flex `gap` now handles all spacing):

| Selector | Property | Current value | Line |
|---|---|---|---|
| `#sidebar h1` | `margin-bottom: 4px` | 4px | ~51 |
| `#sidebar h2` | `margin-bottom: 6px` | 6px | ~61 |
| `#live-status` | `margin-top: 2px` | 2px | ~107 |
| `#graph-stats` | `margin-top: 2px` | 2px | ~193 |
| `#fa2-settings` | `margin-top: 6px` | 6px | ~138 |
| `#show-hidden-label` | `margin-top: 4px` | 4px | ~302 |

- [ ] **Step 5: Verify visually**

Open `viewer/index.html` in a browser. Confirm:
- "Disconnected" appears to the right of the Connect button
- Spacing between all sidebar sections is uniform
- No extra gaps or collapsed spacing anywhere
- ForceAtlas2 settings area doesn't have double-spacing

- [ ] **Step 6: Commit**

```bash
git add viewer/style.css
git commit -m "standardize sidebar spacing: 16px between sections, 8px within, remove ad-hoc margins"
```
