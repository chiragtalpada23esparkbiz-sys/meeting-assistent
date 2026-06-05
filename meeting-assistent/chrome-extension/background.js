// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Auto-open side panel when navigating to Google Meet
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('meet.google.com')) {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});
