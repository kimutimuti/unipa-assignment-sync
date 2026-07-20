console.log("UNIPA Assignment Sync loaded");

const extAPI = typeof browser !== "undefined" ? browser : chrome;

// 1. 課題ページかどうかの判定（非描画のバックグラウンド対応）
function isAssignmentPage() {
  return document.body.textContent.includes("課題一覧");
}

// 2. 課題IDの生成
async function generateId(message) {
  if (window.crypto && window.crypto.subtle) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } else {
    let hash = 0;
    for (let i = 0; i < message.length; i++) {
      const char = message.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16) + "-" + message.length;
  }
}

// 3. 課題の抽出処理（非描画のバックグラウンド対応のため textContent に完全置換）
async function extractAssignments() {
  const assignments = [];
  const rows = document.querySelectorAll("tbody tr");

  const cpTgtName = document.querySelector(".cpTgtName");
  let rawGroupName = "";
  if (cpTgtName) {
    cpTgtName.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        rawGroupName += node.textContent;
      }
    });
  }
  const groupName = rawGroupName.replace(/^[A-Z]{1,4}\d{3,5}[a-zA-Z]*/g, "").trim();
  console.log("講義名:", groupName);

  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 8) continue;

    // innerText ではなく textContent を使用して非表示状態でも文字を取得する
    const assignmentName = cells[1]?.textContent?.trim() || "";
    const deadline = cells[5]?.textContent?.trim() || "";
    const status = cells[7]?.textContent?.trim() || "";
    const isUnsubmitted = cells[8]?.textContent?.trim() === "○";

    if (!assignmentName || !deadline) continue;

    const rawId = `${groupName}${assignmentName}${deadline}`;
    const assignmentId = await generateId(rawId);

    assignments.push({
      assignmentId,
      groupName,
      assignmentName,
      deadline,
      status,
      isUnsubmitted
    });
  }

  return assignments;
}

// 4. トースト通知の表示
function showToast(message, isError = false, url = null) {
  const toast = document.createElement("div");
  toast.innerText = message;
  
  if (url) {
    toast.style.cursor = "pointer";
    toast.onclick = () => {
      window.open(url, "_blank");
      toast.remove();
    };
    toast.onmouseenter = () => toast.style.filter = "brightness(0.9)";
    toast.onmouseleave = () => toast.style.filter = "brightness(1)";
  }
  toast.style.position = "fixed";
  toast.style.bottom = "20px";
  toast.style.right = "20px";
  toast.style.backgroundColor = isError ? "#d32f2f" : "#388e3c";
  toast.style.color = "white";
  toast.style.padding = "16px 24px";
  toast.style.borderRadius = "8px";
  toast.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
  toast.style.zIndex = "999999";
  toast.style.fontFamily = "sans-serif";
  toast.style.fontSize = "14px";
  toast.style.fontWeight = "bold";
  toast.style.whiteSpace = "pre-line";
  toast.style.opacity = "0";
  toast.style.transform = "translateY(20px)";
  toast.style.transition = "all 0.3s ease";

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  }, 10);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(20px)";
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// 5. 画面監視と同期の発火（2秒ごと）
let lastSyncedSubject = "";

setInterval(async () => {
  if (!isAssignmentPage()) {
    lastSyncedSubject = "";
    return;
  }

  const cpTgtName = document.querySelector(".cpTgtName");
  let rawGroupName = "";
  if (cpTgtName) {
    cpTgtName.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        rawGroupName += node.textContent;
      }
    });
  }
  const groupName = rawGroupName.replace(/^[A-Z]{1,4}\d{3,5}[a-zA-Z]*/g, "").trim();

  if (groupName && groupName !== lastSyncedSubject) {
    lastSyncedSubject = groupName;
    console.log("課題一覧ページを検出:", groupName);

    try {
      const assignments = await extractAssignments();
      console.log("抽出された課題:", assignments);

      if (assignments.length > 0) {
        extAPI.runtime.sendMessage(
          { type: "SYNC_ASSIGNMENTS", payload: assignments },
          (response) => {
            if (response?.success) {
              console.log("GAS Sync Result:", response.data);
              const { created = 0, deleted = 0, updated = 0, skipped = 0, url } = response.data;
              const lines = ["✅ UNIPA Assignment Sync 完了"];
              if (created > 0) lines.push(`📅 ${created} 件を追加`);
              if (deleted > 0) lines.push(`🗑️ ${deleted} 件を削除`);
              if (updated > 0) lines.push(`🔄 ${updated} 件を更新`);
              if (url) lines.push(`\n👉 クリックして開く`);
              
              showToast(lines.length > 1 ? lines.join("\n") : "✅ UNIPA Sync 完了\n変更なし", false, url);
            } else {
              console.error("Sync failed:", response?.error);
              showToast(`❌ 同期失敗\n${response?.error || "不明なエラー"}`, true);
            }
          }
        );
      }
    } catch (error) {
      console.error("Extraction error:", error);
    }
  }
}, 2000);
