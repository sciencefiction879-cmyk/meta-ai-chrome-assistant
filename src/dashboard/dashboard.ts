import {
  WorkflowState,
  VTab,
  LogEntry,
  DiagnosticError,
  LogLevel
} from '../types';
import { parseTitlesFromRawText, parseRange, sliceTitlesForRange, parseCustomVideoIds } from '../utils/normalizer';
import {
  mapFilesToVNumbers,
  createZipBundle,
  triggerDownload,
  createTxtBlob,
  formatMergedScriptPart,
  getMergedFilename
} from '../utils/fileHelper';
import { saveAsset, loadWorkflowState } from '../storage/db';
import { validateVideoMerge } from '../utils/mergeValidator';
import { generateIntelligentHeading, detectOutlineInText } from '../utils/partDetector';

class DashboardController {
  private state: WorkflowState = {
    config: {
      workflowId: `META-${Date.now()}`,
      initialPrompt: '',
      masterPrompt: '',
      nextPartPromptTemplate: 'Please write Part {n} script now.',
      concurrencyLimit: 2,
      autoInsertNextPart: false,
      debugMode: false
    },
    tabs: [],
    logs: [],
    isPaused: false,
    activeExecutionCount: 0
  };

  private activeLogFilter: string = 'ALL';
  private showSelectedOnly: boolean = false;
  private confirmActionCallback: (() => void) | null = null;

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    // Instant paint from local storage on reload so UI never flashes empty
    const saved = await loadWorkflowState();
    if (saved) {
      this.state = saved;
      this.render();
    }

    this.bindEvents();
    this.syncState();

    // Actively scan and reconcile all open tabs with extension on dashboard launch / reload
    chrome.runtime.sendMessage({ type: 'REFRESH_ALL_TABS' }, () => this.syncState());

    // Instant real-time state synchronization via storage changes
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && (changes['meta_assistant_workflow_state'] || changes['qwen_assistant_workflow_state'])) {
          this.state = (changes['meta_assistant_workflow_state'] || changes['qwen_assistant_workflow_state']).newValue;
          this.render();
        }
      });
    }

    // Periodic state synchronization fallback (1000ms)
    setInterval(() => this.syncState(), 1000);

    // Check if opened with a section hash
    if (window.location.hash) {
      const el = document.querySelector(window.location.hash);
      el?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  private syncState(): void {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
      if (response && response.state) {
        this.state = response.state;
        this.render();
      }
    });
  }

  private bindEvents(): void {
    // Collapsible sections
    document.querySelectorAll('.section-header').forEach((header) => {
      header.addEventListener('click', () => {
        const targetId = (header as HTMLElement).dataset.toggle;
        if (targetId) {
          const body = document.getElementById(targetId);
          body?.classList.toggle('collapsed');
        }
      });
    });

    // Side panel launcher
    document.getElementById('btn-open-sidepanel')?.addEventListener('click', async () => {
      const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (currentTab?.id && chrome.sidePanel && chrome.sidePanel.open) {
        chrome.sidePanel.open({ tabId: currentTab.id });
      }
    });

    // Reset Workflow Modal
    document.getElementById('btn-reset-workflow')?.addEventListener('click', () => {
      this.showConfirmModal(
        'Reset Workflow',
        'Are you sure you want to reset the current workflow? This will clear managed tabs and script assignments.',
        () => {
          chrome.runtime.sendMessage({ type: 'RESET_WORKFLOW', mode: 'all' }, () => this.syncState());
        }
      );
    });

    // Debug Mode Toggle
    document.getElementById('btn-toggle-debug')?.addEventListener('click', () => {
      this.state.config.debugMode = !this.state.config.debugMode;
      const debugPanel = document.getElementById('sec-debug-panel');
      if (debugPanel) {
        debugPanel.style.display = this.state.config.debugMode ? 'block' : 'none';
      }
      this.updateConfig({ debugMode: this.state.config.debugMode });
    });

    // Preset Copy Buttons
    document.querySelectorAll('.btn-dup-preset').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const count = parseInt((e.currentTarget as HTMLElement).dataset.count || '1', 10);
        this.duplicateChats(count);
      });
    });

    document.getElementById('btn-duplicate-chats')?.addEventListener('click', () => {
      this.duplicateChats();
    });

    // Two-Way Range Sync Listeners
    document.getElementById('dup-range-start')?.addEventListener('input', () => {
      this.syncRangeInputs('start');
    });
    document.getElementById('dup-range-end')?.addEventListener('input', () => {
      this.syncRangeInputs('end');
    });
    document.getElementById('dup-custom-count')?.addEventListener('input', () => {
      this.syncRangeInputs('count');
    });

    // Custom Video IDs Toggle and Input
    const chkCustomIds = document.getElementById('chk-custom-video-ids') as HTMLInputElement | null;
    const inputCustomIds = document.getElementById('input-custom-video-ids') as HTMLInputElement | null;
    const rangeInputsWrap = document.getElementById('dup-range-inputs-wrap');

    chkCustomIds?.addEventListener('change', () => {
      const enabled = chkCustomIds.checked;
      if (inputCustomIds) {
        inputCustomIds.style.display = enabled ? 'block' : 'none';
        if (enabled) inputCustomIds.focus();
      }
      if (rangeInputsWrap) {
        rangeInputsWrap.style.opacity = enabled ? '0.4' : '1';
        rangeInputsWrap.style.pointerEvents = enabled ? 'none' : 'auto';
      }
      this.syncRangeInputs('start');
    });

    inputCustomIds?.addEventListener('input', () => {
      this.syncRangeInputs('start');
    });

    document.getElementById('title-range-start')?.addEventListener('input', () => {
      const s = parseInt((document.getElementById('title-range-start') as HTMLInputElement)?.value || '1', 10);
      const e = parseInt((document.getElementById('title-range-end') as HTMLInputElement)?.value || '5', 10);
      this.syncRangeInputs('external', s, e);
    });
    document.getElementById('title-range-end')?.addEventListener('input', () => {
      const s = parseInt((document.getElementById('title-range-start') as HTMLInputElement)?.value || '1', 10);
      const e = parseInt((document.getElementById('title-range-end') as HTMLInputElement)?.value || '5', 10);
      this.syncRangeInputs('external', s, e);
    });

    // Tab Manager Selection Buttons
    document.getElementById('btn-select-all')?.addEventListener('click', () => {
      chrome.runtime.sendMessage(
        { type: 'SELECT_TABS', tabIds: this.state.tabs.map((t) => t.id), selected: true },
        () => this.syncState()
      );
    });

    document.getElementById('btn-deselect-all')?.addEventListener('click', () => {
      chrome.runtime.sendMessage(
        { type: 'SELECT_TABS', tabIds: this.state.tabs.map((t) => t.id), selected: false },
        () => this.syncState()
      );
    });

    document.querySelectorAll('.btn-range-preset').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const range = (e.currentTarget as HTMLElement).dataset.range || '';
        const parsed = parseRange(range);
        if (parsed) {
          this.syncRangeInputs('external', parsed.start, parsed.end);
          chrome.runtime.sendMessage(
            { type: 'SELECT_RANGE', startIndex: parsed.start, endIndex: parsed.end },
            () => this.syncState()
          );
        }
      });
    });

    document.getElementById('btn-apply-range')?.addEventListener('click', () => {
      const input = (document.getElementById('custom-range-input') as HTMLInputElement).value;
      const parsed = parseRange(input);
      if (parsed) {
        this.syncRangeInputs('external', parsed.start, parsed.end);
        chrome.runtime.sendMessage(
          { type: 'SELECT_RANGE', startIndex: parsed.start, endIndex: parsed.end },
          () => this.syncState()
        );
      }
    });

    // Master Table Checkbox
    document.getElementById('chk-table-master')?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      chrome.runtime.sendMessage(
        { type: 'SELECT_TABS', tabIds: this.state.tabs.map((t) => t.id), selected: checked },
        () => this.syncState()
      );
    });

    // Show Selected Tabs Only Filter
    document.getElementById('chk-show-selected-only')?.addEventListener('change', (e) => {
      this.showSelectedOnly = (e.target as HTMLInputElement).checked;
      this.renderTabsTable();
    });

    // Batch Actions for Selected Tabs
    const getSelectedTabIds = () => this.state.tabs.filter((t) => t.selected).map((t) => t.id);

    document.getElementById('btn-batch-restart')?.addEventListener('click', () => {
      const selectedIds = getSelectedTabIds();
      if (selectedIds.length === 0) {
        alert('Please select at least one tab.');
        return;
      }
      chrome.runtime.sendMessage(
        { type: 'BATCH_TAB_ACTION', action: 'restart', tabIds: selectedIds },
        () => this.syncState()
      );
    });

    document.getElementById('btn-batch-retry')?.addEventListener('click', () => {
      const selectedIds = getSelectedTabIds();
      if (selectedIds.length === 0) {
        alert('Please select at least one tab.');
        return;
      }
      chrome.runtime.sendMessage(
        { type: 'BATCH_TAB_ACTION', action: 'retry', tabIds: selectedIds },
        () => this.syncState()
      );
    });

    document.getElementById('btn-batch-refresh')?.addEventListener('click', () => {
      const selectedIds = getSelectedTabIds();
      if (selectedIds.length === 0) {
        alert('Please select at least one tab.');
        return;
      }
      chrome.runtime.sendMessage(
        { type: 'BATCH_TAB_ACTION', action: 'refresh', tabIds: selectedIds },
        () => this.syncState()
      );
    });

    document.getElementById('btn-batch-cancel')?.addEventListener('click', () => {
      const selectedIds = getSelectedTabIds();
      if (selectedIds.length === 0) {
        alert('Please select at least one tab.');
        return;
      }
      chrome.runtime.sendMessage(
        { type: 'BATCH_TAB_ACTION', action: 'cancel', tabIds: selectedIds },
        () => this.syncState()
      );
    });

    document.getElementById('btn-batch-remove')?.addEventListener('click', () => {
      const selectedIds = getSelectedTabIds();
      if (selectedIds.length === 0) {
        alert('Please select at least one tab.');
        return;
      }
      this.showConfirmModal(
        'Remove Selected Tabs',
        `Are you sure you want to remove ${selectedIds.length} selected tab(s)? Remaining tabs will be automatically renumbered (V1..Vn).`,
        () => {
          chrome.runtime.sendMessage(
            { type: 'BATCH_TAB_ACTION', action: 'remove', tabIds: selectedIds },
            () => this.syncState()
          );
        }
      );
    });

    document.getElementById('btn-reindex-tabs')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'REINDEX_TABS' }, () => this.syncState());
    });

    document.getElementById('btn-clear-closed')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CLEAR_CLOSED_TABS' }, () => this.syncState());
    });

    // Batch Push Bar for Selected Tabs
    document.getElementById('btn-batch-push-titles')?.addEventListener('click', () => {
      const selectedIds = getSelectedTabIds();
      if (selectedIds.length === 0) {
        alert('Please select at least one tab.');
        return;
      }
      chrome.runtime.sendMessage({ type: 'PUSH_TITLES_TO_CHATS', target: 'selected' }, (res) => {
        if (res?.success) {
          this.syncState();
          alert(`Pushed assigned titles to ${res.count} selected Meta.ai tabs!`);
        }
      });
    });

    document.getElementById('btn-batch-push-prompt')?.addEventListener('click', () => {
      const selectedIds = getSelectedTabIds();
      if (selectedIds.length === 0) {
        alert('Please select at least one tab.');
        return;
      }
      chrome.runtime.sendMessage({ type: 'PUSH_PROMPT_TO_CHATS', target: 'selected' }, (res) => {
        if (res?.success) {
          this.syncState();
          alert(`Pushed master prompt to ${res.count} selected Meta.ai tabs!`);
        }
      });
    });

    document.getElementById('btn-batch-push-thumbs')?.addEventListener('click', () => {
      const selectedIds = getSelectedTabIds();
      if (selectedIds.length === 0) {
        alert('Please select at least one tab.');
        return;
      }
      chrome.runtime.sendMessage({ type: 'PUSH_THUMBNAILS_TO_CHATS', target: 'selected' }, (res) => {
        if (res?.success) {
          this.syncState();
          alert(`Pasting thumbnails via clipboard to ${res.count} selected Meta.ai tabs!`);
        }
      });
    });

    document.getElementById('btn-batch-push-scripts')?.addEventListener('click', () => {
      const selectedIds = getSelectedTabIds();
      if (selectedIds.length === 0) {
        alert('Please select at least one tab.');
        return;
      }
      chrome.runtime.sendMessage({ type: 'PUSH_SCRIPTS_TO_CHATS', target: 'selected' }, (res) => {
        if (res?.success) {
          this.syncState();
          alert(`Embedded competitor scripts into ${res.count} selected Meta.ai tabs!`);
        }
      });
    });

    document.getElementById('btn-batch-push-all')?.addEventListener('click', () => {
      const selectedIds = getSelectedTabIds();
      if (selectedIds.length === 0) {
        alert('Please select at least one tab.');
        return;
      }
      chrome.runtime.sendMessage({ type: 'PUSH_ALL_ASSETS_TO_CHATS', target: 'selected' }, (res) => {
        if (res?.success) {
          this.syncState();
          alert(`Pushed all 4 assets into ${res.count} selected Meta.ai tabs!`);
        }
      });
    });

    // Titles Dropzone & Paste
    const dropzoneTitles = document.getElementById('dropzone-titles');
    const fileTitlesInput = document.getElementById('file-titles-input') as HTMLInputElement;

    dropzoneTitles?.addEventListener('click', () => fileTitlesInput?.click());
    fileTitlesInput?.addEventListener('change', async () => {
      if (fileTitlesInput.files && fileTitlesInput.files[0]) {
        const text = await fileTitlesInput.files[0].text();
        (document.getElementById('txt-titles-paste') as HTMLTextAreaElement).value = text;
        this.updateTitleSummary(text);
      }
    });

    document.getElementById('txt-titles-paste')?.addEventListener('input', (e) => {
      this.updateTitleSummary((e.target as HTMLTextAreaElement).value);
    });

    document.getElementById('btn-assign-titles')?.addEventListener('click', () => {
      const pasteTextarea = document.getElementById('txt-titles-paste') as HTMLTextAreaElement;
      const text = pasteTextarea ? pasteTextarea.value : '';
      const parsed = parseTitlesFromRawText(text);
      if (parsed.length === 0) {
        alert('Please provide titles either via TXT file or textarea paste.');
        return;
      }

      const start = parseInt((document.getElementById('title-range-start') as HTMLInputElement).value, 10) || 1;
      const end = parseInt((document.getElementById('title-range-end') as HTMLInputElement).value, 10) || (start + parsed.length - 1);

      if (start > end) {
        alert(`Validation Error: Start Video ID (V${start}) cannot be greater than End Video ID (V${end}).`);
        return;
      }

      // Slices and strictly filters titles to range [start .. end] or custom IDs:
      const chkCustom = document.getElementById('chk-custom-video-ids') as HTMLInputElement | null;
      const inputCustom = document.getElementById('input-custom-video-ids') as HTMLInputElement | null;
      const customIds = (chkCustom?.checked && inputCustom) ? parseCustomVideoIds(inputCustom.value) : undefined;

      const { assigned, excessCount, cutBelowCount, cutAboveCount } = sliceTitlesForRange(
        parsed.map((p) => p.normalized),
        start,
        end,
        customIds
      );

      // AUTO-CUT / TRIM: Automatically update the textarea to keep ONLY the assigned titles!
      if (pasteTextarea) {
        pasteTextarea.value = assigned.join('\n');
      }

      chrome.runtime.sendMessage(
        {
          type: 'ASSIGN_TITLES',
          titles: assigned,
          startIndex: start,
          endIndex: end
        },
        (res) => {
          if (res?.success) {
            this.syncState();
            const summaryEl = document.getElementById('title-parse-summary');
            if (summaryEl) {
              let cutMsg = '';
              if (cutBelowCount > 0 && cutAboveCount > 0) {
                cutMsg = ` (Auto-cut ${cutBelowCount} below V${start} and ${cutAboveCount} above V${end})`;
              } else if (cutBelowCount > 0) {
                cutMsg = ` (Auto-cut ${cutBelowCount} below V${start})`;
              } else if (cutAboveCount > 0) {
                cutMsg = ` (Auto-cut ${cutAboveCount} above V${end})`;
              }
              summaryEl.textContent = `Assigned ${assigned.length} titles to range V${start}..V${end}.${cutMsg}`;
            }
          }
        }
      );
    });

    // Manual Trim / Cut Excess Titles Button
    document.getElementById('btn-trim-titles')?.addEventListener('click', () => {
      const pasteTextarea = document.getElementById('txt-titles-paste') as HTMLTextAreaElement;
      const text = pasteTextarea ? pasteTextarea.value : '';
      const parsed = parseTitlesFromRawText(text);
      if (parsed.length === 0) return;

      const start = parseInt((document.getElementById('title-range-start') as HTMLInputElement).value, 10) || 1;
      const end = parseInt((document.getElementById('title-range-end') as HTMLInputElement).value, 10) || (start + parsed.length - 1);

      if (start > end) {
        alert(`Validation Error: Start Video ID (V${start}) cannot be greater than End Video ID (V${end}).`);
        return;
      }

      const { assigned, excessCount, cutBelowCount, cutAboveCount } = sliceTitlesForRange(
        parsed.map((p) => p.normalized),
        start,
        end
      );

      if (pasteTextarea) {
        pasteTextarea.value = assigned.join('\n');
      }
      const summaryEl = document.getElementById('title-parse-summary');
      if (summaryEl) {
        let cutMsg = '';
        if (cutBelowCount > 0 && cutAboveCount > 0) {
          cutMsg = ` Removed ${cutBelowCount} below (V1..V${start - 1}) and ${cutAboveCount} above (V${end + 1}+).`;
        } else if (cutBelowCount > 0) {
          cutMsg = ` Removed ${cutBelowCount} below (V1..V${start - 1}).`;
        } else if (cutAboveCount > 0) {
          cutMsg = ` Removed ${cutAboveCount} above (V${end + 1}+).`;
        }
        summaryEl.textContent = `Kept ${assigned.length} titles (V${start}..V${end}).${cutMsg}`;
      }
    });

    // Master Prompt
    const fileMasterPromptInput = document.getElementById('file-master-prompt-input') as HTMLInputElement;
    document.getElementById('btn-upload-master-prompt-txt')?.addEventListener('click', () => {
      fileMasterPromptInput?.click();
    });

    fileMasterPromptInput?.addEventListener('change', async () => {
      if (fileMasterPromptInput.files && fileMasterPromptInput.files[0]) {
        const text = await fileMasterPromptInput.files[0].text();
        const textarea = document.getElementById('txt-master-prompt') as HTMLTextAreaElement;
        if (textarea) textarea.value = text;
        this.state.config.masterPrompt = text;
        this.updateConfig({ masterPrompt: text });
      }
    });

    document.getElementById('btn-apply-prompt-selected')?.addEventListener('click', () => {
      const prompt = (document.getElementById('txt-master-prompt') as HTMLTextAreaElement).value;
      if (!prompt.trim()) {
        alert('Please enter a Master Prompt.');
        return;
      }
      chrome.runtime.sendMessage(
        { type: 'SET_MASTER_PROMPT', prompt, target: 'selected' },
        () => this.syncState()
      );
    });

    document.getElementById('btn-apply-prompt-all')?.addEventListener('click', () => {
      const prompt = (document.getElementById('txt-master-prompt') as HTMLTextAreaElement).value;
      if (!prompt.trim()) {
        alert('Please enter a Master Prompt.');
        return;
      }
      chrome.runtime.sendMessage(
        { type: 'SET_MASTER_PROMPT', prompt, target: 'all' },
        () => this.syncState()
      );
    });

    // Thumbnails Dropzone & Multi-File Upload
    const dropzoneThumbnails = document.getElementById('dropzone-thumbnails');
    const fileThumbnailsInput = document.getElementById('file-thumbnails-input') as HTMLInputElement;

    dropzoneThumbnails?.addEventListener('click', () => fileThumbnailsInput?.click());
    this.setupDropzone(dropzoneThumbnails, (files) => this.handleThumbnailsUpload(files));
    fileThumbnailsInput?.addEventListener('change', () => {
      if (fileThumbnailsInput.files) {
        this.handleThumbnailsUpload(Array.from(fileThumbnailsInput.files));
      }
    });

    // Scripts Dropzone & Multi-File Upload
    const dropzoneScripts = document.getElementById('dropzone-scripts');
    const fileScriptsInput = document.getElementById('file-scripts-input') as HTMLInputElement;

    dropzoneScripts?.addEventListener('click', () => fileScriptsInput?.click());
    this.setupDropzone(dropzoneScripts, (files) => this.handleScriptsUpload(files));
    fileScriptsInput?.addEventListener('change', () => {
      if (fileScriptsInput.files) {
        this.handleScriptsUpload(Array.from(fileScriptsInput.files));
      }
    });

    // Clear Buttons for Sections
    document.getElementById('btn-clear-completed')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CLEAR_COMPLETED_TABS' }, () => this.syncState());
    });

    document.getElementById('btn-clear-titles')?.addEventListener('click', () => {
      this.showConfirmModal('Clear Titles', 'Are you sure you want to clear all assigned titles?', () => {
        chrome.runtime.sendMessage({ type: 'CLEAR_TITLES' }, () => {
          const input = document.getElementById('txt-titles-paste') as HTMLTextAreaElement;
          if (input) input.value = '';
          this.syncState();
        });
      });
    });

    document.getElementById('btn-clear-prompt')?.addEventListener('click', () => {
      this.showConfirmModal('Clear Master Prompt', 'Are you sure you want to clear the Master Prompt?', () => {
        chrome.runtime.sendMessage({ type: 'CLEAR_PROMPT' }, () => {
          const input = document.getElementById('txt-master-prompt') as HTMLTextAreaElement;
          if (input) input.value = '';
          this.syncState();
        });
      });
    });

    document.getElementById('btn-clear-thumbnails')?.addEventListener('click', () => {
      this.showConfirmModal('Clear Thumbnails', 'Are you sure you want to clear all assigned thumbnails?', () => {
        chrome.runtime.sendMessage({ type: 'CLEAR_THUMBNAILS' }, () => this.syncState());
      });
    });

    // Script Mode Selection (Original Script Mode vs Competitor Script Mode)
    const handleModeChange = (mode: 'original' | 'competitor') => {
      this.state.config.scriptMode = mode;
      this.state.config.competitorScriptEnabled = (mode === 'competitor');
      chrome.runtime.sendMessage({ type: 'SET_SCRIPT_MODE', mode }, () => this.syncState());
    };

    document.getElementById('radio-mode-original')?.addEventListener('change', (e) => {
      if ((e.target as HTMLInputElement).checked) {
        handleModeChange('original');
      }
    });

    document.getElementById('radio-mode-competitor')?.addEventListener('change', (e) => {
      if ((e.target as HTMLInputElement).checked) {
        handleModeChange('competitor');
      }
    });

    // Competitor Script (Optional) Events
    document.getElementById('chk-competitor-script-enabled')?.addEventListener('change', (e) => {
      const isEnabled = (e.target as HTMLInputElement).checked;
      const container = document.getElementById('competitor-script-input-container');
      if (container) container.style.display = isEnabled ? 'flex' : 'none';
      const badge = document.getElementById('badge-competitor-script-status');
      if (badge) {
        badge.textContent = isEnabled ? 'Optional Input (Active)' : 'Optional Input (Disabled)';
        badge.style.color = isEnabled ? '#34d399' : '#fbbf24';
      }
      const txt = (document.getElementById('txt-competitor-script') as HTMLTextAreaElement)?.value || '';
      chrome.runtime.sendMessage(
        { type: 'SET_COMPETITOR_SCRIPT', enabled: isEnabled, text: txt },
        () => this.syncState()
      );
    });

    document.getElementById('btn-save-competitor-script')?.addEventListener('click', () => {
      const txt = (document.getElementById('txt-competitor-script') as HTMLTextAreaElement)?.value || '';
      chrome.runtime.sendMessage(
        { type: 'SET_COMPETITOR_SCRIPT', enabled: true, text: txt },
        () => {
          this.syncState();
          const ind = document.getElementById('script-sync-indicator');
          if (ind) {
            ind.style.display = 'inline';
            setTimeout(() => {
              if (ind) ind.style.display = 'none';
            }, 2000);
          }
        }
      );
    });

    document.getElementById('btn-clear-scripts')?.addEventListener('click', () => {
      this.showConfirmModal('Clear Competitor Script', 'Are you sure you want to clear the competitor script?', () => {
        const txtArea = document.getElementById('txt-competitor-script') as HTMLTextAreaElement;
        if (txtArea) txtArea.value = '';
        chrome.runtime.sendMessage({ type: 'SET_COMPETITOR_SCRIPT', enabled: false, text: '' }, () => {
          chrome.runtime.sendMessage({ type: 'CLEAR_SCRIPTS' }, () => this.syncState());
        });
      });
    });

    // Per-Section Push Buttons
    document.getElementById('btn-push-titles-to-chats')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'PUSH_TITLES_TO_CHATS', target: 'all' }, (res) => {
        if (res?.success) {
          this.syncState();
          alert(`Pushed assigned titles to ${res.count} Meta.ai chat inputs!`);
        }
      });
    });

    document.getElementById('btn-push-prompt-to-chats')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'PUSH_PROMPT_TO_CHATS', target: 'all' }, (res) => {
        if (res?.success) {
          this.syncState();
          alert(`Pushed Master Prompt to ${res.count} Meta.ai chats!`);
        }
      });
    });

    document.getElementById('btn-push-thumbnails-to-chats')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'PUSH_THUMBNAILS_TO_CHATS', target: 'all' }, (res) => {
        if (res?.success) {
          this.syncState();
          alert(`Pasting thumbnails via clipboard to ${res.count} Meta.ai chats. Check your Qwen tabs!`);
        }
      });
    });

    document.getElementById('btn-push-scripts-to-chats')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'PUSH_SCRIPTS_TO_CHATS', target: 'all' }, (res) => {
        if (res?.success) {
          this.syncState();
          alert(`Embedded competitor script text into ${res.count} Meta.ai chats!`);
        }
      });
    });

    // Staged Workflow Execution Controls
    document.getElementById('btn-stage-prompts')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'STAGE_PASTE_PROMPTS', target: 'all' }, (res) => {
        if (res?.success) {
          this.syncState();
        }
      });
    });

    document.getElementById('btn-stage-thumbnails')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'STAGE_PASTE_THUMBNAILS', target: 'all' }, (res) => {
        if (res?.success) {
          this.syncState();
        }
      });
    });

    document.getElementById('btn-stage-scripts')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'STAGE_PASTE_SCRIPTS', target: 'all' }, (res) => {
        if (res?.success) {
          this.syncState();
        }
      });
    });

    document.getElementById('btn-stage-all')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'PUSH_ALL_ASSETS_TO_CHATS', target: 'all' }, (res) => {
        if (res?.success) {
          this.syncState();
          alert(`All 4 assets (Titles, Prompt, Thumbnails, Scripts) pushed into ${res.count} chats! Ready to safely run.`);
        }
      });
    });

    document.getElementById('btn-stage-run-all')?.addEventListener('click', () => {
      this.runExecution('all');
    });

    // Execution Controls
    document.getElementById('btn-run-all')?.addEventListener('click', () => {
      this.runExecution('all');
    });

    document.getElementById('btn-run-selected')?.addEventListener('click', () => {
      this.runExecution('selected');
    });

    document.getElementById('btn-pause-all')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'PAUSE_EXECUTION' }, () => this.syncState());
    });

    document.getElementById('btn-resume-all')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'RESUME_EXECUTION' }, () => this.syncState());
    });

    document.getElementById('btn-stop-all')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'STOP_EXECUTION' }, () => this.syncState());
    });

    document.getElementById('btn-restart-all')?.addEventListener('click', () => {
      this.showConfirmModal('Restart All Tabs', 'Are you sure you want to restart all managed tabs from Part 1?', () => {
        this.state.tabs.forEach((t) => {
          chrome.runtime.sendMessage({ type: 'RESTART_TAB', vNumber: t.id });
        });
        this.syncState();
      });
    });

    const handleSyncAll = (btnEl: HTMLElement | null, originalText: string) => {
      if (btnEl) btnEl.textContent = '⏳ Syncing...';
      chrome.runtime.sendMessage({ type: 'REFRESH_ALL_TABS' }, () => {
        if (btnEl) btnEl.textContent = originalText;
        this.syncState();
      });
    };

    const btnRefreshAll = document.getElementById('btn-refresh-all');
    btnRefreshAll?.addEventListener('click', () => {
      handleSyncAll(btnRefreshAll, '🔃 REFRESH TABS');
    });

    const btnSyncHeader = document.getElementById('btn-sync-all-header');
    btnSyncHeader?.addEventListener('click', () => {
      handleSyncAll(btnSyncHeader, '🔄 Sync Tabs');
    });

    document.getElementById('btn-retry-failed')?.addEventListener('click', () => {
      const failedTabs = this.state.tabs.filter((t) => t.status === 'error');
      failedTabs.forEach((t) => {
        chrome.runtime.sendMessage({ type: 'RETRY_TAB', vNumber: t.id });
      });
      this.syncState();
    });

    // Concurrency & Options
    document.getElementById('sel-concurrency')?.addEventListener('change', (e) => {
      const limit = parseInt((e.target as HTMLSelectElement).value, 10);
      this.updateConfig({ concurrencyLimit: limit });
    });

    document.getElementById('chk-auto-next-part')?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      this.updateConfig({ autoInsertNextPart: checked });
    });

    // Part Word Count Setting
    document.getElementById('cfg-word-count')?.addEventListener('change', (e) => {
      const val = parseInt((e.target as HTMLInputElement).value, 10);
      const count = !isNaN(val) && val > 0 ? val : 4000;
      chrome.runtime.sendMessage({ type: 'SET_PART_WORD_COUNT', wordCount: count }, () => {
        this.syncState();
      });
    });

    // Downloads
    document.getElementById('btn-download-all')?.addEventListener('click', () => {
      this.downloadAllCombinedFile();
    });

    document.getElementById('btn-download-all-separate')?.addEventListener('click', () => {
      this.downloadAllIndividualFiles();
    });

    document.getElementById('btn-download-all-zip')?.addEventListener('click', () => {
      this.downloadAllAsZip();
    });

    document.getElementById('btn-download-all-parts-zip')?.addEventListener('click', () => {
      this.downloadAllIndividualPartsAsZip();
    });

    document.getElementById('btn-clear-dm')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CLEAR_DOWNLOAD_MANAGER' }, () => this.syncState());
    });

    // Activity Log Filter
    document.querySelectorAll('.btn-filter-log').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-filter-log').forEach((b) => b.classList.remove('active'));
        (e.currentTarget as HTMLElement).classList.add('active');
        this.activeLogFilter = (e.currentTarget as HTMLElement).dataset.level || 'ALL';
        this.renderLogs();
      });
    });

    // Clear and Export Log
    document.getElementById('btn-clear-logs')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' }, () => this.syncState());
    });

    document.getElementById('btn-export-log')?.addEventListener('click', () => {
      this.exportActivityLog();
    });

    // Modal Events
    document.getElementById('modal-btn-cancel')?.addEventListener('click', () => {
      this.hideConfirmModal();
    });

    document.getElementById('modal-btn-confirm')?.addEventListener('click', () => {
      this.confirmActionCallback?.();
      this.hideConfirmModal();
    });

    // Initialize Video ID Range on startup
    this.syncRangeInputs('start');
  }

  /**
   * Synchronizes the Video ID Range across Tab Duplicator, Tab Manager, and Title Input System.
   * Keeps Start, End, Count, Preview Badge, and Title Range inputs 100% in sync.
   */
  private syncRangeInputs(from: 'start' | 'end' | 'count' | 'external', val1?: number, val2?: number): void {
    const startInput = document.getElementById('dup-range-start') as HTMLInputElement;
    const endInput = document.getElementById('dup-range-end') as HTMLInputElement;
    const countInput = document.getElementById('dup-custom-count') as HTMLInputElement;
    const titleStartInput = document.getElementById('title-range-start') as HTMLInputElement;
    const titleEndInput = document.getElementById('title-range-end') as HTMLInputElement;
    const previewEl = document.getElementById('dup-range-preview');
    const countEl = document.getElementById('dup-range-count');
    const btnDup = document.getElementById('btn-duplicate-chats') as HTMLButtonElement;
    const valMsg = document.getElementById('dup-range-validation-msg');

    const chkCustom = document.getElementById('chk-custom-video-ids') as HTMLInputElement | null;
    const inputCustom = document.getElementById('input-custom-video-ids') as HTMLInputElement | null;
    const isCustom = Boolean(chkCustom?.checked);

    if (isCustom && inputCustom) {
      const customIds = parseCustomVideoIds(inputCustom.value);
      if (customIds.length > 0) {
        const customPreview = customIds.map((id) => `V${id}`).join(', ');
        if (previewEl) previewEl.textContent = customPreview;
        if (countEl) countEl.textContent = `${customIds.length} Tab${customIds.length === 1 ? '' : 's'}`;
        if (btnDup) {
          btnDup.textContent = `⚡ Duplicate Chats (${customIds.length} Custom Tabs)`;
          btnDup.style.opacity = '1';
        }
        if (valMsg) {
          valMsg.textContent = '';
          valMsg.style.display = 'none';
        }
        return;
      } else {
        if (previewEl) previewEl.textContent = 'None';
        if (countEl) countEl.textContent = '0 Tabs';
        if (btnDup) {
          btnDup.textContent = '⚡ Duplicate Chats (Enter Video IDs)';
          btnDup.style.opacity = '0.6';
        }
        if (valMsg) {
          valMsg.textContent = '⚠️ Please enter at least one valid Video ID (e.g. V3, V4, V7)';
          valMsg.style.display = 'block';
        }
        return;
      }
    }

    let start = parseInt(startInput?.value || '1', 10);
    let end = parseInt(endInput?.value || '5', 10);

    if (from === 'external') {
      if (val1 !== undefined && !isNaN(val1)) start = val1;
      if (val2 !== undefined && !isNaN(val2)) end = val2;
      if (startInput) startInput.value = start.toString();
      if (endInput) endInput.value = end.toString();
    } else if (from === 'count') {
      const count = parseInt(countInput?.value || '1', 10);
      if (!isNaN(count) && count > 0) {
        end = start + count - 1;
        if (endInput) endInput.value = end.toString();
      }
    }

    if (isNaN(start) || start < 1) start = 1;
    if (isNaN(end) || end < 1) end = 1;

    const count = Math.max(0, end - start + 1);

    // Sync to Section 3 (Title Input System)
    if (titleStartInput && document.activeElement !== titleStartInput) {
      titleStartInput.value = start.toString();
    }
    if (titleEndInput && document.activeElement !== titleEndInput) {
      titleEndInput.value = end.toString();
    }

    // Sync to Custom Count input
    if (countInput && from !== 'count' && document.activeElement !== countInput) {
      countInput.value = count > 0 ? count.toString() : '';
    }

    // Validation checks
    let isValid = true;
    let errorText = '';
    if (start > end) {
      isValid = false;
      errorText = `⚠️ Validation Error: Start Video ID (V${start}) cannot be greater than End Video ID (V${end}).`;
    } else if (start < 1 || end < 1) {
      isValid = false;
      errorText = '⚠️ Validation Error: Video IDs must be positive numbers (≥ 1).';
    }

    if (valMsg) {
      if (!isValid) {
        valMsg.textContent = errorText;
        valMsg.style.display = 'block';
      } else {
        valMsg.textContent = '';
        valMsg.style.display = 'none';
      }
    }

    if (previewEl) {
      previewEl.textContent = `V${start}–V${end}`;
    }
    if (countEl) {
      countEl.textContent = `${count} Tab${count === 1 ? '' : 's'}`;
    }
    if (btnDup) {
      btnDup.textContent = `⚡ Duplicate Chats (V${start}–V${end})`;
      if (!isValid) {
        btnDup.style.opacity = '0.6';
      } else {
        btnDup.style.opacity = '1';
      }
    }

    // Live update of title summary if titles are present
    const pasteTextarea = document.getElementById('txt-titles-paste') as HTMLTextAreaElement;
    if (pasteTextarea && pasteTextarea.value.trim()) {
      this.updateTitleSummary(pasteTextarea.value);
    }
  }

  /**
   * Duplicates tabs according to the defined Video ID Range or Custom Video IDs.
   */
  private duplicateChats(explicitCount?: number): void {
    const chkCustom = document.getElementById('chk-custom-video-ids') as HTMLInputElement | null;
    const inputCustom = document.getElementById('input-custom-video-ids') as HTMLInputElement | null;
    const isCustom = Boolean(chkCustom?.checked);

    const initialText = (document.getElementById('dup-initial-message') as HTMLInputElement)?.value || '';

    if (isCustom && inputCustom) {
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
        (res) => {
          if (!res?.success) {
            alert(`Duplication failed: ${res?.error || 'Unknown error'}`);
          } else {
            this.syncState();
            // Automatically select duplicated tabs in Tab Manager
            const tabIds = explicitVideoIds.map((id) => `V${id}`);
            chrome.runtime.sendMessage(
              { type: 'SELECT_TABS', tabIds, selected: true },
              () => this.syncState()
            );
          }
        }
      );
      return;
    }

    const startInput = document.getElementById('dup-range-start') as HTMLInputElement;
    const endInput = document.getElementById('dup-range-end') as HTMLInputElement;

    let start = parseInt(startInput?.value || '1', 10);
    let end = parseInt(endInput?.value || '5', 10);

    if (isNaN(start) || start < 1) start = 1;

    if (explicitCount && explicitCount > 0) {
      end = start + explicitCount - 1;
      if (endInput) endInput.value = end.toString();
      this.syncRangeInputs('start');
    }

    // Strict validation before duplication begins
    if (isNaN(start) || isNaN(end) || start < 1 || end < 1) {
      alert('Validation Error: Start and End Video IDs must be valid positive numbers.');
      return;
    }
    if (start > end) {
      alert(`Validation Error: Start Video ID (V${start}) cannot be greater than End Video ID (V${end}).`);
      return;
    }

    const count = end - start + 1;

    chrome.runtime.sendMessage(
      {
        type: 'DUPLICATE_CHATS',
        count,
        initialText,
        startVideoId: start,
        endVideoId: end
      },
      (res) => {
        if (!res?.success) {
          alert(`Duplication failed: ${res?.error || 'Unknown error'}`);
        } else {
          this.syncState();
          // Automatically select duplicated tabs in Tab Manager
          chrome.runtime.sendMessage(
            { type: 'SELECT_RANGE', startIndex: start, endIndex: end },
            () => this.syncState()
          );
        }
      }
    );
  }

  private async handleThumbnailsUpload(files: File[]): Promise<void> {
    if (files.length === 0) return;
    const vCount = this.state.tabs.length;
    const availableVNumbers = this.state.tabs.map((t) => t.id);
    const mappings = mapFilesToVNumbers(files, vCount, availableVNumbers);

    const assetEntries: { vNumber: string; assetId: string; name: string }[] = [];

    for (const item of mappings) {
      const assetId = `thumb_${item.vNumber}_${Date.now()}`;
      await saveAsset(assetId, item.file, item.file.name);
      assetEntries.push({
        vNumber: item.vNumber,
        assetId,
        name: item.file.name
      });
    }

    chrome.runtime.sendMessage(
      { type: 'ASSIGN_THUMBNAILS', assets: assetEntries },
      () => this.syncState()
    );
  }

  private async handleScriptsUpload(files: File[]): Promise<void> {
    if (files.length === 0) return;
    const vCount = this.state.tabs.length;
    const availableVNumbers = this.state.tabs.map((t) => t.id);
    const mappings = mapFilesToVNumbers(files, vCount, availableVNumbers);

    const assetEntries: { vNumber: string; assetId: string; name: string }[] = [];

    for (const item of mappings) {
      const assetId = `script_${item.vNumber}_${Date.now()}`;
      await saveAsset(assetId, item.file, item.file.name);
      assetEntries.push({
        vNumber: item.vNumber,
        assetId,
        name: item.file.name
      });
    }

    chrome.runtime.sendMessage(
      { type: 'ASSIGN_SCRIPTS', assets: assetEntries },
      () => this.syncState()
    );
  }

  private runExecution(target: 'all' | 'selected'): void {
    const validationBanner = document.getElementById('execution-validation-banner');
    if (validationBanner) validationBanner.style.display = 'none';

    chrome.runtime.sendMessage({ type: 'RUN_EXECUTION', target }, (res) => {
      if (!res?.success) {
        if (validationBanner) {
          validationBanner.style.display = 'flex';
          validationBanner.innerHTML = `
            <div class="diag-title" style="color: #f87171; font-weight: bold; font-size: 13px;">🛑 MANDATORY SAFETY BLOCK: Run Aborted</div>
            <div class="diag-section" style="margin-top: 6px;">
              <span class="diag-lbl">Safety Requirement:</span>
              <span class="diag-val" style="color: #fca5a5; white-space: pre-wrap;">${res?.error || 'Thumbnails and Competitor Scripts must be pushed and confirmed in chat before running!'}</span>
            </div>
            <div class="diag-section" style="margin-top: 6px;">
              <span class="diag-lbl">Required Action:</span>
              <span class="diag-val">Push Titles, Master Prompt, Thumbnails, and Scripts using the Section buttons before starting!</span>
            </div>
          `;
        }
        alert(res?.error || 'Safety lock: Thumbnail and script must be confirmed in chat before running!');
      } else {
        const runBtn = document.getElementById('btn-run-all');
        const stageRunBtn = document.getElementById('btn-stage-run-all');
        if (runBtn) {
          const orig = runBtn.innerText;
          runBtn.innerText = '⚡ Running...';
          setTimeout(() => { runBtn.innerText = orig; }, 3000);
        }
        if (stageRunBtn) {
          const orig = stageRunBtn.innerText;
          stageRunBtn.innerText = '⚡ Running...';
          setTimeout(() => { stageRunBtn.innerText = orig; }, 3000);
        }
      }
      this.syncState();
    });
  }

  private updateConfig(updates: Partial<WorkflowState['config']>): void {
    chrome.runtime.sendMessage({ type: 'UPDATE_CONFIG', config: updates });
  }

  /**
   * Live title summary showing kept titles for range and cut-off counts.
   */
  private updateTitleSummary(rawText: string): void {
    const parsed = parseTitlesFromRawText(rawText);
    const summaryEl = document.getElementById('title-parse-summary');
    if (!summaryEl) return;

    if (parsed.length === 0) {
      summaryEl.textContent = '0 titles detected';
      return;
    }

    const start = parseInt((document.getElementById('title-range-start') as HTMLInputElement)?.value || '1', 10);
    const end = parseInt((document.getElementById('title-range-end') as HTMLInputElement)?.value || '5', 10);

    const { assigned, cutBelowCount, cutAboveCount } = sliceTitlesForRange(
      parsed.map((p) => p.normalized),
      start,
      end
    );

    let info = `${parsed.length} titles in box. ${assigned.length} kept for range V${start}–V${end}`;
    if (cutBelowCount > 0 || cutAboveCount > 0) {
      const parts: string[] = [];
      if (cutBelowCount > 0) parts.push(`${cutBelowCount} below V${start}`);
      if (cutAboveCount > 0) parts.push(`${cutAboveCount} above V${end}`);
      info += ` (Will cut: ${parts.join(', ')})`;
    }
    summaryEl.textContent = info;
  }

  private setupDropzone(
    el: HTMLElement | null,
    onFiles: (files: File[]) => void
  ): void {
    if (!el) return;

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('dragover');
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('dragover');
    });

    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        onFiles(Array.from(e.dataTransfer.files));
      }
    });
  }

  private render(): void {
    this.renderStats();
    this.renderTabsTable();
    this.renderThumbnailsList();
    this.renderScriptsList();
    this.renderPartTracker();
    this.renderDownloadsTree();
    this.renderLogs();
    this.renderSummary();
    this.renderGlobalReadiness();

    // Sync Master Prompt
    const masterPromptInput = document.getElementById('txt-master-prompt') as HTMLTextAreaElement;
    if (masterPromptInput && document.activeElement !== masterPromptInput) {
      masterPromptInput.value = this.state.config.masterPrompt || '';
    }

    // Sync Auto Run toggle
    const autoNextChk = document.getElementById('chk-auto-next-part') as HTMLInputElement;
    if (autoNextChk) {
      autoNextChk.checked = Boolean(this.state.config.autoInsertNextPart);
    }

    // Sync Concurrency limit
    const selConcurrency = document.getElementById('sel-concurrency') as HTMLSelectElement;
    if (selConcurrency) {
      selConcurrency.value = String(this.state.config.concurrencyLimit || 2);
    }

    // Sync Part Word Count
    const wordCountInput = document.getElementById('cfg-word-count') as HTMLInputElement;
    if (wordCountInput && document.activeElement !== wordCountInput) {
      wordCountInput.value = String(this.state.config.partWordCount || 4000);
    }

    // Sync Script Mode
    const currentMode = this.state.config.scriptMode || 'original';
    const radioOrig = document.getElementById('radio-mode-original') as HTMLInputElement;
    const radioComp = document.getElementById('radio-mode-competitor') as HTMLInputElement;
    if (radioOrig && radioComp) {
      if (currentMode === 'original') {
        radioOrig.checked = true;
      } else {
        radioComp.checked = true;
      }
    }

    // Toggle Competitor Script section card
    const secCompetitor = document.getElementById('sec-card-competitor-script');
    if (secCompetitor) {
      secCompetitor.style.display = currentMode === 'original' ? 'none' : 'block';
    }

    // Toggle Mode Badge
    const badgeMode = document.getElementById('badge-current-mode');
    if (badgeMode) {
      badgeMode.textContent = currentMode === 'original' ? 'ORIGINAL SCRIPT MODE' : 'COMPETITOR SCRIPT MODE';
      badgeMode.style.color = currentMode === 'original' ? '#93c5fd' : '#34d399';
      badgeMode.style.borderColor = currentMode === 'original' ? 'rgba(59, 130, 246, 0.5)' : 'rgba(52, 211, 153, 0.5)';
    }

    // Toggle Stage button for scripts in Section 7
    const btnStageScripts = document.getElementById('btn-stage-scripts');
    if (btnStageScripts) {
      btnStageScripts.style.display = currentMode === 'original' ? 'none' : 'inline-block';
    }

    // Update mode description text
    const modeDesc = document.getElementById('mode-description-text');
    if (modeDesc) {
      if (currentMode === 'original') {
        modeDesc.innerHTML = '• <strong>Original Script Mode</strong>: Outline generation workflow (Outline → Wait for <code>OUTLINE = GENERATED</code> → Write Part 1..N). Competitor scripts hidden and not required.';
      } else {
        modeDesc.innerHTML = '• <strong>Competitor Script Mode</strong>: Competitor script workflow (Input Reference Script → Direct Parts Generation → Write Part 1..N). Competitor script required.';
      }
    }

    // Sync Competitor Script input
    const isScriptEnabled = Boolean(this.state.config.competitorScriptEnabled);
    const chkComp = document.getElementById('chk-competitor-script-enabled') as HTMLInputElement;
    if (chkComp) chkComp.checked = isScriptEnabled;

    const containerComp = document.getElementById('competitor-script-input-container');
    if (containerComp) containerComp.style.display = isScriptEnabled ? 'flex' : 'none';

    const badgeComp = document.getElementById('badge-competitor-script-status');
    if (badgeComp) {
      badgeComp.textContent = isScriptEnabled ? 'Optional Input (Active)' : 'Optional Input (Disabled)';
      badgeComp.style.color = isScriptEnabled ? '#34d399' : '#fbbf24';
    }

    const txtComp = document.getElementById('txt-competitor-script') as HTMLTextAreaElement;
    if (txtComp && document.activeElement !== txtComp) {
      txtComp.value = this.state.config.competitorScriptText || '';
    }

    // Debug view
    const debugView = document.getElementById('debug-json-view');
    if (debugView && this.state.config.debugMode) {
      debugView.textContent = JSON.stringify(this.state, null, 2);
    }
  }

  private renderSummary(): void {
    const total = this.state.tabs.length;
    const ready = this.state.tabs.filter((t) => t.status === 'ready').length;
    const running = this.state.tabs.filter((t) => t.status === 'running').length;
    const completed = this.state.tabs.filter((t) => t.status === 'completed').length;
    const allVerified = this.state.tabs.filter(
      (t) => t.titleInjected && t.promptInjected && t.thumbnailPasted && t.scriptInjected
    ).length;

    const summaryBanner = document.getElementById('header-summary-banner');
    if (summaryBanner) {
      summaryBanner.textContent = `Managed Tabs: ${total} | Verified in Chat: ${allVerified}/${total} | Completed: ${completed}`;
    }
  }

  private renderGlobalReadiness(): void {
    const total = this.state.tabs.length;
    let titles = 0, thumbs = 0, scripts = 0;
    const isOriginalMode = (this.state.config.scriptMode || 'original') === 'original';
    const isCompEnabled = !isOriginalMode && Boolean(this.state.config.competitorScriptEnabled);
    const hasPastedScript = Boolean(this.state.config.competitorScriptText && this.state.config.competitorScriptText.trim());

    this.state.tabs.forEach((t) => {
      if (t.titleInjected && t.promptInjected) titles++;
      if (t.thumbnailStatus === 'uploaded' || (t.thumbnailPasted && !t.thumbnailUploading)) thumbs++;
      if (isOriginalMode || !isCompEnabled || t.scriptOptional || hasPastedScript || t.scriptStatus === 'uploaded' || t.scriptInjected) {
        scripts++;
      }
    });

    const elTitles = document.getElementById('ready-titles');
    const elThumbs = document.getElementById('ready-thumbs');
    const elScripts = document.getElementById('ready-scripts');

    if (elTitles) elTitles.textContent = `${titles}/${total}`;
    if (elThumbs) elThumbs.textContent = `${thumbs}/${total}`;
    if (elScripts) {
      if (isOriginalMode) {
        elScripts.textContent = 'Outline Mode (N/A)';
        elScripts.style.color = 'var(--success)';
      } else if (!isCompEnabled) {
        elScripts.textContent = 'Optional ✓';
        elScripts.style.color = 'var(--success)';
      } else if (hasPastedScript) {
        elScripts.textContent = 'Pasted ✓';
        elScripts.style.color = 'var(--success)';
      } else {
        elScripts.textContent = `${scripts}/${total}`;
        elScripts.style.color = scripts === total ? 'var(--success)' : '#f43f5e';
      }
    }
  }

  private renderStats(): void {
    const total = this.state.tabs.length;
    const ready = this.state.tabs.filter((t) => t.status === 'ready').length;
    const running = this.state.tabs.filter((t) => t.status === 'running').length;
    const completed = this.state.tabs.filter((t) => t.status === 'completed').length;
    const incomplete = this.state.tabs.filter((t) => t.status === 'incomplete').length;
    const errors = this.state.tabs.filter((t) => t.status === 'error').length;

    this.setText('stat-total', String(total));
    this.setText('stat-ready', String(ready));
    this.setText('stat-running', String(running));
    this.setText('stat-completed', String(completed));
    this.setText('stat-incomplete', String(incomplete));
    this.setText('stat-errors', String(errors));
    this.setText('tab-count-badge', `${total} Tabs`);

    // Calculate overall completion percentage
    let pct = 0;
    if (total > 0) {
      pct = Math.round((completed / total) * 100);
    }
    this.setText('stat-progress-pct', `${pct}%`);
    const progressFill = document.getElementById('progress-bar-fill');
    if (progressFill) {
      progressFill.style.width = `${pct}%`;
    }
  }

  private renderTabsTable(): void {
    const tbody = document.getElementById('tabs-table-body');
    if (!tbody) return;

    const displayTabs = this.showSelectedOnly
      ? this.state.tabs.filter((t) => t.selected)
      : this.state.tabs;

    if (displayTabs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 18px;">
            ${this.showSelectedOnly ? 'No tabs selected. Select some tabs above or uncheck "Show Selected Only".' : 'No Meta.ai tabs managed yet. Use Section 1 to duplicate chats.'}
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = displayTabs.map((tab) => {
      const hasTitle = Boolean(tab.title);
      const hasThumb = tab.thumbnailStatus !== 'none';
      const hasScript = tab.scriptStatus !== 'none';
      const all4InChat = Boolean(tab.titleInjected && tab.promptInjected && tab.thumbnailPasted && tab.scriptInjected);

      return `
        <tr>
          <td>
            <input type="checkbox" class="chk-tab-select" data-id="${tab.id}" ${tab.selected ? 'checked' : ''} />
          </td>
          <td><strong>${tab.id}</strong></td>
          <td class="col-hide-compact" style="color: var(--text-secondary);">${tab.chromeTabId || 'None'}</td>
          <td>
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
              ${tab.titleInjected
                ? `<span style="color: #4ade80; font-weight: 500;" title="${tab.title}">✓ In Chat: ${this.truncate(tab.title, 14)}</span>`
                : (hasTitle
                    ? `<span style="color: #facc15;" title="${tab.title}">⏳ ${this.truncate(tab.title, 12)}</span>`
                    : '<span style="color: var(--text-muted);">○ Empty</span>'
                  )
              }
              ${hasTitle && !tab.titleInjected ? `<button class="btn btn-xs btn-table-push-title" data-id="${tab.id}" style="padding: 1px 5px; font-size: 10px;" title="Push title to this tab">📥 Push</button>` : ''}
            </div>
          </td>
          <td>
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
              ${tab.thumbnailPasted
                ? `<span style="color: #4ade80; font-weight: 500;" title="${tab.thumbnailName}">✓ Pasted: ${this.truncate(tab.thumbnailName || '', 12)}</span>`
                : (hasThumb
                    ? `<span style="color: #facc15;" title="${tab.thumbnailName}">⏳ ${this.truncate(tab.thumbnailName || '', 10)}</span>`
                    : '<span style="color: var(--text-muted);">○ Empty</span>'
                  )
              }
              ${hasThumb && !tab.thumbnailPasted ? `<button class="btn btn-xs btn-warning btn-table-push-thumb" data-id="${tab.id}" style="padding: 1px 5px; font-size: 10px;" title="Paste thumbnail via clipboard to this tab">🖼️ Paste</button>` : ''}
            </div>
          </td>
          <td>
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
              ${tab.scriptInjected
                ? `<span style="color: #4ade80; font-weight: 500;" title="${tab.scriptName}">✓ Embedded: ${this.truncate(tab.scriptName || '', 12)}</span>`
                : (hasScript
                    ? `<span style="color: #facc15;" title="${tab.scriptName}">⏳ ${this.truncate(tab.scriptName || '', 10)}</span>`
                    : '<span style="color: var(--text-muted);">○ Empty</span>'
                  )
              }
              ${hasScript && !tab.scriptInjected ? `<button class="btn btn-xs btn-warning btn-table-push-script" data-id="${tab.id}" style="padding: 1px 5px; font-size: 10px;" title="Embed competitor script into this tab">📄 Embed</button>` : ''}
            </div>
          </td>
          <td>
            ${all4InChat
              ? `<span class="badge badge-success" style="background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid #22c55e;" title="All 4 assets in chat! Ready for safe 10s–15s run">🟢 4/4 IN CHAT</span>`
              : (tab.status === 'running'
                  ? `<span class="badge badge-running">RUNNING</span>`
                  : (tab.status === 'completed'
                      ? `<span class="badge badge-success">DONE</span>`
                      : (tab.status === 'error'
                          ? `<span class="badge badge-error">ERROR</span>`
                          : `<span class="badge badge-warning" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid #ef4444;" title="Chat blocked: Missing assets in chat">🔴 MISSING IN CHAT</span>`
                        )
                    )
                )
            }
          </td>
          <td>
            ${tab.totalParts > 0 ? `${tab.parts.filter((p) => p.status === 'done' && Boolean(p.content && p.content.trim().length > 0)).length}/${tab.totalParts}` : '-'}
          </td>
          <td>
            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
              <button class="btn btn-sm btn-primary btn-table-push-all" data-id="${tab.id}" title="Push all 4 assets (Title, Prompt, Thumb, Script) to this tab">⚡ Push</button>
              <button class="btn btn-sm btn-table-focus" data-tabid="${tab.chromeTabId}" title="Bring Meta.ai tab to front">Focus</button>
              ${tab.status === 'running' ? `<button class="btn btn-sm btn-warning btn-table-cancel" data-id="${tab.id}" title="Cancel execution">Cancel</button>` : ''}
              ${tab.status === 'error' ? `<button class="btn btn-sm btn-table-retry" data-id="${tab.id}" title="Retry failed execution">Retry</button>` : ''}
              <button class="btn btn-sm btn-table-restart" data-id="${tab.id}" title="Restart tab from Part 1">Restart</button>
              ${tab.chromeTabId ? `<button class="btn btn-sm btn-table-refresh" data-id="${tab.id}" title="Refresh browser tab">Refresh</button>` : ''}
              <button class="btn btn-sm btn-danger btn-table-remove" data-id="${tab.id}" title="Remove tab from list">✕</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Attach row events
    tbody.querySelectorAll('.btn-table-push-all').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).dataset.id;
        if (id) {
          chrome.runtime.sendMessage({ type: 'PUSH_ALL_ASSETS_TO_CHATS', target: id }, () => this.syncState());
        }
      });
    });

    tbody.querySelectorAll('.btn-table-push-title').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).dataset.id;
        if (id) {
          chrome.runtime.sendMessage({ type: 'PUSH_TITLES_TO_CHATS', target: id }, () => this.syncState());
        }
      });
    });

    tbody.querySelectorAll('.btn-table-push-thumb').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).dataset.id;
        if (id) {
          chrome.runtime.sendMessage({ type: 'PUSH_THUMBNAILS_TO_CHATS', target: id }, () => this.syncState());
        }
      });
    });

    tbody.querySelectorAll('.btn-table-push-script').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).dataset.id;
        if (id) {
          chrome.runtime.sendMessage({ type: 'PUSH_SCRIPTS_TO_CHATS', target: id }, () => this.syncState());
        }
      });
    });

    // Attach row events
    tbody.querySelectorAll('.chk-tab-select').forEach((chk) => {
      chk.addEventListener('change', (e) => {
        const id = (e.target as HTMLElement).dataset.id;
        const checked = (e.target as HTMLInputElement).checked;
        if (id) {
          chrome.runtime.sendMessage({ type: 'SELECT_TABS', tabIds: [id], selected: checked }, () => this.syncState());
        }
      });
    });

    tbody.querySelectorAll('.btn-table-focus').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const tabId = parseInt((e.currentTarget as HTMLElement).dataset.tabid || '0', 10);
        if (tabId) {
          chrome.tabs.update(tabId, { active: true });
        }
      });
    });

    tbody.querySelectorAll('.btn-table-retry').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const vId = (e.currentTarget as HTMLElement).dataset.id;
        if (vId) {
          chrome.runtime.sendMessage({ type: 'RETRY_TAB', vNumber: vId }, () => this.syncState());
        }
      });
    });

    tbody.querySelectorAll('.btn-table-cancel').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const vId = (e.currentTarget as HTMLElement).dataset.id;
        if (vId) {
          chrome.runtime.sendMessage({ type: 'CANCEL_TAB', vNumber: vId }, () => this.syncState());
        }
      });
    });

    tbody.querySelectorAll('.btn-table-restart').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const vId = (e.currentTarget as HTMLElement).dataset.id;
        if (vId) {
          chrome.runtime.sendMessage({ type: 'RESTART_TAB', vNumber: vId }, () => this.syncState());
        }
      });
    });

    tbody.querySelectorAll('.btn-table-refresh').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const vId = (e.currentTarget as HTMLElement).dataset.id;
        if (vId) {
          chrome.runtime.sendMessage({ type: 'REFRESH_TAB', vNumber: vId }, () => this.syncState());
        }
      });
    });

    tbody.querySelectorAll('.btn-table-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const vId = (e.currentTarget as HTMLElement).dataset.id;
        if (vId) {
          chrome.runtime.sendMessage({ type: 'REMOVE_TAB', vNumber: vId }, () => this.syncState());
        }
      });
    });
  }

  private renderThumbnailsList(): void {
    const list = document.getElementById('thumbnails-status-list');
    if (!list) return;

    list.innerHTML = this.state.tabs.map((t) => `
      <div class="badge ${t.thumbnailStatus !== 'none' ? 'badge-ready' : 'badge-incomplete'}">
        ${t.id}: ${t.thumbnailName ? this.truncate(t.thumbnailName, 16) : 'None'}
      </div>
    `).join('');
  }

  private renderScriptsList(): void {
    const list = document.getElementById('scripts-status-list');
    if (!list) return;

    list.innerHTML = this.state.tabs.map((t) => `
      <div class="badge ${t.scriptStatus !== 'none' ? 'badge-ready' : 'badge-incomplete'}">
        ${t.id}: ${t.scriptName ? this.truncate(t.scriptName, 16) : 'None'}
      </div>
    `).join('');
  }

  private renderPartTracker(): void {
    const grid = document.getElementById('part-tracker-grid');
    if (!grid) return;

    const activeTabs = this.state.tabs.filter((t) => t.parts.length > 0 || t.status === 'running');
    if (activeTabs.length === 0) {
      grid.innerHTML = '<div style="color: var(--text-muted); font-size: 12px;">No active parts tracked yet.</div>';
    } else {
      grid.innerHTML = activeTabs.map((tab) => {
        const hasCompetitor = Boolean((tab.scriptStatus && tab.scriptStatus !== 'none') || tab.scriptId);
        let outlineText = '— None';
        let outlineColor = 'var(--text-muted)';
        if (hasCompetitor) {
          outlineText = 'REF SCRIPT ✓';
          outlineColor = 'var(--primary)';
        } else if (tab.outlineStatus === 'generating') {
          outlineText = 'OUTLINE GENERATING...';
          outlineColor = '#f59e0b';
        } else if (tab.outlineStatus === 'completed' || tab.outlineDetected) {
          outlineText = 'OUTLINE GENERATED ✓';
          outlineColor = 'var(--success)';
        }

        // Determine next part to write
        let nextPartNum: number | null = null;
        const donePartNums = new Set(tab.parts.filter((p) => p.status === 'done').map((p) => p.partNumber));
        if (donePartNums.size === 0) {
          if (hasCompetitor || tab.outlineStatus === 'completed' || tab.outlineDetected) {
            nextPartNum = 1;
          }
        } else {
          const maxDone = Math.max(...Array.from(donePartNums));
          const total = tab.totalParts || 0;
          if (total === 0 || maxDone < total) {
            nextPartNum = maxDone + 1;
          }
        }

        const missingHtml = tab.missingParts && tab.missingParts.length > 0 ? `
          <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; padding: 3px 6px; border-radius: 4px; font-weight: bold; font-size: 10px;">
            ⚠️ MISSING: ${tab.missingParts.map((n) => `${tab.id} P${n}`).join(', ')}
          </div>
        ` : '';

        const duplicateHtml = tab.duplicateParts && tab.duplicateParts.length > 0 ? `
          <div style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); color: #fcd34d; padding: 3px 6px; border-radius: 4px; font-weight: bold; font-size: 10px;">
            ⚠️ DUPLICATE: ${tab.duplicateParts.map((n) => `${tab.id} P${n}`).join(', ')}
          </div>
        ` : '';

        return `
          <div class="stat-card" style="gap: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong>${tab.id}</strong>
              <div style="display: flex; gap: 4px; align-items: center;">
                <button class="btn btn-xs btn-override-tab" data-v="${tab.id}" data-total="${tab.totalParts || 4}" data-current="${tab.currentPart || 1}" data-outline="${tab.outlineDetected ? 'true' : 'false'}" style="padding: 1px 6px; font-size: 10px; background: rgba(59,130,246,0.15); color: #93c5fd; border: 1px solid rgba(59,130,246,0.4);" title="Manually override total parts, current part, or outline">
                  ✏️ Override
                </button>
                <span class="badge badge-${tab.status}">${tab.status.toUpperCase()}</span>
              </div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-secondary);">
              <span>TOTAL PARTS: <strong>${tab.totalParts > 0 ? tab.totalParts : '-'}</strong></span>
              <span>OUTLINE: <strong style="color: ${outlineColor};">${outlineText}</strong></span>
            </div>
            ${missingHtml}
            ${duplicateHtml}
            <div style="font-size: 11px; color: var(--text-secondary);">
              Completed: ${tab.parts.filter((p) => p.status === 'done').length} / ${tab.totalParts || 0}
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              ${tab.parts.map((p) => {
                const marker = p.explicitMarker || `${tab.id} P${p.partNumber}`;
                const heading = p.heading ? `— ${p.heading}` : '';
                const statusLabel = p.status === 'done' ? 'Generated ✓' : p.status === 'generating' ? 'Generating...' : 'Queue';
                const statusColor = p.status === 'done' ? 'var(--success)' : p.status === 'generating' ? '#f59e0b' : 'var(--text-muted)';
                const icon = p.status === 'done' ? '✓' : p.status === 'generating' ? '⚡' : '○';
                return `
                  <div style="display: flex; justify-content: space-between; font-size: 11px; background: rgba(255,255,255,0.03); padding: 4px 6px; border-radius: 4px; gap: 6px;">
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${marker} ${heading}">
                      ${icon} <strong>${marker}</strong> ${heading}
                    </span>
                    <span style="color: ${statusColor}; font-weight: 500; font-size: 10px; white-space: nowrap;">
                      ${statusLabel}
                    </span>
                  </div>
                `;
              }).join('')}
            </div>
            ${nextPartNum ? `
              <button class="btn btn-sm btn-primary btn-grid-insert-part" data-v="${tab.id}" data-part="${nextPartNum}">
                ✍️ Write Part ${nextPartNum} Script
              </button>
            ` : ''}
          </div>
        `;
      }).join('');

      grid.querySelectorAll('.btn-grid-insert-part').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const target = e.currentTarget as HTMLButtonElement;
          const v = target.dataset.v;
          const part = parseInt(target.dataset.part || '1', 10);
          if (v) {
            target.disabled = true;
            target.innerHTML = `⏳ Requesting Part ${part}...`;
            chrome.runtime.sendMessage({ type: 'INSERT_NEXT_PART', vNumber: v, partNumber: part }, (resp) => {
              if (resp && resp.error) {
                alert(`Could not request Part ${part} for ${v}:\n\n${resp.error}`);
              }
              this.syncState();
            });
          }
        });
      });

      grid.querySelectorAll('.btn-override-tab').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const v = (e.currentTarget as HTMLElement).dataset.v;
          const curTotal = (e.currentTarget as HTMLElement).dataset.total || '4';
          const curPart = (e.currentTarget as HTMLElement).dataset.current || '1';
          const curOutline = (e.currentTarget as HTMLElement).dataset.outline === 'true';
          if (!v) return;

          const newTotalStr = prompt(`[Manual Override for ${v}]\nEnter TOTAL PARTS for this video:`, curTotal);
          if (newTotalStr === null) return;
          const newTotal = parseInt(newTotalStr, 10);
          if (isNaN(newTotal) || newTotal < 1) {
            alert('Please enter a valid positive number for Total Parts.');
            return;
          }

          const newPartStr = prompt(`[Manual Override for ${v}]\nEnter CURRENT PART being generated (1 to ${newTotal}):`, curPart);
          if (newPartStr === null) return;
          const newPart = parseInt(newPartStr, 10);
          if (isNaN(newPart) || newPart < 1 || newPart > newTotal) {
            alert('Please enter a valid part number within range.');
            return;
          }

          const newOutline = confirm(`[Manual Override for ${v}]\n\nIs OUTLINE generated for this script?\n(Currently: ${curOutline ? 'Generated ✓' : 'None'})\n\n• Click OK for YES (Outline Generated ✓)\n• Click Cancel for NO (No Outline)`);

          chrome.runtime.sendMessage({
            type: 'OVERRIDE_TAB_PARTS',
            vNumber: v,
            totalParts: newTotal,
            currentPart: newPart,
            outlineDetected: newOutline
          }, () => this.syncState());
        });
      });
    }

    // Requirement 2: Wait for complete Part Tracker synchronization.
    // Only after all expected parts have appeared in the Part Tracker and are fully synchronized,
    // show the "Load Parts into Download Manager" button below the Part Tracker.
    const hasDoneParts = this.state.tabs.some((t) =>
      t.parts.some((p) => p.status === 'done' && p.content && p.content.trim())
    );

    const loadContainer = document.getElementById('load-parts-btn-container');
    if (loadContainer) {
      if (hasDoneParts) {
        loadContainer.innerHTML = `
          <div style="margin-top: 16px; padding: 12px 18px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 8px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
            <div>
              <div style="font-weight: bold; font-size: 13px; color: #34d399; display: flex; align-items: center; gap: 6px;">
                <span>✓</span> Scripts Synchronized in Part Tracker
              </div>
              <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
                All expected parts are generated and verified. Click to transfer them into the Download Manager.
              </div>
            </div>
            <button id="btn-load-parts-to-dm" class="btn btn-success" style="font-weight: bold; padding: 9px 22px; font-size: 13px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
              📥 Load Parts into Download Manager
            </button>
          </div>
        `;

        document.getElementById('btn-load-parts-to-dm')?.addEventListener('click', () => {
          chrome.runtime.sendMessage({ type: 'LOAD_DOWNLOAD_MANAGER' }, () => {
            this.syncState();
            const secDownloads = document.getElementById('sec-downloads');
            secDownloads?.scrollIntoView({ behavior: 'smooth' });
          });
        });
      } else {
        loadContainer.innerHTML = '';
      }
    }
  }

  // Requirement 1, 3, 4: Download Manager Structure and Lifecycle
  private renderDownloadsTree(): void {
    const container = document.getElementById('downloads-tree-container');
    const badge = document.getElementById('download-manager-badge');
    const btnAllMerged = document.getElementById('btn-download-all') as HTMLButtonElement;
    const btnAllZip = document.getElementById('btn-download-all-zip') as HTMLButtonElement;
    const btnAllPartsZip = document.getElementById('btn-download-all-parts-zip') as HTMLButtonElement;

    if (!container) return;

    // Requirement 1: Keep the Download Manager empty initially.
    // Requirement 3: Load only after clicking the button.
    if (!this.state.downloadManagerLoaded) {
      if (badge) {
        badge.textContent = 'Empty (Waiting for Load)';
        badge.style.background = 'rgba(245, 158, 11, 0.15)';
        badge.style.color = '#fbbf24';
      }
      if (btnAllMerged) btnAllMerged.disabled = true;
      if (btnAllZip) btnAllZip.disabled = true;
      if (btnAllPartsZip) btnAllPartsZip.disabled = true;

      container.innerHTML = `
        <div style="text-align: center; padding: 40px 16px; color: var(--text-muted); font-size: 13px;">
          <div style="font-size: 36px; margin-bottom: 10px;">⏳</div>
          <strong style="color: #cbd5e1; font-size: 14px;">Download Manager is empty.</strong>
          <div style="font-size: 12px; margin-top: 6px; color: var(--text-secondary); max-width: 520px; margin-left: auto; margin-right: auto; line-height: 1.5;">
            Waiting for complete Part Tracker synchronization. Once all expected parts are generated and verified in <strong>Section 8 (Part Tracker)</strong>, click <strong>"Load Parts into Download Manager"</strong> to populate and export your scripts.
          </div>
        </div>
      `;
      return;
    }

    if (badge) {
      badge.textContent = 'Loaded & Verified ✓';
      badge.style.background = 'rgba(16, 185, 129, 0.15)';
      badge.style.color = '#34d399';
    }
    if (btnAllMerged) btnAllMerged.disabled = false;
    if (btnAllZip) btnAllZip.disabled = false;
    if (btnAllPartsZip) btnAllPartsZip.disabled = false;

    // Requirement 4: Correct Download Manager structure:
    // Under each file/video name, show the videos in the exact same correct numbering/order as the Part Tracker:
    // V1 -> V1 P1, V1 P2, V1 P3...
    // V2 -> V2 P1, V2 P2, V2 P3...
    // V3 -> V3 P1, V3 P2, V3 P3...
    const sortedTabs = [...this.state.tabs].sort((a, b) => a.index - b.index);

    const videoCardsHtml = sortedTabs.map((tab) => {
      // Requirement 6: Verify before merging - parts must strictly belong to tab.id
      const doneParts = tab.parts.filter((p) => p.status === 'done' && p.content && p.content.trim());
      // Strict part-by-part sequence: P1 -> P2 -> P3...
      doneParts.sort((a, b) => a.partNumber - b.partNumber);

      const val = validateVideoMerge(tab);
      const missingStr = val.missingParts && val.missingParts.length > 0
        ? val.missingParts.map((n) => `P${n}`).join(', ')
        : `${val.completedPartsCount}/${tab.totalParts || val.completedPartsCount} Parts`;

      const valBadge = val.valid
        ? '<span class="badge badge-success" style="font-size: 11px;">TXT MERGE VERIFIED ✓</span>'
        : `<span class="badge badge-danger" style="font-size: 10px; font-weight: bold; background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid #ef4444;" title="${val.errors.join('; ')}">MERGE INCOMPLETE — ${missingStr} MISSING</span>`;

      if (doneParts.length === 0) {
        return `
          <div class="video-download-card" style="background: rgba(30, 41, 59, 0.4); border: 1px dashed rgba(255, 255, 255, 0.1); border-radius: 8px; margin-bottom: 12px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <span style="font-weight: bold; color: #60a5fa; font-size: 14px;">🎬 ${tab.id}</span>
              <span style="font-size: 12px; color: var(--text-secondary); margin-left: 8px;">${this.truncate(tab.title || 'Untitled', 30)}</span>
            </div>
            <span style="font-size: 11px; color: var(--text-muted);">No completed parts ready</span>
          </div>
        `;
      }

      const partsRowsHtml = doneParts.map((p) => {
        const sizeBytes = new TextEncoder().encode(p.content).length;
        const heading = p.heading || generateIntelligentHeading(p.partNumber, p.content, tab.totalParts);
        return `
          <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.04);">
            <td style="padding: 8px 8px; font-weight: 600; color: #e2e8f0;">
              <span style="color: #94a3b8; margin-right: 6px;">↳</span> ${tab.id} P${p.partNumber} <span style="color: #cbd5e1; font-weight: normal; margin-left: 4px;">— ${heading}</span>
            </td>
            <td style="padding: 8px 8px; color: var(--text-secondary);">Part ${p.partNumber}</td>
            <td style="padding: 8px 8px; color: var(--success); font-weight: 500;">✅ Done</td>
            <td style="padding: 8px 8px; color: var(--text-muted);">${sizeBytes.toLocaleString()} B</td>
            <td style="padding: 8px 8px; text-align: right;">
              <button class="btn btn-xs btn-primary btn-download-part" data-v="${tab.id}" data-part="${p.partNumber}" style="padding: 3px 12px; font-size: 11px;">
                ⬇ Download Part
              </button>
            </td>
          </tr>
        `;
      }).join('');

      const missingWarningHtml = tab.missingParts && tab.missingParts.length > 0
        ? `<span class="badge badge-danger" style="font-size: 10px;">⚠️ MISSING: ${tab.missingParts.map((n) => `${tab.id} P${n}`).join(', ')}</span>`
        : '';
      const duplicateWarningHtml = tab.duplicateParts && tab.duplicateParts.length > 0
        ? `<span class="badge badge-warning" style="font-size: 10px;">⚠️ DUPLICATE: ${tab.duplicateParts.map((n) => `${tab.id} P${n}`).join(', ')}</span>`
        : '';

      return `
        <div class="video-download-card" style="background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; margin-bottom: 14px; overflow: hidden;">
          <!-- Video Header Card -->
          <div style="background: rgba(15, 23, 42, 0.8); padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08); flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 15px; font-weight: bold; color: #60a5fa;">🎬 ${tab.id}</span>
              <span style="font-size: 12px; color: var(--text-secondary);" title="${tab.title || ''}">${this.truncate(tab.title || 'Untitled', 35)}</span>
              ${valBadge}
              ${missingWarningHtml}
              ${duplicateWarningHtml}
            </div>
            <!-- Download Merged TXT (Always allows export of completed parts) -->
            ${val.valid ? `
              <button class="btn btn-sm btn-success btn-download-video-merged" data-v="${tab.id}" style="font-weight: 600;" title="Download complete verified merged script for ${tab.id}">
                📄 Download Merged (${tab.id} Script.txt) ✓
              </button>
            ` : `
              <button class="btn btn-sm btn-warning btn-download-video-merged" data-v="${tab.id}" style="font-weight: 600;" title="Download all available parts for ${tab.id} (${val.errors.join('; ')})">
                📥 Download Merged (${tab.id} Script.txt) ⚠️
              </button>
            `}
          </div>

          <!-- Video Parts List -->
          <div style="padding: 4px 12px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
              <thead>
                <tr style="color: var(--text-muted); text-align: left; font-size: 11px; border-bottom: 1px solid rgba(255, 255, 255, 0.06);">
                  <th style="padding: 6px 8px;">File / Part Name</th>
                  <th style="padding: 6px 8px;">Part</th>
                  <th style="padding: 6px 8px;">Status</th>
                  <th style="padding: 6px 8px;">Size</th>
                  <th style="padding: 6px 8px; text-align: right;">Action</th>
                </tr>
              </thead>
              <tbody>
                ${partsRowsHtml}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = videoCardsHtml || '<div style="color: var(--text-muted); text-align: center; padding: 20px;">No video tabs found.</div>';

    // Bind individual part download buttons
    container.querySelectorAll('.btn-download-part').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const v = (e.currentTarget as HTMLElement).dataset.v;
        const part = parseInt((e.currentTarget as HTMLElement).dataset.part || '1', 10);
        if (v) this.downloadSinglePart(v, part);
      });
    });

    // Bind merged video download buttons
    container.querySelectorAll('.btn-download-video-merged').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const v = (e.currentTarget as HTMLElement).dataset.v;
        if (v) this.downloadMergedVideo(v);
      });
    });
  }

  // Requirement 5 & 6: Download Individual Part with Heading
  private downloadSinglePart(vNumber: string, partNumber: number): void {
    const tab = this.state.tabs.find((t) => t.id === vNumber);
    if (!tab) return;
    const part = tab.parts.find((p) => p.partNumber === partNumber && (p.status === 'done' || (p.content && p.content.trim().length > 20)) && p.content);
    if (!part || !part.content) {
      alert(`Part ${partNumber} for ${vNumber} has no content to download.`);
      return;
    }
    const heading = part.heading || generateIntelligentHeading(part.partNumber, part.content, tab.totalParts);
    const formatted = `${tab.id} P${part.partNumber} — ${heading}\n\n${part.content.trim()}`;
    const blob = createTxtBlob(formatted);
    triggerDownload(blob, `${tab.id} P${part.partNumber}.txt`);
  }

  // Requirement 5, 6, 10, 11, 12, 13, 15: Download Merged Video with Headings
  private downloadMergedVideo(vNumber: string): void {
    const tab = this.state.tabs.find((t) => t.id === vNumber);
    if (!tab) return;

    const val = validateVideoMerge(tab);
    const doneParts = tab.parts.filter((p) => (p.status === 'done' || (p.content && p.content.trim().length > 20)) && !detectOutlineInText(p.content).isOutline);
    if (doneParts.length === 0) {
      alert(`No completed script parts found for ${vNumber} to merge.`);
      return;
    }

    if (!val.valid) {
      const missingStr = val.missingParts && val.missingParts.length > 0
        ? val.missingParts.map((n) => `P${n}`).join(', ')
        : 'some parts';
      console.warn(`[Download Merged] Downloading available parts for ${vNumber} (Missing: ${missingStr}).`);
    }

    // Sort strictly: P1 -> P2 -> P3...
    doneParts.sort((a, b) => a.partNumber - b.partNumber);

    let mergedContent = '';
    doneParts.forEach((p, idx) => {
      if (idx > 0) mergedContent += '\n\n';
      const heading = p.heading || generateIntelligentHeading(p.partNumber, p.content, tab.totalParts);
      mergedContent += formatMergedScriptPart(tab.id, p.partNumber, heading, p.content);
    });

    const blob = createTxtBlob(mergedContent.trim());
    triggerDownload(blob, `${tab.id} Script.txt`);
  }

  private renderLogs(): void {
    const container = document.getElementById('activity-log-container');
    const badge = document.getElementById('log-count-badge');
    if (!container) return;

    const filtered = this.state.logs.filter((l) =>
      this.activeLogFilter === 'ALL' ? true : l.level === this.activeLogFilter
    );

    if (badge) badge.textContent = `${filtered.length} Logs`;

    if (filtered.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px;">No logs recorded yet.</div>';
      return;
    }

    container.innerHTML = filtered.map((l) => {
      let formattedMsg = l.message;
      if (formattedMsg.includes('[MANUAL]')) {
        formattedMsg = formattedMsg.replace(
          '[MANUAL]',
          '<span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); padding: 1px 6px; border-radius: 4px; font-weight: bold; font-size: 10px; margin-right: 4px;">👤 MANUAL</span>'
        );
      } else if (formattedMsg.includes('[MANUAL MODE]')) {
        formattedMsg = formattedMsg.replace(
          '[MANUAL MODE]',
          '<span style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); padding: 1px 6px; border-radius: 4px; font-weight: bold; font-size: 10px; margin-right: 4px;">⏸️ MANUAL MODE</span>'
        );
      } else if (formattedMsg.includes('[AUTO]')) {
        formattedMsg = formattedMsg.replace(
          '[AUTO]',
          '<span style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); padding: 1px 6px; border-radius: 4px; font-weight: bold; font-size: 10px; margin-right: 4px;">⚡ AUTO</span>'
        );
      }

      const errorHtml = l.errorDetails ? `
        <div class="diag-card" style="margin-top: 4px;">
          <div class="diag-title">${l.errorDetails.title}</div>
          <div class="diag-section"><span class="diag-lbl">Problem:</span> <span class="diag-val">${l.errorDetails.problem}</span></div>
          <div class="diag-section"><span class="diag-lbl">Why:</span> <span class="diag-val">${l.errorDetails.why}</span></div>
          <div class="diag-section"><span class="diag-lbl">Solution:</span> <span class="diag-val">${l.errorDetails.solution}</span></div>
          ${l.errorDetails.canRetry && l.vNumber ? `
            <button class="btn btn-sm btn-danger btn-retry-diag" data-v="${l.vNumber}" style="align-self: flex-start; margin-top: 4px;">Retry</button>
          ` : ''}
        </div>
      ` : '';

      return `
        <div class="log-line">
          <span class="log-time">[${l.timeStr}]</span>
          <span class="log-level-${l.level}">[${l.level}]</span>
          <span class="log-msg">${formattedMsg}</span>
          ${errorHtml}
        </div>
      `;
    }).join('');

    container.querySelectorAll('.btn-retry-diag').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const v = (e.currentTarget as HTMLElement).dataset.v;
        if (v) {
          chrome.runtime.sendMessage({ type: 'RETRY_TAB', vNumber: v }, () => this.syncState());
        }
      });
    });
  }

  private escapeHtml(str: string): string {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Dynamic Merged File Download: Automatically renames the entire downloaded TXT file to the Video ID range (e.g. "V1 to V5 Script.txt")
  private downloadAllCombinedFile(): void {
    const sortedTabs = [...this.state.tabs].sort((a, b) => {
      const numA = parseInt(a.id.replace(/\D/g, ''), 10) || a.index;
      const numB = parseInt(b.id.replace(/\D/g, ''), 10) || b.index;
      return numA - numB;
    });

    const tabsToExport = sortedTabs.filter((tab) =>
      tab.parts.some((p) => (p.status === 'done' || (p.content && p.content.trim().length > 20)) && !detectOutlineInText(p.content).isOutline)
    );

    if (tabsToExport.length === 0) {
      alert('No scripts or completed parts available to download yet. Please generate parts first.');
      return;
    }

    let combinedContent = '';
    const includedVideoIds: string[] = [];

    tabsToExport.forEach((tab) => {
      const doneParts = tab.parts.filter(
        (p) => (p.status === 'done' || (p.content && p.content.trim().length > 20)) && !detectOutlineInText(p.content).isOutline
      );
      if (doneParts.length > 0) {
        doneParts.sort((a, b) => a.partNumber - b.partNumber);
        includedVideoIds.push(tab.id);

        let videoMerged = '';
        doneParts.forEach((p, idx) => {
          if (idx > 0) videoMerged += '\n\n';
          const heading = p.heading || generateIntelligentHeading(p.partNumber, p.content, tab.totalParts);
          videoMerged += formatMergedScriptPart(tab.id, p.partNumber, heading, p.content);
        });

        if (combinedContent.length > 0) combinedContent += '\n\n\n';
        combinedContent += videoMerged.trim();
      }
    });

    const filename = getMergedFilename(includedVideoIds);
    const blob = createTxtBlob(combinedContent.trim());
    triggerDownload(blob, filename);
  }

  // Download All Merged as Individual TXT Files
  private downloadAllIndividualFiles(): void {
    let triggered = 0;
    const sortedTabs = [...this.state.tabs].sort((a, b) => a.index - b.index);
    const tabsToExport = sortedTabs.filter((tab) =>
      tab.parts.some((p) => (p.status === 'done' || (p.content && p.content.trim().length > 20)) && !detectOutlineInText(p.content).isOutline)
    );

    if (tabsToExport.length === 0) {
      alert('No scripts or completed parts available to download yet. Please generate parts first.');
      return;
    }

    tabsToExport.forEach((tab) => {
      const doneParts = tab.parts.filter((p) => (p.status === 'done' || (p.content && p.content.trim().length > 20)) && !detectOutlineInText(p.content).isOutline);
      if (doneParts.length > 0) {
        doneParts.sort((a, b) => a.partNumber - b.partNumber);
        
        let mergedContent = '';
        doneParts.forEach((p, idx) => {
          if (idx > 0) mergedContent += '\n\n';
          const heading = p.heading || generateIntelligentHeading(p.partNumber, p.content, tab.totalParts);
          mergedContent += formatMergedScriptPart(tab.id, p.partNumber, heading, p.content);
        });

        const blob = createTxtBlob(mergedContent.trim());
        triggerDownload(blob, `${tab.id} Script.txt`);
        triggered++;
      }
    });
  }

  // Download All Merged as ZIP
  private async downloadAllAsZip(): Promise<void> {
    const filesToZip: { filename: string; content: string }[] = [];
    const sortedTabs = [...this.state.tabs].sort((a, b) => a.index - b.index);
    const tabsToExport = sortedTabs.filter((tab) =>
      tab.parts.some((p) => (p.status === 'done' || (p.content && p.content.trim().length > 20)) && !detectOutlineInText(p.content).isOutline)
    );
    const includedVideoIds: string[] = [];

    if (tabsToExport.length === 0) {
      alert('No scripts or completed parts available to download yet. Please generate parts first.');
      return;
    }

    tabsToExport.forEach((tab) => {
      const doneParts = tab.parts.filter((p) => (p.status === 'done' || (p.content && p.content.trim().length > 20)) && !detectOutlineInText(p.content).isOutline);
      if (doneParts.length > 0) {
        doneParts.sort((a, b) => a.partNumber - b.partNumber);
        includedVideoIds.push(tab.id);

        let mergedContent = '';
        doneParts.forEach((p, idx) => {
          if (idx > 0) mergedContent += '\n\n';
          const heading = p.heading || generateIntelligentHeading(p.partNumber, p.content, tab.totalParts);
          mergedContent += formatMergedScriptPart(tab.id, p.partNumber, heading, p.content);
        });

        filesToZip.push({
          filename: `${tab.id} Script.txt`,
          content: mergedContent.trim()
        });
      }
    });

    if (filesToZip.length === 0) {
      alert('No completed parts found to bundle into ZIP.');
      return;
    }

    try {
      const zipBlob = await createZipBundle(filesToZip);
      const zipFilename = getMergedFilename(includedVideoIds).replace(/\.txt$/, '.zip');
      triggerDownload(zipBlob, zipFilename);
    } catch (err: any) {
      alert(`ZIP creation failed: ${err.message}`);
    }
  }

  // Requirement 5: Download All Individual Parts as ZIP
  private async downloadAllIndividualPartsAsZip(): Promise<void> {
    const filesToZip: { filename: string; content: string }[] = [];
    const sortedTabs = [...this.state.tabs].sort((a, b) => a.index - b.index);

    sortedTabs.forEach((tab) => {
      const doneParts = tab.parts.filter((p) => p.status === 'done' && p.content && p.content.trim());
      doneParts.sort((a, b) => a.partNumber - b.partNumber);

      doneParts.forEach((p) => {
        const heading = p.heading || generateIntelligentHeading(p.partNumber, p.content, tab.totalParts);
        filesToZip.push({
          filename: `${tab.id} P${p.partNumber}.txt`,
          content: `${tab.id} P${p.partNumber} — ${heading}\n\n${p.content.trim()}`
        });
      });
    });

    if (filesToZip.length === 0) {
      alert('No individual parts found to bundle into ZIP.');
      return;
    }

    try {
      const zipBlob = await createZipBundle(filesToZip);
      const dateStr = new Date().toISOString().split('T')[0];
      triggerDownload(zipBlob, `meta_individual_parts_${dateStr}.zip`);
    } catch (err: any) {
      alert(`ZIP creation failed: ${err.message}`);
    }
  }

  private exportActivityLog(): void {
    if (this.state.logs.length === 0) {
      alert('Activity log is currently empty.');
      return;
    }

    const lines = this.state.logs.map(
      (l) => `[${l.isoTime}] [${l.level}] ${l.message} ${l.errorDetails ? `\n  Problem: ${l.errorDetails.problem}\n  Why: ${l.errorDetails.why}\n  Solution: ${l.errorDetails.solution}` : ''}`
    );

    const content = lines.join('\n');
    const dateStr = new Date().toISOString().split('T')[0];
    const blob = createTxtBlob(content);
    triggerDownload(blob, `meta_activity_log_${dateStr}.txt`);
  }

  private showConfirmModal(title: string, desc: string, onConfirm: () => void): void {
    this.confirmActionCallback = onConfirm;
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('modal-title');
    const descEl = document.getElementById('modal-desc');

    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = desc;
    if (modal) modal.style.display = 'flex';
  }

  private hideConfirmModal(): void {
    this.confirmActionCallback = null;
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.style.display = 'none';
  }

  private setText(id: string, text: string): void {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  private truncate(str: string, maxLen: number): string {
    if (!str) return '';
    return str.length > maxLen ? `${str.slice(0, maxLen)}...` : str;
  }
}

document.addEventListener('DOMContentLoaded', () => new DashboardController());
