const CALENDAR_NAME = "UNIPA Assignments";
const SHEET_NAME = "Assignments";

// ===== Webhook =====

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (!data || !data.assignments) {
      return ContentService.createTextOutput(
        JSON.stringify({ status: "error", message: "Invalid payload" })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    const result = syncAssignments(data.assignments, data.reminders);

    return ContentService.createTextOutput(
      JSON.stringify({ status: "success", ...result })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: "error", message: error.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// ===== Sheet =====

function getOrCreateSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error("This script must be bound to a Google Sheet (Extensions > Apps Script).");
  }

  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
    setupSheetHeaders(sheet);
  }
  return sheet;
}

function setupSheetHeaders(sheet) {
  const headers = [
    "課題ID",
    "未提出フラグ",
    "Event ID",
    "講義名",
    "課題名",
    "締切",
    "ステータス",
    "最終同期"
  ];

  // ヘッダー書き込み
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);

  // ヘッダースタイル
  headerRange.setFontWeight("bold");
  headerRange.setFontColor("#FFFFFF");
  headerRange.setBackground("#1a73e8");
  headerRange.setHorizontalAlignment("center");
  headerRange.setVerticalAlignment("middle");
  headerRange.setWrap(true);
  sheet.setRowHeight(1, 36);

  // 列幅設定
  sheet.setColumnWidth(1, 80);   // 課題ID — 非表示
  sheet.setColumnWidth(2, 100);  // 未提出フラグ — 非表示
  sheet.setColumnWidth(3, 80);   // Event ID — 非表示
  sheet.setColumnWidth(4, 200);  // 講義名
  sheet.setColumnWidth(5, 350);  // 課題名
  sheet.setColumnWidth(6, 150);  // 締切
  sheet.setColumnWidth(7, 130);  // ステータス
  sheet.setColumnWidth(8, 150);  // 最終同期

  // 固定
  sheet.setFrozenRows(1);

  // 不要列を非表示
  sheet.hideColumns(1);  // 課題ID
  sheet.hideColumns(2);  // 未提出フラグ
  sheet.hideColumns(3);  // Event ID
}


function statusSortOrder(status) {
  // 提出受付中を最優先 (0)、それ以外は後ろ
  if (status.includes("提出受付中")) return 0;
  if (status.includes("提出終了")) return 1;
  if (status.includes("受付終了")) return 2;
  if (status.includes("公開終了")) return 3;
  return 4;
}

function formatSheet(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  // データ範囲
  const dataRange = sheet.getRange(2, 1, lastRow - 1, 8);

  // ステータス優先でソートし、ステータスが同じなら講義名でソート
  const data = dataRange.getValues();
  data.sort((a, b) => {
    // a[6] = ステータス, a[3] = 講義名
    const statusDiff = statusSortOrder(a[6].toString()) - statusSortOrder(b[6].toString());
    if (statusDiff !== 0) return statusDiff;
    return a[3].toString().localeCompare(b[3].toString(), 'ja');
  });
  dataRange.setValues(data);

  // ユーザーが自由にソートできるようにフィルターを追加
  if (!sheet.getFilter()) {
    sheet.getDataRange().createFilter();
  }

  // 基本スタイル
  dataRange.setVerticalAlignment("middle");
  dataRange.setWrap(true);
  sheet.setRowHeightsForced(2, lastRow - 1, 28);

  // 交互背景色
  for (let i = 2; i <= lastRow; i++) {
    const rowRange = sheet.getRange(i, 1, 1, 8);
    rowRange.setBackground(i % 2 === 0 ? "#f8f9fa" : "#ffffff");
  }

  // ステータス列の条件付き色分け
  for (let i = 2; i <= lastRow; i++) {
    const statusCell = sheet.getRange(i, 7);
    const status = statusCell.getValue().toString();

    if (status.includes("提出受付中")) {
      statusCell.setBackground("#e8f5e9"); // 緑系
      statusCell.setFontColor("#1b5e20");
    } else if (status.includes("(未)")) {
      statusCell.setBackground("#ffebee"); // 赤系（警告）
      statusCell.setFontColor("#c62828");
    } else if (status.includes("提出終了")) {
      statusCell.setBackground("#e3f2fd"); // 青系
      statusCell.setFontColor("#0d47a1");
    } else if (status.includes("受付終了")) {
      statusCell.setBackground("#eeeeee"); // グレー系（提出済で終わったもの）
      statusCell.setFontColor("#616161");
    } else if (status.includes("公開終了")) {
      statusCell.setBackground("#f3e5f5"); // 紫系
      statusCell.setFontColor("#4a148c");
    }
    statusCell.setHorizontalAlignment("center");
    statusCell.setFontWeight("bold");
  }

  // 締切列: 書式設定 MM/dd(ddd) HH:mm
  sheet.getRange(2, 6, lastRow - 1, 1)
    .setNumberFormat("MM/dd(ddd) HH:mm")
    .setHorizontalAlignment("center");

  // 最終同期列のフォーマット
  sheet.getRange(2, 8, lastRow - 1, 1)
    .setNumberFormat("yyyy/MM/dd HH:mm")
    .setHorizontalAlignment("center");

  // 枠線
  dataRange.setBorder(
    true, true, true, true, true, true,
    "#e0e0e0", SpreadsheetApp.BorderStyle.SOLID
  );

  // 不要列を非表示
  sheet.showColumns(1, sheet.getMaxColumns()); // 一旦すべて表示
  sheet.hideColumns(1);  // 課題ID
  sheet.hideColumns(2);  // 未提出フラグ
  sheet.hideColumns(3);  // Event ID
}

function findAssignmentRow(sheet, assignmentId) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === assignmentId) {
      return i + 1; // 1-indexed row number
    }
  }
  return -1;
}

// ===== Calendar =====

function getOrCreateCalendar() {
  const calendars = CalendarApp.getCalendarsByName(CALENDAR_NAME);
  if (calendars.length > 0) {
    return calendars[0];
  }
  return CalendarApp.createCalendar(CALENDAR_NAME, { timeZone: "Asia/Tokyo" });
}

function parseDateText(dateText) {
  if (!dateText) return null;
  
  // Format: 2026/05/08(金) 23:59
  let match = dateText.match(/(\d{4})\/(\d{2})\/(\d{2}).*(\d{2}):(\d{2})/);
  if (match) {
    const [, year, month, day, hour, minute] = match;
    return new Date(
      parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10),
      parseInt(hour, 10), parseInt(minute, 10)
    );
  }
  
  // Format: 05/08(金) 23:59 (年がない場合)
  match = dateText.match(/(\d{2})\/(\d{2}).*(\d{2}):(\d{2})/);
  if (match) {
    const [, month, day, hour, minute] = match;
    const now = new Date();
    // 実行時の年を使用
    return new Date(
      now.getFullYear(), parseInt(month, 10) - 1, parseInt(day, 10),
      parseInt(hour, 10), parseInt(minute, 10)
    );
  }
  
  return null;
}

/**
 * 文字列や日付オブジェクトを安全にDateオブジェクトに変換する
 */
function tryParseDate(val) {
  if (val instanceof Date) return val;
  if (!val) return null;
  const str = val.toString();
  // 標準フォーマット (YYYY/MM/DD...)
  const parsed = parseDateText(str);
  if (parsed) return parsed;
  // JSの標準解析（長い文字列形式 Fri May 08... などに対応）
  const jsParsed = new Date(str);
  if (!isNaN(jsParsed.getTime())) return jsParsed;
  return null;
}

function createCalendarEvent(calendar, assignment, reminders) {
  const dueDate = tryParseDate(assignment.deadline);
  if (!dueDate) return null;

  const startDate = new Date(dueDate.getTime() - 60 * 60 * 1000); // 1時間前
  const title = assignment.groupName
    ? `${assignment.groupName} - ${assignment.assignmentName}`
    : assignment.assignmentName;
  const description = `UNIPA課題\n状態: ${assignment.status}`;

  const event = calendar.createEvent(title, startDate, dueDate, {
    description: description
  });

  // 拡張機能から送られたリマインダー設定を反映
  event.removeAllReminders();
  const targetReminders = reminders && Array.isArray(reminders) ? reminders : [
    { days: 3, time: "09:00" },
    { days: 1, time: "09:00" },
    { days: 0, time: "09:00" }
  ];

  for (const rem of targetReminders) {
    const [hh, mm] = (rem.time || "09:00").split(":");
    const reminderDate = new Date(dueDate);
    reminderDate.setDate(reminderDate.getDate() - (parseInt(rem.days) || 0));
    reminderDate.setHours(parseInt(hh), parseInt(mm), 0, 0);

    const minutesBefore = Math.floor(
      (dueDate.getTime() - reminderDate.getTime()) / (1000 * 60)
    );
    if (minutesBefore > 0 && minutesBefore <= 40320) {
      // CalendarApp max reminder = 40320 min (4 weeks)
      event.addPopupReminder(minutesBefore);
    }
  }

  return event.getId();
}

function deleteCalendarEvent(calendar, eventId) {
  if (!eventId) return false;
  try {
    const event = calendar.getEventById(eventId);
    if (event) {
      event.deleteEvent();
      return true;
    }
  } catch (e) {
    // Event might already be deleted
  }
  return false;
}

// ===== Sync =====

function isCompleted(status) {
  return status.includes("提出済") || status.includes("提出終了") || status.includes("受付終了") || status.includes("公開終了");
}

function syncAssignments(assignments, reminders) {
  const sheet = getOrCreateSheet();
  const calendar = getOrCreateCalendar();
  const now = new Date();

  let created = 0;
  let deleted = 0;
  let updated = 0;
  let skipped = 0;

  for (const assignment of assignments) {
    let { assignmentId, groupName, assignmentName, deadline, status, isUnsubmitted } = assignment;
    
    // 締切後未提出のステータス書き換え
    if (isUnsubmitted && (status.includes("提出終了") || status.includes("受付終了") || status.includes("公開終了"))) {
      status += "(未)";
    }

    const rowNum = findAssignmentRow(sheet, assignmentId);
    const completed = isCompleted(status) && !status.includes("(未)");

    if (rowNum !== -1) {
      // === 既存の課題 ===
      const existingData = sheet.getRange(rowNum, 1, 1, 8).getValues()[0];
      const eventId = existingData[2];

      // ステータス、締切、最終同期、未提出フラグを更新
      const parsedDeadline = tryParseDate(deadline) || deadline;
      sheet.getRange(rowNum, 6).setValue(parsedDeadline);
      sheet.getRange(rowNum, 7).setValue(status);
      sheet.getRange(rowNum, 8).setValue(now);
      sheet.getRange(rowNum, 2).setValue(isUnsubmitted ? "○" : "");
      updated++;

      // 未完了なのにカレンダーIDがない場合 → 追加
      if (!completed && !eventId) {
        const assignmentForCal = { ...assignment, deadline: parsedDeadline };
        eventId = createCalendarEvent(calendar, assignmentForCal, reminders);
        if (eventId) {
          sheet.getRange(rowNum, 3).setValue(eventId);
          created++;
        }
      }

      // 完了済みでカレンダーイベントがある場合 → 削除
      if (completed && eventId) {
        deleteCalendarEvent(calendar, eventId);
        sheet.getRange(rowNum, 3).setValue("");
        deleted++;
      }
    } else {
      // === 新規課題 ===
      let eventId = "";
      if (!completed) {
        eventId = createCalendarEvent(calendar, assignment, reminders) || "";
        if (eventId) created++;
      } else {
        skipped++;
      }

      sheet.appendRow([
        assignmentId,
        isUnsubmitted ? "○" : "",
        eventId,
        groupName,
        assignmentName,
        tryParseDate(deadline) || deadline,
        status,
        now
      ]);
    }
  }

  // シートの見た目を整える
  formatSheet(sheet);

  // ダッシュボード更新
  updateDashboard(sheet);

  return { created, deleted, updated, skipped, url: sheet.getParent().getUrl() };
}

// ===== ダッシュボード =====

function getOrCreateDashboard() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let dashboard = spreadsheet.getSheetByName("ダッシュボード");
  if (!dashboard) {
    dashboard = spreadsheet.insertSheet("ダッシュボード", 0); // 一番左に配置
  }
  return dashboard;
}

function updateDashboard(assignmentSheet) {
  const dashboard = getOrCreateDashboard();
  dashboard.clear();

  // データ取得
  const lastRow = assignmentSheet.getLastRow();
  if (lastRow < 2) {
    dashboard.getRange("B2").setValue("データがありません");
    return;
  }

  const data = assignmentSheet.getRange(2, 1, lastRow - 1, 8).getValues();
  const now = new Date();

  // ステータス分類
  let pending = 0;      // 提出受付中
  let submitted = 0;    // 提出終了等（ちゃんと提出したもの）
  let missed = 0;       // 締切後未提出
  let urgentCount = 0;  // 24時間以内
  let nextDeadline = null;
  let nextAssignment = "";
  const courseStats = {}; // 講義別統計

  for (const row of data) {
    const groupName = row[3].toString();
    const assignmentName = row[4].toString();
    const deadlineRaw = row[5].toString();
    const status = row[6].toString();

    // 講義別集計の初期化
    if (groupName && !courseStats[groupName]) {
      courseStats[groupName] = { pending: 0, done: 0, missed: 0 };
    }

    if (status.includes("(未)")) {
      missed++;
      if (groupName) courseStats[groupName].missed++;
    } else if (isCompleted(status)) {
      // 提出済、受付終了、公開終了など
      submitted++;
      if (groupName) courseStats[groupName].done++;
    } else {
      // 提出受付中、再提出受付中、一時保存など（未完了のすべて）
      pending++;
      if (groupName) courseStats[groupName].pending++;

      const deadline = tryParseDate(row[5]);

      if (deadline instanceof Date) {
        // 24時間以内チェック
        const hoursLeft = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);
        if (hoursLeft > 0 && hoursLeft <= 24) {
          urgentCount++;
        }

        // 直近の締切
        if (deadline > now && (!nextDeadline || deadline < nextDeadline)) {
          nextDeadline = deadline;
          nextAssignment = `${groupName ? groupName + " - " : ""}${assignmentName}`;
        }
      }
    }
  }

  const totalRelevant = pending + submitted + missed; // 計算対象の全課題
  const submissionRate = totalRelevant > 0
    ? Math.round((submitted / totalRelevant) * 100)
    : 0;
  const totalAll = data.length;

  // ===== ダッシュボード描画 =====

  // タイトル
  dashboard.getRange("B1").setValue("📊 UNIPA 課題ダッシュボード");
  dashboard.getRange("B1:E1").merge();
  dashboard.getRange("B1").setFontSize(16).setFontWeight("bold").setFontColor("#1a73e8");
  dashboard.setRowHeight(1, 40);

  // --- 概要セクション ---
  const summaryStart = 3;
  dashboard.getRange(summaryStart, 2).setValue("📋 概要");
  dashboard.getRange(summaryStart, 2, 1, 4).merge();
  dashboard.getRange(summaryStart, 2).setFontSize(13).setFontWeight("bold");

  const stats = [
    ["🔴 未提出課題", `${pending} 件`, "現在提出受付中の課題数"],
    ["✅ 提出済み課題", `${submitted} 件`, "正しく提出を完了した課題"],
    ["❌ 締切後未提出", `${missed} 件`, "提出期限を過ぎてしまった課題"],
    ["📊 提出進捗率", `${submissionRate}%`, `${submitted} / ${totalRelevant}（提出済み / 対象課題）`],
    ["📚 全課題数", `${totalAll} 件`, "全ステータス合計"],
  ];

  for (let i = 0; i < stats.length; i++) {
    const row = summaryStart + 1 + i;
    dashboard.getRange(row, 2).setValue(stats[i][0]);
    dashboard.getRange(row, 3).setValue(stats[i][1]);
    dashboard.getRange(row, 4).setValue(stats[i][2]);
  }

  // 概要スタイル
  const statsRange = dashboard.getRange(summaryStart + 1, 2, stats.length, 3);
  statsRange.setVerticalAlignment("middle");
  dashboard.getRange(summaryStart + 1, 2, stats.length, 1)
    .setFontWeight("bold").setFontSize(11);
  dashboard.getRange(summaryStart + 1, 3, stats.length, 1)
    .setFontSize(14).setFontWeight("bold").setHorizontalAlignment("center");
  dashboard.getRange(summaryStart + 1, 4, stats.length, 1)
    .setFontColor("#888888").setFontSize(9);

  // 色分け
  dashboard.getRange(summaryStart + 1, 3).setFontColor(pending > 0 ? "#d32f2f" : "#388e3c");
  dashboard.getRange(summaryStart + 2, 3).setFontColor("#388e3c"); // 提出済み
  dashboard.getRange(summaryStart + 3, 3).setFontColor(missed > 0 ? "#d32f2f" : "#aaaaaa"); // 締切後未提出

  // プログレスバー風の色（提出進捗率）
  const rateRow = summaryStart + 4;
  if (submissionRate >= 80) {
    dashboard.getRange(rateRow, 3).setFontColor("#388e3c");
  } else if (submissionRate >= 50) {
    dashboard.getRange(rateRow, 3).setFontColor("#f57c00");
  } else {
    dashboard.getRange(rateRow, 3).setFontColor("#d32f2f");
  }

  // --- 緊急セクション ---
  const urgentStart = summaryStart + stats.length + 2;
  dashboard.getRange(urgentStart, 2).setValue("⚠️ 注意");
  dashboard.getRange(urgentStart, 2, 1, 4).merge();
  dashboard.getRange(urgentStart, 2).setFontSize(13).setFontWeight("bold");

  const urgentData = [];
  if (urgentCount > 0) {
    urgentData.push(["🚨 24時間以内の締切", `${urgentCount} 件`, "早急に提出してください！"]);
  } else {
    urgentData.push(["🚨 24時間以内の締切", "なし", "余裕があります 👍"]);
  }

  if (nextDeadline) {
    urgentData.push(["📅 直近の締切", nextDeadline, nextAssignment]);
  } else {
    urgentData.push(["📅 直近の締切", "なし", ""]);
  }

  for (let i = 0; i < urgentData.length; i++) {
    const row = urgentStart + 1 + i;
    const label = urgentData[i][0];
    const val = urgentData[i][1];
    const desc = urgentData[i][2];

    dashboard.getRange(row, 2).setValue(label);
    
    const valueCell = dashboard.getRange(row, 3);
    valueCell.clearFormat(); // 書式をリセット
    valueCell.setValue(val);
    
    dashboard.getRange(row, 4).setValue(desc);

    // 日付データなら書式を設定
    if (val instanceof Date) {
      valueCell.setNumberFormat("MM/dd(ddd) HH:mm");
    }
  }

  dashboard.getRange(urgentStart + 1, 2, urgentData.length, 1)
    .setFontWeight("bold").setFontSize(11);
  dashboard.getRange(urgentStart + 1, 3, urgentData.length, 1)
    .setFontSize(12).setFontWeight("bold").setHorizontalAlignment("center");
  dashboard.getRange(urgentStart + 1, 4, urgentData.length, 1)
    .setFontColor("#888888").setFontSize(9);

  if (urgentCount > 0) {
    dashboard.getRange(urgentStart + 1, 3).setFontColor("#d32f2f");
    dashboard.getRange(urgentStart + 1, 2, 1, 3).setBackground("#fff3e0");
  }

  // --- 講義別進捗 ---
  const courseNames = Object.keys(courseStats);
  if (courseNames.length > 0) {
    const courseStart = urgentStart + urgentData.length + 2;
    dashboard.getRange(courseStart, 2).setValue("📚 講義別の進捗");
    dashboard.getRange(courseStart, 2, 1, 4).merge();
    dashboard.getRange(courseStart, 2).setFontSize(13).setFontWeight("bold");

    // ヘッダー
    const courseHeaderRow = courseStart + 1;
    dashboard.getRange(courseHeaderRow, 2).setValue("講義名");
    dashboard.getRange(courseHeaderRow, 3).setValue("未提出");
    dashboard.getRange(courseHeaderRow, 4).setValue("提出済み");
    dashboard.getRange(courseHeaderRow, 5).setValue("締切後未提出");
    dashboard.getRange(courseHeaderRow, 6).setValue("提出率");
    dashboard.getRange(courseHeaderRow, 2, 1, 5)
      .setFontWeight("bold").setBackground("#e8eaf6").setHorizontalAlignment("center");

    for (let i = 0; i < courseNames.length; i++) {
      const row = courseHeaderRow + 1 + i;
      const name = courseNames[i];
      const cs = courseStats[name];
      const total = cs.pending + cs.done + cs.missed;
      const rate = total > 0 ? Math.round((cs.done / total) * 100) : 0;

      dashboard.getRange(row, 2).setValue(name || "(講義名なし)");
      dashboard.getRange(row, 3).setValue(`${cs.pending} 件`);
      dashboard.getRange(row, 4).setValue(`${cs.done} 件`);
      dashboard.getRange(row, 5).setValue(cs.missed > 0 ? `${cs.missed} 件` : "0 件");
      dashboard.getRange(row, 6).setValue(`${rate}%`);

      dashboard.getRange(row, 3).setHorizontalAlignment("center");
      dashboard.getRange(row, 4).setHorizontalAlignment("center");
      dashboard.getRange(row, 5).setHorizontalAlignment("center")
        .setFontColor(cs.missed > 0 ? "#d32f2f" : "#aaaaaa");
      dashboard.getRange(row, 6).setHorizontalAlignment("center")
        .setFontWeight("bold")
        .setFontColor(rate >= 80 ? "#388e3c" : rate >= 50 ? "#f57c00" : "#d32f2f");

      // 交互色
      if (i % 2 === 0) {
        dashboard.getRange(row, 2, 1, 5).setBackground("#f8f9fa");
      }
    }

    // 枠線
    dashboard.getRange(courseHeaderRow, 2, courseNames.length + 1, 5)
      .setBorder(true, true, true, true, true, true, "#e0e0e0", SpreadsheetApp.BorderStyle.SOLID);
  }

  // --- 全体スタイル ---
  dashboard.setColumnWidth(1, 20);
  dashboard.setColumnWidth(2, 200);
  dashboard.setColumnWidth(3, 130);
  dashboard.setColumnWidth(4, 100);
  dashboard.setColumnWidth(5, 100);
  dashboard.setColumnWidth(6, 100);

  // 最終更新
  const footerRow = dashboard.getLastRow() + 2;
  dashboard.getRange(footerRow, 2)
    .clearFormat()
    .setValue(now)
    .setNumberFormat("\"最終更新: \"yyyy/MM/dd HH:mm")
    .setFontColor("#aaaaaa")
    .setFontSize(9);
}

// ===== 手動リセット =====
// Apps Scriptエディタから実行: カレンダーの全イベント削除 + シートクリア
// 以前のデプロイで作られた古いイベントも含めて全て削除します
function resetSync() {
  const calendar = getOrCreateCalendar();
  const sheet = getOrCreateSheet();

  // カレンダーの全イベントを削除（過去〜1年後まで）
  const from = new Date(2020, 0, 1);
  const to = new Date();
  to.setFullYear(to.getFullYear() + 1);

  const events = calendar.getEvents(from, to);
  let deleted = 0;
  for (const event of events) {
    event.deleteEvent();
    deleted++;
  }

  // シートのデータ行を全てクリア
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }

  // 最新の列構成に合わせてヘッダーを強制上書き
  setupSheetHeaders(sheet);

  SpreadsheetApp.getUi().alert(
    `リセット完了:\n・カレンダーイベント ${deleted} 件を削除\n・シートをクリア\n\nUNIPAの課題一覧ページを再読み込みすると、提出受付中の課題のみ再同期されます。`
  );
}
