(function () {
  'use strict';

  const ACHROMA_SCOPE = 'ACHROMA_READER';
  const getMessage = (key, substitutions) => {
    if (!key) {
      return '';
    }
    try {
      if (chrome?.i18n?.getMessage) {
        const message = chrome.i18n.getMessage(key, substitutions ?? null);
        if (message) {
          return message;
        }
      }
    } catch (error) {
      // Silently ignore i18n errors - fallback will be used
    }
    if (Array.isArray(substitutions) && substitutions.length) {
      return substitutions.join(' ');
    }
    return '';
  };

  const t = (key, substitutions, fallback) => getMessage(key, substitutions) || fallback || '';
  const getUILanguage = () => {
    try {
      return chrome?.i18n?.getUILanguage?.() || navigator.language || 'en';
    } catch (_error) {
      return 'en';
    }
  };
  const formatPixels = (value) => t('unitPixels', [String(Math.round(value))], `${Math.round(value)} px`);
  const formatPercent = (value) => t('unitPercent', [String(Math.round(value))], `${Math.round(value)}%`);
  const memoryStorage = new Map();

  const DEFAULT_LIGHT_PALETTE = Object.freeze({
    background: '#f5f5f5',
    panelBackground: 'rgba(232, 232, 232, 0.95)',
    textColor: '#000000',
    linkColor: '#101010',
    borderColor: 'rgba(0, 0, 0, 0.2)',
    buttonBackground: '#ffffff',
    buttonHover: '#f0f0f0',
    buttonText: '#101010'
  });

  const DEFAULT_DARK_PALETTE = Object.freeze({
    background: '#121212',
    panelBackground: 'rgba(32, 32, 32, 0.92)',
    textColor: '#f5f5f5',
    linkColor: '#f0f0f0',
    borderColor: 'rgba(255, 255, 255, 0.2)',
    buttonBackground: '#2d2d2d',
    buttonHover: '#3a3a3a',
    buttonText: '#f5f5f5'
  });

  const PROFILE_DEFAULTS = Object.freeze({
    id: 'default',
    name: t('profileDefaultName', null, 'Default'),
    fontSize: 36,
    brightness: 0.7,
    contrast: 1.5,
    fontFamily: "'Verdana', 'Geneva', sans-serif",
    headingFontFamily: "'Georgia', 'Times New Roman', serif",
    boldText: true,
    letterSpacing: 0.12,
    lineHeight: 1.65
  });

  const ACHROMA_DEFAULTS = Object.freeze({
    enabled: false,
    activeProfileId: 'default',
    profiles: { default: { ...PROFILE_DEFAULTS } },
    profilesOrder: ['default'],
    adaptiveMode: true,
    imageAdjustments: {
      enabled: false,
      desaturate: true,
      contrast: 1.1,
      annotate: false
    },
    customFonts: {
      body: "'Verdana', 'Geneva', sans-serif",
      heading: "'Georgia', 'Times New Roman', serif",
      letterSpacing: 0.12,
      lineHeight: 1.65,
      boldText: true
    },
    colorLegend: {
      enabled: false,
      style: 'text'
    },
    readingMask: {
      enabled: false,
      height: 220,
      opacity: 0.3
    },
    onboarding: {
      completed: false
    }
  });

  const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

  const cloneSettings = (value) => {
    if (!value) {
      return {};
    }
    try {
      if (typeof structuredClone === 'function') {
        return structuredClone(value);
      }
    } catch (_error) {
      // ignore structuredClone failures
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return { ...value };
    }
  };

  const deepMerge = (target = {}, source = {}) => {
    const output = { ...target };
    Object.keys(source || {}).forEach((key) => {
      const value = source[key];
      if (Array.isArray(value)) {
        output[key] = value.slice();
        return;
      }
      if (isPlainObject(value)) {
        output[key] = deepMerge(isPlainObject(target[key]) ? target[key] : {}, value);
        return;
      }
      output[key] = value;
    });
    return output;
  };

  const clampChannel = (value) => clamp(Math.round(value), 0, 255);

  const parseColorValue = (value) => {
    if (!value) {
      return null;
    }
    const normalized = String(value).trim().toLowerCase();
    if (!normalized || normalized === 'transparent' || normalized === 'inherit' || normalized === 'initial') {
      return null;
    }
    if (normalized.startsWith('rgb')) {
      const match = normalized.match(/rgba?\(([^)]+)\)/);
      if (!match) {
        return null;
      }
      const parts = match[1].split(',').map((part) => part.trim());
      if (parts.length < 3) {
        return null;
      }
      const r = clampChannel(parseFloat(parts[0]));
      const g = clampChannel(parseFloat(parts[1]));
      const b = clampChannel(parseFloat(parts[2]));
      const a = parts.length > 3 ? clamp(parseFloat(parts[3]), 0, 1) : 1;
      if ([r, g, b].some((channel) => Number.isNaN(channel)) || Number.isNaN(a)) {
        return null;
      }
      if (a <= 0) {
        return null;
      }
      return { r, g, b, a };
    }
    if (normalized.startsWith('#')) {
      const hex = normalized.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        const r = clampChannel(parseInt(hex[0] + hex[0], 16));
        const g = clampChannel(parseInt(hex[1] + hex[1], 16));
        const b = clampChannel(parseInt(hex[2] + hex[2], 16));
        const a = hex.length === 4 ? clamp(parseInt(hex[3] + hex[3], 16) / 255, 0, 1) : 1;
        if (a <= 0) {
          return null;
        }
        return { r, g, b, a };
      }
      if (hex.length === 6 || hex.length === 8) {
        const r = clampChannel(parseInt(hex.slice(0, 2), 16));
        const g = clampChannel(parseInt(hex.slice(2, 4), 16));
        const b = clampChannel(parseInt(hex.slice(4, 6), 16));
        const a = hex.length === 8 ? clamp(parseInt(hex.slice(6, 8), 16) / 255, 0, 1) : 1;
        if (a <= 0) {
          return null;
        }
        return { r, g, b, a };
      }
    }
    return null;
  };

  const relativeLuminance = (color) => {
    if (!color) {
      return null;
    }
    const toLinear = (value) => {
      const channel = clamp(value ?? 0, 0, 1);
      if (channel <= 0.03928) {
        return channel / 12.92;
      }
      return Math.pow((channel + 0.055) / 1.055, 2.4);
    };
    const r = toLinear((color.r ?? 0) / 255);
    const g = toLinear((color.g ?? 0) / 255);
    const b = toLinear((color.b ?? 0) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const colorToCss = (color, fallback) => {
    if (!color) {
      return fallback ?? null;
    }
    const alpha = typeof color.a === 'number' ? clamp(color.a, 0, 1) : 1;
    if (alpha >= 1) {
      return `rgb(${clampChannel(color.r)}, ${clampChannel(color.g)}, ${clampChannel(color.b)})`;
    }
    const formattedAlpha = Math.round(alpha * 1000) / 1000;
    return `rgba(${clampChannel(color.r)}, ${clampChannel(color.g)}, ${clampChannel(color.b)}, ${formattedAlpha})`;
  };

  const firstMeaningfulColor = (colors) => {
    if (!Array.isArray(colors)) {
      return null;
    }
    for (const color of colors) {
      if (!color) {
        continue;
      }
      const alpha = typeof color.a === 'number' ? color.a : 1;
      if (alpha <= 0.05) {
        continue;
      }
      if (alpha >= 0.75) {
        return color;
      }
      if (!colors.some((candidate) => candidate && candidate !== color && (candidate.a === undefined || candidate.a >= 0.75))) {
        return color;
      }
    }
    return null;
  };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const ptToPx = (pt) => Math.round((pt * 4) / 3);

  const generateProfileId = () => {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `profile-${crypto.randomUUID()}`;
      }
    } catch (_error) {
      // ignore
    }
    const random = Math.floor(Math.random() * 0xffffff).toString(16);
    return `profile-${Date.now().toString(16)}-${random}`;
  };

  const ensureProfileId = (value, fallbackId) => {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    if (typeof fallbackId === 'string' && fallbackId.trim()) {
      return fallbackId;
    }
    return generateProfileId();
  };

  const normalizeProfile = (profile, fallbackId = 'profile') => {
    const base = { ...PROFILE_DEFAULTS };
    const merged = deepMerge(base, profile || {});

    const fontSize = clamp(Number(merged.fontSize) || base.fontSize, 24, 72);
    const brightness = clamp(Number(merged.brightness) || base.brightness, 0.4, 1.0);
    const contrast = clamp(Number(merged.contrast) || base.contrast, 1.0, 2.0);
    const letterSpacing = clamp(Number(merged.letterSpacing) || base.letterSpacing, -0.05, 0.3);
    const lineHeight = clamp(Number(merged.lineHeight) || base.lineHeight, 1.2, 2.4);

    const fontFamily = merged.fontFamily || base.fontFamily;
    const headingFontFamily = merged.headingFontFamily || merged.fontFamily || base.headingFontFamily;

    return {
      id: ensureProfileId(merged.id, fallbackId),
      name: merged.name || base.name,
      fontSize,
      brightness,
      contrast,
      fontFamily,
      headingFontFamily,
      boldText: Boolean(merged.boldText),
      letterSpacing,
      lineHeight
    };
  };

  const migrateLegacySettings = (rawSettings) => {
    if (!rawSettings || isPlainObject(rawSettings.profiles)) {
      return rawSettings || {};
    }
    const fontSize = Number(rawSettings.fontSize) || PROFILE_DEFAULTS.fontSize;
    const brightness = Number(rawSettings.brightness) || PROFILE_DEFAULTS.brightness;
    const contrast = Number(rawSettings.contrast) || PROFILE_DEFAULTS.contrast;

    const profile = normalizeProfile({
      id: 'default',
      name: t('profileDefaultName', null, 'Default'),
      fontSize,
      brightness,
      contrast
    });

    return {
      enabled: Boolean(rawSettings.enabled),
      activeProfileId: 'default',
      profiles: { default: profile },
      profilesOrder: ['default']
    };
  };

  const normalizeSettingsStructure = (settings) => {
    const migrated = migrateLegacySettings(settings);
    const merged = deepMerge(ACHROMA_DEFAULTS, migrated || {});

    const availableProfiles = isPlainObject(merged.profiles) ? merged.profiles : { default: { ...PROFILE_DEFAULTS } };
    const profiles = {};
    const order = Array.isArray(merged.profilesOrder) ? merged.profilesOrder.filter((id) => typeof id === 'string') : Object.keys(availableProfiles);

    const finalOrder = [];
    const existingIds = new Set();

    const ensureProfile = (id) => {
      const source = availableProfiles[id] || {};
      const normalized = normalizeProfile({ ...source, id }, id);
      profiles[normalized.id] = normalized;
      if (!existingIds.has(normalized.id)) {
        finalOrder.push(normalized.id);
        existingIds.add(normalized.id);
      }
      return normalized;
    };

    order.forEach((id) => {
      if (typeof id !== 'string') {
        return;
      }
      ensureProfile(id);
    });

    Object.keys(availableProfiles).forEach((id) => {
      if (!existingIds.has(id)) {
        ensureProfile(id);
      }
    });

    const activeProfileId = profiles[merged.activeProfileId] ? merged.activeProfileId : finalOrder[0] || 'default';

    const adaptiveMode = Boolean(merged.adaptiveMode);
    const imageAdjustments = {
      enabled: Boolean(merged.imageAdjustments?.enabled),
      desaturate: merged.imageAdjustments?.desaturate !== false,
      contrast: clamp(Number(merged.imageAdjustments?.contrast) || 1.1, 1, 2),
      annotate: Boolean(merged.imageAdjustments?.annotate)
    };

    const customFonts = {
      body: merged.customFonts?.body || PROFILE_DEFAULTS.fontFamily,
      heading: merged.customFonts?.heading || PROFILE_DEFAULTS.headingFontFamily,
      letterSpacing: clamp(Number(merged.customFonts?.letterSpacing) || PROFILE_DEFAULTS.letterSpacing, -0.05, 0.3),
      lineHeight: clamp(Number(merged.customFonts?.lineHeight) || PROFILE_DEFAULTS.lineHeight, 1.2, 2.4),
      boldText: Boolean(merged.customFonts?.boldText)
    };

    const colorLegend = {
      enabled: Boolean(merged.colorLegend?.enabled),
      style: merged.colorLegend?.style === 'pattern' ? 'pattern' : 'text'
    };

    const readingMask = {
      enabled: Boolean(merged.readingMask?.enabled),
      height: clamp(Number(merged.readingMask?.height) || ACHROMA_DEFAULTS.readingMask.height, 80, 400),
      opacity: clamp(Number(merged.readingMask?.opacity) || ACHROMA_DEFAULTS.readingMask.opacity, 0.1, 0.8)
    };

    const onboarding = {
      completed: Boolean(merged.onboarding?.completed)
    };

    return {
      enabled: Boolean(merged.enabled),
      activeProfileId,
      profiles,
      profilesOrder: finalOrder,
      adaptiveMode,
      imageAdjustments,
      customFonts,
      colorLegend,
      readingMask,
      onboarding
    };
  };

  class AchromatopsiaReader {
    constructor() {
      this.isActive = false;
      this.domain = window.location.hostname || 'global';
      this.domainKey = `achromatopsia:${this.domain}`;
      this.defaultKey = 'achromatopsia:defaults';
      this.settings = normalizeSettingsStructure();
      this.profile = normalizeProfile();
      this.toolbar = null;
      this.loadingOverlay = null;
      this.statusNode = null;
      this.toggleButton = null;
      this.originalScrollPosition = 0;
      this.lastErrorMessage = null;
      this.messageListener = null;
      this.storageListener = null;
      this.themeProfile = null;
      this.mutationObserver = null;
      this.colorLegendOverlay = null;
      this.colorLegendData = null;
      this.imageAnnotations = new Map();
      this.readingMaskOverlay = null;
      this.refreshTimeoutId = null;
      this.onboardingOverlay = null;
      this.boundHandlePointerMove = this.handlePointerMoveForMask.bind(this);
      this.boundHandleScroll = this.updateReadingMaskPosition.bind(this);
      this.boundHandleResize = this.updateReadingMaskPosition.bind(this);
      this.boundCloseOnboarding = (this.hideOnboardingOverlay || (() => {})).bind(this);
      this.boundHandleEscape = (this.handleOnboardingKeydown || (() => {})).bind(this);
      this.boundHandleMessage = this.handleMessage.bind(this);
      this.boundHandleStorageChange = this.handleStorageChange.bind(this);
      this.boundHandleKeydown = this.handleKeydown.bind(this);
    }

    async init() {
      await this.loadSettings();
      this.injectToggleButton();
      this.registerMessageListeners();
      this.registerStorageListeners();
      window.addEventListener('keydown', this.boundHandleKeydown, { passive: true });

      if (this.settings.enabled) {
        try {
          await this.activateReader();
        } catch (error) {
          console.error('[AchromatopsiaReader] Failed to auto-activate on load', error);
        }
      }
    }

    async loadSettings() {
      try {
        const [localResult, syncResult] = await Promise.all([
          this.storageGet([this.defaultKey, this.domainKey]),
          this.storageSyncGet ? this.storageSyncGet([this.defaultKey]).catch(() => ({})) : Promise.resolve({})
        ]);
        const defaultRaw = localResult[this.defaultKey] ?? syncResult?.[this.defaultKey];
        const domainRaw = localResult[this.domainKey];
        this.defaultSettings = normalizeSettingsStructure(defaultRaw);
        const combinedRaw = domainRaw ? deepMerge(defaultRaw || {}, domainRaw) : defaultRaw;
        const normalized = normalizeSettingsStructure(combinedRaw);
        this.settings = normalized;
        this.profile = this.getActiveProfile();
      } catch (error) {
        console.error('[AchromatopsiaReader] Unable to load settings; falling back to defaults.', error);
        this.defaultSettings = normalizeSettingsStructure();
        this.settings = normalizeSettingsStructure();
        this.profile = this.getActiveProfile();
      }
    }

    getActiveProfile() {
      if (!this.settings || !isPlainObject(this.settings.profiles)) {
        return normalizeProfile();
      }
      const profile = this.settings.profiles[this.settings.activeProfileId];
      if (profile) {
        return profile;
      }
      const firstId = this.settings.profilesOrder?.[0];
      if (firstId && this.settings.profiles[firstId]) {
        return this.settings.profiles[firstId];
      }
      const fallbackId = Object.keys(this.settings.profiles)[0];
      if (fallbackId) {
        return this.settings.profiles[fallbackId];
      }
      return normalizeProfile();
    }

    async saveSettings(patch = {}, { scope = 'domain', replace = false } = {}) {
      const target = scope === 'defaults' ? this.defaultSettings || normalizeSettingsStructure() : this.settings || normalizeSettingsStructure();
      const baseRaw = replace ? patch : deepMerge(target, patch);
      const mergedRaw = replace && isPlainObject(patch) ? patch : baseRaw;
      const normalized = normalizeSettingsStructure(mergedRaw);
      if (scope === 'defaults') {
        this.defaultSettings = normalized;
      } else {
        this.settings = normalized;
        this.profile = this.getActiveProfile();
      }
      const payload = scope === 'defaults' ? { [this.defaultKey]: normalized } : { [this.domainKey]: normalized };
      try {
        await this.storageSet(payload);
        if (scope === 'defaults' && this.storageSyncSet) {
          await this.storageSyncSet(payload);
        }
      } catch (error) {
        const message = String(error?.message || error || 'Unknown error');
        if (message.includes('Extension context invalidated')) {
          console.warn('[AchromatopsiaReader] Settings save skipped due to extension reload; will retry on next interaction.');
          return;
        }
        console.error('[AchromatopsiaReader] Failed to persist settings', error);
      }
    }

    registerMessageListeners() {
      chrome.runtime.onMessage.removeListener(this.boundHandleMessage);
      chrome.runtime.onMessage.addListener(this.boundHandleMessage);
    }

    registerStorageListeners() {
      chrome.storage.onChanged.removeListener(this.boundHandleStorageChange);
      chrome.storage.onChanged.addListener(this.boundHandleStorageChange);
    }

    handleStorageChange(changes, areaName) {
      if (areaName !== 'local') {
        return;
      }
      if (Object.prototype.hasOwnProperty.call(changes, this.defaultKey)) {
        const { newValue } = changes[this.defaultKey];
        if (newValue) {
          this.defaultSettings = normalizeSettingsStructure(newValue);
        }
      }
      if (Object.prototype.hasOwnProperty.call(changes, this.domainKey)) {
        const { newValue } = changes[this.domainKey];
        if (newValue) {
          const updated = normalizeSettingsStructure(newValue);
          const wasActive = this.isActive;
          this.settings = updated;
          this.profile = this.getActiveProfile();
          if (wasActive) {
            this.applyAchromatopsiaStyles();
            this.updateInlineStatus();
          }
          this.updateToggleButton();
        }
      }
    }

    handleMessage(message, _sender, sendResponse) {
      if (!message || message.scope !== ACHROMA_SCOPE) {
        return false;
      }

      const respond = (payload) => {
        try {
          sendResponse(payload);
        } catch (error) {
          console.warn('[AchromatopsiaReader] Failed to send response', error);
        }
      };

      switch (message.type) {
        case 'GET_STATE': {
          respond({
            settings: this.settings,
            defaults: this.defaultSettings,
            active: this.isActive,
            error: this.lastErrorMessage,
            profile: this.profile,
            domain: this.domain,
            theme: this.themeProfile
          });
          return false;
        }
        case 'TOGGLE': {
          const { enabled } = message.payload || {};
          const targetState = typeof enabled === 'boolean' ? enabled : !this.isActive;
          this.toggleReader(targetState)
            .then((state) => respond({ ok: true, active: state }))
            .catch((error) => {
              console.error('[AchromatopsiaReader] Toggle failed', error);
              respond({ ok: false, error: error.message });
            });
          return true;
        }
        case 'UPDATE_SETTINGS': {
          const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
          const { updates, scope, replace } = payload;
          const changes = updates && isPlainObject(updates) ? updates : { ...payload };
          if (!(updates && isPlainObject(updates))) {
            delete changes.scope;
            delete changes.replace;
          }
          this.applySettingChanges(changes, { scope, replace: Boolean(replace) })
            .then(() => respond({ ok: true }))
            .catch((error) => {
              console.error('[AchromatopsiaReader] Update settings failed', error);
              respond({ ok: false, error: error.message });
            });
          return true;
        }
        case 'OPEN_POPUP': {
          respond({ ok: true });
          return false;
        }
        default:
          return false;
      }
    }

    async toggleReader(enable) {
      if (enable && this.isActive) {
        return true;
      }
      if (!enable && !this.isActive) {
        return false;
      }
      if (enable) {
        await this.activateReader();
        await this.saveSettings({ enabled: true });
        return true;
      }
      await this.deactivateReader();
      await this.saveSettings({ enabled: false });
      return false;
    }

    async applySettingChanges(updates, options) {
      await this.saveSettings(updates, options);
      this.profile = this.getActiveProfile();
      if (this.isActive) {
        this.applyAchromatopsiaStyles();
        this.applyImageAdjustments();
        this.updateColorLegend();
        this.updateReadingMask();
        if (this.settings?.adaptiveMode) {
          this.setupAdaptiveMode();
        } else {
          this.teardownAdaptiveMode();
        }
        this.updateInlineStatus();
      }
    }




    injectToggleButton() {
      if (document.querySelector('.achromatopsia-page-toggle')) {
        return;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'achromatopsia-page-toggle';
      button.setAttribute('aria-pressed', String(this.settings.enabled));
      button.setAttribute('aria-label', this.settings.enabled ? t('exitReaderLabel', null, 'Exit Reader') : t('readerModeLabel', null, 'Reader Mode'));
      button.title = this.settings.enabled ? t('exitReaderLabel', null, 'Exit Reader') : t('readerModeLabel', null, 'Reader Mode');
      button.lang = getUILanguage();
      button.textContent = 'R';

      button.addEventListener('click', () => {
        this.toggleReader(!this.isActive).catch((error) => {
          console.error('[AchromatopsiaReader] Toggle via button failed', error);
          this.announceStatus(t('errorToggle', null, 'Unable to toggle reader. See console for details.'));
        });
      });
      document.body.appendChild(button);
      this.toggleButton = button;
    }

    updateToggleButton() {
      if (!this.toggleButton) {
        return;
      }
      const label = this.isActive ? t('exitReaderLabel', null, 'Exit Reader') : t('readerModeLabel', null, 'Reader Mode');
      this.toggleButton.setAttribute('aria-label', label);
      this.toggleButton.title = label;
      this.toggleButton.setAttribute('aria-pressed', String(this.isActive));
    }

    handleKeydown(event) {
      if (event.altKey && event.shiftKey && !event.repeat && event.code === 'KeyA') {
        event.preventDefault();
        this.toggleReader(!this.isActive).catch((error) => {
          console.error('[AchromatopsiaReader] Toggle via keyboard failed', error);
          this.announceStatus(t('errorToggle', null, 'Unable to toggle reader. See console for details.'));
        });
      }
    }

    detectExistingTheme() {
      try {
        const docElement = document.documentElement;
        const body = document.body || docElement;
        const docStyles = window.getComputedStyle(docElement);
        const bodyStyles = window.getComputedStyle(body);

        const backgroundCandidates = [
          parseColorValue(bodyStyles.backgroundColor),
          parseColorValue(docStyles.backgroundColor),
          this.readThemeColorMeta()
        ];

        const background = firstMeaningfulColor(backgroundCandidates);
        const textColor = parseColorValue(bodyStyles.color);
        let linkColor = null;
        const linkSample = body.querySelector('a[href]');
        if (linkSample) {
          try {
            linkColor = parseColorValue(window.getComputedStyle(linkSample).color);
          } catch (error) {
            console.warn('[AchromatopsiaReader] Unable to sample link color', error);
          }
        }

        const attributeScheme = this.resolveThemeFromAttributes();
        const colorScheme = attributeScheme || this.resolveExplicitColorScheme(bodyStyles, docStyles);
        const backgroundLuminance = relativeLuminance(background);
        const textLuminance = relativeLuminance(textColor);
        const prefersDark = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;

        const mode = this.chooseThemeMode({
          colorScheme,
          attributeScheme,
          backgroundLuminance,
          textLuminance,
          prefersDark
        });

        const palette = this.buildPaletteForMode(mode, {
          background,
          textColor,
          linkColor
        });

        return { mode, palette };
      } catch (error) {
        console.warn('[AchromatopsiaReader] Theme detection failed; using light defaults.', error);
        return { mode: 'light', palette: { ...DEFAULT_LIGHT_PALETTE } };
      }
    }

    readThemeColorMeta() {
      try {
        const metaTheme = document.querySelector('meta[name="theme-color" i]');
        if (metaTheme && metaTheme.content) {
          const parsed = parseColorValue(metaTheme.content);
          if (parsed) {
            return parsed;
          }
        }
      } catch (error) {
        console.warn('[AchromatopsiaReader] Failed to read theme-color meta tag', error);
      }
      return null;
    }

    resolveExplicitColorScheme(...styleSources) {
      for (const styles of styleSources) {
        if (!styles) {
          continue;
        }
        const schemeValue = styles.colorScheme || (typeof styles.getPropertyValue === 'function' ? styles.getPropertyValue('color-scheme') : null);
        if (schemeValue) {
          const normalized = String(schemeValue).toLowerCase();
          const hasDark = normalized.includes('dark');
          const hasLight = normalized.includes('light');
          if (hasDark && !hasLight) {
            return 'dark';
          }
          if (hasLight && !hasDark) {
            return 'light';
          }
        }
      }
      try {
        const meta = document.querySelector('meta[name="color-scheme" i]');
        if (meta && meta.content) {
          const content = meta.content.toLowerCase();
          const hasDark = content.includes('dark');
          const hasLight = content.includes('light');
          if (hasDark && !hasLight) {
            return 'dark';
          }
          if (hasLight && !hasDark) {
            return 'light';
          }
        }
      } catch (error) {
        console.warn('[AchromatopsiaReader] Failed to read color-scheme meta tag', error);
      }
      return null;
    }

    resolveThemeFromAttributes() {
      const attributeNames = ['data-theme', 'data-color-mode', 'data-mode', 'data-ui-theme', 'data-bs-theme', 'data-theme-mode'];
      const classKeywords = ['dark', 'theme-dark', 'dark-mode', 'mode-dark', 'night', 'night-mode'];
      const nodes = [document.documentElement, document.body];

      for (const node of nodes) {
        if (!node) {
          continue;
        }
        for (const attr of attributeNames) {
          const value = node.getAttribute?.(attr);
          if (!value) {
            continue;
          }
          const normalized = String(value).toLowerCase();
          const hasDark = normalized.includes('dark') || normalized.includes('night');
          const hasLight = normalized.includes('light');
          if (hasDark && !hasLight) {
            return 'dark';
          }
          if (hasLight && !hasDark) {
            return 'light';
          }
        }

        if (node.classList && node.classList.length) {
          const classList = Array.from(node.classList, (token) => token.toLowerCase());
          const hasDarkClass = classKeywords.some((keyword) => classList.includes(keyword));
          if (hasDarkClass) {
            return 'dark';
          }
          const hasLightClass = classList.some((token) => token.includes('light') || token.includes('theme-light'));
          if (hasLightClass) {
            return 'light';
          }
        }
      }

      return null;
    }

    chooseThemeMode({ colorScheme, attributeScheme, backgroundLuminance, textLuminance, prefersDark }) {
      if (attributeScheme === 'dark' || attributeScheme === 'light') {
        return attributeScheme;
      }
      if (colorScheme === 'dark') {
        return 'dark';
      }
      if (colorScheme === 'light') {
        return 'light';
      }
      if (typeof backgroundLuminance === 'number' && typeof textLuminance === 'number') {
        if (backgroundLuminance < textLuminance && backgroundLuminance <= 0.45) {
          return 'dark';
        }
        if (backgroundLuminance > textLuminance && backgroundLuminance >= 0.55) {
          return 'light';
        }
      }
      if (typeof backgroundLuminance === 'number') {
        if (backgroundLuminance <= 0.35) {
          return 'dark';
        }
        if (backgroundLuminance >= 0.7) {
          return 'light';
        }
      }
      return prefersDark ? 'dark' : 'light';
    }

    buildPaletteForMode(mode, colors = {}) {
      const source = mode === 'dark' ? DEFAULT_DARK_PALETTE : DEFAULT_LIGHT_PALETTE;
      const background = colorToCss(colors.background, source.background) || source.background;
      const textColor = colorToCss(colors.textColor, source.textColor) || source.textColor;
      const linkColor = colorToCss(colors.linkColor, source.linkColor) || source.linkColor;

      if (mode === 'dark') {
        return {
          background,
          panelBackground: source.panelBackground,
          textColor,
          linkColor,
          borderColor: source.borderColor,
          buttonBackground: source.buttonBackground,
          buttonHover: source.buttonHover,
          buttonText: source.buttonText
        };
      }

      return {
        background,
        panelBackground: source.panelBackground,
        textColor,
        linkColor,
        borderColor: source.borderColor,
        buttonBackground: source.buttonBackground,
        buttonHover: source.buttonHover,
        buttonText: source.buttonText
      };
    }

    async activateReader() {
      if (this.isActive) {
        return;
      }

      const detectedTheme = this.detectExistingTheme();
      this.showLoadingState(t('loadingApplying', null, 'Applying accessible view…'));
      try {
        this.originalScrollPosition = window.scrollY;
        this.themeProfile = detectedTheme;
        document.documentElement.classList.add('achromatopsia-active');
        document.body.classList.add('achromatopsia-adjusted');
        this.ensureToolbar();
        this.applyAchromatopsiaStyles();
        this.applyImageAdjustments();
        this.updateColorLegend();
        this.updateReadingMask();
        this.setupAdaptiveMode();
        this.updateInlineStatus();
        this.isActive = true;
        this.lastErrorMessage = null;
        this.updateToggleButton();
        this.announceStatus(t('statusActivated', null, 'Achromatopsia adjustments enabled.'));
      } catch (error) {
        this.lastErrorMessage = error.message;
        throw error;
      } finally {
        this.hideLoadingState();
      }
    }

    async deactivateReader() {
      if (!this.isActive) {
        return;
      }

      if (this.toolbar && this.toolbar.parentElement) {
        this.toolbar.parentElement.removeChild(this.toolbar);
      }
      this.toolbar = null;
      this.statusNode = null;
      document.body.classList.remove('achromatopsia-adjusted');
      document.documentElement.classList.remove('achromatopsia-active');
      document.body?.classList.remove('achromatopsia-images-enabled');

      const root = document.documentElement.style;
      root.removeProperty('--achroma-font-size');
      root.removeProperty('--achroma-heading-size');
      root.removeProperty('--achroma-base-font');
      root.removeProperty('--achroma-brightness');
      root.removeProperty('--achroma-contrast');
      root.removeProperty('--achroma-scroll-padding');
      root.removeProperty('--achroma-background');
      root.removeProperty('--achroma-panel-background');
      root.removeProperty('--achroma-text-color');
      root.removeProperty('--achroma-link-color');
      root.removeProperty('--achroma-border-color');
      root.removeProperty('--achroma-button-background');
      root.removeProperty('--achroma-button-hover');
      root.removeProperty('--achroma-button-text');
      root.removeProperty('--achroma-body-font');
      root.removeProperty('--achroma-heading-font');
      root.removeProperty('--achroma-letter-spacing');
      root.removeProperty('--achroma-line-height');
      root.removeProperty('--achroma-bold-weight');
      root.removeProperty('--achroma-image-contrast');
      root.removeProperty('--achroma-image-desaturate');
      root.removeProperty('--achroma-image-annotation-opacity');

      this.isActive = false;
      this.lastErrorMessage = null;
      this.themeProfile = null;
      this.teardownAdaptiveMode();
      this.removeColorLegend();
      this.clearImageAnnotations();
      this.disableReadingMask();
      this.updateToggleButton();
      window.scrollTo({ top: this.originalScrollPosition, behavior: 'auto' });
      this.announceStatus(t('statusDeactivated', null, 'Reader deactivated.'));
    }

    ensureToolbar() {
      if (this.toolbar && this.toolbar.isConnected) {
        return this.toolbar;
      }

      const toolbar = document.createElement('div');
      toolbar.className = 'achromatopsia-inline-toolbar';
      toolbar.setAttribute('role', 'region');
      toolbar.setAttribute('aria-label', t('toolbarRegionLabel', null, 'Achromatopsia controls'));
      toolbar.lang = getUILanguage();

      const exitButton = document.createElement('button');
      exitButton.type = 'button';
      exitButton.className = 'achromatopsia-inline-toolbar__button';
      exitButton.textContent = t('exitReaderLabel', null, 'Exit Reader');
      exitButton.lang = getUILanguage();
      exitButton.addEventListener('click', () => {
        this.toggleReader(false).catch((error) => {
          console.error('[AchromatopsiaReader] Failed to deactivate from toolbar', error);
          this.announceStatus(t('errorExit', null, 'Unable to exit reader. See console for details.'));
        });
      });

      const settingsButton = document.createElement('button');
      settingsButton.type = 'button';
      settingsButton.className = 'achromatopsia-inline-toolbar__button';
      settingsButton.textContent = t('toolbarSettings', null, 'Settings');
      settingsButton.lang = getUILanguage();
      settingsButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ scope: ACHROMA_SCOPE, type: 'OPEN_POPUP' });
        this.announceStatus(t('statusPopupOpened', null, 'Settings popup opened.'));
      });

      const status = document.createElement('div');
      status.className = 'achromatopsia-inline-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.lang = getUILanguage();

      toolbar.append(exitButton, settingsButton, status);
      document.body.appendChild(toolbar);

      this.toolbar = toolbar;
      this.statusNode = status;
      return toolbar;
    }

    applyAchromatopsiaStyles() {
      const profile = this.profile || this.getActiveProfile();
      const fontPx = ptToPx(profile.fontSize);
      const baseFontPx = Math.max(18, Math.round(fontPx * 0.55));
      const headingPx = Math.round(fontPx * 1.35);
      const root = document.documentElement.style;
      const palette = (this.themeProfile && this.themeProfile.palette) || DEFAULT_LIGHT_PALETTE;

      root.setProperty('--achroma-font-size', `${fontPx}px`);
      root.setProperty('--achroma-heading-size', `${headingPx}px`);
      root.setProperty('--achroma-base-font', `${baseFontPx}px`);
      root.setProperty('--achroma-brightness', String(profile.brightness));
      root.setProperty('--achroma-contrast', String(profile.contrast));
      root.setProperty('--achroma-scroll-padding', '5rem');
      root.setProperty('--achroma-background', palette.background);
      root.setProperty('--achroma-panel-background', palette.panelBackground);
      root.setProperty('--achroma-text-color', palette.textColor);
      root.setProperty('--achroma-link-color', palette.linkColor);
      root.setProperty('--achroma-border-color', palette.borderColor);
      root.setProperty('--achroma-button-background', palette.buttonBackground);
      root.setProperty('--achroma-button-hover', palette.buttonHover);
      root.setProperty('--achroma-button-text', palette.buttonText);
      root.setProperty('--achroma-body-font', profile.fontFamily);
      root.setProperty('--achroma-heading-font', profile.headingFontFamily);
      root.setProperty('--achroma-letter-spacing', `${profile.letterSpacing}em`);
      root.setProperty('--achroma-line-height', `${profile.lineHeight}`);
      root.setProperty('--achroma-bold-weight', profile.boldText ? '700' : '600');

      if (this.toolbar) {
        this.toolbar.dataset.fontSize = `${ptToPx(profile.fontSize)}px`;
        this.toolbar.dataset.brightness = `${Math.round(profile.brightness * 100)}%`;
        this.toolbar.dataset.contrast = `${Math.round(profile.contrast * 100)}%`;
      }
    }

    updateInlineStatus() {
      if (!this.statusNode) {
        return;
      }
      const profile = this.profile || this.getActiveProfile();
      const parts = [
        t('statusInlineFont', [formatPixels(ptToPx(profile.fontSize))], `Font ${ptToPx(profile.fontSize)}px`),
        t('statusInlineBrightness', [formatPercent(profile.brightness * 100)], `Brightness ${Math.round(profile.brightness * 100)}%`),
        t('statusInlineContrast', [formatPercent(profile.contrast * 100)], `Contrast ${Math.round(profile.contrast * 100)}%`)
      ];
      this.statusNode.textContent = parts.join(' · ');
    }

    applyImageAdjustments({ nodes } = {}) {
      const settings = this.settings?.imageAdjustments || {};
      const body = document.body;
      const root = document.documentElement.style;
      if (!settings.enabled || !body) {
        if (body) {
          body.classList.remove('achromatopsia-images-enabled');
        }
        root.removeProperty('--achroma-image-contrast');
        root.removeProperty('--achroma-image-desaturate');
        root.removeProperty('--achroma-image-annotation-opacity');
        this.clearImageAnnotations();
        return;
      }

      body.classList.add('achromatopsia-images-enabled');
      root.setProperty('--achroma-image-contrast', String(settings.contrast));
      root.setProperty('--achroma-image-desaturate', settings.desaturate ? '1' : '0');
      root.setProperty('--achroma-image-annotation-opacity', settings.annotate ? '1' : '0');

      if (settings.annotate) {
        const images = nodes ? this.collectImages(nodes) : Array.from(document.querySelectorAll('img, [role="img"]'));
        images.forEach((img) => this.annotateImage(img));
      } else {
        this.clearImageAnnotations();
      }
    }

    collectImages(nodes) {
      if (!nodes) {
        return [];
      }
      const items = [];
      const visit = (node) => {
        if (!node) {
          return;
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.matches('img, [role="img"]')) {
            items.push(node);
          }
          node.querySelectorAll?.('img, [role="img"]').forEach((img) => items.push(img));
        }
      };
      if (typeof nodes.forEach === 'function') {
        nodes.forEach((node) => visit(node));
      } else {
        Array.from(nodes).forEach((node) => visit(node));
      }
      return items;
    }

    annotateImage(node) {
      if (!node || node.dataset?.achromaAnnotated === 'true') {
        return;
      }
      const altText = (node.getAttribute?.('alt') || node.getAttribute?.('aria-label') || node.getAttribute?.('title') || '').trim();
      if (!altText) {
        return;
      }
      const trimmed = altText.length > 160 ? `${altText.slice(0, 157)}…` : altText;
      let annotation = this.imageAnnotations.get(node);
      if (!annotation) {
        annotation = document.createElement('span');
        annotation.className = 'achromatopsia-image-annotation';
        annotation.setAttribute('aria-hidden', 'true');
        node.insertAdjacentElement('afterend', annotation);
        this.imageAnnotations.set(node, annotation);
      }
      annotation.textContent = trimmed;
      node.dataset.achromaAnnotated = 'true';
    }

    clearImageAnnotations() {
      if (!this.imageAnnotations) {
        return;
      }
      for (const [node, annotation] of this.imageAnnotations.entries()) {
        if (node) {
          delete node.dataset?.achromaAnnotated;
        }
        if (annotation?.parentElement) {
          annotation.parentElement.removeChild(annotation);
        }
      }
      this.imageAnnotations.clear();
    }

    removeAnnotationsFromNodes(nodes) {
      if (!nodes || !this.imageAnnotations) {
        return;
      }
      const cleanup = (node) => {
        const annotation = this.imageAnnotations.get(node);
        if (annotation?.parentElement) {
          annotation.parentElement.removeChild(annotation);
        }
        if (node?.dataset) {
          delete node.dataset.achromaAnnotated;
        }
        this.imageAnnotations.delete(node);
      };
      nodes.forEach?.((node) => {
        if (node?.nodeType === Node.ELEMENT_NODE) {
          if (node.matches?.('img, [role="img"]')) {
            cleanup(node);
          }
          node.querySelectorAll?.('img, [role="img"]').forEach((img) => cleanup(img));
        }
      });
    }

    updateColorLegend() {
      const config = this.settings?.colorLegend || {};
      if (!config.enabled) {
        this.removeColorLegend();
        return;
      }

      const entries = this.collectColorLegendEntries();
      if (!entries.length) {
        this.removeColorLegend();
        return;
      }

      const overlay = this.ensureColorLegend();
      overlay.innerHTML = '';
      entries.forEach((entry, index) => {
        overlay.appendChild(this.createLegendItem(entry, index));
      });

      this.removeColorPatterns();
      if (config.style === 'pattern') {
        this.applyColorPatterns(entries);
      } else {
        this.removeColorPatterns();
      }

      this.colorLegendData = { entries };
    }

    collectColorLegendEntries() {
      const selectors = [
        '[data-color]',
        '[class*="badge"]',
        '[class*="tag"]',
        '[class*="pill"]',
        '[class*="status"]',
        '[role="status"]',
        '[role="option"]'
      ];
      const candidates = new Set();
      selectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((node) => candidates.add(node));
      });

      const entries = new Map();
      let scanned = 0;
      candidates.forEach((node) => {
        if (!node || scanned > 800) {
          return;
        }
        scanned += 1;
        const styles = window.getComputedStyle(node);
        const background = parseColorValue(styles.backgroundColor);
        if (!background || (typeof background.a === 'number' && background.a < 0.1)) {
          return;
        }
        const text = (node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '').trim();
        if (!text) {
          return;
        }
        const key = `${background.r}-${background.g}-${background.b}-${Math.round((background.a ?? 1) * 100)}`;
        if (!entries.has(key)) {
          entries.set(key, {
            key,
            color: background,
            labels: new Set(),
            nodes: new Set()
          });
        }
        const entry = entries.get(key);
        entry.labels.add(text);
        entry.nodes.add(node);
      });

      const prepared = Array.from(entries.values())
        .map((entry) => ({
          ...entry,
          label: Array.from(entry.labels).slice(0, 3).join(', ')
        }))
        .filter((entry) => entry.label)
        .slice(0, 8);

      return prepared;
    }

    ensureColorLegend() {
      if (this.colorLegendOverlay && this.colorLegendOverlay.isConnected) {
        return this.colorLegendOverlay;
      }
      const overlay = document.createElement('aside');
      overlay.className = 'achromatopsia-color-legend';
      overlay.setAttribute('aria-label', 'Color legend');
      document.body.appendChild(overlay);
      this.colorLegendOverlay = overlay;
      return overlay;
    }

    createLegendItem(entry, index) {
      const item = document.createElement('div');
      item.className = 'achromatopsia-color-legend__item';

      const swatch = document.createElement('span');
      swatch.className = 'achromatopsia-color-legend__swatch';
      swatch.style.backgroundColor = colorToCss(entry.color, '#ccc');
      swatch.dataset.patternIndex = String(index);

      const label = document.createElement('span');
      label.className = 'achromatopsia-color-legend__label';
      label.textContent = entry.label;

      item.append(swatch, label);
      return item;
    }

    applyColorPatterns(entries) {
      const patterns = [
        'repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.35) 0 8px, transparent 8px 16px)',
        'repeating-linear-gradient(-45deg, rgba(255, 255, 255, 0.35) 0 10px, transparent 10px 20px)',
        'repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.35) 0 6px, transparent 6px 12px)',
        'repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.25) 0 12px, transparent 12px 24px)',
        'repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.4) 0 6px, transparent 6px 12px)'
      ];
      const appliedNodes = new Set();
      entries.forEach((entry, index) => {
        const pattern = patterns[index % patterns.length];
        entry.nodes.forEach((node) => {
          if (!node) {
            return;
          }
          node.classList.add('achromatopsia-color-pattern');
          node.style.setProperty('--achroma-pattern-overlay', pattern);
          const computed = window.getComputedStyle(node);
          if (computed.position === 'static') {
            node.dataset.achromaPatternPosition = 'static';
            node.style.position = 'relative';
          }
          appliedNodes.add(node);
        });
      });
      this.colorLegendData = { ...(this.colorLegendData || {}), appliedNodes };
    }

    removeColorPatterns() {
      const nodes = this.colorLegendData?.appliedNodes;
      if (!nodes) {
        return;
      }
      nodes.forEach((node) => {
        if (!node) {
          return;
        }
        node.classList.remove('achromatopsia-color-pattern');
        node.style.removeProperty('--achroma-pattern-overlay');
        if (node.dataset?.achromaPatternPosition === 'static') {
          node.style.position = '';
          delete node.dataset.achromaPatternPosition;
        }
      });
      this.colorLegendData.appliedNodes = null;
    }

    removeColorLegend() {
      this.removeColorPatterns();
      if (this.colorLegendOverlay?.parentElement) {
        this.colorLegendOverlay.parentElement.removeChild(this.colorLegendOverlay);
      }
      this.colorLegendOverlay = null;
      this.colorLegendData = null;
    }

    updateReadingMask() {
      const config = this.settings?.readingMask || {};
      if (!config.enabled) {
        this.disableReadingMask();
        return;
      }
      this.enableReadingMask();
      this.updateReadingMaskPosition();
    }

    enableReadingMask() {
      if (this.readingMaskOverlay) {
        return;
      }
      const container = document.createElement('div');
      container.className = 'achromatopsia-reading-mask';
      container.setAttribute('aria-hidden', 'true');

      const topShade = document.createElement('div');
      topShade.className = 'achromatopsia-reading-mask__segment achromatopsia-reading-mask__segment--top';
      const bottomShade = document.createElement('div');
      bottomShade.className = 'achromatopsia-reading-mask__segment achromatopsia-reading-mask__segment--bottom';

      container.append(topShade, bottomShade);
      document.body.appendChild(container);

      this.readingMaskOverlay = {
        container,
        topShade,
        bottomShade,
        lastY: window.innerHeight / 2
      };

      document.addEventListener('mousemove', this.boundHandlePointerMove, { passive: true });
      window.addEventListener('scroll', this.boundHandleScroll, { passive: true });
      window.addEventListener('resize', this.boundHandleResize, { passive: true });
    }

    disableReadingMask() {
      if (!this.readingMaskOverlay) {
        return;
      }
      document.removeEventListener('mousemove', this.boundHandlePointerMove);
      window.removeEventListener('scroll', this.boundHandleScroll);
      window.removeEventListener('resize', this.boundHandleResize);
      const { container } = this.readingMaskOverlay;
      if (container?.parentElement) {
        container.parentElement.removeChild(container);
      }
      this.readingMaskOverlay = null;
    }

    handlePointerMoveForMask(event) {
      if (!this.readingMaskOverlay) {
        return;
      }
      this.readingMaskOverlay.lastY = event.clientY;
      this.updateReadingMaskPosition();
    }

    updateReadingMaskPosition() {
      if (!this.readingMaskOverlay) {
        return;
      }
      const { topShade, bottomShade, lastY } = this.readingMaskOverlay;
      const height = this.settings?.readingMask?.height || ACHROMA_DEFAULTS.readingMask.height;
      const opacity = this.settings?.readingMask?.opacity || ACHROMA_DEFAULTS.readingMask.opacity;
      const center = Math.max(height / 2, Math.min(window.innerHeight - height / 2, lastY ?? window.innerHeight / 2));
      const topHeight = Math.max(0, center - height / 2);
      const bottomHeight = Math.max(0, window.innerHeight - (center + height / 2));

      topShade.style.height = `${topHeight}px`;
      bottomShade.style.height = `${bottomHeight}px`;
      topShade.style.setProperty('--achroma-mask-opacity', String(opacity));
      bottomShade.style.setProperty('--achroma-mask-opacity', String(opacity));
    }

    setupAdaptiveMode() {
      if (!this.settings?.adaptiveMode || this.mutationObserver) {
        return;
      }
      if (!document.body) {
        return;
      }
      this.mutationObserver = new MutationObserver((mutations) => this.handleMutations(mutations));
      this.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    teardownAdaptiveMode() {
      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
      }
      this.mutationObserver = null;
      window.clearTimeout(this.refreshTimeoutId);
      this.refreshTimeoutId = null;
    }

    handleMutations(mutations) {
      if (!Array.isArray(mutations) || !this.settings?.adaptiveMode) {
        return;
      }
      const addedNodes = [];
      const removedNodes = [];
      mutations.forEach((mutation) => {
        mutation.addedNodes && addedNodes.push(...mutation.addedNodes);
        mutation.removedNodes && removedNodes.push(...mutation.removedNodes);
      });
      if (addedNodes.length && this.settings.imageAdjustments?.enabled) {
        this.applyImageAdjustments({ nodes: addedNodes });
      }
      if (removedNodes.length && this.imageAnnotations.size) {
        this.removeAnnotationsFromNodes(removedNodes);
      }
      if (this.settings.colorLegend?.enabled) {
        this.scheduleLegendRefresh();
      }
    }

    scheduleLegendRefresh() {
      window.clearTimeout(this.refreshTimeoutId);
      this.refreshTimeoutId = window.setTimeout(() => {
        this.refreshTimeoutId = null;
        if (this.isActive && this.settings?.colorLegend?.enabled) {
          this.updateColorLegend();
        }
      }, 200);
    }


    announceStatus(message) {
      if (!message) {
        return;
      }
      if (this.statusNode) {
        this.statusNode.textContent = message;
        window.setTimeout(() => this.updateInlineStatus(), 3000);
      }
    }

    showLoadingState(message) {
      this.hideLoadingState();
      const overlay = document.createElement('div');
      overlay.className = 'achromatopsia-loading';
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'assertive');
      overlay.lang = getUILanguage();
      overlay.textContent = message || t('loadingDefault', null, 'Loading…');
      document.body.appendChild(overlay);
      this.loadingOverlay = overlay;
    }

    hideLoadingState() {
      if (this.loadingOverlay && this.loadingOverlay.parentElement) {
        this.loadingOverlay.parentElement.removeChild(this.loadingOverlay);
      }
      this.loadingOverlay = null;
    }

    async storageGet(keys) {
      if (!chrome?.storage?.local) {
        console.warn('[AchromatopsiaReader] chrome.storage.local unavailable; using in-memory fallback.');
        if (!keys) {
          return Object.fromEntries(memoryStorage.entries());
        }
        const output = {};
        (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
          if (memoryStorage.has(key)) {
            output[key] = memoryStorage.get(key);
          }
        });
        return output;
      }
      return new Promise((resolve, reject) => {
        try {
          chrome.storage.local.get(keys, (result) => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(error);
              return;
            }
            resolve(result);
          });
        } catch (error) {
          reject(error);
        }
      });
    }

    async storageSet(items) {
      if (!chrome?.storage?.local) {
        console.warn('[AchromatopsiaReader] chrome.storage.local unavailable; caching settings in memory only.');
        Object.entries(items || {}).forEach(([key, value]) => {
          memoryStorage.set(key, value);
        });
        return;
      }
      return new Promise((resolve, reject) => {
        try {
          chrome.storage.local.set(items, () => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(error);
              return;
            }
            Object.entries(items || {}).forEach(([key, value]) => {
              memoryStorage.set(key, value);
            });
            resolve();
          });
        } catch (error) {
          reject(error);
        }
      });
    }

    async storageSyncGet(keys) {
      if (!chrome.storage?.sync) {
        return {};
      }
      return new Promise((resolve, reject) => {
        try {
          chrome.storage.sync.get(keys, (result) => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(error);
              return;
            }
            resolve(result);
          });
        } catch (error) {
          reject(error);
        }
      });
    }

    async storageSyncSet(items) {
      if (!chrome.storage?.sync) {
        return;
      }
      return new Promise((resolve, reject) => {
        try {
          chrome.storage.sync.set(items, () => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        } catch (error) {
          reject(error);
        }
      });
    }
  }

  const reader = new AchromatopsiaReader();
  reader.init().catch((error) => {
    console.error('[AchromatopsiaReader] Failed to initialise content script', error);
  });
})();
