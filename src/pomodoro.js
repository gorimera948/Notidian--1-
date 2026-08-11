import { state, saveLogsToStorage, saveNotesToStorage, getActiveNote, markLocalDataChanged } from './state.js';
import { generateId, escapeHTML } from './utils.js';
import { insertPomodoroStartToActiveTable, insertPomodoroLogToActiveNoteDb } from './database.js';

export let sets = [];
export let schedule = [];
export let presets = [];
let activePresetIdx = null;
let index = 0;
let isWork = true;
let raf = null;
let remaining = 0;
let duration = 1;
let endTime = 0;
export let isRunning = false;
export let isPaused = false;
let lastSec = null;
export let timerVolume = 0.5;

// Initialize Pomodoro Data
export function loadPomodoroData() {
  try {
    sets = JSON.parse(localStorage.getItem("pomodoro_sets") || "[]");
  } catch (e) {
    console.error("Failed to parse pomodoro_sets:", e);
    sets = [];
  }
  try {
    schedule = JSON.parse(localStorage.getItem("pomodoro_schedule") || "[]");
  } catch (e) {
    console.error("Failed to parse pomodoro_schedule:", e);
    schedule = [];
  }
  try {
    presets = JSON.parse(localStorage.getItem("pomodoro_presets") || "[]");
  } catch (e) {
    console.error("Failed to parse pomodoro_presets:", e);
    presets = [];
  }

  timerVolume = parseFloat(localStorage.getItem("pomodoro_standalone_volume") || "0.5");

  // 1.5秒などのテストデータのクリーンアップ (強化版)
  let needsSave = false;
  if (Array.isArray(sets) && sets.length > 0) {
    const originalLength = sets.length;
    sets = sets.filter(s => s.work >= 10000 && !(s.name && s.name.includes("1.5")));
    if (sets.length !== originalLength) needsSave = true;
  }
  if (Array.isArray(schedule) && schedule.length > 0) {
    const originalLength = schedule.length;
    schedule = schedule.filter(s => s.work >= 10000 && !(s.name && s.name.includes("1.5")));
    if (schedule.length !== originalLength) needsSave = true;
  }
  if (needsSave) {
    savePomodoroData();
  }

  // Prepopulate standard Pomodoro configurations if completely empty
  if (!Array.isArray(sets) || sets.length === 0) {
    sets = [
      { name: '作業セッション (25分)', work: 25 * 60 * 1000, rest: 5 * 60 * 1000 },
      { name: 'ショートブレイク (5分)', work: 5 * 60 * 1000, rest: 3 * 60 * 1000 },
      { name: 'テスト用 (10秒)', work: 10 * 1000, rest: 5 * 1000 }
    ];
    savePomodoroData();
  }

  if (!Array.isArray(schedule) || schedule.length === 0) {
    schedule = [sets[0]];
    savePomodoroData();
  }
}

export function savePomodoroData() {
  localStorage.setItem("pomodoro_sets", JSON.stringify(sets));
  localStorage.setItem("pomodoro_schedule", JSON.stringify(schedule));
  localStorage.setItem("pomodoro_presets", JSON.stringify(presets));
  localStorage.setItem("pomodoro_standalone_volume", timerVolume);
  markLocalDataChanged('pomodoro');
}

export function setTimerVolume(val) {
  timerVolume = val;
  savePomodoroData();
}

// Sets Manager
export function addSet() {
  const nameVal = document.getElementById("name").value.trim();
  let workMinVal = Math.max(0, Number(document.getElementById("workMin").value || 0));
  let workSecVal = Math.max(0, Number(document.getElementById("workSec").value || 0));
  let restMinVal = Math.max(0, Number(document.getElementById("restMin").value || 0));
  let restSecVal = Math.max(0, Number(document.getElementById("restSec").value || 0));

  // 秒が60以上の場合の繰り上げ処理
  if (workSecVal >= 60) {
    workMinVal += Math.floor(workSecVal / 60);
    workSecVal = workSecVal % 60;
  }
  if (restSecVal >= 60) {
    restMinVal += Math.floor(restSecVal / 60);
    restSecVal = restSecVal % 60;
  }

  const work = (workMinVal * 60 + workSecVal) * 1000;
  const rest = (restMinVal * 60 + restSecVal) * 1000;

  if (!nameVal || work <= 0) {
    alert('セット名と有効な作業時間を入力してください。');
    return;
  }

  sets.push({ name: nameVal, work, rest });

  // Clear inputs
  document.getElementById("name").value = '';
  document.getElementById("workMin").value = '25';
  document.getElementById("workSec").value = '0';
  document.getElementById("restMin").value = '5';
  document.getElementById("restSec").value = '0';

  savePomodoroData();
  renderPomodoro();
}

export function deleteSet() {
  const setSel = document.getElementById("setSelect");
  const selectedIdx = setSel.value;
  if (selectedIdx === "" || !sets[selectedIdx]) return;

  sets.splice(selectedIdx, 1);
  savePomodoroData();
  renderPomodoro();
}

// Schedule Manager
export function addSchedule() {
  const setSel = document.getElementById("setSelect");
  const selectedIdx = setSel.value;
  if (selectedIdx === "" || !sets[selectedIdx]) return;

  activePresetIdx = null; // スケジュール構成が変わったためプリセット選択状態を解除
  schedule.push(sets[selectedIdx]);
  savePomodoroData();
  renderPomodoro();

  // 描画後、再び選択状態を復元！
  const newSetSel = document.getElementById("setSelect");
  if (newSetSel && selectedIdx !== "") {
    newSetSel.value = selectedIdx;
  }
}

export function deleteSchedule(i) {
  activePresetIdx = null; // スケジュール構成が変わったためプリセット選択状態を解除
  schedule.splice(i, 1);

  // Adjust index if out of bounds
  if (index >= schedule.length) {
    index = Math.max(0, schedule.length - 1);
  }

  savePomodoroData();
  renderPomodoro();
}

// Presets Manager
export function savePreset() {
  const pName = document.getElementById("presetName").value.trim();
  if (!pName) {
    alert('プリセット名を入力してください。');
    return;
  }
  presets.push({ name: pName, schedule: JSON.parse(JSON.stringify(schedule)) });
  document.getElementById("presetName").value = '';
  activePresetIdx = presets.length - 1; // 登録された新規プリセットを選択状態にする
  savePomodoroData();
  renderPomodoro();
}

export function loadPreset() {
  const pSel = document.getElementById("presetSelect");
  const selected = pSel.value;
  if (selected === "" || !presets[selected]) {
    activePresetIdx = null;
    return;
  }

  stopTimer(); // タイマー動作中であれば確実に停止して初期化

  schedule = JSON.parse(JSON.stringify(presets[selected].schedule));
  index = 0;
  isWork = true;
  activePresetIdx = selected; // ロードしたインデックスを保持
  savePomodoroData();
  renderPomodoro();
}

export function deletePreset() {
  const pSel = document.getElementById("presetSelect");
  const selected = pSel.value;
  if (selected === "" || !presets[selected]) {
    alert('削除するプリセットを選択してください。');
    return;
  }

  if (confirm(`プリセット「${presets[selected].name}」を削除してもよろしいですか？`)) {
    presets.splice(selected, 1);
    activePresetIdx = null; // 削除されたのでアクティブ選択を解除
    savePomodoroData();
    renderPomodoro();
  }
}

function formatMS(ms) {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}分${sec}秒`;
}

// Render Pomodoro Widgets
export function renderPomodoro() {
  // Populate select dropdowns
  const setSel = document.getElementById("setSelect");
  if (!setSel) return; // Guard for DOM presence
  setSel.innerHTML = "";
  sets.forEach((s, i) => {
    const wMin = Math.floor(s.work / 60000);
    const wSec = Math.floor((s.work % 60000) / 1000);
    const rMin = Math.floor(s.rest / 60000);
    const rSec = Math.floor((s.rest % 60000) / 1000);

    const wStr = `${wMin}分${wSec}秒`;
    const rStr = `${rMin}分${rSec}秒`;

    setSel.innerHTML += `<option value="${i}">${escapeHTML(s.name)} (${wStr}/${rStr})</option>`;
  });
  if (sets.length === 0) setSel.innerHTML = `<option value="">セットなし</option>`;

  const pSel = document.getElementById("presetSelect");
  pSel.innerHTML = "";

  const defOpt = document.createElement('option');
  defOpt.value = "";
  defOpt.textContent = "プリセットを選択...";
  if (activePresetIdx === null || activePresetIdx === "") {
    defOpt.selected = true;
  }
  pSel.appendChild(defOpt);

  presets.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.name;
    if (activePresetIdx !== null && String(activePresetIdx) === String(i)) {
      opt.selected = true;
    }
    pSel.appendChild(opt);
  });

  // Render Schedule Items
  const schedContainer = document.getElementById("schedule");
  schedContainer.innerHTML = "";

  if (schedule.length === 0) {
    schedContainer.innerHTML = '<div class="no-data-msg">スケジュールが空です</div>';

    // Empty timer displays
    document.getElementById("currentIndex").textContent = '0/0';
    document.getElementById("taskName").textContent = '未選択';
    document.getElementById("time").textContent = '00:00';
    drawCirclePizza(0);
    return;
  }

  schedule.forEach((s, i) => {
    const isActive = i === index;
    schedContainer.innerHTML += `
      <div class="scheduleItem ${isActive ? 'active' : ''}">
        <div class="scheduleMain">
          <div class="schedule-name">${i + 1}. ${escapeHTML(s.name)}</div>
          <div class="schedule-times">作業: ${formatMS(s.work)} / 休憩: ${formatMS(s.rest)}</div>
        </div>
        <button class="del" data-index="${i}">×</button>
      </div>`;
  });

  // Re-bind delete buttons directly inside JS
  schedContainer.querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(btn.getAttribute('data-index'));
      deleteSchedule(idx);
    });
  });

  // Init sortable schedule reordering
  Sortable.create(schedContainer, {
    animation: 150,
    handle: '.scheduleMain',
    onEnd: (e) => {
      activePresetIdx = null; // 並び替えたためプリセット選択状態を解除
      const moved = schedule.splice(e.oldIndex, 1)[0];
      schedule.splice(e.newIndex, 0, moved);

      // Update active index if moved
      if (index === e.oldIndex) {
        index = e.newIndex;
      } else if (index > e.oldIndex && index <= e.newIndex) {
        index--;
      } else if (index < e.oldIndex && index >= e.newIndex) {
        index++;
      }

      savePomodoroData();
      renderPomodoro();
    }
  });

  // Update timer display states
  if (!isRunning && schedule[index]) {
    const card = document.getElementById("pomodoro-timer-card");
    if (card) {
      card.classList.remove("status-work", "status-break");
    }
    document.getElementById("currentIndex").textContent = `${index + 1}/${schedule.length}`;
    document.getElementById("taskName").textContent = `${index + 1}. ${schedule[index].name}`;
    const initialRem = isWork ? schedule[index].work : schedule[index].rest;
    const initialSec = Math.ceil(initialRem / 1000);
    document.getElementById("time").textContent = `${Math.floor(initialSec / 60)}:${String(initialSec % 60).padStart(2, '0')}`;
    drawCirclePizza(initialRem);
  }
}

// Timer loops & run controls
export function startTimer() {
  if (schedule.length === 0) return;

  if (!isRunning) {
    isWork = false; // Will invert to true immediately inside run()
    run();
    isRunning = true;
    isPaused = false;
  } else if (isPaused) {
    endTime = Date.now() + remaining;
    loop();
    isPaused = false;
  }
}

function run() {
  if (index >= schedule.length) {
    stopTimer();
    return;
  }

  const s = schedule[index];

  isWork = !isWork;
  duration = isWork ? s.work : s.rest;

  remaining = duration;
  endTime = Date.now() + duration;
  lastSec = Math.ceil(duration / 1000);

  const card = document.getElementById("pomodoro-timer-card");
  if (card) {
    if (isWork) {
      card.classList.add("status-work");
      card.classList.remove("status-break");
    } else {
      card.classList.add("status-break");
      card.classList.remove("status-work");
    }
  }

  document.getElementById("currentIndex").textContent = `${index + 1}/${schedule.length}`;
  document.getElementById("taskName").textContent = `${index + 1}. ${s.name} (${isWork ? '作業中' : '休憩中'})`;

  // タイマー開始時（作業セッションの開始時）に現在のテーブルに自動挿入
  if (isWork) {
    insertPomodoroStartToActiveTable(s.name, s.work);
  }

  renderPomodoro();
  isPaused = false;
  loop();
}

function loop() {
  cancelAnimationFrame(raf);

  function frame() {
    const now = Date.now();
    remaining = endTime - now;

    if (remaining <= 0) {
      remaining = 0;

      if (lastSec !== 0) {
        beepSound();
        lastSec = 0;
      }

      document.getElementById("time").textContent = "0:00";
      drawCirclePizza(0);

      endAlertSound();

      // Trigger Focus Log Event if Work Session Completed
      if (isWork) {
        logFocusSession(schedule[index].name, schedule[index].work);
      }

      // Next phase transition
      isWork ? run() : (index++, isWork = false, run());
      return;
    }

    const sec = Math.ceil(remaining / 1000);

    if (sec !== lastSec) {
      if (sec === 3 || sec === 2 || sec === 1) {
        beepSound();
      }
      lastSec = sec;
    }

    document.getElementById("time").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    drawCirclePizza(remaining);

    raf = requestAnimationFrame(frame);
  }

  frame();
}

export function pauseTimer() {
  cancelAnimationFrame(raf);
  if (isRunning) {
    isPaused = true;
  }
}

export function stopTimer() {
  cancelAnimationFrame(raf);
  isRunning = false;
  isPaused = false;
  index = 0;
  isWork = true; // reset

  const card = document.getElementById("pomodoro-timer-card");
  if (card) {
    card.classList.remove("status-work", "status-break");
  }

  renderPomodoro();
}

function getFormattedTimeFromMs(ms) {
  const d = new Date(ms);
  const hrs = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${hrs}:${mins}`;
}

// Pomodoro Focus Completion Log
function logFocusSession(taskName, durationMs) {
  const durationMin = Math.ceil(durationMs / 60000);
  const todayString = new Date().toLocaleDateString('ja-JP');

  // 開始・終了時間の計算と明記
  const endMs = Date.now();
  const startMs = endMs - durationMs;
  const startStr = getFormattedTimeFromMs(startMs);
  const endStr = getFormattedTimeFromMs(endMs);
  const fullDateStr = `${todayString} ${startStr}~${endStr}`;

  const newLog = {
    id: generateId(),
    taskName: taskName || '未命名のタスク',
    date: fullDateStr,
    timestamp: endMs,
    duration: durationMin,
    status: '完了'
  };

  state.focusLogs.push(newLog);
  saveLogsToStorage();

  // 現在開いているページの最初に見つかったデータベースに自動挿入
  insertPomodoroLogToActiveNoteDb(newLog.taskName, newLog.duration);
}

// Audio beepers
export function beepSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle'; // 三角波に変更し音圧を劇的向上！
    o.frequency.value = 600;
    g.gain.setValueAtTime(6.25 * timerVolume, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.002, ctx.currentTime + 0.18);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.18);
  } catch (e) {
    console.error('AudioContext fail', e);
  }
}

export function endAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle'; // 三角波に変更し音圧を劇的向上！
    o.frequency.value = 750;
    g.gain.setValueAtTime(8.75 * timerVolume, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.002, ctx.currentTime + 1.5);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 1.5);
  } catch (e) {
    console.error('AudioContext fail', e);
  }
}

// Draw radial focus progress inside canvas
export function drawCirclePizza(rem) {
  const canvas = document.getElementById("circle");
  if (!canvas) return; // Guard for DOM presence
  const ctx = canvas.getContext("2d");

  let ratio = rem / duration;
  if (rem <= 0) ratio = 0;

  ctx.clearRect(0, 0, 130, 130);

  // Glow filter properties
  ctx.shadowBlur = 10;
  ctx.shadowColor = isWork ? "rgba(59, 130, 246, 0.4)" : "rgba(16, 185, 129, 0.4)";

  // Outer full circular arc (muted gray border track)
  ctx.beginPath();
  ctx.arc(65, 65, 55, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 8;
  ctx.stroke();

  // Progress circular arc
  const start = -Math.PI / 2;
  const end = start + Math.PI * 2 * ratio;

  ctx.beginPath();
  ctx.arc(65, 65, 55, start, end);
  ctx.strokeStyle = isWork ? "#3b82f6" : "#10b981"; // Blue for focus, emerald green for break
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.stroke();

  // Reset shadow for further draws
  ctx.shadowBlur = 0;
}
