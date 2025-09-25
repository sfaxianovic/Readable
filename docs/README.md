# Achromatopsia Web Reader – Documentation

## 1. Purpose & Audience
Achromatopsia Web Reader rebuilds the main content of a webpage into a high-contrast, grayscale, large-type experience that remains usable at 300–400% magnification. It is designed for people with:

- Complete colour blindness (grayscale vision only)
- 20/200 visual acuity (legally blind) requiring very large text
- Photophobia that makes bright backgrounds painful

Traditional browser zoom or operating system magnification frequently breaks layouts. This extension extracts the readable article using Mozilla Readability and renders it inside an accessibility-optimised overlay that maintains semantic structure, reliable spacing, and consistent typography.

## 2. Project Structure
```
achromatopsia-extension/
├── manifest.json
├── background/
│   └── background.js           # Service worker (keyboard shortcuts, popup requests)
├── content/
│   ├── content.css              # Overlay layout, typography, filters
│   └── content.js               # AchromatopsiaReader content script
├── popup/
│   ├── popup.css                # Popup theming for low-vision use
│   ├── popup.html               # Popup UI
│   └── popup.js                 # Messaging + settings controls
├── libs/
│   └── readability.js           # Vendored Mozilla Readability library
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── docs/
    └── README.md                # This document
```

## 3. Installation (Developer Mode)
1. Download or clone the repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and choose the `achromatopsia-extension` folder.
5. Pin the extension to the toolbar for quick access.

No build step is required; all assets are plain JavaScript/CSS/HTML.

## 4. Daily Use Workflow
- **Activate**: Use any of the three entry points
  - Keyboard shortcut `Alt+Shift+A`
  - Toolbar popup → **Turn On**
  - Floating in-page button labelled *Reader Mode*
- **Settings**: Adjust font size (24–48 pt), brightness (40–100%), and contrast (100–200%) in the popup.
- **Persistence**: Preferences are stored per domain via `chrome.storage.local`. The extension re-applies your last state when revisiting the same site.
- **Deactivate**: Use the same shortcut/button or press **Exit Reader** from the overlay toolbar.

While active, the original page DOM is hidden and the extracted article is rendered inside a full-viewport overlay. The toolbar remains sticky at the top with quick access to Exit and Settings. Messages in the overlay confirm filter values after adjustments.

## 5. Technical Architecture
### 5.1 Content Script (`content/content.js`)
- Instantiates `AchromatopsiaReader`, responsible for lifecycle, layout creation, settings persistence, and messaging.
- Extracts the readable article by cloning the DOM and running Mozilla `Readability`.
- Builds a semantic `<article>` overlay with generous spacing and grayscale palette while preserving headings, paragraphs, lists, links, and images.
- Applies grayscale, brightness, and contrast filters at the `<html>` level using CSS custom properties, guaranteeing consistency even when the user scrolls or resizes.
- Injects a floating toggle button, keyboard shortcut handler, loading state, and error fallback (basic text extraction) for pages that Readability cannot parse.

### 5.2 Popup (`popup/*.js|css|html`)
- Fetches the live page state via `chrome.tabs.sendMessage`.
- Provides sliders and toggle buttons with real-time feedback and debounced updates to reduce storage churn.
- Displays status updates (active/offline, errors) using polite `aria-live` regions.

### 5.3 Background Service Worker (`background/background.js`)
- Listens for the `activate-reader` command (Alt+Shift+A) and forwards toggle messages to the active tab.
- Receives `OPEN_POPUP` events from the content overlay and calls `chrome.action.openPopup()` so users can open settings without leaving the page.
- Logs lifecycle events for debugging.

### 5.4 Storage Layout
```
chrome.storage.local
└── achromatopsia:<domain> = {
      fontSize: Number,      // points
      brightness: Number,    // 0.4–1.0
      contrast: Number,      // 1.0–2.0
      enabled: Boolean
    }
```
Defaults are stored once under `achromatopsia:defaults` to ensure consistency across domains after a reset.

## 6. Testing Checklist (Phase 1)
Test across a representative set of websites and document findings:
- **News**: CNN, BBC, NYTimes – verify article extraction, images, captions.
- **Blogs**: Medium, personal blog – ensure author callouts and inline media render.
- **Knowledge**: Wikipedia – confirm lists, infoboxes, tables degrade gracefully.
- **E-commerce**: Amazon product pages – expect fallback mode for complex layouts; verify messaging.
- **Documentation**: MDN, Stack Overflow – check code blocks, headings.
- **Social media**: Twitter (web), Reddit threads – ensure toggle works and fallback handles dynamic layouts.
- **Dashboards**: SaaS admin panels – confirm graceful failure message where Readability cannot extract content.
- **Forms/Interactive**: Long forms remain accessible or exit gracefully.

For each site, measure:
- Activation time (goal < 2 seconds for typical articles)
- Readability of headings and lists at 300–400% scaling
- Correct application of grayscale/brightness/contrast filters

## 7. Accessibility Considerations
- All buttons and sliders are keyboard-focusable with visible focus rings.
- Overlay uses `role="region"` and `aria-live` status messaging for screen-reader compatibility.
- Large hit targets and legible typography even within the popup (minimum 16px base size).
- Fallback mode warns the user when full extraction is not possible but still provides simplified text.

## 8. Performance & Limitations
- Readability is vendored locally to avoid network latency; the content script clones the DOM once per activation.
- Settings updates are debounced (200 ms) to minimise `chrome.storage` writes.
- DOMPurify is not yet integrated; page content is currently assumed safe after Readability sanitisation. Phase 2 should add DOMPurify before inserting HTML into the overlay.
- Highly interactive web apps may require bespoke handling beyond the fallback view.

## 9. Next Steps (Phase 2+)
1. Integrate DOMPurify before inserting Readability HTML to harden security.
2. Allow user-defined color palettes or dark mode variations.
3. Provide inline settings within the overlay for users who prefer not to open the popup.
4. Add analytics hooks (privacy-safe) to track activation times and failure cases.
5. Explore text-to-speech integration for multimodal accessibility support.

---
For development issues or suggestions, please document findings with the tested URL, browser version, observed behaviour, and console output.
