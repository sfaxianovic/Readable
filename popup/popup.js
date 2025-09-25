const ACHROMA_SCOPE = 'ACHROMA_READER';

const state = {
  tabId: null,
  tabUrl: null,
  settings: null,
  defaults: null,
  active: false,
  isEligible: true,
  pendingProfileChanges: {},
  pendingGeneralPatch: {},
  profileCommitTimer: null,
  settingsCommitTimer: null,
  grantAccessHandler: null,
  hydrateRetried: false
};

const elements = {};
const nullableElements = [
  'adaptiveMode',
  'imageEnhance',
  'imageOptions',
  'imageDesaturate',
  'imageAnnotate',
  'imageContrast',
  'imageContrastValue',
  'legendEnabled',
  'legendOptions',
  'legendStyle',
  'readingMaskToggle',
  'maskOptions',
  'maskHeight',
  'maskHeightValue',
  'maskOpacity',
  'maskOpacityValue'
];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const ptToPx = (pt) => Math.round((pt * 4) / 3);
const pxToPt = (px) => Math.round((px * 3) / 4);

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
    console.warn('[Popup] Unable to resolve i18n message', key, error);
  }
  if (Array.isArray(substitutions) && substitutions.length) {
    return substitutions.join(' ');
  }
  return key;
};

const t = (key, substitutions) => getMessage(key, substitutions);

const formatPixels = (value) => t('unitPixels', String(Math.round(value)));
const formatPercent = (value) => t('unitPercent', String(Math.round(value)));
const formatEm = (value) => t('unitEm', Number.parseFloat(value).toFixed(2));

function applyLocalization() {
  try {
    const lang = chrome?.i18n?.getUILanguage?.() || navigator.language || 'en';
    document.documentElement.lang = lang;
  } catch (_error) {
    document.documentElement.lang = document.documentElement.lang || 'en';
  }
  document.title = t('appTitle');
  document.querySelectorAll('[data-i18n-text]').forEach((node) => {
    node.textContent = t(node.dataset.i18nText);
  });
  document.querySelectorAll('[data-i18n-html]').forEach((node) => {
    node.innerHTML = t(node.dataset.i18nHtml);
  });
  document.querySelectorAll('[data-i18n-title], [data-i18n-ariaLabel], [data-i18n-placeholder]').forEach((node) => {
    Object.entries(node.dataset).forEach(([dataKey, value]) => {
      if (!dataKey.startsWith('i18n') || dataKey === 'i18nText' || dataKey === 'i18nHtml') {
        return;
      }
      const attributeName = dataKey
        .slice(4)
        .replace(/^[A-Z]/, (match) => match.toLowerCase())
        .replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
      node.setAttribute(attributeName, t(value));
    });
  });
}

const deepClone = (value) => {
  try {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
  } catch (_error) {
    // ignore
  }
  return JSON.parse(JSON.stringify(value ?? {}));
};

const mergePatch = (target, patch) => {
  const output = { ...target };
  Object.keys(patch || {}).forEach((key) => {
    const value = patch[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = mergePatch(target?.[key] ?? {}, value);
    } else {
      output[key] = value;
    }
  });
  return output;
};

const debounce = (fn, wait = 200) => {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn.apply(null, args), wait);
  };
};

function cacheElements() {
  elements.toggle = document.getElementById('toggleReader');
  elements.status = document.getElementById('status');

  elements.profileSelect = document.getElementById('profileSelect');
  elements.profileAdd = document.getElementById('profileAdd');
  elements.profileDuplicate = document.getElementById('profileDuplicate');
  elements.profileRename = document.getElementById('profileRename');
  elements.profileDelete = document.getElementById('profileDelete');
  elements.profileSetDefault = document.getElementById('profileSetDefault');

  elements.fontSize = document.getElementById('fontSize');
  elements.fontValue = document.getElementById('fontSizeValue');
  elements.brightness = document.getElementById('brightness');
  elements.brightnessValue = document.getElementById('brightnessValue');
  elements.contrast = document.getElementById('contrast');
  elements.contrastValue = document.getElementById('contrastValue');

  elements.bodyFont = document.getElementById('bodyFont');
  elements.headingFont = document.getElementById('headingFont');
  elements.letterSpacing = document.getElementById('letterSpacing');
  elements.letterSpacingValue = document.getElementById('letterSpacingValue');
  elements.lineHeight = document.getElementById('lineHeight');
  elements.lineHeightValue = document.getElementById('lineHeightValue');
  elements.boldText = document.getElementById('boldText');

  elements.adaptiveMode = document.getElementById('adaptiveMode');

  elements.imageEnhance = document.getElementById('imageEnhance');
  elements.imageOptions = document.getElementById('imageOptions');
  elements.imageDesaturate = document.getElementById('imageDesaturate');
  elements.imageAnnotate = document.getElementById('imageAnnotate');
  elements.imageContrast = document.getElementById('imageContrast');
  elements.imageContrastValue = document.getElementById('imageContrastValue');

  elements.legendEnabled = document.getElementById('legendEnabled');
  elements.legendOptions = document.getElementById('legendOptions');
  elements.legendStyle = document.getElementById('legendStyle');

  elements.readingMaskToggle = document.getElementById('readingMaskToggle');
  elements.maskOptions = document.getElementById('maskOptions');
  elements.maskHeight = document.getElementById('maskHeight');
  elements.maskHeightValue = document.getElementById('maskHeightValue');
  elements.maskOpacity = document.getElementById('maskOpacity');
  elements.maskOpacityValue = document.getElementById('maskOpacityValue');

  elements.exportSettings = document.getElementById('exportSettings');
  elements.importSettings = document.getElementById('importSettings');
  elements.applyAsDefault = document.getElementById('applyAsDefault');
  elements.importFile = document.getElementById('importFile');

  elements.reset = document.getElementById('reset');
  elements.replayOnboarding = document.getElementById('replayOnboarding');
}

function attachEventListeners() {
  elements.toggle.addEventListener('click', onToggleClick);
  elements.profileSelect.addEventListener('change', onProfileChange);
  elements.profileAdd.addEventListener('click', onProfileAdd);
  elements.profileDuplicate.addEventListener('click', onProfileDuplicate);
  elements.profileRename.addEventListener('click', onProfileRename);
  elements.profileDelete.addEventListener('click', onProfileDelete);
  elements.profileSetDefault.addEventListener('click', onApplyProfileAsDefault);

  elements.fontSize.addEventListener('input', () => handleFontSize(parseInt(elements.fontSize.value, 10)));
  elements.brightness.addEventListener('input', () => handleBrightness(parseInt(elements.brightness.value, 10)));
  elements.contrast.addEventListener('input', () => handleContrast(parseInt(elements.contrast.value, 10)));

  elements.bodyFont.addEventListener('change', () => handleProfileChange({ fontFamily: sanitizeFontValue(elements.bodyFont.value) }));
  elements.headingFont.addEventListener('change', () => {
    const value = elements.headingFont.value;
    const font = value === 'inherit' ? elements.bodyFont.value : value;
    handleProfileChange({ headingFontFamily: sanitizeFontValue(font) });
  });

  elements.letterSpacing.addEventListener('input', () => handleLetterSpacing(parseInt(elements.letterSpacing.value, 10)));
  elements.lineHeight.addEventListener('input', () => handleLineHeight(parseInt(elements.lineHeight.value, 10)));
  elements.boldText.addEventListener('change', () => handleProfileChange({ boldText: elements.boldText.checked }));

  if (elements.adaptiveMode) {
    elements.adaptiveMode.addEventListener('change', () => scheduleSettingsUpdate({ adaptiveMode: elements.adaptiveMode.checked }));
  }

  if (elements.imageEnhance) {
    elements.imageEnhance.addEventListener('change', () => {
      toggleFeatureOptions(elements.imageOptions, elements.imageEnhance.checked);
      scheduleSettingsUpdate({ imageAdjustments: { enabled: elements.imageEnhance.checked } });
    });
  }
  if (elements.imageDesaturate) {
    elements.imageDesaturate.addEventListener('change', () => scheduleSettingsUpdate({ imageAdjustments: { desaturate: elements.imageDesaturate.checked } }));
  }
  if (elements.imageAnnotate) {
    elements.imageAnnotate.addEventListener('change', () => scheduleSettingsUpdate({ imageAdjustments: { annotate: elements.imageAnnotate.checked } }));
  }
  if (elements.imageContrast) {
    elements.imageContrast.addEventListener('input', () => handleImageContrast(parseInt(elements.imageContrast.value, 10)));
  }

  if (elements.legendEnabled) {
    elements.legendEnabled.addEventListener('change', () => {
      toggleFeatureOptions(elements.legendOptions, elements.legendEnabled.checked);
      scheduleSettingsUpdate({ colorLegend: { enabled: elements.legendEnabled.checked } });
    });
  }
  if (elements.legendStyle) {
    elements.legendStyle.addEventListener('change', () => scheduleSettingsUpdate({ colorLegend: { style: elements.legendStyle.value } }));
  }

  if (elements.readingMaskToggle) {
    elements.readingMaskToggle.addEventListener('change', () => {
      toggleFeatureOptions(elements.maskOptions, elements.readingMaskToggle.checked);
      scheduleSettingsUpdate({ readingMask: { enabled: elements.readingMaskToggle.checked } });
    });
  }
  if (elements.maskHeight) {
    elements.maskHeight.addEventListener('input', () => handleMaskHeight(parseInt(elements.maskHeight.value, 10)));
  }
  if (elements.maskOpacity) {
    elements.maskOpacity.addEventListener('input', () => handleMaskOpacity(parseInt(elements.maskOpacity.value, 10)));
  }

  elements.exportSettings.addEventListener('click', onExportSettings);
  elements.importSettings.addEventListener('click', () => elements.importFile.click());
  elements.applyAsDefault.addEventListener('click', onApplyAllSites);
  elements.importFile.addEventListener('change', onImportFile);

  elements.reset.addEventListener('click', onResetClick);
  elements.replayOnboarding.addEventListener('click', onReplayOnboarding);
}

async function init() {
  applyLocalization();
  cacheElements();
  attachEventListeners();
  await resolveActiveTab();
  if (!state.tabId) {
    disableControls(t('statusNoActiveTab'));
    return;
  }
  state.isEligible = await evaluateTabEligibility();
  if (!state.isEligible) {
    disableControls(t('statusIneligible'));
    return;
  }
  await hydrateState();
}

async function resolveActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tabId = tab?.id ?? null;
    state.tabUrl = tab?.url ?? null;
  } catch (error) {
    console.error('[Popup] Failed to query active tab', error);
    state.tabId = null;
    state.tabUrl = null;
  }
}

async function hydrateState() {
  try {
    const response = await sendMessageToContent({ type: 'GET_STATE' });
    if (!response) {
      throw new Error(t('statusUnavailable'));
    }
    state.settings = deepClone(response.settings);
    state.defaults = deepClone(response.defaults);
    state.active = Boolean(response.active);
    renderUI();
    updateStatus(state.active ? t('statusActive') : t('statusInactive'));
    setControlsEnabled(true);
    state.hydrateRetried = false;
  } catch (error) {
    const errorDetail = error?.message || error;
    const normalized = String(errorDetail || '').toLowerCase();
    const connectionIssue = normalized.includes('could not establish connection') || normalized.includes('receiving end does not exist');
    if (connectionIssue && !state.hydrateRetried) {
      state.hydrateRetried = true;
      try {
        await injectContentAssets();
        await hydrateState();
        return;
      } catch (retryError) {
        console.warn('[Popup] Retry hydration failed', retryError);
      }
    }
    console.warn('[Popup] Unable to hydrate state', errorDetail);
    const userMessage = resolveUserFacingError(error) || t('statusUnavailable');
    disableControls(userMessage, error);
  }
}

function disableControls(message, error) {
  updateStatus(message);
  setControlsEnabled(false);
  const toggle = elements.toggle;
  if (!toggle) {
    return;
  }
  if (state.grantAccessHandler) {
    toggle.removeEventListener('click', state.grantAccessHandler);
    state.grantAccessHandler = null;
  }
  if (error?.code === 'HOST_PERMISSION_DENIED') {
    toggle.textContent = t('toggleGrantAccess');
    toggle.disabled = false;
    const handler = async () => {
      toggle.disabled = true;
      try {
        const granted = await requestSiteAccess();
        if (granted) {
          toggle.textContent = t('toggleLoading');
          state.grantAccessHandler && toggle.removeEventListener('click', state.grantAccessHandler);
          state.grantAccessHandler = null;
          await hydrateState();
          return;
        }
        setControlsEnabled(false);
        toggle.disabled = false;
      } catch (err) {
        console.error('[Popup] Site access request failed', err);
        setControlsEnabled(false);
        toggle.disabled = false;
      }
    };
    state.grantAccessHandler = handler;
    toggle.addEventListener('click', handler);
  } else {
    toggle.textContent = t('toggleNotAvailable');
    toggle.disabled = true;
  }
}

function setControlsEnabled(enabled) {
  const disabled = !enabled;
  [
    elements.profileSelect,
    elements.profileAdd,
    elements.profileDuplicate,
    elements.profileRename,
    elements.profileDelete,
    elements.profileSetDefault,
    elements.fontSize,
    elements.brightness,
    elements.contrast,
    elements.bodyFont,
    elements.headingFont,
    elements.letterSpacing,
    elements.lineHeight,
    elements.boldText,
    elements.adaptiveMode,
    elements.imageEnhance,
    elements.imageDesaturate,
    elements.imageAnnotate,
    elements.imageContrast,
    elements.legendEnabled,
    elements.legendStyle,
    elements.readingMaskToggle,
    elements.maskHeight,
    elements.maskOpacity,
    elements.exportSettings,
    elements.importSettings,
    elements.applyAsDefault,
    elements.reset,
    elements.replayOnboarding
  ].forEach((node) => {
    if (node) {
      node.disabled = disabled;
    }
  });
}

function updateStatus(message) {
  elements.status.textContent = message;
}

function renderUI() {
  renderToggle();
  renderProfiles();
  renderProfileControls();
  renderFeatures();
}

function renderToggle() {
  elements.toggle.disabled = false;
  elements.toggle.classList.toggle('toggle--active', state.active);
  elements.toggle.textContent = state.active ? t('toggleTurnOff') : t('toggleTurnOn');
}

function renderProfiles() {
  const profiles = state.settings?.profiles || {};
  const order = state.settings?.profilesOrder || [];
  const activeId = state.settings?.activeProfileId;
  elements.profileSelect.innerHTML = '';
  order.forEach((id) => {
    if (!profiles[id]) {
      return;
    }
    const option = document.createElement('option');
    option.value = id;
    option.textContent = profiles[id].name || t('profileNameFallback', [id]);
    if (id === activeId) {
      option.selected = true;
    }
    elements.profileSelect.appendChild(option);
  });

  elements.profileDelete.disabled = Object.keys(profiles).length <= 1;
}

function getActiveProfile() {
  const id = state.settings?.activeProfileId;
  return id ? state.settings?.profiles?.[id] : null;
}

function renderProfileControls() {
  const profile = getActiveProfile();
  if (!profile) {
    return;
  }
  const fontPx = ptToPx(profile.fontSize);
  elements.fontSize.value = clamp(fontPx, parseInt(elements.fontSize.min, 10), parseInt(elements.fontSize.max, 10));
  elements.fontValue.textContent = formatPixels(Number(elements.fontSize.value));

  const brightnessValue = Math.round(profile.brightness * 100);
  elements.brightness.value = brightnessValue;
  elements.brightnessValue.textContent = formatPercent(brightnessValue);

  const contrastValue = Math.round(profile.contrast * 100);
  elements.contrast.value = contrastValue;
  elements.contrastValue.textContent = formatPercent(contrastValue);

  const bodyFontValue = sanitizeFontValue(profile.fontFamily);
  ensureSelectValue(elements.bodyFont, bodyFontValue);
  const headingFontValue = sanitizeFontValue(profile.headingFontFamily);
  const resolvedHeading = headingFontValue === bodyFontValue ? 'inherit' : headingFontValue;
  if (resolvedHeading !== 'inherit') {
    ensureSelectValue(elements.headingFont, headingFontValue);
  }
  elements.headingFont.value = resolvedHeading;

  const spacingValue = Math.round((profile.letterSpacing || 0) * 100);
  elements.letterSpacing.value = spacingValue;
  elements.letterSpacingValue.textContent = formatEm(spacingValue / 100);

  const lineHeightValue = Math.round((profile.lineHeight || 1.6) * 100);
  elements.lineHeight.value = lineHeightValue;
  elements.lineHeightValue.textContent = (lineHeightValue / 100).toFixed(2);

  elements.boldText.checked = Boolean(profile.boldText);
}


function renderFeatures() {
  if (!elements.adaptiveMode || !elements.imageEnhance || !elements.legendEnabled || !elements.readingMaskToggle) {
    return;
  }
  const settings = state.settings || {};
  const image = settings.imageAdjustments || {};
  const legend = settings.colorLegend || {};
  const mask = settings.readingMask || {};

  elements.adaptiveMode.checked = Boolean(settings.adaptiveMode);

  elements.imageEnhance.checked = Boolean(image.enabled);
  elements.imageDesaturate.checked = image.desaturate !== false;
  elements.imageAnnotate.checked = Boolean(image.annotate);
  const imageContrastValue = Math.round((image.contrast || 1.1) * 100);
  elements.imageContrast.value = imageContrastValue;
  elements.imageContrastValue.textContent = formatPercent(imageContrastValue);
  toggleFeatureOptions(elements.imageOptions, elements.imageEnhance.checked);

  elements.legendEnabled.checked = Boolean(legend.enabled);
  elements.legendStyle.value = legend.style || 'text';
  toggleFeatureOptions(elements.legendOptions, elements.legendEnabled.checked);

  elements.readingMaskToggle.checked = Boolean(mask.enabled);
  const maskHeightValue = Math.round(mask.height || 220);
  elements.maskHeight.value = maskHeightValue;
  elements.maskHeightValue.textContent = formatPixels(maskHeightValue);
  const maskOpacityValue = Math.round((mask.opacity || 0.3) * 100);
  elements.maskOpacity.value = maskOpacityValue;
  elements.maskOpacityValue.textContent = formatPercent(maskOpacityValue);
  toggleFeatureOptions(elements.maskOptions, elements.readingMaskToggle.checked);
}

function toggleFeatureOptions(container, visible) {
  if (!container) {
    return;
  }
  container.style.display = visible ? 'flex' : 'none';
}

function handleFontSize(valuePx) {
  const minPx = parseInt(elements.fontSize.min, 10);
  const maxPx = parseInt(elements.fontSize.max, 10);
  const safePx = clamp(valuePx, minPx, maxPx);
  elements.fontSize.value = safePx;
  elements.fontValue.textContent = formatPixels(safePx);
  const ptValue = clamp(pxToPt(safePx), 24, 72);
  handleProfileChange({ fontSize: ptValue });
}

function handleBrightness(valuePct) {
  const safe = clamp(valuePct, 40, 100) / 100;
  elements.brightnessValue.textContent = formatPercent(safe * 100);
  handleProfileChange({ brightness: Number(safe.toFixed(2)) });
}

function handleContrast(valuePct) {
  const safe = clamp(valuePct, 100, 200) / 100;
  elements.contrastValue.textContent = formatPercent(safe * 100);
  handleProfileChange({ contrast: Number(safe.toFixed(2)) });
}

function handleLetterSpacing(rawValue) {
  const spacing = clamp(rawValue, -5, 30) / 100;
  elements.letterSpacingValue.textContent = formatEm(spacing);
  handleProfileChange({ letterSpacing: Number(spacing.toFixed(3)) });
}

function handleLineHeight(rawValue) {
  const lineHeight = clamp(rawValue, 120, 240) / 100;
  elements.lineHeightValue.textContent = lineHeight.toFixed(2);
  handleProfileChange({ lineHeight: Number(lineHeight.toFixed(2)) });
}

function handleImageContrast(rawValue) {
  const contrast = clamp(rawValue, 100, 200) / 100;
  elements.imageContrastValue.textContent = formatPercent(contrast * 100);
  scheduleSettingsUpdate({ imageAdjustments: { contrast: Number(contrast.toFixed(2)) } });
}

function handleMaskHeight(valuePx) {
  const height = clamp(valuePx, 80, 400);
  elements.maskHeightValue.textContent = formatPixels(height);
  scheduleSettingsUpdate({ readingMask: { height } });
}

function handleMaskOpacity(valuePct) {
  const opacity = clamp(valuePct, 10, 80) / 100;
  elements.maskOpacityValue.textContent = formatPercent(opacity * 100);
  scheduleSettingsUpdate({ readingMask: { opacity: Number(opacity.toFixed(2)) } });
}

function handleProfileChange(changes) {
  Object.assign(state.pendingProfileChanges, changes);
  commitProfileUpdates();
}

const commitProfileUpdates = debounce(async () => {
  if (!state.tabId || !Object.keys(state.pendingProfileChanges).length) {
    return;
  }
  const payload = { id: state.settings.activeProfileId, changes: { ...state.pendingProfileChanges } };
  state.pendingProfileChanges = {};
  try {
    const response = await sendMessageToContent({ type: 'UPDATE_PROFILE', payload });
    if (response?.ok) {
      await hydrateState();
      updateStatus(state.active ? 'Reader updated.' : 'Preferences saved.');
    } else if (response?.error) {
      throw new Error(response.error);
    }
  } catch (error) {
    console.error('[Popup] Failed to update profile', error);
    updateStatus(`Profile update failed: ${error.message}`);
  }
}, 200);

function scheduleSettingsUpdate(patch) {
  state.pendingGeneralPatch = mergePatch(state.pendingGeneralPatch, patch);
  commitSettingsUpdates();
}

const commitSettingsUpdates = debounce(async () => {
  if (!state.tabId || !Object.keys(state.pendingGeneralPatch).length) {
    return;
  }
  const payload = { updates: state.pendingGeneralPatch };
  state.pendingGeneralPatch = {};
  try {
    const response = await sendMessageToContent({ type: 'UPDATE_SETTINGS', payload });
    if (response?.ok) {
      await hydrateState();
    } else if (response?.error) {
      throw new Error(response.error);
    }
  } catch (error) {
    console.error('[Popup] Failed to apply settings', error);
    updateStatus(t('errorSettingsSaveFailed', [error.message]));
  }
}, 200);

async function onToggleClick() {
  if (!state.tabId) {
    return;
  }
  elements.toggle.disabled = true;
  updateStatus(t('statusApplyingChanges'));
  try {
    const response = await sendMessageToContent({ type: 'TOGGLE', payload: { enabled: !state.active } });
    if (response?.ok) {
      state.active = Boolean(response.active);
      await hydrateState();
    } else if (response?.error) {
      throw new Error(response.error);
    }
  } catch (error) {
    console.error('[Popup] Toggle failed', error);
    updateStatus(t('errorToggleFailed', [error.message]));
  } finally {
    elements.toggle.disabled = false;
  }
}

async function onProfileChange() {
  const id = elements.profileSelect.value;
  if (!id || id === state.settings?.activeProfileId) {
    return;
  }
  try {
    const response = await sendMessageToContent({ type: 'SET_ACTIVE_PROFILE', payload: { id } });
    if (response?.ok) {
      await hydrateState();
    } else if (response?.error) {
      throw new Error(response.error);
    }
  } catch (error) {
    console.error('[Popup] Failed to switch profile', error);
    updateStatus(t('errorProfileSwitchFailed', [error.message]));
  }
}

async function onProfileAdd() {
  const name = window.prompt(t('promptProfileName'), t('profileNewDefaultName'));
  if (!name) {
    return;
  }
  try {
    const response = await sendMessageToContent({
      type: 'CREATE_PROFILE',
      payload: { name: name.trim(), baseProfileId: state.settings.activeProfileId, activate: true }
    });
    if (response?.ok) {
      await hydrateState();
      updateStatus(t('statusProfileCreated'));
    } else if (response?.error) {
      throw new Error(response.error);
    }
  } catch (error) {
    console.error('[Popup] Failed to create profile', error);
    updateStatus(t('errorProfileCreateFailed', [error.message]));
  }
}

async function onProfileDuplicate() {
  const activeProfile = getActiveProfile();
  if (!activeProfile) {
    return;
  }
  const baseName = activeProfile.name || t('profilePromptPlaceholder');
  const suggestion = t('profileCopySuggestion', [baseName]);
  try {
    const response = await sendMessageToContent({
      type: 'CREATE_PROFILE',
      payload: { name: suggestion, baseProfileId: state.settings.activeProfileId, activate: false }
    });
    if (response?.ok) {
      await hydrateState();
      updateStatus(t('statusProfileDuplicated'));
    } else if (response?.error) {
      throw new Error(response.error);
    }
  } catch (error) {
    console.error('[Popup] Failed to duplicate profile', error);
    updateStatus(t('errorProfileDuplicateFailed', [error.message]));
  }
}

async function onProfileRename() {
  const activeProfile = getActiveProfile();
  if (!activeProfile) {
    return;
  }
  const name = window.prompt(t('promptProfileName'), activeProfile.name || t('profilePromptPlaceholder'));
  if (!name || name.trim() === activeProfile.name) {
    return;
  }
  try {
    const response = await sendMessageToContent({
      type: 'UPDATE_PROFILE',
      payload: { id: state.settings.activeProfileId, changes: { name: name.trim() } }
    });
    if (response?.ok) {
      await hydrateState();
      updateStatus(t('statusProfileRenamed'));
    } else if (response?.error) {
      throw new Error(response.error);
    }
  } catch (error) {
    console.error('[Popup] Failed to rename profile', error);
    updateStatus(t('errorProfileRenameFailed', [error.message]));
  }
}

async function onProfileDelete() {
  if (!window.confirm(t('confirmDeleteProfile'))) {
    return;
  }
  try {
    const response = await sendMessageToContent({
      type: 'DELETE_PROFILE',
      payload: { id: state.settings.activeProfileId }
    });
    if (response?.ok) {
      await hydrateState();
      updateStatus(t('statusProfileRemoved'));
    } else if (response?.error) {
      throw new Error(response.error);
    }
  } catch (error) {
    console.error('[Popup] Failed to delete profile', error);
    updateStatus(t('errorProfileDeleteFailed', [error.message]));
  }
}

async function onApplyProfileAsDefault() {
  const profile = getActiveProfile();
  if (!profile) {
    return;
  }
  const clone = deepClone(state.defaults || {});
  clone.profiles = clone.profiles || {};
  clone.profiles[state.settings.activeProfileId] = profile;
  clone.activeProfileId = state.settings.activeProfileId;
  clone.profilesOrder = Array.from(new Set([state.settings.activeProfileId, ...(clone.profilesOrder || [])]));
  try {
    const response = await sendMessageToContent({
      type: 'UPDATE_SETTINGS',
      payload: { updates: clone, scope: 'defaults', replace: true }
    });
    if (response?.ok) {
      updateStatus(t('statusDefaultProfileUpdated'));
    } else if (response?.error) {
      throw new Error(response.error);
    }
  } catch (error) {
    console.error('[Popup] Failed to apply default profile', error);
    updateStatus(t('errorDefaultUpdateFailed', [error.message]));
  }
}

async function onApplyAllSites() {
  if (!window.confirm(t('confirmApplyDefaults'))) {
    return;
  }
  try {
    const response = await sendMessageToContent({
      type: 'UPDATE_SETTINGS',
      payload: { updates: state.settings, scope: 'defaults', replace: true }
    });
    if (response?.ok) {
      updateStatus(t('statusDefaultsUpdated'));
    } else if (response?.error) {
      throw new Error(response.error);
    }
  } catch (error) {
    console.error('[Popup] Failed to apply defaults', error);
    updateStatus(t('errorApplyDefaultsFailed', [error.message]));
  }
}

async function onExportSettings() {
  try {
    const response = await sendMessageToContent({ type: 'EXPORT_SETTINGS' });
    if (!response?.ok) {
      throw new Error(response?.error || t('errorExportUnavailable'));
    }
    const dataStr = JSON.stringify(response.snapshot, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = t('exportFileName');
    anchor.click();
    URL.revokeObjectURL(url);
    updateStatus(t('statusExported'));
  } catch (error) {
    console.error('[Popup] Export failed', error);
    updateStatus(t('errorExportFailed', [error.message]));
  }
}

async function onImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const response = await sendMessageToContent({ type: 'IMPORT_SETTINGS', payload });
    if (response?.ok) {
      await hydrateState();
      updateStatus(t('statusImported'));
    } else if (response?.error) {
      throw new Error(response.error);
    }
  } catch (error) {
    console.error('[Popup] Import failed', error);
    updateStatus(t('errorImportFailed', [error.message]));
  } finally {
    elements.importFile.value = '';
  }
}

async function onResetClick() {
  if (!window.confirm(t('confirmResetSite'))) {
    return;
  }
  try {
    const response = await sendMessageToContent({ type: 'RESET_SETTINGS' });
    if (response?.ok) {
      await hydrateState();
      updateStatus(t('statusReset'));
    } else if (response?.error) {
      throw new Error(response.error);
    }
  } catch (error) {
    console.error('[Popup] Reset failed', error);
    updateStatus(t('errorResetFailed', [error.message]));
  }
}

async function onReplayOnboarding() {
  try {
    await sendMessageToContent({ type: 'SHOW_ONBOARDING' });
    updateStatus(t('statusOnboardingTriggered'));
  } catch (error) {
    console.error('[Popup] Unable to show onboarding', error);
    updateStatus(t('errorShowOnboarding'));
  }
}

function sanitizeFontValue(value) {
  return value || "'Arial', 'Helvetica', sans-serif";
}

function ensureSelectValue(select, value) {
  if (!select) {
    return;
  }
  const exists = Array.from(select.options).some((option) => option.value === value);
  if (!exists) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value.replace(/['"']/g, '').split(',')[0] || value;
    select.appendChild(option);
  }
  select.value = value;
}

async function sendMessageToContent(message, allowInjection = true) {
  if (!state.tabId) {
    throw new Error(t('errorNoActiveTab'));
  }
  try {
    return await tabsSendMessage(state.tabId, { scope: ACHROMA_SCOPE, ...message });
  } catch (error) {
    const messageText = String(error?.message || error || '');
    const needsInjection = allowInjection && shouldAttemptInjection(messageText);
    if (!needsInjection) {
      throw error;
    }
    const permissionOutcome = await ensureSitePermission();
    if (permissionOutcome !== true) {
      if (permissionOutcome === 'unsupported') {
        const unsupportedError = new Error(t('statusUnsupportedPage'));
        unsupportedError.code = 'SITE_UNSUPPORTED';
        throw unsupportedError;
      }
      const permissionError = new Error(t('statusPermissionRequired'));
      permissionError.code = 'HOST_PERMISSION_DENIED';
      throw permissionError;
    }
    await injectContentAssets();
    return sendMessageToContent(message, false);
  }
}

async function injectContentAssets() {
  if (!state.tabId) {
    throw new Error(t('errorNoActiveTabToInject'));
  }

  await new Promise((resolve) => {
    chrome.scripting.insertCSS(
      { target: { tabId: state.tabId }, files: ['content/content.css'] },
      () => {
        resolve();
      }
    );
  });

  await new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      { target: { tabId: state.tabId }, files: ['content/content.js'] },
      () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }
    );
  });
}

function tabsSendMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(error);
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function evaluateTabEligibility() {
  if (!state.tabUrl) {
    return false;
  }
  if (state.tabUrl.startsWith('file://')) {
    try {
      const allowed = await new Promise((resolve) => {
        if (!chrome.extension?.isAllowedFileSchemeAccess) {
          resolve(false);
          return;
        }
        chrome.extension.isAllowedFileSchemeAccess((isAllowed) => resolve(Boolean(isAllowed)));
      });
      if (!allowed) {
        return false;
      }
    } catch (error) {
      console.warn('[Popup] Unable to determine file access permissions', error);
      return false;
    }
  }
  try {
    const url = new URL(state.tabUrl);
    const protocol = url.protocol.replace(':', '');
    if (['http', 'https', 'ftp'].includes(protocol)) {
      return true;
    }
    if (protocol === 'file') {
      return true;
    }
    if (protocol === 'blob') {
      return url.pathname.startsWith('http') || url.pathname.startsWith('https');
    }
  } catch (_error) {
    return false;
  }
  return false;
}

window.addEventListener('DOMContentLoaded', init);

function shouldAttemptInjection(messageText) {
  if (!messageText) {
    return false;
  }
  const normalized = messageText.toLowerCase();
  return (
    normalized.includes('could not establish connection') ||
    normalized.includes('receiving end does not exist') ||
    isHostPermissionError(normalized)
  );
}

async function ensureSitePermission() {
  if (!chrome?.permissions) {
    return true;
  }
  const pattern = getOriginPattern(state.tabUrl);
  if (!pattern) {
    return 'unsupported';
  }
  try {
    const hasPermission = await permissionsContains(pattern);
    if (hasPermission) {
      return true;
    }
    return (await permissionsRequest(pattern)) ? true : false;
  } catch (error) {
    console.warn('[Popup] Unable to confirm site permission', error);
    return false;
  }
}

async function requestSiteAccess() {
  if (!chrome?.permissions) {
    return false;
  }
  const pattern = getOriginPattern(state.tabUrl);
  if (!pattern) {
    return false;
  }
  try {
    return permissionsRequest(pattern);
  } catch (error) {
    console.error('[Popup] Site access request error', error);
    return false;
  }
}

function permissionsContains(originPattern) {
  return new Promise((resolve, reject) => {
    try {
      chrome.permissions.contains({ origins: [originPattern] }, (result) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(error);
          return;
        }
        resolve(Boolean(result));
      });
    } catch (error) {
      reject(error);
    }
  });
}

function permissionsRequest(originPattern) {
  return new Promise((resolve, reject) => {
    try {
      chrome.permissions.request({ origins: [originPattern] }, (granted) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(error);
          return;
        }
        resolve(Boolean(granted));
      });
    } catch (error) {
      reject(error);
    }
  });
}

function getOriginPattern(urlString) {
  if (!urlString) {
    return null;
  }
  try {
    const url = new URL(urlString);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ftp:') {
      return `${url.origin}/*`;
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function isHostPermissionError(messageText) {
  return (
    messageText.includes('missing host permission') ||
    messageText.includes('cannot access contents of the page') ||
    messageText.includes('cannot access contents of url')
  );
}

function resolveUserFacingError(error) {
  if (!error) {
    return null;
  }
  if (error.code === 'HOST_PERMISSION_DENIED') {
    return t('statusGrantAccessPrompt');
  }
  if (error.code === 'SITE_UNSUPPORTED') {
    return t('statusUnsupportedPage');
  }
  const message = String(error.message || '').trim();
  if (!message) {
    return null;
  }
  if (isHostPermissionError(message.toLowerCase())) {
    return t('statusPermissionRequired');
  }
  return null;
}
