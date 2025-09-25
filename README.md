# Achromatopsia Web Reader

A Chrome extension that rebuilds any article into an achromatopsia-optimised layout with extreme font scaling, grayscale visual filters, and per-site preferences. It is engineered for people with complete colour blindness, 20/200 vision, and photophobia.

## Highlights
- Manifest V3 extension with content script, popup UI, and background service worker.
- Powered by Mozilla Readability to extract article content while preserving hierarchy.
- Inline overlay layout that supports 300–400% font scaling without breaking typography.
- Achromatopsia-specific filters (grayscale, brightness, contrast) with per-site persistence.
- Keyboard shortcut (Alt+Shift+A), page button, popup controls, and settings remembered per domain.

## Quick Start
1. Enable Developer Mode in `chrome://extensions`.
2. Choose **Load unpacked** and select the `achromatopsia-extension` folder.
3. Pin the extension for easy access. Use Alt+Shift+A or the popup toggle to activate.

Full installation, usage, and testing notes live in [`docs/README.md`](docs/README.md).
