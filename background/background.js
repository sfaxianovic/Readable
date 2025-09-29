const ACHROMA_SCOPE = 'ACHROMA_READER';

chrome.runtime.onInstalled.addListener(() => {
  console.log('Achromatopsia Reader installed. Ready to improve accessibility.');
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
