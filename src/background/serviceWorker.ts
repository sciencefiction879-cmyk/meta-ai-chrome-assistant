import {
  WorkflowState,
  VTab,
  LogEntry,
  DiagnosticError,
  LogLevel
} from '../types';
import { loadWorkflowState, saveWorkflowState, getAssetBlob } from '../storage/db';
import { createDiagnosticError } from '../utils/diagnostics';
import { validateVideoMerge } from '../utils/mergeValidator';

class BackgroundServiceWorker {
  private state: WorkflowState = {
    config: {
      workflowId: `META-${Date.now()}`,
      initialPrompt: 'My Version of Title is:',
      masterPrompt: '',
      nextPartPromptTemplate: 'Please write Part {n} script now.',
      concurrencyLimit: 2,
      autoInsertNextPart: false,
      debugMode: false,
      scriptMode: 'original',
      competitorScriptEnabled: false,
      competitorScriptText: '',
      partWordCount: 4000
    },
    tabs: [],
    logs: [],
    isPaused: false,
    activeExecutionCount: 0,
    downloadManagerLoaded: false
  };

  private executionQueue: string[] = [];
  private isProcessingQueue = false;

  private readyPromise: Promise<void>;

  constructor() {
    this.setupListeners();
    this.readyPromise = this.init();
  }

  private setupListeners(): void {
    // Set up message listeners synchronously at the top level so Chrome never drops messages on worker wake-up or reload
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.readyPromise
        .then(() => this.handleMessage(message, sender))
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // Keep channel open for async response
    });

    // Monitor tab lifecycle events synchronously
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.readyPromise.then(() => this.handleTabClosed(tabId));
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status === 'complete') {
        this.readyPromise.then(() => this.handleTabLoaded(tabId));
      }
    });

    // Reconcile and re-inject open tabs on extension install, update, or reload
    chrome.runtime.onInstalled.addListener(() => {
      this.readyPromise.then(() => this.reconcileAndInjectTabs());
    });

    chrome.runtime.onStartup.addListener(() => {
      this.readyPromise.then(() => this.reconcileAndInjectTabs());
    });
  }

  private async init(): Promise<void> {
    // Load persisted state if available
    const saved = await loadWorkflowState();
    if (saved) {
      this.state = saved;
      // Preserve custom video ID numbering (do not reindex to V1..N)
      this.addLog('INFO', 'Restored previous workflow state from storage.');
    }

    // Enable side panel on action click if API supported
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
    }

    // Reconcile open tabs with restored state immediately on startup/reload
    await this.reconcileAndInjectTabs();
  }

  private async handleMessage(message: any, sender: chrome.runtime.MessageSender): Promise<any> {
    switch (message.type) {
      case 'GET_STATE': {
        return { success: true, state: this.state };
      }

      case 'SET_STATE': {
        this.state = { ...this.state, ...message.state };
        await this.persist();
        return { success: true, state: this.state };
      }

      case 'THUMBNAIL_UPLOAD_STARTED': {
        const tStarted = this.state.tabs.find((t) => t.id === message.vNumber);
        if (tStarted) {
          tStarted.thumbnailUploading = true;
          this.persist();
        }
        return { success: true };
      }

      case 'THUMBNAIL_UPLOAD_COMPLETE': {
        const tComplete = this.state.tabs.find((t) => t.id === message.vNumber);
        if (tComplete) {
          tComplete.thumbnailUploading = false;
          tComplete.thumbnailPasted = true;
          this.recalculateTabStatus(tComplete);
          this.persist();
        }
        return { success: true };
      }

      case 'GET_ACTIVE_META_TAB':
      case 'GET_ACTIVE_QWEN_TAB': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs[0];
        const isQwen = activeTab?.url && this.isMetaUrl(activeTab.url);
        return { success: true, tab: activeTab, isQwen, isMeta: isQwen };
      }

      case 'DUPLICATE_CHATS': {
        return await this.duplicateChats(
          message.count,
          message.initialText,
          message.startVideoId,
          message.endVideoId,
          message.explicitVideoIds
        );
      }

      case 'UPDATE_CONFIG': {
        this.state.config = { ...this.state.config, ...message.config };
        await this.persist();
        return { success: true, config: this.state.config };
      }

      case 'SELECT_TABS': {
        const { tabIds, selected } = message;
        this.state.tabs.forEach((t) => {
          if (tabIds.includes(t.id)) {
            t.selected = selected;
          }
        });
        await this.persist();
        return { success: true, tabs: this.state.tabs };
      }

      case 'SELECT_RANGE': {
        const { startIndex, endIndex } = message;
        this.state.tabs.forEach((t, idx) => {
          const pos = idx + 1;
          t.selected = (t.index >= startIndex && t.index <= endIndex) || (pos >= startIndex && pos <= endIndex);
        });
        await this.persist();
        return { success: true, tabs: this.state.tabs };
      }

      case 'ASSIGN_TITLES': {
        return await this.assignTitles(message.titles, message.startIndex, message.endIndex);
      }

      case 'SET_MASTER_PROMPT': {
        const { prompt, target } = message;
        this.state.config.masterPrompt = prompt;
        this.state.tabs.forEach((t) => {
          if (target === 'all' || t.selected) {
            t.masterPrompt = prompt;
            this.recalculateTabStatus(t);
          }
        });
        this.addLog('SUCCESS', `Master prompt applied to ${target === 'all' ? 'all' : 'selected'} tabs.`);
        await this.persist();
        return { success: true, tabs: this.state.tabs };
      }

      case 'ASSIGN_THUMBNAILS': {
        message.assets.forEach((item: { vNumber: string; assetId: string; name: string }) => {
          const tab = this.state.tabs.find((t) => t.id === item.vNumber);
          if (tab) {
            tab.thumbnailId = item.assetId;
            tab.thumbnailName = item.name;
            tab.thumbnailStatus = 'assigned';
            this.recalculateTabStatus(tab);
          }
        });
        this.addLog('SUCCESS', `Thumbnails mapped to ${message.assets.length} tabs.`);
        await this.persist();
        return { success: true, tabs: this.state.tabs };
      }

      case 'ASSIGN_SCRIPTS': {
        message.assets.forEach((item: { vNumber: string; assetId: string; name: string }) => {
          const tab = this.state.tabs.find((t) => t.id === item.vNumber);
          if (tab) {
            tab.scriptId = item.assetId;
            tab.scriptName = item.name;
            tab.scriptStatus = 'assigned';
            this.recalculateTabStatus(tab);
          }
        });
        this.addLog('SUCCESS', `Scripts mapped to ${message.assets.length} tabs.`);
        await this.persist();
        return { success: true, tabs: this.state.tabs };
      }

      case 'RUN_EXECUTION': {
        return await this.startExecution(message.target);
      }

      case 'PAUSE_EXECUTION': {
        this.state.isPaused = true;
        this.addLog('WARNING', 'Execution paused by user.');
        await this.persist();
        return { success: true };
      }

      case 'RESUME_EXECUTION': {
        this.state.isPaused = false;
        this.addLog('INFO', 'Execution resumed.');
        this.processQueue();
        await this.persist();
        return { success: true };
      }

      case 'STOP_EXECUTION': {
        this.state.isPaused = false;
        this.executionQueue = [];
        this.state.tabs.forEach((t) => {
          if (t.status === 'running') t.status = 'ready';
        });
        this.addLog('WARNING', 'Execution stopped.');
        await this.persist();
        return { success: true };
      }

      case 'RETRY_TAB': {
        return await this.retryTab(message.vNumber);
      }

      case 'RETRY_PART': {
        return await this.retryPart(message.vNumber, message.partNumber);
      }

      case 'LOAD_DOWNLOAD_MANAGER': {
        this.state.downloadManagerLoaded = true;
        this.addLog('SUCCESS', 'Loaded all synchronized script parts into Download Manager.');
        await this.persist();
        return { success: true };
      }

      case 'CLEAR_DOWNLOAD_MANAGER': {
        this.state.downloadManagerLoaded = false;
        await this.persist();
        return { success: true };
      }

      case 'SET_SCRIPT_MODE': {
        const mode = message.mode === 'competitor' ? 'competitor' : 'original';
        this.state.config.scriptMode = mode;
        this.state.config.competitorScriptEnabled = (mode === 'competitor');
        this.state.tabs.forEach((t) => {
          t.scriptMode = mode;
          t.scriptOptional = (mode === 'original');
          this.recalculateTabStatus(t);
        });
        this.addLog(
          'INFO',
          `Script Mode set to ${mode === 'original' ? 'Original Script Mode' : 'Competitor Script Mode'}.`
        );
        await this.persist();
        return { success: true, config: this.state.config, scriptMode: mode };
      }

      case 'SET_COMPETITOR_SCRIPT': {
        this.state.config.competitorScriptEnabled = message.enabled;
        if (message.text !== undefined) {
          this.state.config.competitorScriptText = message.text;
        }
        // When disabled, all tabs have scriptOptional = true
        this.state.tabs.forEach((t) => {
          t.scriptOptional = !message.enabled;
        });
        this.addLog(
          'INFO',
          message.enabled
            ? 'Optional Competitor Script input enabled.'
            : 'Competitor Script disabled (running normally without competitor script).'
        );
        await this.persist();
        return { success: true, config: this.state.config };
      }

      case 'SET_PART_WORD_COUNT': {
        const count = typeof message.wordCount === 'number' && message.wordCount > 0 ? message.wordCount : 4000;
        this.state.config.partWordCount = count;
        this.state.tabs.forEach((t) => {
          t.partWordCount = count;
        });
        this.addLog('INFO', `Part Word Count updated to ${count} words.`);
        await this.persist();
        return { success: true, partWordCount: count };
      }

      case 'SET_SCRIPT_OPTIONAL': {
        const sTab = this.state.tabs.find((t) => t.id === message.vNumber);
        if (sTab) {
          sTab.scriptOptional = message.optional;
          await this.persist();
        }
        return { success: true };
      }

      case 'INSERT_NEXT_PART': {
        return await this.insertNextPart(message.vNumber, message.partNumber);
      }

      case 'CANCEL_TAB': {
        const vId = message.vNumber;
        this.executionQueue = this.executionQueue.filter((id) => id !== vId);
        const tab = this.state.tabs.find((t) => t.id === vId);
        if (tab) {
          tab.status = 'ready';
          this.addLog('WARNING', `Execution cancelled for ${vId}.`, vId);
          await this.persist();
        }
        return { success: true };
      }

      case 'RESTART_TAB': {
        const vId = message.vNumber;
        const tab = this.state.tabs.find((t) => t.id === vId);
        if (tab) {
          tab.status = 'ready';
          tab.parts = [];
          tab.totalParts = 0;
          tab.currentPart = 1;
          tab.error = null;
          this.recalculateTabStatus(tab);
          if (!this.executionQueue.includes(vId)) {
            this.executionQueue.push(vId);
          }
          this.addLog('INFO', `Restarted ${vId} from beginning. Queued for execution.`, vId);
          this.processQueue();
          await this.persist();
        }
        return { success: true };
      }

      case 'REFRESH_TAB': {
        const vId = message.vNumber;
        const tab = this.state.tabs.find((t) => t.id === vId);
        if (tab && tab.chromeTabId) {
          const isAlive = await new Promise<boolean>((resolve) => {
            chrome.tabs.sendMessage(tab.chromeTabId!, { type: 'PING' }, (resp) => {
              resolve(!chrome.runtime.lastError && resp && resp.pong);
            });
            setTimeout(() => resolve(false), 200);
          });
          if (!isAlive) {
            await chrome.scripting.executeScript({
              target: { tabId: tab.chromeTabId },
              files: ['content.js']
            }).catch(() => {});
            await chrome.scripting.insertCSS({
              target: { tabId: tab.chromeTabId },
              files: ['floatingPanel.css']
            }).catch(() => {});
          } else {
            chrome.tabs.sendMessage(tab.chromeTabId, { type: 'SCAN_DOM_NOW', tab }).catch(() => {});
          }
          this.addLog('INFO', `Re-synced state for ${vId} in-place (no page reload).`, vId);
        }
        return { success: true };
      }

      case 'REFRESH_ALL_TABS':
      case 'RESYNC_ALL_TABS': {
        const tabs = await this.resyncAllTabs();
        return { success: true, tabs };
      }

      case 'REMOVE_TAB': {
        const vId = message.vNumber;
        this.executionQueue = this.executionQueue.filter((id) => id !== vId);
        this.state.tabs = this.state.tabs.filter((t) => t.id !== vId);
        this.reindexTabs();
        this.addLog('INFO', `Removed ${vId} from dashboard. Reindexed remaining tabs to V1..V${this.state.tabs.length}.`);
        await this.persist();
        return { success: true, tabs: this.state.tabs };
      }

      case 'CLEAR_COMPLETED_TABS': {
        const before = this.state.tabs.length;
        this.state.tabs = this.state.tabs.filter((t) => t.status !== 'completed');
        this.reindexTabs();
        this.addLog('INFO', `Cleared ${before - this.state.tabs.length} completed tabs. Reindexed remaining to V1..V${this.state.tabs.length}.`);
        await this.persist();
        return { success: true, tabs: this.state.tabs };
      }

      case 'CLEAR_CLOSED_TABS': {
        const allTabs = await chrome.tabs.query({});
        const openTabIds = new Set(allTabs.map((t) => t.id));
        const before = this.state.tabs.length;
        this.state.tabs = this.state.tabs.filter((t) => t.chromeTabId && openTabIds.has(t.chromeTabId));
        this.reindexTabs();
        this.addLog('INFO', `Cleared ${before - this.state.tabs.length} closed tabs. Reindexed remaining to V1..V${this.state.tabs.length}.`);
        await this.persist();
        return { success: true, tabs: this.state.tabs };
      }

      case 'REINDEX_TABS': {
        this.reindexTabs();
        this.addLog('INFO', `Renumbered all tabs sequentially (V1..V${this.state.tabs.length}).`);
        await this.persist();
        return { success: true, tabs: this.state.tabs };
      }

      case 'BATCH_TAB_ACTION': {
        const { action, tabIds } = message;
        const targetTabs = this.state.tabs.filter((t) => tabIds.includes(t.id));

        if (action === 'restart') {
          for (const tab of targetTabs) {
            tab.status = 'ready';
            tab.parts = [];
            tab.totalParts = 0;
            tab.currentPart = 1;
            tab.error = null;
            this.recalculateTabStatus(tab);
            if (!this.executionQueue.includes(tab.id)) {
              this.executionQueue.push(tab.id);
            }
          }
          this.addLog('INFO', `Restarted ${targetTabs.length} selected tabs from Part 1.`);
          this.processQueue();
        } else if (action === 'retry') {
          const failed = targetTabs.filter((t) => t.status === 'error' || t.status === 'incomplete');
          for (const tab of failed) {
            tab.error = null;
            this.recalculateTabStatus(tab);
            if (!this.executionQueue.includes(tab.id)) {
              this.executionQueue.push(tab.id);
            }
          }
          this.addLog('INFO', `Retried ${failed.length} selected tabs.`);
          this.processQueue();
        } else if (action === 'refresh') {
          for (const tab of targetTabs) {
            if (tab.chromeTabId) {
              const isAlive = await new Promise<boolean>((resolve) => {
                chrome.tabs.sendMessage(tab.chromeTabId!, { type: 'PING' }, (resp) => {
                  resolve(!chrome.runtime.lastError && resp && resp.pong);
                });
                setTimeout(() => resolve(false), 200);
              });
              if (!isAlive) {
                await chrome.scripting.executeScript({
                  target: { tabId: tab.chromeTabId },
                  files: ['content.js']
                }).catch(() => {});
                await chrome.scripting.insertCSS({
                  target: { tabId: tab.chromeTabId },
                  files: ['floatingPanel.css']
                }).catch(() => {});
              } else {
                chrome.tabs.sendMessage(tab.chromeTabId, { type: 'SCAN_DOM_NOW', tab }).catch(() => {});
              }
            }
          }
          this.addLog('INFO', `Re-synced state in-place for ${targetTabs.length} selected tabs.`);
        } else if (action === 'cancel') {
          this.executionQueue = this.executionQueue.filter((id) => !tabIds.includes(id));
          for (const tab of targetTabs) {
            if (tab.status === 'running') {
              tab.status = 'ready';
            }
          }
          this.addLog('WARNING', `Cancelled execution for ${targetTabs.length} selected tabs.`);
        } else if (action === 'remove') {
          this.executionQueue = this.executionQueue.filter((id) => !tabIds.includes(id));
          this.state.tabs = this.state.tabs.filter((t) => !tabIds.includes(t.id));
          this.reindexTabs();
          this.addLog('INFO', `Removed ${targetTabs.length} selected tabs. Reindexed remaining tabs to V1..V${this.state.tabs.length}.`);
        }

        await this.persist();
        return { success: true, tabs: this.state.tabs };
      }

      case 'PUSH_TITLES_TO_CHATS':
      case 'STAGE_PASTE_PROMPTS': {
        const target = message.target || 'all';
        const targetTabs = this.getTargetTabs(target);
        let count = 0;
        for (const tab of targetTabs) {
          if (tab.chromeTabId) {
            tab.titleInjected = Boolean(tab.title);
            tab.promptInjected = Boolean(tab.masterPrompt || this.state.config.masterPrompt);
            this.recalculateTabStatus(tab);
            chrome.tabs.sendMessage(tab.chromeTabId, {
              type: 'PASTE_PROMPT_ONLY',
              title: tab.title,
              masterPrompt: tab.masterPrompt || this.state.config.masterPrompt,
              vNumber: tab.id
            }).catch(() => {});
            chrome.tabs.sendMessage(tab.chromeTabId, { type: 'UPDATE_HUD', tab }).catch(() => {});
            count++;
          }
        }
        this.addLog('INFO', `Stage 1 / Push Titles: Injected into ${count} Qwen chat inputs (${target}).`);
        await this.persist();
        return { success: true, count, tabs: this.state.tabs };
      }

      case 'PUSH_PROMPT_TO_CHATS': {
        const target = message.target || 'all';
        const targetTabs = this.getTargetTabs(target);
        let count = 0;
        for (const tab of targetTabs) {
          if (tab.chromeTabId) {
            tab.promptInjected = true;
            this.recalculateTabStatus(tab);
            chrome.tabs.sendMessage(tab.chromeTabId, {
              type: 'PASTE_PROMPT_ONLY',
              title: tab.title,
              masterPrompt: tab.masterPrompt || this.state.config.masterPrompt,
              vNumber: tab.id
            }).catch(() => {});
            chrome.tabs.sendMessage(tab.chromeTabId, { type: 'UPDATE_HUD', tab }).catch(() => {});
            count++;
          }
        }
        this.addLog('INFO', `Push Prompt: Injected master prompt into ${count} Qwen chats (${target}).`);
        await this.persist();
        return { success: true, count, tabs: this.state.tabs };
      }

      case 'PUSH_THUMBNAILS_TO_CHATS':
      case 'STAGE_PASTE_THUMBNAILS': {
        const target = message.target || 'all';
        const targetTabs = this.getTargetTabs(target);
        let count = 0;
        for (const tab of targetTabs) {
          if (tab.chromeTabId && tab.thumbnailId) {
            const assetRecord = await getAssetBlob(tab.thumbnailId);
            if (assetRecord) {
              const base64 = await this.blobToBase64(assetRecord.blob);
              tab.thumbnailPasted = true;
              this.recalculateTabStatus(tab);
              chrome.tabs.sendMessage(tab.chromeTabId, {
                type: 'PASTE_THUMBNAIL_ONLY',
                thumbnail: {
                  name: assetRecord.asset.name || `${tab.id}_thumb`,
                  type: assetRecord.asset.type,
                  base64
                },
                vNumber: tab.id
              }).catch(() => {});
              chrome.tabs.sendMessage(tab.chromeTabId, { type: 'UPDATE_HUD', tab }).catch(() => {});
              count++;
            }
          }
        }
        this.addLog('INFO', `Stage 2 / Push Thumbnails: Dispatched clipboard paste to ${count} Qwen chats (${target}).`);
        await this.persist();
        return { success: true, count, tabs: this.state.tabs };
      }

      case 'PUSH_SCRIPTS_TO_CHATS':
      case 'STAGE_PASTE_SCRIPTS': {
        const target = message.target || 'all';
        const targetTabs = this.getTargetTabs(target);
        let count = 0;
        for (const tab of targetTabs) {
          if (!tab.chromeTabId) continue;
          let scriptContent = '';
          let scriptName = `${tab.id}_script.txt`;

          if (tab.scriptId) {
            const assetRecord = await getAssetBlob(tab.scriptId);
            if (assetRecord) {
              scriptContent = await assetRecord.blob.text();
              scriptName = assetRecord.asset.name || scriptName;
            }
          } else if (this.state.config.competitorScriptEnabled && this.state.config.competitorScriptText?.trim()) {
            scriptContent = this.state.config.competitorScriptText.trim();
            scriptName = `${tab.id}_Competitor_Script.txt`;
          }

          if (scriptContent) {
            tab.scriptInjected = true;
            this.recalculateTabStatus(tab);
            chrome.tabs.sendMessage(tab.chromeTabId, {
              type: 'PASTE_SCRIPT_ONLY',
              script: {
                name: scriptName,
                content: scriptContent
              },
              vNumber: tab.id
            }).catch(() => {});
            chrome.tabs.sendMessage(tab.chromeTabId, { type: 'UPDATE_HUD', tab }).catch(() => {});
            count++;
          }
        }
        this.addLog('INFO', `Stage 3 / Push Scripts: Embedded competitor scripts into ${count} Qwen chats (${target}).`);
        await this.persist();
        return { success: true, count, tabs: this.state.tabs };
      }

      case 'PUSH_ALL_ASSETS_TO_CHATS': {
        const target = message.target || 'all';
        const targetTabs = this.getTargetTabs(target);
        let count = 0;
        for (const tab of targetTabs) {
          if (!tab.chromeTabId) continue;

          // 1. Push Title & Prompt
          tab.titleInjected = Boolean(tab.title);
          tab.promptInjected = Boolean(tab.masterPrompt || this.state.config.masterPrompt);
          chrome.tabs.sendMessage(tab.chromeTabId, {
            type: 'PASTE_PROMPT_ONLY',
            title: tab.title,
            masterPrompt: tab.masterPrompt || this.state.config.masterPrompt,
            vNumber: tab.id
          }).catch(() => {});

          // 2. Push Thumbnail
          if (tab.thumbnailId) {
            const assetRecord = await getAssetBlob(tab.thumbnailId);
            if (assetRecord) {
              const base64 = await this.blobToBase64(assetRecord.blob);
              tab.thumbnailPasted = true;
              chrome.tabs.sendMessage(tab.chromeTabId, {
                type: 'PASTE_THUMBNAIL_ONLY',
                thumbnail: {
                  name: assetRecord.asset.name || `${tab.id}_thumb`,
                  type: assetRecord.asset.type,
                  base64
                },
                vNumber: tab.id
              }).catch(() => {});
            }
          }

          // 3. Push Competitor Script
          if (tab.scriptId) {
            const assetRecord = await getAssetBlob(tab.scriptId);
            if (assetRecord) {
              const scriptContent = await assetRecord.blob.text();
              tab.scriptInjected = true;
              chrome.tabs.sendMessage(tab.chromeTabId, {
                type: 'PASTE_SCRIPT_ONLY',
                script: {
                  name: assetRecord.asset.name || `${tab.id}_script.txt`,
                  content: scriptContent
                },
                vNumber: tab.id
              }).catch(() => {});
            }
          }

          this.recalculateTabStatus(tab);
          chrome.tabs.sendMessage(tab.chromeTabId, { type: 'UPDATE_HUD', tab }).catch(() => {});
          count++;
        }

        this.addLog('INFO', `All Pushing: Pushed all 4 assets into ${count} Qwen chats (${target}).`);
        await this.persist();
        return { success: true, count, tabs: this.state.tabs };
      }

      case 'STAGE_RUN_ALL_PACED': {
        const target = message.target || 'all';
        return await this.startExecution(target);
      }

      case 'CLEAR_TITLES': {
        this.state.tabs.forEach((t) => {
          t.title = '';
          this.recalculateTabStatus(t);
        });
        this.addLog('INFO', 'Cleared all assigned titles.');
        await this.persist();
        return { success: true, tabs: this.state.tabs };
      }

      case 'CLEAR_PROMPT': {
        this.state.config.masterPrompt = '';
        this.state.tabs.forEach((t) => {
          t.masterPrompt = '';
          this.recalculateTabStatus(t);
        });
        this.addLog('INFO', 'Cleared Master Prompt.');
        await this.persist();
        return { success: true, tabs: this.state.tabs };
      }

      case 'CLEAR_THUMBNAILS': {
        this.state.tabs.forEach((t) => {
          t.thumbnailId = undefined;
          t.thumbnailName = undefined;
          t.thumbnailStatus = 'none';
          this.recalculateTabStatus(t);
        });
        this.addLog('INFO', 'Cleared all assigned thumbnails.');
        await this.persist();
        return { success: true, tabs: this.state.tabs };
      }

      case 'CLEAR_SCRIPTS': {
        this.state.tabs.forEach((t) => {
          t.scriptId = undefined;
          t.scriptName = undefined;
          t.scriptStatus = 'none';
          this.recalculateTabStatus(t);
        });
        this.addLog('INFO', 'Cleared all assigned scripts.');
        await this.persist();
        return { success: true, tabs: this.state.tabs };
      }

      case 'CLEAR_LOGS': {
        this.state.logs = [];
        await this.persist();
        return { success: true };
      }

      case 'RESET_WORKFLOW': {
        if (message.mode === 'all') {
          this.state.tabs = [];
          this.state.logs = [];
          this.state.config.masterPrompt = '';
          this.state.config.initialPrompt = '';
        } else {
          this.state.tabs.forEach((t) => {
            t.status = 'uninitialized';
            t.parts = [];
            t.totalParts = 0;
            t.currentPart = 1;
            t.error = null;
            this.recalculateTabStatus(t);
          });
        }
        this.addLog('INFO', `Workflow reset (${message.mode}).`);
        await this.persist();
        return { success: true, state: this.state };
      }

      case 'CONTENT_TAB_READY': {
        const chromeTabId = sender.tab?.id;
        if (chromeTabId) {
          let tab: VTab | undefined;

          // 1. If explicit video marker was detected in the tab DOM (e.g. "V6" or "V20")
          if (message.detectedVideoNumber) {
            const targetId = `V${message.detectedVideoNumber}`;

            // Unlink any other tab currently holding this chromeTabId
            this.state.tabs.forEach((t) => {
              if (t.chromeTabId === chromeTabId && t.id !== targetId) {
                t.chromeTabId = null;
              }
            });

            tab = this.state.tabs.find((t) => t.id === targetId);
            if (!tab) {
              tab = {
                id: targetId,
                index: message.detectedVideoNumber,
                title: '',
                masterPrompt: this.state.config.masterPrompt || '',
                qwenUrl: 'https://chat.qwen.ai',
                initialMessage: '',
                status: 'ready',
                currentPart: 1,
                totalParts: 0,
                parts: [],
                selected: false,
                chromeTabId,
                thumbnailStatus: 'none',
                scriptStatus: 'none',
                scriptMode: this.state.config.scriptMode || 'original',
                scriptOptional: (this.state.config.scriptMode || 'original') === 'original' || !this.state.config.competitorScriptEnabled,
                lastUpdated: Date.now()
              };
              this.state.tabs.push(tab);
            }
            tab.chromeTabId = chromeTabId;
            this.addLog('INFO', `Linked ${tab.id} to browser tab ${chromeTabId} via explicit marker`, tab.id);
            await this.persist();
            return { success: true, tab };
          }

          // 2. Try matching by existing chromeTabId
          tab = this.state.tabs.find((t) => t.chromeTabId === chromeTabId);

          // 3. If not matched, clear dead tabs and assign first free tab
          if (!tab) {
            const allTabs = await chrome.tabs.query({});
            const liveTabIds = new Set(allTabs.map((at) => at.id));
            this.state.tabs.forEach((t) => {
              if (t.chromeTabId && !liveTabIds.has(t.chromeTabId)) {
                t.chromeTabId = null;
              }
            });

            tab = this.state.tabs.find((t) => !t.chromeTabId);
            if (tab) {
              tab.chromeTabId = chromeTabId;
              this.addLog('INFO', `Linked ${tab.id} to browser tab ${chromeTabId}`, tab.id);
              await this.persist();
            } else if (this.state.tabs.length === 0) {
              const newTab: VTab = {
                id: 'V1',
                index: 1,
                title: '',
                masterPrompt: this.state.config.masterPrompt || '',
                qwenUrl: 'https://chat.qwen.ai',
                initialMessage: '',
                status: 'ready',
                currentPart: 1,
                totalParts: 0,
                parts: [],
                selected: false,
                chromeTabId,
                thumbnailStatus: 'none',
                scriptStatus: 'none',
                scriptMode: this.state.config.scriptMode || 'original',
                scriptOptional: (this.state.config.scriptMode || 'original') === 'original' || !this.state.config.competitorScriptEnabled,
                lastUpdated: Date.now()
              };
              tab = newTab;
              this.state.tabs.push(tab);
              this.addLog('INFO', `Auto-registered V1 for browser tab ${chromeTabId}`, 'V1');
              await this.persist();
            }
          }

          if (tab) {
            return { success: true, tab };
          }
        }
        return { success: true, tab: null };
      }

      case 'REASSIGN_TAB_VNUMBER': {
        const chromeTabId = sender.tab?.id;
        const newVNum = message.toVideoNumber || parseInt((message.toVNumber || '').replace(/\D/g, ''), 10);
        if (newVNum && chromeTabId) {
          const targetId = `V${newVNum}`;
          
          // Unlink any tab currently holding chromeTabId that isn't targetId
          this.state.tabs.forEach((t) => {
            if (t.chromeTabId === chromeTabId && t.id !== targetId) {
              t.chromeTabId = null;
            }
          });

          let targetTab = this.state.tabs.find((t) => t.id === targetId);
          if (!targetTab) {
            targetTab = {
              id: targetId,
              index: newVNum,
              title: '',
              masterPrompt: this.state.config.masterPrompt || '',
              qwenUrl: 'https://chat.qwen.ai',
              initialMessage: '',
              status: 'ready',
              currentPart: 1,
              totalParts: 0,
              parts: [],
              selected: false,
              chromeTabId,
              thumbnailStatus: 'none',
              scriptStatus: 'none',
              scriptMode: this.state.config.scriptMode || 'original',
              scriptOptional: (this.state.config.scriptMode || 'original') === 'original' || !this.state.config.competitorScriptEnabled,
              lastUpdated: Date.now()
            };
            this.state.tabs.push(targetTab);
          }
          targetTab.chromeTabId = chromeTabId;
          this.addLog('INFO', `Re-assigned browser tab ${chromeTabId} from ${message.fromVNumber || 'unknown'} to ${targetTab.id}`, targetTab.id);
          await this.persist();
          return { success: true, tab: targetTab };
        }
        return { success: false };
      }

      case 'CONTENT_OUTLINE_DETECTED': {
        const tab = this.state.tabs.find((t) => t.id === message.vNumber);
        if (tab) {
          tab.outlineDetected = true;
          if (message.outlineContent) tab.outlineContent = message.outlineContent;
          if (message.outlineStatus) tab.outlineStatus = message.outlineStatus;
          if (message.outlinePartInstructions) tab.outlinePartInstructions = message.outlinePartInstructions;
          if (message.lifecycleStage) tab.lifecycleStage = message.lifecycleStage;
          if (message.liveDebugStatus) tab.liveDebugStatus = message.liveDebugStatus;
          if (!tab.manualOverride && message.totalParts) {
            tab.totalParts = message.totalParts;
          }
          this.addLog(
            'INFO',
            `${tab.id}: [OUTLINE] Outline detected (${tab.totalParts} total parts planned). Outline status: ${tab.outlineStatus || 'completed'}.`,
            tab.id
          );
          await this.persist();
        }
        return { success: true };
      }

      case 'OVERRIDE_TAB_PARTS': {
        const tab = this.state.tabs.find((t) => t.id === message.vNumber);
        if (tab) {
          if (message.totalParts) tab.totalParts = message.totalParts;
          if (message.currentPart) tab.currentPart = message.currentPart;
          if (typeof message.outlineDetected === 'boolean') {
            tab.outlineDetected = message.outlineDetected;
          }
          tab.manualOverride = true;

          if (!tab.parts) tab.parts = [];
          for (let p = 1; p <= tab.totalParts; p++) {
            if (!tab.parts.some((x) => x.partNumber === p)) {
              const vNum = parseInt(tab.id.replace(/\D/g, ''), 10) || 1;
              tab.parts.push({
                partNumber: p,
                label: `${tab.id} P${p}`,
                explicitMarker: `${tab.id} P${p}`,
                videoNumber: vNum,
                status: p < tab.currentPart ? 'done' : p === tab.currentPart ? 'ready' : 'waiting',
                content: '',
                downloaded: false
              });
            }
          }
          // Prune phantom parts exceeding overridden totalParts unless already done with content
          tab.parts = tab.parts.filter(
            (p) => p.partNumber <= tab.totalParts || (p.status === 'done' && p.content && p.content.trim())
          );
          tab.parts.sort((a, b) => a.partNumber - b.partNumber);

          const val = validateVideoMerge(tab);
          tab.mergeValidationStatus = val.valid ? 'valid' : 'invalid';

          this.addLog(
            'INFO',
            `[MANUAL] ${tab.id}: Manual override applied. Total Parts = ${tab.totalParts}, Current Part = ${tab.currentPart}, Outline = ${tab.outlineDetected ? 'Generated ✓' : 'None'}.`,
            tab.id
          );
          await this.persist();
        }
        return { success: true };
      }

      case 'CONTENT_PART_DETECTED': {
        const tab = this.state.tabs.find((t) => t.id === message.vNumber);
        if (tab) {
          if (!tab.manualOverride && message.totalParts && message.totalParts > 0) {
            tab.totalParts = message.totalParts;
            // Prune phantom parts exceeding detected totalParts
            if (tab.parts && tab.parts.length > 0) {
              tab.parts = tab.parts.filter(
                (p) => p.partNumber <= tab.totalParts || (p.status === 'done' && p.content && p.content.trim())
              );
            }
          }
          if (!tab.parts) tab.parts = [];

          if (message.missingParts) tab.missingParts = message.missingParts;
          if (message.duplicateParts) tab.duplicateParts = message.duplicateParts;
          if (message.detectedVideoNumber) tab.detectedVideoNumber = message.detectedVideoNumber;
          if (message.lifecycleStage) tab.lifecycleStage = message.lifecycleStage;
          if (message.liveDebugStatus) tab.liveDebugStatus = message.liveDebugStatus;

          // Merge parts without losing existing completed content!
          for (const newPart of (message.parts || [])) {
            const existing = tab.parts.find((p) => p.partNumber === newPart.partNumber);
            if (existing) {
              if (newPart.content && newPart.content.trim()) {
                existing.content = newPart.content;
              }
              if (newPart.heading) {
                existing.heading = newPart.heading;
              }
              if (newPart.explicitMarker) {
                existing.explicitMarker = newPart.explicitMarker;
              }
              if (newPart.videoNumber) {
                existing.videoNumber = newPart.videoNumber;
              }
              if (existing.status === 'done' && newPart.status !== 'done') {
                // Keep 'done'
              } else {
                existing.status = newPart.status;
              }
            } else {
              tab.parts.push({ ...newPart });
            }
          }

          tab.parts.sort((a, b) => a.partNumber - b.partNumber);

          const val = validateVideoMerge(tab);
          tab.mergeValidationStatus = val.valid ? 'valid' : 'invalid';
          if (val.valid) {
            tab.status = 'completed';
          }
          this.recalculateTabStatus(tab);

          // Log warning if missing parts detected
          if (tab.missingParts && tab.missingParts.length > 0) {
            const missingStr = tab.missingParts.map((n) => `${tab.id} P${n}`).join(', ');
            this.addLog('WARNING', `${tab.id}: MISSING: ${missingStr}`, tab.id);
          }
          // Log warning if duplicate parts detected
          if (tab.duplicateParts && tab.duplicateParts.length > 0) {
            const dupStr = tab.duplicateParts.map((n) => `${tab.id} P${n}`).join(', ');
            this.addLog('WARNING', `${tab.id}: DUPLICATE: ${dupStr}`, tab.id);
          }

          await this.persist();
        }
        return { success: true };
      }

      case 'CONTENT_PART_COMPLETED': {
        const tab = this.state.tabs.find((t) => t.id === message.vNumber);
        if (tab) {
          let part = tab.parts.find((p) => p.partNumber === message.partNumber);
          if (!part) {
            part = {
              partNumber: message.partNumber,
              label: message.explicitMarker || `${tab.id} P${message.partNumber}`,
              explicitMarker: message.explicitMarker,
              videoNumber: message.videoNumber,
              heading: message.heading,
              status: 'done',
              content: message.content,
              extractedAt: Date.now(),
              downloaded: false
            };
            tab.parts.push(part);
          } else {
            part.status = 'done';
            if (message.content && message.content.trim()) {
              part.content = message.content;
            }
            if (message.heading) {
              part.heading = message.heading;
            }
            if (message.explicitMarker) {
              part.explicitMarker = message.explicitMarker;
            }
            if (message.videoNumber) {
              part.videoNumber = message.videoNumber;
            }
            part.extractedAt = Date.now();
          }

          tab.parts.sort((a, b) => a.partNumber - b.partNumber);

          const nextPart = tab.parts.find((p) => p.partNumber === message.partNumber + 1);
          if (nextPart && nextPart.status === 'waiting') {
            nextPart.status = 'ready';
          }

          // Strict validation before marking tab complete
          const val = validateVideoMerge(tab);
          tab.mergeValidationStatus = val.valid ? 'valid' : 'invalid';

          if (val.valid) {
            tab.status = 'completed';
            this.addLog(
              'SUCCESS',
              `${tab.id}: All ${tab.totalParts} parts completed and verified. TXT MERGE VERIFIED ✓`,
              tab.id
            );
          } else {
            this.addLog(
              'SUCCESS',
              `${tab.id} Part ${message.partNumber} completed successfully.`,
              tab.id
            );
          }

          await this.persist();

          // Auto-insert next part if Auto Run toggle is enabled!
          if (this.state.config.autoInsertNextPart && nextPart && tab.chromeTabId) {
            this.addLog('INFO', `[AUTO] ${tab.id}: Auto Run toggle is ON. Automatically requesting Part ${nextPart.partNumber}...`, tab.id);
            setTimeout(() => this.insertNextPart(tab.id, nextPart.partNumber), 1500);
          } else if (nextPart) {
            this.addLog('INFO', `[MANUAL MODE] ${tab.id}: Part ${message.partNumber} completed. Ready for manual Alt-Tab submission of Part ${nextPart.partNumber} (or enable Auto Run toggle).`, tab.id);
          }
        }
        return { success: true };
      }

      case 'CONTENT_EXECUTION_ERROR': {
        const tab = this.state.tabs.find((t) => t.id === message.vNumber);
        if (tab) {
          tab.status = 'error';
          tab.error = message.error;
          this.addLog('ERROR', `${tab.id} error: ${message.error.problem}`, tab.id, message.error);
          await this.persist();
        }
        return { success: true };
      }

      case 'LOG_MESSAGE': {
        this.addLog(message.level, message.message, message.vNumber, message.error);
        await this.persist();
        return { success: true };
      }

      case 'DOWNLOAD_FILE': {
        return await this.downloadPartFile(message.vNumber, message.partNumber);
      }

      default:
        return { success: false, error: `Unknown action: ${message.type}` };
    }
  }

  /**
   * Duplicates tabs according to a specified Video ID range (e.g. V20 to V25) or count.
   * If startVideoId and endVideoId are provided, tabs strictly receive those IDs (e.g. V20, V21, V22...).
   */
  private async duplicateChats(
    count: number,
    initialText?: string,
    startVideoId?: number,
    endVideoId?: number,
    explicitVideoIds?: number[]
  ): Promise<any> {
    const isCustomMode = Boolean(explicitVideoIds && explicitVideoIds.length > 0);
    const targetVideoIds: number[] = isCustomMode
      ? Array.from(new Set(explicitVideoIds!)).sort((a, b) => a - b)
      : (() => {
          const s = startVideoId && startVideoId > 0 ? startVideoId : 1;
          const e = endVideoId && endVideoId >= s ? endVideoId : (s + Math.max(1, count) - 1);
          const ids: number[] = [];
          for (let i = s; i <= e; i++) ids.push(i);
          return ids;
        })();

    if (!isCustomMode && startVideoId && endVideoId && startVideoId > endVideoId) {
      return {
        success: false,
        error: `Validation Error: Start Video ID (V${startVideoId}) cannot be greater than End Video ID (V${endVideoId}).`
      };
    }

    if (targetVideoIds.length === 0) {
      return { success: false, error: 'Invalid Video ID range. Must create at least 1 tab.' };
    }

    const start = targetVideoIds[0];
    const end = targetVideoIds[targetVideoIds.length - 1];

    // Prune stale tabs outside targetVideoIds to prevent Ghost Tabs (e.g. V1-V10 lingering when V11-V20 created)
    const targetSet = new Set(targetVideoIds);
    this.state.tabs = this.state.tabs.filter((t) => targetSet.has(t.index));

    // Search for any existing open Meta.ai / Qwen tab across all windows
    const allTabs = await chrome.tabs.query({});
    const qwenTabs = allTabs.filter((t) => t.url && this.isMetaUrl(t.url));

    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = activeTabs[0];

    let targetQwenUrl = 'https://www.meta.ai/';
    let sourceQwenTab: chrome.tabs.Tab | null = null;

    if (activeTab && activeTab.url && this.isMetaUrl(activeTab.url)) {
      sourceQwenTab = activeTab;
      targetQwenUrl = activeTab.url;
    } else if (qwenTabs.length > 0) {
      sourceQwenTab = qwenTabs[0];
      targetQwenUrl = qwenTabs[0].url || 'https://www.meta.ai/';
    }

    // Try extracting draft text from existing Qwen tab if none provided in dashboard
    let finalInitialText = (initialText || '').trim();
    if (!finalInitialText && sourceQwenTab && sourceQwenTab.id) {
      try {
        const response = await chrome.tabs.sendMessage(sourceQwenTab.id, { type: 'GET_CURRENT_INPUT_TEXT' });
        if (response && response.text) {
          finalInitialText = response.text.trim();
        }
      } catch {
        // Content script might not be loaded yet
      }
    }
    if (!finalInitialText) {
      finalInitialText = this.state.config.initialPrompt || 'My Version of Title is:';
    }

    this.state.config.initialPrompt = finalInitialText;
    const createdTabs: VTab[] = [];

    // Check if sourceQwenTab is already bound to an existing VTab
    const isSourceAlreadyAssigned = sourceQwenTab && sourceQwenTab.id
      ? this.state.tabs.some((t) => t.chromeTabId === sourceQwenTab!.id)
      : true;

    let sourceTabAssigned = false;

    // Create / register tabs strictly for targetVideoIds
    for (const vIndex of targetVideoIds) {
      const vId = `V${vIndex}`;
      const existingTabIndex = this.state.tabs.findIndex((t) => t.id === vId || t.index === vIndex);

      let chromeTabId: number | null = null;

      // Assign first tab in batch to active Qwen tab if available and not yet assigned
      if (!sourceTabAssigned && !isSourceAlreadyAssigned && sourceQwenTab && sourceQwenTab.id) {
        chromeTabId = sourceQwenTab.id;
        sourceTabAssigned = true;
        this.addLog('INFO', `${vId} assigned to active Qwen tab (Tab ID: ${chromeTabId}).`, vId);
      } else {
        // Create a new Chrome tab for this V-number
        try {
          const newTab = await chrome.tabs.create({
            url: targetQwenUrl,
            active: false
          });
          chromeTabId = newTab.id || null;
          this.addLog('INFO', `${vId} opened (Meta Tab ID: ${chromeTabId}).`, vId);
        } catch (err: any) {
          this.addLog('ERROR', `Failed to open Meta tab for ${vId}: ${err.message}`, vId);
        }
      }

      const vTab: VTab = {
        id: vId,
        index: vIndex,
        chromeTabId,
        qwenUrl: targetQwenUrl,
        metaUrl: targetQwenUrl,
        status: 'incomplete',
        selected: true,
        initialMessage: finalInitialText,
        title: '',
        masterPrompt: this.state.config.masterPrompt,
        thumbnailStatus: 'none',
        scriptStatus: 'none',
        scriptMode: this.state.config.scriptMode || 'original',
        scriptOptional: (this.state.config.scriptMode || 'original') === 'original' || !this.state.config.competitorScriptEnabled,
        totalParts: 0,
        currentPart: 1,
        parts: [],
        lastUpdated: Date.now()
      };

      if (existingTabIndex >= 0) {
        this.state.tabs[existingTabIndex] = vTab;
      } else {
        this.state.tabs.push(vTab);
      }
      createdTabs.push(vTab);

      if (chromeTabId) {
        chrome.tabs.sendMessage(chromeTabId, { type: 'UPDATE_HUD', tab: vTab }).catch(() => {});
        if (finalInitialText) {
          this.scheduleInitialTextInjection(chromeTabId, finalInitialText);
        }
      }
    }

    // Sort tabs numerically by index so V10..V15 or V20..V25 are always in natural order
    this.state.tabs.sort((a, b) => a.index - b.index);

    const rangeLabel = isCustomMode
      ? targetVideoIds.map((id) => `V${id}`).join(', ')
      : `V${start}–V${end}`;
    this.addLog('SUCCESS', `Duplicated ${createdTabs.length} tabs for ${rangeLabel}.`);

    await this.persist();
    return { success: true, count: createdTabs.length, range: rangeLabel, tabs: this.state.tabs };
  }

  /**
   * Assigns titles to tabs sequentially or by explicit V-number marker.
   * Cuts off any excess titles beyond the selected range (below START or above END).
   */
  private async assignTitles(
    titles: string[],
    startIndex?: number,
    endIndex?: number
  ): Promise<any> {
    if (titles.length === 0) {
      return { success: false, error: 'No titles provided.' };
    }

    const start = startIndex || 1;
    const end = endIndex || (start + titles.length - 1);

    const targetTabs = this.state.tabs.filter((tab, idx) => {
      const pos = idx + 1;
      return (tab.index >= start && tab.index <= end) || (pos >= start && pos <= end);
    });

    const assignedTabs = new Set<string>();
    const unassignedTitles: string[] = [];

    // 1. First: Match titles with explicit V-number prefixes directly to their corresponding tabs
    for (const title of titles) {
      const match = title.trim().match(/^(?:\[?\s*[vV](\d+)\s*\]?|Video\s*(\d+))[\s.:\-_–—]*/i);
      if (match) {
        const vNum = parseInt(match[1] || match[2], 10);
        const matchedTab = targetTabs.find(
          (t) => (t.index === vNum || t.id === `V${vNum}`) && !assignedTabs.has(t.id)
        );
        if (matchedTab) {
          matchedTab.title = title;
          this.recalculateTabStatus(matchedTab);
          this.addLog('INFO', `Title assigned to ${matchedTab.id}: "${matchedTab.title}"`, matchedTab.id);
          assignedTabs.add(matchedTab.id);
          continue;
        }
      }
      unassignedTitles.push(title);
    }

    // 2. Second: For remaining target tabs without title, assign unassigned titles sequentially
    let unassignedIdx = 0;
    for (const tab of targetTabs) {
      if (!assignedTabs.has(tab.id) && unassignedIdx < unassignedTitles.length) {
        tab.title = unassignedTitles[unassignedIdx];
        this.recalculateTabStatus(tab);
        this.addLog('INFO', `Title assigned to ${tab.id}: "${tab.title}"`, tab.id);
        assignedTabs.add(tab.id);
        unassignedIdx++;
      }
    }

    this.addLog('INFO', `Assigned ${assignedTabs.size} titles to range V${start}–V${end}.`);

    await this.persist();
    return { success: true, tabs: this.state.tabs, assignedCount: assignedTabs.size };
  }

  /**
   * Starts execution queue for target tabs ('all', 'selected', or specific V ID).
   */
  private async startExecution(target: 'all' | 'selected' | string): Promise<any> {
    this.state.isPaused = false; // Always unpause execution

    const targetTabs = this.getTargetTabs(target);
    if (targetTabs.length === 0) {
      const msg = 'No active Qwen browser tabs found matching selection. Please ensure Qwen tabs are open.';
      this.addLog('WARNING', msg);
      return { success: false, error: msg };
    }

    // Auto-prepare: If any tab has assigned assets that haven't been pushed to chat yet,
    // automatically push them so they are verified and confirmed in the chat!
    for (const tab of targetTabs) {
      if (!tab.chromeTabId) continue;
      const globalPrompt = this.state.config.masterPrompt || '';
      if (!tab.masterPrompt && globalPrompt) {
        tab.masterPrompt = globalPrompt;
      }

      // Auto-push Title & Prompt if not yet injected
      if (tab.title && (!tab.titleInjected || !tab.promptInjected)) {
        tab.titleInjected = true;
        tab.promptInjected = true;
        chrome.tabs.sendMessage(tab.chromeTabId, {
          type: 'PASTE_PROMPT_ONLY',
          title: tab.title,
          masterPrompt: tab.masterPrompt || globalPrompt,
          vNumber: tab.id
        }).catch(() => {});
      }

      // Auto-push Thumbnail if assigned and not yet pasted
      if (tab.thumbnailId && !tab.thumbnailPasted) {
        const assetRecord = await getAssetBlob(tab.thumbnailId);
        if (assetRecord) {
          const base64 = await this.blobToBase64(assetRecord.blob);
          tab.thumbnailPasted = true;
          chrome.tabs.sendMessage(tab.chromeTabId, {
            type: 'PASTE_THUMBNAIL_ONLY',
            thumbnail: {
              name: assetRecord.asset.name || `${tab.id}_thumb`,
              type: assetRecord.asset.type,
              base64
            },
            vNumber: tab.id
          }).catch(() => {});
        }
      }

      // Auto-push Competitor Script if present and not yet embedded
      if (!tab.scriptInjected) {
        let scriptContent = '';
        let scriptName = `${tab.id}_script.txt`;

        if (tab.scriptId) {
          const assetRecord = await getAssetBlob(tab.scriptId);
          if (assetRecord) {
            scriptContent = await assetRecord.blob.text();
            scriptName = assetRecord.asset.name || scriptName;
          }
        } else if (this.state.config.competitorScriptEnabled && this.state.config.competitorScriptText?.trim()) {
          scriptContent = this.state.config.competitorScriptText.trim();
          scriptName = `${tab.id}_Competitor_Script.txt`;
        }

        if (scriptContent) {
          tab.scriptInjected = true;
          chrome.tabs.sendMessage(tab.chromeTabId, {
            type: 'PASTE_SCRIPT_ONLY',
            script: {
              name: scriptName,
              content: scriptContent
            },
            vNumber: tab.id
          }).catch(() => {});
        }
      }

      this.recalculateTabStatus(tab);
      chrome.tabs.sendMessage(tab.chromeTabId, { type: 'UPDATE_HUD', tab }).catch(() => {});
    }

    // Safety validation: Ensure Title and Prompt are assigned.
    // Thumbnail and Script are allowed if they have been uploaded (thumbnailId exists OR thumbnailPasted = true)
    // or if they were manually pasted via push buttons (thumbnailPasted / scriptInjected flags).
    const invalidTabs: { id: string; missing: string[] }[] = [];
    const isOriginalMode = (this.state.config.scriptMode || 'original') === 'original';
    const isScriptOptionActive = !isOriginalMode && Boolean(this.state.config.competitorScriptEnabled);
    const hasGlobalPastedScript = Boolean(this.state.config.competitorScriptText && this.state.config.competitorScriptText.trim());

    for (const tab of targetTabs) {
      const missing: string[] = [];
      if (!tab.title) missing.push('Title not assigned');
      if (!tab.masterPrompt && !this.state.config.masterPrompt) missing.push('Master Prompt missing');

      // Only block if NEITHER assigned via dashboard NOR already pasted into chat manually
      const thumbOk = tab.thumbnailId || tab.thumbnailPasted || tab.thumbnailStatus === 'assigned';
      
      // Competitor script check:
      // If original mode or competitor script is NOT enabled -> ALWAYS OK (not required)
      // If competitor script IS enabled -> OK if global pasted script exists, file assigned, or already injected
      const scriptOk =
        isOriginalMode ||
        !isScriptOptionActive ||
        tab.scriptOptional ||
        hasGlobalPastedScript ||
        tab.scriptId ||
        tab.scriptInjected ||
        tab.scriptStatus === 'assigned';

      if (!thumbOk) missing.push('Thumbnail image not uploaded or pasted into chat');
      if (!scriptOk) missing.push('Competitor script not provided (paste script or switch to Original Script Mode)');

      if (missing.length > 0) {
        tab.status = 'incomplete';
        invalidTabs.push({ id: tab.id, missing });
      } else {
        tab.status = 'ready';
      }
    }

    if (invalidTabs.length > 0) {
      const details = invalidTabs.map((it) => `${it.id}: [${it.missing.join('; ')}]`).join('\n');
      const errorMsg = isOriginalMode
        ? `Required assets missing for execution:\n\n${details}\n\nPlease assign Titles, Master Prompt, and Thumbnails before running.`
        : `Required assets missing for execution:\n\n${details}\n\nPlease upload Thumbnails and Competitor Scripts in the dashboard and push them to the Qwen chats before running.`;
      this.addLog('ERROR', `Cannot run: ${invalidTabs.length} tabs have missing files.`);
      await this.persist();
      return {
        success: false,
        error: errorMsg,
        invalidTabs
      };
    }

    // Enqueue valid tabs
    targetTabs.forEach((tab) => {
      if (!this.executionQueue.includes(tab.id)) {
        this.executionQueue.push(tab.id);
      }
    });

    this.addLog('INFO', `Enqueued ${targetTabs.length} tabs for execution. Starting queue now...`);
    this.processQueue();
    await this.persist();
    return { success: true, queuedCount: targetTabs.length };
  }

  /**
   * Concurrency-controlled execution queue processor.
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.state.isPaused) return;
    this.isProcessingQueue = true;

    try {
      while (
        this.executionQueue.length > 0 &&
        !this.state.isPaused &&
        this.state.activeExecutionCount < this.state.config.concurrencyLimit
      ) {
        const vId = this.executionQueue.shift();
        if (!vId) continue;

        const tab = this.state.tabs.find((t) => t.id === vId);
        if (!tab || !tab.chromeTabId) continue;

        // VISUALLY SWITCH TO THE TAB to mimic human behavior and wake up DOM
        try {
          await chrome.tabs.update(tab.chromeTabId, { active: true });
          const chromeTab = await chrome.tabs.get(tab.chromeTabId);
          await chrome.windows.update(chromeTab.windowId, { focused: true });
        } catch (err) {
          this.addLog('WARNING', `Could not switch to tab ${vId}, it might be closed.`, vId);
        }

        // Wait a short moment (1s) for the browser to render the tab actively
        await new Promise((r) => setTimeout(r, 1000));

        this.state.activeExecutionCount++;

        this.runSingleTab(tab).finally(() => {
          this.state.activeExecutionCount--;
          this.processQueue();
        });

        // Human Pacing: Wait 5-15s before moving to the next tab in the queue
        // This simulates a human clicking send, watching it start, then moving to the next tab.
        const humanDelay = Math.floor(5000 + Math.random() * 10000);
        this.addLog('INFO', `Human Pacing: Waiting ${(humanDelay / 1000).toFixed(1)}s before navigating to next tab...`, vId);
        await new Promise((r) => setTimeout(r, humanDelay));
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Executes a single tab workflow: loads assets, sends payload to content script.
   */
  private async runSingleTab(tab: VTab): Promise<void> {
    tab.status = 'running';
    tab.error = null;
    this.addLog('INFO', `${tab.id} starting execution...`, tab.id);
    await this.persist();

    // Verify Chrome tab exists
    if (!tab.chromeTabId) {
      tab.status = 'error';
      tab.error = createDiagnosticError('TAB_NOT_FOUND', { vNumber: tab.id });
      this.addLog('ERROR', `${tab.id} has no Chrome Tab ID.`, tab.id, tab.error);
      await this.persist();
      return;
    }

    try {
      // Send SUBMIT payload to content script (chat is already primed by startExecution or manual pushes)
      await chrome.tabs.sendMessage(tab.chromeTabId, {
        type: 'SUBMIT_CHAT_ONLY',
        vNumber: tab.id
      });
    } catch (err: any) {
      tab.status = 'error';
      tab.error = createDiagnosticError('CUSTOM', {
        title: `${tab.id} Execution Failed`,
        problem: err.message,
        vNumber: tab.id
      });
      this.addLog('ERROR', `${tab.id} run error: ${err.message}`, tab.id, tab.error);
      await this.persist();
    }
  }

  /**
   * Retries execution for a failed tab.
   */
  private async retryTab(vId: string): Promise<any> {
    const tab = this.state.tabs.find((t) => t.id === vId);
    if (!tab) return { success: false, error: `Tab ${vId} not found.` };

    tab.status = 'ready';
    tab.error = null;
    if (!this.executionQueue.includes(vId)) {
      this.executionQueue.push(vId);
    }
    this.addLog('INFO', `Retry queued for ${vId}.`, vId);
    this.processQueue();
    await this.persist();
    return { success: true };
  }

  /**
   * Retries a single specific part for a tab.
   * Switches to the tab, then inserts and runs that part exactly like normal generation.
   */
  private async retryPart(vId: string, partNumber: number): Promise<any> {
    const tab = this.state.tabs.find((t) => t.id === vId);
    if (!tab || !tab.chromeTabId) return { success: false, error: `Tab ${vId} not found or closed.` };

    const part = tab.parts.find((p) => p.partNumber === partNumber);
    if (!part) return { success: false, error: `Part ${partNumber} not found in ${vId}.` };

    this.addLog('INFO', `Retrying ${vId} P${partNumber}...`, vId);

    // Mark part as generating, switch to the tab
    part.status = 'generating';
    tab.status = 'running';
    tab.currentPart = partNumber;
    await this.persist();

    try {
      await chrome.tabs.update(tab.chromeTabId, { active: true });
    } catch (_) { /* Tab might be in background, OK */ }

    try {
      await chrome.tabs.sendMessage(tab.chromeTabId, {
        type: 'EXECUTE_NEXT_PART_ACTION',
        partNumber,
        totalParts: tab.totalParts || 0,
        wordCount: tab.partWordCount || this.state.config.partWordCount || 4000
      });
      return { success: true };
    } catch (err: any) {
      part.status = 'error';
      tab.status = 'error';
      this.addLog('ERROR', `Retry P${partNumber} failed for ${vId}: ${err.message}`, vId);
      await this.persist();
      return { success: false, error: err.message };
    }
  }

  /**
   * Triggers content script to insert next part.
   */
  private async insertNextPart(vId: string, partNumber: number): Promise<any> {
    const tab = this.state.tabs.find((t) => t.id === vId);
    if (!tab || !tab.chromeTabId) return { success: false, error: 'Tab not found.' };

    // 1. Visually activate tab and focus window so browser foregrounds DOM
    try {
      await chrome.tabs.update(tab.chromeTabId, { active: true });
      const chromeTab = await chrome.tabs.get(tab.chromeTabId);
      if (chromeTab.windowId) {
        await chrome.windows.update(chromeTab.windowId, { focused: true });
      }
    } catch (err) {}
    await new Promise((r) => setTimeout(r, 600));

    // 2. Verify content script is responsive, inject if needed
    const isAlive = await new Promise<boolean>((resolve) => {
      chrome.tabs.sendMessage(tab.chromeTabId!, { type: 'PING' }, (resp) => {
        resolve(!chrome.runtime.lastError && resp && resp.pong);
      });
      setTimeout(() => resolve(false), 300);
    });
    if (!isAlive) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.chromeTabId },
          files: ['content.js']
        });
        await new Promise((r) => setTimeout(r, 800));
      } catch (e) {}
    }

    // 3. Mark tab running and clear previous error
    tab.status = 'running';
    tab.currentPart = partNumber;
    tab.error = null;
    let partObj = tab.parts.find((p) => p.partNumber === partNumber);
    if (partObj) {
      partObj.status = 'generating';
    } else {
      const vNum = parseInt(tab.id.replace(/\D/g, ''), 10) || 1;
      tab.parts.push({
        partNumber,
        label: `${tab.id} P${partNumber}`,
        explicitMarker: `${tab.id} P${partNumber}`,
        videoNumber: vNum,
        status: 'generating',
        content: '',
        downloaded: false
      });
    }
    for (const other of tab.parts) {
      if (other.partNumber !== partNumber && other.status === 'generating') {
        other.status = 'waiting';
      }
    }
    this.addLog('INFO', `${tab.id}: Writing Part ${partNumber} Script...`, tab.id);
    await this.persist();

    const isOriginalMode = tab.scriptMode === 'original' || (this.state.config.scriptMode || 'original') === 'original';
    const outlineInstruction = isOriginalMode && tab.outlinePartInstructions ? tab.outlinePartInstructions[partNumber] : undefined;

    try {
      const resp = await chrome.tabs.sendMessage(tab.chromeTabId, {
        type: 'EXECUTE_NEXT_PART_ACTION',
        partNumber,
        totalParts: tab.totalParts || 0,
        wordCount: tab.partWordCount || this.state.config.partWordCount || 4000,
        outlineInstruction
      });
      if (resp && resp.error) {
        tab.status = 'error';
        tab.error = createDiagnosticError('CUSTOM', {
          title: `Part ${partNumber} Request Failed`,
          problem: resp.error,
          vNumber: tab.id
        });
        this.addLog('ERROR', `${tab.id} Part ${partNumber} request failed: ${resp.error}`, tab.id, tab.error);
        await this.persist();
        return { success: false, error: resp.error };
      }
      return { success: true };
    } catch (err: any) {
      tab.status = 'error';
      tab.error = createDiagnosticError('CUSTOM', {
        title: `Part ${partNumber} Request Failed`,
        problem: err.message,
        vNumber: tab.id
      });
      this.addLog('ERROR', `${tab.id} Part ${partNumber} error: ${err.message}`, tab.id, tab.error);
      await this.persist();
      return { success: false, error: err.message };
    }
  }

  /**
   * Downloads a single generated part text file via chrome.downloads API.
   */
  private async downloadPartFile(vId: string, partNumber: number): Promise<any> {
    const tab = this.state.tabs.find((t) => t.id === vId);
    if (!tab) return { success: false, error: 'Tab not found.' };

    const part = tab.parts.find((p) => p.partNumber === partNumber);
    if (!part || !part.content) {
      return { success: false, error: `Part ${partNumber} content not available.` };
    }

    const filename = `${vId} P${partNumber}.txt`;
    const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(part.content)}`;

    try {
      const downloadId = await chrome.downloads.download({
        url: dataUrl,
        filename,
        saveAs: false
      });

      part.downloaded = true;
      this.addLog('SUCCESS', `Downloaded ${filename} (ID: ${downloadId}).`, vId);
      await this.persist();
      return { success: true, downloadId };
    } catch (err: any) {
      this.addLog('ERROR', `Download failed for ${filename}: ${err.message}`, vId);
      return { success: false, error: err.message };
    }
  }

  private getTargetTabs(target?: string): VTab[] {
    const t = target || 'all';
    return this.state.tabs.filter((tab) => {
      if (!tab.chromeTabId) return false;
      if (t === 'all') return true;
      if (t === 'selected') return tab.selected;
      return tab.id === t;
    });
  }

  private handleTabClosed(tabId: number): void {
    const tab = this.state.tabs.find((t) => t.chromeTabId === tabId);
    if (tab) {
      tab.chromeTabId = null;
      tab.status = 'error';
      tab.error = createDiagnosticError('TAB_NOT_FOUND', { vNumber: tab.id });
      this.addLog('WARNING', `${tab.id} browser tab was closed.`, tab.id, tab.error);
      this.persist();
    }
  }

  private handleTabLoaded(tabId: number): void {
    const tab = this.state.tabs.find((t) => t.chromeTabId === tabId);
    if (
      tab &&
      tab.initialMessage &&
      !tab.initialMessageInjected &&
      tab.status !== 'running' &&
      tab.status !== 'completed'
    ) {
      tab.initialMessageInjected = true;
      this.scheduleInitialTextInjection(tabId, tab.initialMessage);
    }
  }

  private scheduleInitialTextInjection(tabId: number, text: string): void {
    const delays = [600, 1500, 3000, 5000];
    delays.forEach((delay) => {
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, {
          type: 'INJECT_INITIAL_TEXT',
          text
        }).catch(() => {});
      }, delay);
    });
  }

  private reindexTabs(): void {
    this.state.tabs.forEach((tab, i) => {
      const newIndex = i + 1;
      tab.index = newIndex;
      tab.id = `V${newIndex}`;

      if (tab.chromeTabId) {
        chrome.tabs.sendMessage(tab.chromeTabId, {
          type: 'UPDATE_HUD',
          tab
        }).catch(() => {});
      }
    });
  }

  private recalculateTabStatus(tab: VTab): void {
    if (tab.status === 'running' || tab.status === 'completed') return;

    const hasTitle = Boolean(tab.title);
    const hasPrompt = Boolean(tab.masterPrompt);
    // Thumbnail is OK if assigned via dashboard OR already pasted into chat
    const hasThumb = tab.thumbnailStatus !== 'none' || tab.thumbnailPasted || Boolean(tab.thumbnailId);
    
    // Script is OK if Original Script Mode, script is optional, or competitor script is provided
    const isOriginalMode = tab.scriptMode === 'original' || (this.state.config.scriptMode || 'original') === 'original';
    const isScriptOptionActive = !isOriginalMode && Boolean(this.state.config.competitorScriptEnabled);
    const hasGlobalPastedScript = Boolean(this.state.config.competitorScriptText && this.state.config.competitorScriptText.trim());
    const hasScript = isOriginalMode || !isScriptOptionActive || tab.scriptOptional || hasGlobalPastedScript || tab.scriptStatus !== 'none' || tab.scriptInjected || Boolean(tab.scriptId);

    if (hasTitle && hasPrompt && hasThumb && hasScript) {
      tab.status = 'ready';
      tab.error = null;
    } else {
      tab.status = 'incomplete';
    }
  }

  private addLog(
    level: LogLevel,
    message: string,
    vNumber?: string,
    error?: DiagnosticError
  ): void {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const logEntry: LogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timeStr,
      isoTime: now.toISOString(),
      level,
      message,
      vNumber,
      errorDetails: error
    };

    this.state.logs.unshift(logEntry);
    if (this.state.logs.length > 500) {
      this.state.logs.pop();
    }
  }

  /**
   * Resyncs all managed tabs by querying their content scripts in parallel.
   * Scans DOM for parts, updates part state, completion status, and broadcasts HUD updates.
   */
  public async resyncAllTabs(): Promise<VTab[]> {
    this.addLog('INFO', 'Starting parallel resync across all managed tabs...');
    const allTabs = await chrome.tabs.query({});
    const liveTabIds = new Set(allTabs.map((t) => t.id).filter((id): id is number => id !== undefined));

    let updatedCount = 0;
    const syncPromises = this.state.tabs.map(async (vTab) => {
      if (!vTab.chromeTabId || !liveTabIds.has(vTab.chromeTabId)) {
        return;
      }
      try {
        const resp = await new Promise<any>((resolve) => {
          chrome.tabs.sendMessage(
            vTab.chromeTabId!,
            { type: 'RESYNC_DOM_NOW', tab: vTab },
            (response) => {
              if (chrome.runtime.lastError) {
                resolve(null);
              } else {
                resolve(response);
              }
            }
          );
          setTimeout(() => resolve(null), 1500);
        });

        const parts = (resp && (resp.parts || (resp.tab && resp.tab.parts))) || null;
        if (parts && Array.isArray(parts)) {
          vTab.parts = parts;
          if (resp.tab) {
            vTab.currentPart = resp.tab.currentPart || vTab.currentPart;
            vTab.totalParts = resp.tab.totalParts || vTab.totalParts;
            if (resp.tab.outlineDetected) vTab.outlineDetected = true;
            if (resp.tab.outlineContent) vTab.outlineContent = resp.tab.outlineContent;
            if (resp.tab.detectedVideoNumber) vTab.detectedVideoNumber = resp.tab.detectedVideoNumber;
          }
          const val = validateVideoMerge(vTab);
          vTab.mergeValidationStatus = val.valid ? 'valid' : 'invalid';
          if (val.valid) {
            vTab.status = 'completed';
          } else {
            this.recalculateTabStatus(vTab);
          }
          vTab.lastUpdated = Date.now();
          updatedCount++;

          // Broadcast HUD update to this tab
          chrome.tabs.sendMessage(vTab.chromeTabId!, {
            type: 'UPDATE_HUD',
            tab: vTab
          }).catch(() => {});
        }
      } catch (err) {
        console.warn(`Resync error for ${vTab.id}:`, err);
      }
    });

    await Promise.all(syncPromises);
    await this.persist();
    this.broadcastState();
    this.addLog('SUCCESS', `Resynced ${updatedCount} managed tabs from live DOM.`);
    return this.state.tabs;
  }

  /**
   * Reconciles all open browser tabs, links open Qwen tabs to VTabs,
   * re-injects content scripts if disconnected on extension reload,
   * and requests live DOM status & parts detection.
   */
  public async reconcileAndInjectTabs(): Promise<VTab[]> {
    try {
      const allTabs = await chrome.tabs.query({});
      const liveTabIds = new Set(allTabs.map((t) => t.id).filter((id): id is number => id !== undefined));

      // 1. Clear dead chromeTabIds that are no longer open in the browser
      this.state.tabs.forEach((t) => {
        if (t.chromeTabId && !liveTabIds.has(t.chromeTabId)) {
          t.chromeTabId = null;
        }
      });

      // 2. Find all currently open Qwen tabs
      const qwenTabs = allTabs.filter(
        (t) => t.id && t.url && this.isQwenUrl(t.url)
      );

      // 3. Match or assign each open Qwen tab
      for (const qTab of qwenTabs) {
        if (!qTab.id) continue;

        let matched = this.state.tabs.find((t) => t.chromeTabId === qTab.id);
        if (!matched) {
          // Check for unassigned managed tab
          matched = this.state.tabs.find((t) => !t.chromeTabId);
          if (matched) {
            matched.chromeTabId = qTab.id;
          }
          // Ghost Tab Prevention: NEVER automatically push a new tab to this.state.tabs!
          // Unmanaged browser tabs outside the active range stay unmanaged.
        }

        // 4. Ensure content script is running in this tab
        const isAlive = await new Promise<boolean>((resolve) => {
          chrome.tabs.sendMessage(qTab.id!, { type: 'PING' }, (resp) => {
            if (chrome.runtime.lastError || !resp || !resp.pong) {
              resolve(false);
            } else {
              resolve(true);
            }
          });
          setTimeout(() => resolve(false), 250);
        });

        if (!isAlive) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: qTab.id },
              files: ['content.js']
            });
            await chrome.scripting.insertCSS({
              target: { tabId: qTab.id },
              files: ['floatingPanel.css']
            }).catch(() => {});
          } catch {
            // Tab might be loading or restricted
          }
        } else if (matched) {
          // Ask tab to rescan DOM and send back parts
          try {
            chrome.tabs.sendMessage(
              qTab.id,
              { type: 'SCAN_DOM_NOW', tab: matched },
              () => {
                if (chrome.runtime.lastError) {
                  // ignored
                }
              }
            );
          } catch {
            // ignored
          }
        }
      }

      await this.persist();
      return this.state.tabs;
    } catch (err: any) {
      console.warn('reconcileAndInjectTabs error:', err);
      return this.state.tabs;
    }
  }

  private async persist(): Promise<void> {
    await saveWorkflowState(this.state);
  }

  private isMetaUrl(url: string): boolean {
    if (!url) return false;
    return (
      url.includes('meta.ai') ||
      url.includes('www.meta.ai') ||
      url.includes('mockMeta.html') ||
      url.includes('chat.qwen.ai') ||
      url.includes('qwen.ai') ||
      url.includes('mockQwen.html') ||
      url.startsWith('http://localhost') ||
      url.startsWith('http://127.0.0.1')
    );
  }

  private isQwenUrl(url: string): boolean {
    return this.isMetaUrl(url);
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }
}

new BackgroundServiceWorker();
