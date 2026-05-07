console.log("UNIPA Calendar Sync loaded");

// Safari互換: browser API or chrome API
const extAPI = typeof browser !== "undefined" ? browser : chrome;

function isAssignmentPage() {
  return document.body.innerText.includes("課題一覧");
}

async function generateId(message) {
  if (window.crypto && window.crypto.subtle) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } else {
    // Simple hash for non-secure contexts
    let hash = 0;
    for (let i = 0; i < message.length; i++) {
      const char = message.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16) + "-" + message.length;
  }
}

async function extractAssignments() {
  const assignments = [];
  const rows = document.querySelectorAll("tbody tr");

  // ページヘッダーの .cpTgtName から講義名を取得（テキストノードのみ）
  const cpTgtName = document.querySelector(".cpTgtName");
  let rawGroupName = "";
  if (cpTgtName) {
    cpTgtName.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        rawGroupName += node.textContent;
      }
    });
  }
  // コード部分（例: ST3039sp, ST3047spA）を除去
  const groupName = rawGroupName.replace(/^[A-Z]{1,4}\d{3,5}[a-zA-Z]*/g, "").trim();
  console.log("講義名:", groupName);

  // UNIPAテーブル構造 (21列):
  // [0] 課題グループ名  [1] 課題名  [2] コース  [3] 目次
  // [4] 提出開始日時  [5] 提出終了日時(=締切)  [6] 提出方法
  // [7] ステータス  ...

  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 8) continue;

    const assignmentName = cells[1]?.innerText?.trim() || "";
    const deadline = cells[5]?.innerText?.trim() || "";   // 課題提出終了日時
    const status = cells[7]?.innerText?.trim() || "";      // ステータス
    const isUnsubmitted = cells[8]?.innerText?.trim() === "○"; // 未提出フラグ

    if (!assignmentName || !deadline) continue;

    // assignmentId: 授業名 + 課題名 + 締切
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

function showToast(message, isError = false, url = null) {
  const toast = document.createElement("div");
  toast.innerText = message;
  
  if (url) {
    toast.style.cursor = "pointer";
    toast.onclick = () => {
      window.open(url, "_blank");
      toast.remove();
    };
    // ホバー時に少し暗くする効果（簡易的）
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

  // フェードイン
  setTimeout(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  }, 10);

  // 5秒後にフェードアウト
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(20px)";
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

setTimeout(async () => {
  if (isAssignmentPage()) {
    console.log("課題一覧ページを検出");

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
            if (created > 0) lines.push(`📅 ${created} 件をカレンダーに追加`);
            if (deleted > 0) lines.push(`🗑️ ${deleted} 件を削除`);
            if (updated > 0) lines.push(`🔄 ${updated} 件を更新`);
            if (skipped > 0) lines.push(`⏭️ ${skipped} 件をスキップ`);
            if (url) lines.push(`\n👉 クリックしてスプレッドシートを開く`);
            
            showToast(lines.length > 1 ? lines.join("\n") : "✅ UNIPA Assignment Sync 完了\n変更なし", false, url);
          } else {
            console.error("Sync failed:", response?.error);
            showToast(`❌ 同期失敗\n${response?.error || "不明なエラー"}`, true);
          }
        }
      );
    }
  }
}, 3000);