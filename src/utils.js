// utils.js - Common Utility Functions for Notidian

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

export function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  const s = String(str);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function showToast(msg) {
  const existing = document.getElementById('notidian-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'notidian-toast';
  toast.style = 'position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); background: rgba(13, 17, 28, 0.9); color: #fff; padding: 8px 16px; border-radius: 20px; font-size: 12px; font-weight: 600; border: 1px solid var(--accent-primary); box-shadow: 0 4px 12px rgba(0,0,0,0.5); z-index: 10000; animation: toastFade 2s forwards;';
  toast.textContent = msg;

  const style = document.createElement('style');
  style.innerHTML = `
    @keyframes toastFade {
      0% { opacity: 0; transform: translate(-50%, 10px); }
      15% { opacity: 1; transform: translate(-50%, 0); }
      85% { opacity: 1; transform: translate(-50%, 0); }
      100% { opacity: 0; transform: translate(-50%, -10px); }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 2000);
}

export function isSameContent(notesA, notesB) {
  if (!notesA || !notesB) return false;
  const cleanNotes = (notes) => {
    return JSON.stringify(notes, (key, value) => {
      if (key === 'updatedAt' || key === 'sortIndex' || key === 'activeFocusedBlockId' || key === 'selectedBlockIds') {
        return undefined;
      }
      return value;
    });
  };
  return cleanNotes(notesA) === cleanNotes(notesB);
}

export function formatMS(ms) {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}分${sec}秒`;
}

export function getFormattedTime() {
  const now = new Date();
  const hrs = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');
  return `${hrs}:${mins}`;
}

export function getFormattedTimeFromMs(ms) {
  const d = new Date(ms);
  const hrs = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${hrs}:${mins}`;
}
