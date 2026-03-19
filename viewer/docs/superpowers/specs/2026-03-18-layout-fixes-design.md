# Layout Fixes — HTTP Graph Viewer

## Overview

Fix two layout issues: inline the connection status with the Connect button, and make vertical spacing consistent across the sidebar.

## Connected Status Inline

Move `#live-status` from below the `.btn-group` to inside it, so it sits to the right of the Connect button on the same line.

### HTML change (index.html)

Move `<span id="live-status"></span>` from after the `.btn-group` div to inside it, after the Connect button:

```html
<div class="btn-group">
  <button id="btn-live">Connect</button>
  <span id="live-status">Disconnected</span>
</div>
```

### CSS change (style.css)

Add `align-items: center` to the global `.btn-group` rule (harmless for other instances since buttons are uniform height). This vertically centers the status text with the button.

`#live-status` keeps its existing font-size (11px) and color classes. Remove `margin-top: 2px` since it's now inline. Long error messages (e.g., "chrome.runtime unavailable...") will wrap to the next line via the existing `flex-wrap: wrap` on `.btn-group`, which is acceptable.

### JS change (app.js)

Set the initial text and class on `#live-status`:

```js
liveStatus.textContent = "Disconnected";
liveStatus.className = "disconnected";
```

This should happen immediately after the `const liveStatus = document.getElementById("live-status")` declaration (around line 252). When connected, the existing code already sets "Connected" with `.connected` class. When disconnecting, set back to "Disconnected" with `.disconnected` class.

## Consistent Vertical Spacing

Standardize to **16px between sections**, **8px within sections**.

### Sidebar gap

Change `#sidebar` gap from `12px` to `16px`.

### Section internal gap

Change `section` gap from `6px` to `8px`.

### Remove ad-hoc margins

| Selector | Property to remove | Current value |
|---|---|---|
| `#sidebar h1` | `margin-bottom` | `4px` |
| `#sidebar h2` | `margin-bottom` | `6px` |
| `#live-status` | `margin-top` | `2px` |
| `#graph-stats` | `margin-top` | `2px` |
| `.fa2-mode-label` | `margin-top` | `4px` |
| `#fa2-settings` | `margin-top` | `6px` |
| `#show-hidden-label` | `margin-top` | `4px` |

These are all replaced by the consistent `gap` values on the flex containers.

## Scope

### Files changed
- `style.css` — gap values, remove ad-hoc margins, btn-group align-items
- `index.html` — move `#live-status` inside `.btn-group`
- `app.js` — set initial "Disconnected" text/class, ensure disconnect resets text

### Out of scope
- No other layout changes
- No color or font changes
