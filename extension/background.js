const extAPI = typeof browser !== "undefined" ? browser : chrome;

extAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SYNC_ASSIGNMENTS") {
    postToGAS(message.payload)
      .then(result => {
        sendResponse({ success: true, data: result });
      })
      .catch(err => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // 非同期レスポンスのために必要
  }
});

async function postToGAS(assignments) {
  const data = await new Promise(resolve => {
    extAPI.storage.local.get(["gasUrl", "reminders"], resolve);
  });

  const webhookUrl = data.gasUrl;
  if (!webhookUrl) {
    throw new Error("拡張機能のアイコンをクリックし、設定画面からGAS Webhook URLを設定してください。");
  }

  const reminders = data.reminders || [
    { days: 3, time: "09:00" },
    { days: 1, time: "09:00" },
    { days: 0, time: "09:00" }
  ];

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ assignments, reminders })
  });

  return response.json();
}
