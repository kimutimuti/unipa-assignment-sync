document.addEventListener("DOMContentLoaded", () => {
  const gasUrlInput = document.getElementById("gasUrl");
  const saveBtn = document.getElementById("saveBtn");
  const statusDiv = document.getElementById("status");
  const remindersContainer = document.getElementById("remindersContainer");
  const addReminderBtn = document.getElementById("addReminderBtn");

  // デフォルトのリマインダー設定
  const DEFAULT_REMINDERS = [
    { days: 3, time: "09:00" },
    { days: 1, time: "09:00" },
    { days: 0, time: "09:00" }
  ];

  let reminders = [];

  // ロード処理
  chrome.storage.local.get(["gasUrl", "reminders"], (result) => {
    if (result.gasUrl) {
      gasUrlInput.value = result.gasUrl;
    }
    
    if (result.reminders && Array.isArray(result.reminders)) {
      reminders = result.reminders;
    } else {
      reminders = [...DEFAULT_REMINDERS];
    }
    renderReminders();
  });

  // UI描画
  function renderReminders() {
    remindersContainer.innerHTML = "";
    reminders.forEach((rem, index) => {
      const div = document.createElement("div");
      div.className = "reminder-item";
      
      const daysInput = document.createElement("input");
      daysInput.type = "number";
      daysInput.min = "0";
      daysInput.max = "30";
      daysInput.value = rem.days;
      daysInput.onchange = (e) => updateReminder(index, "days", parseInt(e.target.value) || 0);

      const daysLabel = document.createElement("span");
      daysLabel.innerText = "日前の";

      const timeInput = document.createElement("input");
      timeInput.type = "time";
      timeInput.value = rem.time;
      timeInput.onchange = (e) => updateReminder(index, "time", e.target.value);

      const removeBtn = document.createElement("button");
      removeBtn.className = "btn-remove";
      removeBtn.innerText = "削除";
      removeBtn.onclick = () => removeReminder(index);

      div.appendChild(daysInput);
      div.appendChild(daysLabel);
      div.appendChild(timeInput);
      div.appendChild(removeBtn);

      remindersContainer.appendChild(div);
    });

    if (reminders.length >= 5) {
      addReminderBtn.style.display = "none";
    } else {
      addReminderBtn.style.display = "block";
    }
  }

  function updateReminder(index, key, value) {
    reminders[index][key] = value;
  }

  function removeReminder(index) {
    reminders.splice(index, 1);
    renderReminders();
  }

  addReminderBtn.addEventListener("click", () => {
    if (reminders.length < 5) {
      reminders.push({ days: 1, time: "09:00" });
      renderReminders();
    }
  });

  // 保存処理
  saveBtn.addEventListener("click", () => {
    const gasUrl = gasUrlInput.value.trim();
    chrome.storage.local.set({ gasUrl, reminders }, () => {
      statusDiv.style.display = "block";
      setTimeout(() => {
        statusDiv.style.display = "none";
      }, 2000);
    });
  });
});
