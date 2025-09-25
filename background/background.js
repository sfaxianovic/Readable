const ACHROMA_SCOPE = 'ACHROMA_READER';

chrome.runtime.onInstalled.addListener(() => {
  console.log('Achromatopsia Reader installed. Ready to improve accessibility.');
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'activate-reader') {
    return;
  }
  try {
    const tab = await getActiveTab();
    if (!tab?.id) {
      return;
    }
    await sendToggleMessage(tab.id);
  } catch (error) {
    console.error('[Background] Failed to toggle reader via keyboard shortcut', error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.scope !== ACHROMA_SCOPE) {
    return false;
  }

  if (message.type === 'OPEN_POPUP') {
    chrome.action
      .openPopup()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error('[Background] Unable to open popup', error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  return false;
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToggleMessage(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { scope: ACHROMA_SCOPE, type: 'TOGGLE' },
      (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(error);
          return;
        }
        resolve(response);
      }
    );
  });
}
