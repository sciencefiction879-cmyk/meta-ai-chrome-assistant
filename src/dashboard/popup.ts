import { WorkflowState } from '../types';
import { parseCustomVideoIds } from '../utils/normalizer';

let state: WorkflowState | null = null;

async function init() {
  document.getElementById('btn-open-full-dashboard')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  });

  // Video ID Range listeners
  document.getElementById('dup-range-start')?.addEventListener('input', () => syncPopupRange('start'));
  document.getElementById('dup-range-end')?.addEventListener('input', () => syncPopupRange('end'));
  document.getElementById('dup-custom-count')?.addEventListener('input', () => syncPopupRange('count'));

  // Custom Video IDs toggle & input
  const chkCustom = document.getElementById('chk-custom-video-ids') as HTMLInputElement | null;
  const inputCustom = document.getElementById('input-custom-video-ids') as HTMLInputElement | null;
  const rangeRow = document.getElementById('popup-range-row');

  chkCustom?.addEventListener('change', () => {
    const enabled = chkCustom.checked;
    if (inputCustom) {
      inputCustom.style.display = enabled ? 'block' : 'none';
      if (enabled) inputCustom.focus();
    }
    if (rangeRow) {
      rangeRow.style.opacity = enabled ? '0.4' : '1';
      rangeRow.style.pointerEvents = enabled ? 'none' : 'auto';
    }
    syncPopupRange('start');
  });

  inputCustom?.addEventListener('input', () => syncPopupRange('start'));

  syncPopupRange('start');

  // Preset copy buttons
  document.querySelectorAll('.btn-dup-preset').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const count = parseInt((e.currentTarget as HTMLElement).dataset.count || '1', 10);
      const countInput = document.getElementById('dup-custom-count') as HTMLInputElement;
      if (countInput) countInput.value = count.toString();
      syncPopupRange('count');
      duplicate();
    });
  });

  document.getElementById('btn-duplicate-chats')?.addEventListener('click', () => {
    duplicate();
  });

  document.getElementById('btn-run-all')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RUN_EXECUTION', target: 'all' }, () => syncState());
  });

  document.getElementById('btn-pause-all')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'PAUSE_EXECUTION' }, () => syncState());
  });

  document.getElementById('btn-resume-all')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESUME_EXECUTION' }, () => syncState());
  });

  document.getElementById('btn-download-all')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#sec-downloads') });
  });

  // Load and subscribe
  syncState();
  setInterval(syncState, 2000);
}

function syncPopupRange(from: 'start' | 'end' | 'count') {
  const chkCustom = document.getElementById('chk-custom-video-ids') as HTMLInputElement | null;
  const inputCustom = document.getElementById('input-custom-video-ids') as HTMLInputElement | null;
  const previewEl = document.getElementById('dup-range-preview');

  if (chkCustom?.checked && inputCustom) {
    const customIds = parseCustomVideoIds(inputCustom.value);
    if (previewEl) {
      previewEl.textContent = customIds.length > 0
        ? `(${customIds.map((id) => `V${id}`).join(', ')})`
        : '(None)';
    }
    return;
  }

  const startInput = document.getElementById('dup-range-start') as HTMLInputElement;
  const endInput = document.getElementById('dup-range-end') as HTMLInputElement;
  const countInput = document.getElementById('dup-custom-count') as HTMLInputElement;

  let start = parseInt(startInput?.value || '1', 10);
  let end = parseInt(endInput?.value || '5', 10);

  if (from === 'count') {
    const count = parseInt(countInput?.value || '1', 10);
    if (!isNaN(count) && count > 0) {
      end = start + count - 1;
      if (endInput) endInput.value = end.toString();
    }
  }

  if (isNaN(start) || start < 1) start = 1;
  if (isNaN(end) || end < 1) end = 1;

  if (from !== 'count' && countInput && document.activeElement !== countInput) {
    const count = Math.max(0, end - start + 1);
    countInput.value = count > 0 ? count.toString() : '';
  }

  if (previewEl) {
    previewEl.textContent = `(V${start}–V${end})`;
  }
}

function duplicate(count?: number) {
  const initialText = (document.getElementById('dup-initial-message') as HTMLInputElement)?.value || '';
  const chkCustom = document.getElementById('chk-custom-video-ids') as HTMLInputElement | null;
  const inputCustom = document.getElementById('input-custom-video-ids') as HTMLInputElement | null;

  if (chkCustom?.checked && inputCustom) {
    const explicitVideoIds = parseCustomVideoIds(inputCustom.value);
    if (explicitVideoIds.length === 0) {
      alert('Validation Error: Please specify at least one valid Video ID (e.g. V3, V4, V7, V9, V10).');
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: 'DUPLICATE_CHATS',
        count: explicitVideoIds.length,
        initialText,
        explicitVideoIds
      },
      () => syncState()
    );
    return;
  }

  const startInput = document.getElementById('dup-range-start') as HTMLInputElement;
  const endInput = document.getElementById('dup-range-end') as HTMLInputElement;

  let start = parseInt(startInput?.value || '1', 10);
  let end = parseInt(endInput?.value || '5', 10);

  if (isNaN(start) || start < 1) start = 1;
  if (isNaN(end) || end < 1) end = 1;

  if (start > end) {
    alert(`Validation Error: Start Video ID (V${start}) cannot be greater than End Video ID (V${end}).`);
    return;
  }

  const calculatedCount = end - start + 1;
  const finalCount = count !== undefined ? count : calculatedCount;

  chrome.runtime.sendMessage(
    {
      type: 'DUPLICATE_CHATS',
      count: finalCount,
      initialText,
      startVideoId: start,
      endVideoId: end,
    },
    () => syncState()
  );
}

function syncState() {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
    if (response && response.state) {
      state = response.state;
      renderQuickStats(response.state);
      renderPopupProgress(response.state);
      renderRecentLogs(response.state.logs);
    }
  });
}

function renderPopupProgress(s: WorkflowState) {
  const container = document.getElementById('popup-videos-container');
  const badge = document.getElementById('popup-progress-badge');
  if (!container) return;

  const activeTabs = s.tabs.filter((t) => t.parts.length > 0 || t.status === 'running');
  const tabsToShow = activeTabs.length > 0 ? activeTabs : s.tabs.slice(0, 3);

  if (tabsToShow.length === 0) {
    container.innerHTML = `<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 12px;">No active videos yet. Click Duplicate or open chats to begin.</div>`;
    if (badge) badge.textContent = 'Idle';
    return;
  }

  const runningCount = s.tabs.filter((t) => t.status === 'running').length;
  if (badge) {
    badge.textContent = runningCount > 0 ? `${runningCount} Running ⚡` : 'Synchronized ✓';
    badge.style.color = runningCount > 0 ? '#f59e0b' : '#34d399';
    badge.style.background = runningCount > 0 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)';
  }

  container.innerHTML = tabsToShow.map((tab) => {
    const vNum = tab.index || parseInt(tab.id.replace(/\D/g, ''), 10) || 1;
    const totalParts = tab.totalParts > 0 ? tab.totalParts : (tab.parts.length > 0 ? tab.parts.length : 1);
    const hasCompetitorScript = Boolean((tab.scriptStatus && tab.scriptStatus !== 'none') || tab.scriptId);
    let outlineBadge = '';
    if (hasCompetitorScript) {
      outlineBadge = `<span style="color: #38bdf8; font-size: 10px; font-weight: 600; margin-left: 6px;" title="Reference script uploaded: direct parts mode">[REF SCRIPT ✓]</span>`;
    } else if (tab.outlineDetected) {
      outlineBadge = `<span style="color: #10b981; font-size: 10px; font-weight: 600; margin-left: 6px;">[OUTLINE: ✓]</span>`;
    }

    const missingAlert = tab.missingParts && tab.missingParts.length > 0 ? `
      <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; padding: 3px 8px; border-radius: 4px; font-weight: bold; font-size: 10px; margin-bottom: 6px;">
        ⚠️ MISSING: ${tab.missingParts.map((n) => `${tab.id} P${n}`).join(', ')}
      </div>
    ` : '';

    const duplicateAlert = tab.duplicateParts && tab.duplicateParts.length > 0 ? `
      <div style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); color: #fcd34d; padding: 3px 8px; border-radius: 4px; font-weight: bold; font-size: 10px; margin-bottom: 6px;">
        ⚠️ DUPLICATE: ${tab.duplicateParts.map((n) => `${tab.id} P${n}`).join(', ')}
      </div>
    ` : '';

    let outlineRow = '';
    if (!hasCompetitorScript) {
      if (tab.outlineStatus === 'generating' || (!tab.outlineDetected && tab.status === 'running')) {
        outlineRow = `
          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0;">
            <div style="display: flex; align-items: center; gap: 6px; color: #f59e0b; font-weight: bold;">
              <span style="color: #f59e0b;">*</span>
              <strong>OUTLINE</strong>
              <span style="color: #f59e0b; font-weight: bold;">⚡</span>
            </div>
            <span style="font-size: 10px; color: #f59e0b; font-weight: 600;">
              OUTLINE GENERATING...
            </span>
          </div>
        `;
      } else if (tab.outlineDetected || tab.outlineStatus === 'completed') {
        outlineRow = `
          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0;">
            <div style="display: flex; align-items: center; gap: 6px; color: #10b981; font-weight: bold;">
              <span style="color: #10b981;">*</span>
              <strong>OUTLINE</strong>
              <span style="color: #10b981; font-weight: bold;">✓</span>
            </div>
            <span style="font-size: 10px; color: #10b981; font-weight: 600;">
              OUTLINE GENERATED ✓
            </span>
          </div>
        `;
      }
    }

    const partsRows = tab.parts.map((p) => {
      const marker = p.explicitMarker || `${tab.id} P${p.partNumber}`;
      let icon = '<span style="color: #64748b;">○</span>';
      let statusColor = '#94a3b8';
      let statusLabel = 'Queue';

      if (p.status === 'done') {
        icon = '<span style="color: #10b981; font-weight: bold;">✓</span>';
        statusColor = '#10b981';
        statusLabel = 'Generated ✓';
      } else if (p.status === 'generating') {
        icon = '<span style="color: #f59e0b; font-weight: bold;">⚡</span>';
        statusColor = '#f59e0b';
        statusLabel = 'Generating...';
      } else if (p.status === 'ready' || p.status === 'waiting') {
        icon = '<span style="color: #64748b;">○</span>';
        statusColor = '#94a3b8';
        statusLabel = 'Queue';
      } else if (p.status === 'error') {
        icon = '<span style="color: #ef4444; font-weight: bold;">✕</span>';
        statusColor = '#ef4444';
        statusLabel = 'Error';
      }

      const headingDisplay = p.heading ? `<span style="color: #94a3b8; font-size: 11px; margin-left: 4px;">— ${p.heading}</span>` : '';
      const doubleBadge = p.hasDoubleResponse
        ? `<span style="background: rgba(59, 130, 246, 0.2); color: #93c5fd; border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 3px; padding: 0 4px; font-size: 9px; margin-left: 4px;" title="Double response detected (${p.candidateCount || 2} variants).">[2 variants]</span>`
        : '';

      return `
        <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0;">
          <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 380px;">
            <span style="color: #94a3b8;">*</span>
            <strong>${marker}</strong>
            ${icon}
            ${headingDisplay}
            ${doubleBadge}
          </div>
          <span style="font-size: 10px; color: ${statusColor}; font-weight: 600; letter-spacing: 0.2px;">
            ${statusLabel}
          </span>
        </div>
      `;
    }).join('');

    return `
      <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; padding: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); padding-bottom: 4px;">
          <div>
            <strong style="color: #60a5fa; font-size: 12px; text-transform: uppercase;">VIDEO ${vNum}</strong>
            ${outlineBadge}
          </div>
          <span style="font-size: 11px; color: #cbd5e1;">Total Parts: <strong>${totalParts}</strong></span>
        </div>
        ${missingAlert}
        ${duplicateAlert}
        <div style="display: flex; flex-direction: column; gap: 2px;">
          ${outlineRow}
          ${partsRows || (!outlineRow ? '<div style="color: #64748b; font-size: 11px;">* No explicit parts detected yet —</div>' : '')}
        </div>
      </div>
    `;
  }).join('');
}

function renderQuickStats(s: WorkflowState) {
  const total = s.tabs.length;
  const ready = s.tabs.filter((t) => t.status === 'ready').length;
  const running = s.tabs.filter((t) => t.status === 'running').length;
  const completed = s.tabs.filter((t) => t.status === 'completed').length;

  const elTotal = document.getElementById('stat-total');
  const elReady = document.getElementById('stat-ready');
  const elRunning = document.getElementById('stat-running');
  const elCompleted = document.getElementById('stat-completed');

  if (elTotal) elTotal.textContent = String(total);
  if (elReady) elReady.textContent = String(ready);
  if (elRunning) elRunning.textContent = String(running);
  if (elCompleted) elCompleted.textContent = String(completed);
}

function renderRecentLogs(logs: any[]) {
  const container = document.getElementById('activity-log-container');
  if (!container) return;

  const recent = logs.slice(0, 8);
  container.innerHTML = recent.map((l) => `
    <div class="log-line">
      <span class="log-time">[${l.timeStr}]</span>
      <span class="log-level-${l.level}">[${l.level}]</span>
      <span class="log-msg">${l.message}</span>
    </div>
  `).join('');
}

document.addEventListener('DOMContentLoaded', init);
