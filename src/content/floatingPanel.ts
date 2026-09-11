import { VTab, GeneratedPart } from '../types';

export class FloatingPanel {
  private container: HTMLElement | null = null;
  private isMinimized = false;
  private currentTab: VTab | null = null;
  private showOverride = false;
  private onInsertPartCallback?: (partNum: number) => void;
  private onDownloadCallback?: () => void;
  private onRetryCallback?: () => void;
  private onRestartCallback?: () => void;
  private onCancelCallback?: () => void;
  private onRefreshCallback?: () => void;
  private onOverrideCallback?: (totalParts: number, currentPart: number, outlineDetected: boolean) => void;

  // Dragging and Resizing State
  private isDragging = false;
  private isResizing = false;
  private savedTop: number | null = null;
  private savedLeft: number | null = null;
  private savedWidth: number | null = null;
  private savedHeight: number | null = null;

  constructor(
    onInsertPart?: (partNum: number) => void,
    onDownload?: () => void,
    onRetry?: () => void,
    onRestart?: () => void,
    onCancel?: () => void,
    onRefresh?: () => void,
    onOverride?: (totalParts: number, currentPart: number, outlineDetected: boolean) => void
  ) {
    this.onInsertPartCallback = onInsertPart;
    this.onDownloadCallback = onDownload;
    this.onRetryCallback = onRetry;
    this.onRestartCallback = onRestart;
    this.onCancelCallback = onCancel;
    this.onRefreshCallback = onRefresh;
    this.onOverrideCallback = onOverride;

    this.loadSavedGeometry();
  }

  private loadSavedGeometry(): void {
    try {
      const top = localStorage.getItem('qwen_hud_v3_top') || sessionStorage.getItem('qwen_hud_v3_top');
      const left = localStorage.getItem('qwen_hud_v3_left') || sessionStorage.getItem('qwen_hud_v3_left');
      const w = localStorage.getItem('qwen_hud_v3_w') || sessionStorage.getItem('qwen_hud_v3_w');
      const h = localStorage.getItem('qwen_hud_v3_h') || sessionStorage.getItem('qwen_hud_v3_h');

      if (top) this.savedTop = parseFloat(top);
      if (left) this.savedLeft = parseFloat(left);
      if (w) this.savedWidth = parseFloat(w);
      if (h) this.savedHeight = parseFloat(h);
    } catch {
      // Ignore storage errors
    }
  }

  private saveGeometry(): void {
    try {
      if (this.savedTop !== null) {
        sessionStorage.setItem('qwen_hud_v3_top', this.savedTop.toString());
        localStorage.setItem('qwen_hud_v3_top', this.savedTop.toString());
      }
      if (this.savedLeft !== null) {
        sessionStorage.setItem('qwen_hud_v3_left', this.savedLeft.toString());
        localStorage.setItem('qwen_hud_v3_left', this.savedLeft.toString());
      }
      if (this.savedWidth !== null) {
        sessionStorage.setItem('qwen_hud_v3_w', this.savedWidth.toString());
        localStorage.setItem('qwen_hud_v3_w', this.savedWidth.toString());
      }
      if (this.savedHeight !== null) {
        sessionStorage.setItem('qwen_hud_v3_h', this.savedHeight.toString());
        localStorage.setItem('qwen_hud_v3_h', this.savedHeight.toString());
      }
    } catch {
      // Ignore storage errors
    }
  }

  public resetDefaultGeometry(): void {
    try {
      localStorage.removeItem('qwen_hud_v3_top');
      localStorage.removeItem('qwen_hud_v3_left');
      localStorage.removeItem('qwen_hud_v3_w');
      localStorage.removeItem('qwen_hud_v3_h');
      sessionStorage.removeItem('qwen_hud_v3_top');
      sessionStorage.removeItem('qwen_hud_v3_left');
      sessionStorage.removeItem('qwen_hud_v3_w');
      sessionStorage.removeItem('qwen_hud_v3_h');
    } catch {
      // Ignore storage errors
    }
    this.savedTop = null;
    this.savedLeft = null;
    this.savedWidth = null;
    this.savedHeight = null;
    this.applyGeometry();
  }

  public mount(): void {
    if (this.container || document.getElementById('qwen-extension-hud-root')) {
      return;
    }

    this.container = document.createElement('div');
    this.container.id = 'qwen-extension-hud-root';
    this.container.className = 'qwen-assistant-hud';
    document.body.appendChild(this.container);

    this.applyGeometry();
    this.render();
  }

  private applyGeometry(): void {
    if (!this.container) return;

    if (this.savedTop !== null && this.savedLeft !== null) {
      // Clamp to viewport
      const top = Math.max(10, Math.min(window.innerHeight - 80, this.savedTop));
      const left = Math.max(10, Math.min(window.innerWidth - 160, this.savedLeft));
      this.container.style.top = `${top}px`;
      this.container.style.left = `${left}px`;
      this.container.style.bottom = 'auto';
      this.container.style.right = 'auto';
    } else {
      // Default initial docked position: docked beside Qwen sidebar (matches screenshot)
      let defaultLeft = 180;
      try {
        const sidebar = document.querySelector('aside, [class*="sidebar" i], nav');
        if (sidebar) {
          const rect = sidebar.getBoundingClientRect();
          if (rect.width > 50 && rect.right > 50 && rect.right < window.innerWidth / 2) {
            defaultLeft = Math.round(rect.right + 8);
          }
        }
      } catch {
        // ignore
      }

      const defaultWidth = 255;
      const defaultHeight = Math.min(540, Math.max(300, window.innerHeight - 80));
      const defaultTop = Math.min(220, Math.max(20, window.innerHeight - defaultHeight - 40));

      const top = Math.max(10, Math.min(window.innerHeight - 80, defaultTop));
      const left = Math.max(10, Math.min(window.innerWidth - defaultWidth - 10, defaultLeft));

      this.container.style.top = `${top}px`;
      this.container.style.left = `${left}px`;
      this.container.style.bottom = 'auto';
      this.container.style.right = 'auto';
    }

    if (!this.isMinimized) {
      const w = this.savedWidth !== null
        ? Math.max(220, Math.min(window.innerWidth - 20, this.savedWidth))
        : 255;
      const h = this.savedHeight !== null
        ? Math.max(140, Math.min(window.innerHeight - 20, this.savedHeight))
        : Math.min(540, Math.max(300, window.innerHeight - 80));

      this.container.style.width = `${w}px`;
      this.container.style.height = `${h}px`;
    }
  }

  public update(tab: VTab): void {
    this.currentTab = tab;
    this.render();
  }

  public toggleMinimize(): void {
    this.isMinimized = !this.isMinimized;
    if (this.container) {
      if (this.isMinimized) {
        this.container.classList.add('minimized');
      } else {
        this.container.classList.remove('minimized');
        this.applyGeometry();
      }
    }
    this.render();
  }

  private render(): void {
    if (!this.container) return;

    const tab = this.currentTab;
    const vId = tab?.id || 'V1';
    const status = tab?.status || 'ready';
    const totalParts = tab?.totalParts || 0;
    const currentPart = tab?.currentPart || 1;

    // Determine status class and label
    let statusClass = 'hud-status-incomplete';
    let statusLabel = 'Incomplete';
    if (status === 'ready') {
      statusClass = 'hud-status-ready';
      statusLabel = '✓ Ready';
    } else if (status === 'running') {
      statusClass = 'hud-status-running';
      statusLabel = '⏳ Running';
    } else if (status === 'completed') {
      statusClass = 'hud-status-completed';
      statusLabel = '✓ Complete';
    } else if (status === 'error') {
      statusClass = 'hud-status-error';
      statusLabel = '✕ Error';
    }

    const thumbChecked = tab?.thumbnailId || tab?.thumbnailPasted || tab?.thumbnailStatus === 'assigned' || tab?.thumbnailStatus === 'uploaded' ? '✓' : '-';
    let thumbText = 'Thumb';
    if (tab?.thumbnailUploading) {
      thumbText = '⏳ Uploading';
    }

    const hasTitle = Boolean(tab?.title);
    const isOriginalMode = tab?.scriptMode === 'original' || (!tab?.scriptMode && tab?.scriptStatus === 'none');
    const hasScript = !isOriginalMode && tab?.scriptStatus !== 'none';
    const isOutlineDone = tab?.outlineStatus === 'completed' || Boolean(tab?.outlineDetected) || (Boolean(tab?.outlineContent) && /OUTLINE\s*[:=\-]\s*GENERATED/i.test(tab?.outlineContent || ''));
    const allDone = totalParts > 0 && (tab?.parts || []).length >= totalParts &&
      (tab?.parts || []).every(p => p.status === 'done' && Boolean(p.content));

    // Find next part to insert
    const nextPartToInsert = this.findNextAvailablePart(tab?.parts || [], isOutlineDone, hasScript);

    let outlineRowHtml = '';
    if (!hasScript) {
      if (tab?.outlineStatus === 'generating' && !isOutlineDone) {
        outlineRowHtml = `
          <div class="hud-part-row" style="display: flex; justify-content: space-between; align-items: center; padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 11px;">
            <div class="hud-part-name" style="display: flex; align-items: center; gap: 4px; color: #f59e0b; font-weight: bold;">
              <span class="part-icon-gen">⚡</span>
              <span><strong>OUTLINE</strong></span>
            </div>
            <span style="color: #f59e0b; font-weight: 600; font-size: 10px; margin-left: 6px;">
              Generating Outline...
            </span>
          </div>
        `;
      } else if (isOutlineDone) {
        outlineRowHtml = `
          <div class="hud-part-row" style="display: flex; justify-content: space-between; align-items: center; padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 11px;">
            <div class="hud-part-name" style="display: flex; align-items: center; gap: 4px; color: #10b981; font-weight: bold;">
              <span class="part-icon-done">✓</span>
              <span><strong>OUTLINE</strong></span>
            </div>
            <span style="color: #10b981; font-weight: 600; font-size: 10px; margin-left: 6px;">
              Generated ✓
            </span>
          </div>
        `;
      }
    }

    const partsListHtml = (tab?.parts || []).map((part) => {
      let icon = '<span class="part-icon-wait">○</span>';
      let statusColor = '#9ca3af';
      let statusText = 'Queue';

      if (part.status === 'done') {
        icon = '<span class="part-icon-done">✓</span>';
        statusColor = '#10b981';
        statusText = 'Completed ✓';
      } else if (part.status === 'generating') {
        icon = '<span class="part-icon-gen">⚡</span>';
        statusColor = '#f59e0b';
        statusText = 'Generating / Incomplete';
      } else if (part.status === 'ready' || part.status === 'waiting') {
        icon = '<span class="part-icon-wait">○</span>';
        statusColor = '#9ca3af';
        statusText = 'Queue';
      } else if (part.status === 'error') {
        icon = '<span class="part-icon-err" style="color: #ef4444; font-weight: bold;">✕</span>';
        statusColor = '#ef4444';
        statusText = 'Error';
      }

      const markerDisplay = part.explicitMarker || `${vId} P${part.partNumber}`;
      const headingDisplay = part.heading ? `— ${part.heading}` : '';
      const doubleBadge = part.hasDoubleResponse
        ? `<span style="background: rgba(59, 130, 246, 0.2); color: #93c5fd; border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 3px; padding: 0 4px; font-size: 9px; margin-left: 4px;" title="Double response detected (${part.candidateCount || 2} variants). Select preferred variant after generation.">[2 variants]</span>`
        : '';

      const canWriteThisPart = (part.status === 'ready' || part.status === 'waiting') && status !== 'running';
      const actionButton = canWriteThisPart
        ? `<button class="hud-part-write-btn" data-part="${part.partNumber}" style="background: #2563eb; color: #ffffff; border: none; border-radius: 3px; font-size: 10px; font-weight: 600; padding: 1px 6px; cursor: pointer; margin-left: 6px;" title="Write Part ${part.partNumber}">✍️ Write</button>`
        : '';

      return `
        <div class="hud-part-row" style="display: flex; justify-content: space-between; align-items: center; padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 11px;">
          <div class="hud-part-name" style="display: flex; align-items: center; gap: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px;">
            ${icon}
            <span title="${markerDisplay} ${headingDisplay}"><strong>${markerDisplay}</strong> ${headingDisplay}</span>
            ${doubleBadge}
          </div>
          <div style="display: flex; align-items: center;">
            <span style="color: ${statusColor}; font-weight: 600; font-size: 10px; margin-left: 4px;">
              ${statusText}
            </span>
            ${actionButton}
          </div>
        </div>
      `;
    }).join('');

    const missingPartsHtml = tab?.missingParts && tab.missingParts.length > 0 ? `
      <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 4px; padding: 4px 6px; margin: 4px 0; font-size: 10px; color: #fca5a5; font-weight: 600;">
        ⚠️ MISSING: ${tab.missingParts.map((n) => `${vId} P${n}`).join(', ')}
      </div>
    ` : '';

    const duplicatePartsHtml = tab?.duplicateParts && tab.duplicateParts.length > 0 ? `
      <div style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 4px; padding: 4px 6px; margin: 4px 0; font-size: 10px; color: #fcd34d; font-weight: 600;">
        ⚠️ DUPLICATE: ${tab.duplicateParts.map((n) => `${vId} P${n}`).join(', ')}
      </div>
    ` : '';

    const errorHtml = tab?.error ? `
      <div class="hud-error-banner">
        <div><strong>${tab.error.title}</strong></div>
        <div>${tab.error.problem}</div>
        <div style="display: flex; gap: 6px; margin-top: 4px;">
          ${tab.error.canRetry ? `<button id="hud-retry-btn">Try Again</button>` : ''}
          <button id="hud-error-restart-btn">Restart</button>
        </div>
      </div>
    ` : '';

    this.container.innerHTML = `
      <!-- 8-Direction Resizable Handles -->
      <div class="hud-resize-handle hud-resize-nw" data-dir="nw" title="Resize"></div>
      <div class="hud-resize-handle hud-resize-ne" data-dir="ne" title="Resize"></div>
      <div class="hud-resize-handle hud-resize-sw" data-dir="sw" title="Resize"></div>
      <div class="hud-resize-handle hud-resize-se" data-dir="se" title="Resize"></div>
      <div class="hud-resize-handle hud-resize-n" data-dir="n" title="Resize vertical"></div>
      <div class="hud-resize-handle hud-resize-s" data-dir="s" title="Resize vertical"></div>
      <div class="hud-resize-handle hud-resize-w" data-dir="w" title="Resize horizontal"></div>
      <div class="hud-resize-handle hud-resize-e" data-dir="e" title="Resize horizontal"></div>
      <div class="hud-resize-grip"></div>

      <!-- Draggable Header -->
      <div class="hud-header" id="hud-drag-header" title="Drag to reposition vertically or anywhere">
        <span class="hud-drag-grip">⠿</span>
        <div class="hud-title-wrap">
          <span class="hud-v-badge">${vId}</span>
          <span class="hud-parts-badge" title="Total parts detected in script">TOTAL PARTS: ${totalParts > 0 ? totalParts : '-'}</span>
          <span class="hud-status-badge ${statusClass}">${statusLabel}</span>
        </div>
        <div class="hud-controls" style="display: flex; align-items: center; gap: 4px;">
          <button id="hud-reset-pos-btn" title="Reset to default docked position (v3.0)" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 11px; padding: 1px 3px; line-height: 1;">⌂</button>
          <button id="hud-minimize-btn" title="${this.isMinimized ? 'Expand' : 'Minimize'}">${this.isMinimized ? '▲' : '▼'}</button>
        </div>
      </div>

      ${this.isMinimized ? '' : `
        <div class="hud-body">
          <div class="hud-checklist">
            <div class="hud-check-item ${hasTitle ? 'checked' : ''}">
              <span>${hasTitle ? '✓' : '○'}</span> Title
            </div>
            <div class="hud-check-item ${thumbChecked === '✓' ? 'checked' : ''}">
              <span>${thumbChecked}</span> ${thumbText}
            </div>
            <div class="hud-check-item ${hasScript ? 'checked' : ''}">
              <span>${hasScript ? '✓' : '○'}</span> Script
            </div>
          </div>

          <div class="hud-stats" style="display: flex; flex-direction: column; gap: 3px; font-size: 11px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>TOTAL PARTS: <span class="hud-stats-val">${totalParts > 0 ? totalParts : '-'}</span></div>
              <button id="hud-toggle-override-btn" style="background: rgba(59,130,246,0.15); border: 1px solid rgba(59,130,246,0.4); color: #93c5fd; font-size: 10px; padding: 1px 6px; border-radius: 3px; cursor: pointer;">✏️ Override</button>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <div>OUTLINE: ${hasScript ? '<span style="color: #38bdf8; font-weight: bold;" title="Competitor script provided: direct parts mode">REF SCRIPT ✓</span>' : (isOutlineDone ? '<span style="color: #10b981; font-weight: bold;">OUTLINE GENERATED ✓</span>' : '<span style="color: #f59e0b; font-weight: 500;">Generating Outline / Incomplete</span>')}</div>
              <div>Current: <span class="hud-stats-val">P${currentPart}</span></div>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <div>Progress: <span class="hud-stats-val">${this.calcProgress(tab?.parts || [])}</span></div>
              <div>Status: <span class="hud-stats-val">${!hasScript && isOutlineDone && (tab?.parts || []).filter(p => p.status === 'done').length === 0 && status !== 'running' ? 'OUTLINE GENERATED ✓' : status === 'running' ? '⏳ Processing... Waiting for Meta.ai' : statusLabel}</span></div>
            </div>
          </div>

          <!-- Live State & Debug Tracker (#21) -->
          <div class="hud-live-tracker" style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 5px; padding: 5px 8px; margin-top: 5px; font-size: 10px; color: #94a3b8; display: flex; flex-direction: column; gap: 2px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 700; color: #60a5fa; text-transform: uppercase; font-size: 9px; letter-spacing: 0.5px;">📡 Live Tracker:</span>
              <span style="font-size: 9px; color: #38bdf8; font-weight: 600;">${tab?.lifecycleStage || 'WAITING'}</span>
            </div>
            <div style="color: #cbd5e1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${tab?.liveDebugStatus || 'Waiting for run...'}">
              ${tab?.liveDebugStatus || (status === 'running' ? '⏳ Processing... Waiting for Meta.ai' : 'Ready')}
            </div>
          </div>

          <!-- Manual Override Box -->
          ${this.showOverride ? `
            <div id="hud-override-container" style="background: rgba(15, 23, 42, 0.95); border: 1px solid #3b82f6; border-radius: 6px; padding: 8px; margin: 6px 0;">
              <div style="font-size: 11px; font-weight: bold; color: #60a5fa; margin-bottom: 6px;">Manual Parts & Outline Override (${vId})</div>
              
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; padding: 4px 6px; background: rgba(0,0,0,0.3); border-radius: 4px;">
                <label style="font-size: 10px; color: #cbd5e1; font-weight: 500;">Outline Status:</label>
                <select id="hud-override-outline-select" style="background: #0f172a; color: #38bdf8; border: 1px solid #475569; border-radius: 4px; padding: 2px 6px; font-size: 11px; font-weight: 600; cursor: pointer;">
                  <option value="true" ${isOutlineDone ? 'selected' : ''}>✓ Outline Generated</option>
                  <option value="false" ${!isOutlineDone ? 'selected' : ''}>— No Outline (Direct Parts)</option>
                </select>
              </div>

              <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px;">
                <label style="font-size: 10px; color: #cbd5e1;">Total Parts:</label>
                <input type="number" id="hud-override-total" min="1" max="50" value="${totalParts > 0 ? totalParts : 4}" style="width: 48px; padding: 2px 4px; background: #0f172a; color: #fff; border: 1px solid #475569; border-radius: 4px; font-size: 11px;" />
                <label style="font-size: 10px; color: #cbd5e1;">Current:</label>
                <input type="number" id="hud-override-current" min="1" max="50" value="${currentPart > 0 ? currentPart : 1}" style="width: 48px; padding: 2px 4px; background: #0f172a; color: #fff; border: 1px solid #475569; border-radius: 4px; font-size: 11px;" />
              </div>
              <div style="display: flex; gap: 6px; justify-content: flex-end;">
                <button id="hud-override-cancel" style="padding: 2px 8px; font-size: 10px; background: #475569; color: #fff; border: none; border-radius: 3px; cursor: pointer;">Cancel</button>
                <button id="hud-override-save" style="padding: 2px 10px; font-size: 10px; background: #2563eb; color: #fff; border: none; border-radius: 3px; cursor: pointer; font-weight: bold;">Apply Override</button>
              </div>
            </div>
          ` : ''}

          <div class="hud-parts-list" style="margin-top: 6px;">
            ${missingPartsHtml}
            ${duplicatePartsHtml}
            <div style="font-size: 10px; font-weight: bold; color: #94a3b8; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">
              PARTS TRACKER:
            </div>
            ${outlineRowHtml}
            ${partsListHtml || (!outlineRowHtml ? '<div style="color: #6b7280; text-align: center; padding: 6px;">No parts detected yet</div>' : '')}
          </div>

          ${allDone ? `
            <div style="margin-top: 6px; padding: 4px 8px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 4px; font-size: 11px; color: #34d399; font-weight: bold; text-align: center;">
              TXT MERGE VERIFIED ✓
            </div>
          ` : ''}

          ${errorHtml}

          <div class="hud-actions">
            ${nextPartToInsert ? `
              <button class="hud-btn" id="hud-insert-next-btn">
                ✍️ Write Part ${nextPartToInsert} Script
              </button>
            ` : ''}

            <button class="hud-btn hud-btn-secondary" id="hud-download-btn" ${!this.hasDoneParts(tab?.parts) ? 'disabled' : ''}>
              📥 Download Parts
            </button>

            <div style="display: flex; gap: 4px; margin-top: 4px;">
              <button class="hud-btn hud-btn-secondary" id="hud-refresh-btn" style="flex: 1; padding: 4px; font-size: 11px;" title="Re-sync state in-place without page reload">🔃 Re-sync</button>
              <button class="hud-btn hud-btn-secondary" id="hud-restart-btn" style="flex: 1; padding: 4px; font-size: 11px;" title="Restart tab from Part 1">🔄 Restart</button>
              ${status === 'running' ? `<button class="hud-btn hud-btn-secondary" id="hud-cancel-btn" style="flex: 1; padding: 4px; font-size: 11px; color: #ef4444;" title="Cancel run">⏹ Cancel</button>` : ''}
            </div>
          </div>
        </div>
      `}
    `;

    this.attachEventListeners(nextPartToInsert);
    this.setupDraggable();
    this.setupResizable();
  }

  private findNextAvailablePart(parts: GeneratedPart[], isOutlineDone = false, hasScript = false): number | null {
    if (!hasScript && !isOutlineDone) {
      return null;
    }
    if (!parts || parts.length === 0) {
      if (!hasScript && isOutlineDone) return 1;
      return null;
    }
    const doneNumbers = new Set(parts.filter((p) => p.status === 'done').map((p) => p.partNumber));
    if (!hasScript && isOutlineDone && !doneNumbers.has(1)) return 1;

    for (const p of parts) {
      if (p.status === 'ready' && !doneNumbers.has(p.partNumber)) return p.partNumber;
      if (p.status === 'waiting' && !doneNumbers.has(p.partNumber)) return p.partNumber;
    }
    return null;
  }

  private hasDoneParts(parts?: GeneratedPart[]): boolean {
    return Boolean(parts && parts.some(p => p.status === 'done' && p.content));
  }

  private calcProgress(parts: GeneratedPart[]): string {
    if (!parts || parts.length === 0) return '0/0';
    const done = parts.filter(p => p.status === 'done' && Boolean(p.content && p.content.trim().length > 0)).length;
    return `${done}/${parts.length}`;
  }

  /**
   * Sets up drag functionality for repositioning the HUD vertically (and horizontally).
   */
  private setupDraggable(): void {
    if (!this.container) return;
    const header = this.container.querySelector('#hud-drag-header') as HTMLElement;
    if (!header) return;

    header.onmousedown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('#hud-minimize-btn')) return; // Ignore minimize button clicks

      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const rect = this.container!.getBoundingClientRect();
      let hasMoved = false;

      this.isDragging = true;
      this.container!.classList.add('is-dragging');

      const onMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
          hasMoved = true;
        }

        if (hasMoved && this.container) {
          const newTop = Math.max(10, Math.min(window.innerHeight - 50, rect.top + deltaY));
          const newLeft = Math.max(10, Math.min(window.innerWidth - 120, rect.left + deltaX));

          this.container.style.top = `${newTop}px`;
          this.container.style.left = `${newLeft}px`;
          this.container.style.bottom = 'auto';
          this.container.style.right = 'auto';

          this.savedTop = newTop;
          this.savedLeft = newLeft;
        }
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);

        this.isDragging = false;
        if (this.container) {
          this.container.classList.remove('is-dragging');
        }

        if (hasMoved) {
          this.saveGeometry();
        } else {
          // If mouse didn't move, treat as header click to toggle minimize
          this.toggleMinimize();
        }
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };
  }

  /**
   * Sets up multi-direction resizing from all corners and edges.
   */
  private setupResizable(): void {
    if (!this.container) return;

    const handles = this.container.querySelectorAll<HTMLElement>('.hud-resize-handle');
    handles.forEach((handle) => {
      handle.onmousedown = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const dir = handle.dataset.dir || 'se';
        const startX = e.clientX;
        const startY = e.clientY;
        const rect = this.container!.getBoundingClientRect();
        const minW = 220;
        const minH = 140;
        const maxW = window.innerWidth - 30;
        const maxH = window.innerHeight - 30;

        this.isResizing = true;
        this.container!.classList.add('is-resizing');

        const onMouseMove = (moveEvent: MouseEvent) => {
          const deltaX = moveEvent.clientX - startX;
          const deltaY = moveEvent.clientY - startY;

          let newWidth = rect.width;
          let newHeight = rect.height;
          let newTop = rect.top;
          let newLeft = rect.left;

          // East / West
          if (dir.includes('e')) {
            newWidth = Math.max(minW, Math.min(maxW, rect.width + deltaX));
          } else if (dir.includes('w')) {
            newWidth = Math.max(minW, Math.min(maxW, rect.width - deltaX));
            newLeft = rect.right - newWidth;
          }

          // South / North
          if (dir.includes('s')) {
            newHeight = Math.max(minH, Math.min(maxH, rect.height + deltaY));
          } else if (dir.includes('n')) {
            newHeight = Math.max(minH, Math.min(maxH, rect.height - deltaY));
            newTop = rect.bottom - newHeight;
          }

          if (this.container) {
            this.container.style.width = `${newWidth}px`;
            this.container.style.height = `${newHeight}px`;
            this.container.style.top = `${newTop}px`;
            this.container.style.left = `${newLeft}px`;
            this.container.style.bottom = 'auto';
            this.container.style.right = 'auto';

            this.savedWidth = newWidth;
            this.savedHeight = newHeight;
            this.savedTop = newTop;
            this.savedLeft = newLeft;
          }
        };

        const onMouseUp = () => {
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);

          this.isResizing = false;
          if (this.container) {
            this.container.classList.remove('is-resizing');
          }
          this.saveGeometry();
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      };
    });
  }

  private attachEventListeners(nextPartNum: number | null): void {
    if (!this.container) return;

    const resetPosBtn = this.container.querySelector('#hud-reset-pos-btn');
    resetPosBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.resetDefaultGeometry();
    });

    const minBtn = this.container.querySelector('#hud-minimize-btn');
    minBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMinimize();
    });

    const insertBtn = this.container.querySelector('#hud-insert-next-btn') as HTMLButtonElement | null;
    if (insertBtn && nextPartNum !== null) {
      insertBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        insertBtn.disabled = true;
        insertBtn.textContent = `⏳ Requesting Part ${nextPartNum}...`;
        this.onInsertPartCallback?.(nextPartNum);
        // Safety watchdog: re-enable button after 5 seconds if generation hasn't started or fails silently
        setTimeout(() => {
          if (insertBtn && insertBtn.isConnected && this.currentTab?.status !== 'running') {
            insertBtn.disabled = false;
            insertBtn.textContent = `✍️ Write Part ${nextPartNum} Script`;
          }
        }, 5000);
      });
    }

    // Attach listeners to individual row Write Part buttons
    this.container.querySelectorAll('.hud-part-write-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const part = parseInt((btn as HTMLElement).dataset.part || '0', 10);
        if (part > 0) {
          (btn as HTMLButtonElement).disabled = true;
          btn.textContent = '⏳';
          this.onInsertPartCallback?.(part);
          setTimeout(() => {
            if (btn && btn.isConnected && this.currentTab?.status !== 'running') {
              (btn as HTMLButtonElement).disabled = false;
              btn.textContent = '✍️ Write';
            }
          }, 5000);
        }
      });
    });

    const downloadBtn = this.container.querySelector('#hud-download-btn');
    downloadBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onDownloadCallback?.();
    });

    const retryBtn = this.container.querySelector('#hud-retry-btn');
    retryBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onRetryCallback?.();
    });

    const errorRestartBtn = this.container.querySelector('#hud-error-restart-btn');
    errorRestartBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onRestartCallback?.();
    });

    const refreshBtn = this.container.querySelector('#hud-refresh-btn');
    refreshBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onRefreshCallback?.();
    });

    const restartBtn = this.container.querySelector('#hud-restart-btn');
    restartBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onRestartCallback?.();
    });

    const cancelBtn = this.container.querySelector('#hud-cancel-btn');
    cancelBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onCancelCallback?.();
    });

    // Override toggle & actions
    const toggleOverrideBtn = this.container.querySelector('#hud-toggle-override-btn');
    toggleOverrideBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showOverride = !this.showOverride;
      this.render();
    });

    const cancelOverrideBtn = this.container.querySelector('#hud-override-cancel');
    cancelOverrideBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showOverride = false;
      this.render();
    });

    const saveOverrideBtn = this.container.querySelector('#hud-override-save');
    saveOverrideBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const inputTotal = this.container?.querySelector('#hud-override-total') as HTMLInputElement;
      const inputCurrent = this.container?.querySelector('#hud-override-current') as HTMLInputElement;
      const selOutline = this.container?.querySelector('#hud-override-outline-select') as HTMLSelectElement;
      const total = parseInt(inputTotal?.value || '0', 10);
      const current = parseInt(inputCurrent?.value || '0', 10);
      const outline = selOutline ? selOutline.value === 'true' : false;

      if (total > 0 && current > 0) {
        this.showOverride = false;
        this.onOverrideCallback?.(total, current, outline);
      }
    });
  }

  public destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
      this.container = null;
    }
  }
}
