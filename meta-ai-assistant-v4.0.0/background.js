var V = Object.defineProperty;
var k = (m, t, n) => t in m ? V(m, t, { enumerable: !0, configurable: !0, writable: !0, value: n }) : m[t] = n;
var C = (m, t, n) => k(m, typeof t != "symbol" ? t + "" : t, n);
const F = "MetaExtensionDB";
const L = "assets";
function Q() {
  return new Promise((m, t) => {
    const n = indexedDB.open(F, 1);
    n.onupgradeneeded = () => {
      const o = n.result;
      o.objectStoreNames.contains(L) || o.createObjectStore(L, { keyPath: "id" });
    }, n.onsuccess = () => m(n.result), n.onerror = () => t(n.error);
  });
}
async function R(m) {
  const t = await Q();
  return new Promise((n, o) => {
    const e = t.transaction(L, "readonly").objectStore(L).get(m);
    e.onsuccess = () => {
      const a = e.result;
      if (!a) {
        n(null);
        return;
      }
      const s = new Blob([a.data], { type: a.type });
      n({
        asset: {
          id: a.id,
          name: a.name,
          size: a.size,
          type: a.type,
          dataUrl: a.dataUrl,
          textSnippet: a.textSnippet,
          createdAt: a.createdAt
        },
        blob: s
      });
    }, e.onerror = () => o(e.error);
  });
}
const v = "meta_assistant_workflow_state", D = "qwen_assistant_workflow_state";
async function B() {
  return typeof chrome > "u" || !chrome.storage || !chrome.storage.local ? null : new Promise((m) => {
    chrome.storage.local.get([v, D], (t) => {
      m(t[v] || t[D] || null);
    });
  });
}
async function G(m) {
  if (!(typeof chrome > "u" || !chrome.storage || !chrome.storage.local))
    return new Promise((t) => {
      chrome.storage.local.set({ [v]: m }, () => {
        t();
      });
    });
}
function O(m, t) {
  const n = `err_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  switch (m) {
    case "INPUT_NOT_FOUND":
      return {
        id: n,
        title: "Qwen Chat Input Not Found",
        problem: "The extension could not locate the text input area on this Qwen chat page.",
        why: "The page might still be loading, or Qwen updated its web interface layout.",
        solution: "Make sure the Qwen tab is fully loaded and you are logged in, then click Retry.",
        canRetry: !0,
        timestamp: Date.now(),
        ...t
      };
    case "SEND_BUTTON_NOT_FOUND":
      return {
        id: n,
        title: "Send Button Not Found",
        problem: "The extension could not locate or activate the message submit button.",
        why: "The input might be disabled, the model might be unavailable, or previous message is still generating.",
        solution: "Check if Qwen is waiting for input or if an existing generation is active. Click Retry when ready.",
        canRetry: !0,
        timestamp: Date.now(),
        ...t
      };
    case "UPLOAD_NOT_FOUND":
      return {
        id: n,
        title: "Upload Control Unavailable",
        problem: "The file upload/attachment button could not be located in the Qwen chat interface.",
        why: "The upload feature might require logging into Qwen, or the selected model does not support file attachments.",
        solution: "Verify that you are logged in to chat.qwen.ai and that the paperclip/upload icon is visible, then click Retry.",
        canRetry: !0,
        timestamp: Date.now(),
        ...t
      };
    case "UPLOAD_REJECTED":
      return {
        id: n,
        title: "File Attachment Incomplete",
        problem: "The file could not be programmatically attached to the chat input.",
        why: "Browser security prevented setting the file input, or the file format/size exceeds Qwen limits.",
        solution: "Use drag-and-drop directly on the Qwen tab or click Retry to re-dispatch the upload event.",
        canRetry: !0,
        timestamp: Date.now(),
        ...t
      };
    case "TAB_NOT_FOUND":
      return {
        id: n,
        title: "Qwen Tab Not Accessible",
        problem: "The target Chrome tab could not be found or is no longer open.",
        why: "The browser tab may have been closed, crashed, or moved to another window.",
        solution: "Click Reconnect to re-link an active Qwen tab or remove this tab from the dashboard.",
        canRetry: !0,
        timestamp: Date.now(),
        ...t
      };
    case "TAB_DISCONNECTED":
      return {
        id: n,
        title: "Content Script Disconnected",
        problem: "The extension lost connection with the Qwen tab.",
        why: "The page was refreshed, navigated away, or put to sleep by Chrome tab discarder.",
        solution: "Refresh the Qwen tab and click Retry.",
        canRetry: !0,
        timestamp: Date.now(),
        ...t
      };
    case "GENERATION_TIMEOUT":
      return {
        id: n,
        title: "Response Generation Timeout",
        problem: "Qwen took longer than expected to complete generating the response.",
        why: "High server load, network throttling, or very long script output.",
        solution: "Check the Qwen tab. If the model is still typing, wait a moment and click Retry to resume tracking.",
        canRetry: !0,
        timestamp: Date.now(),
        ...t
      };
    case "MISSING_ASSETS":
      return {
        id: n,
        title: "Required Assets Missing",
        problem: "One or more required inputs (Title, Master Prompt, Thumbnail, Script) are missing.",
        why: "Not all assets were assigned before clicking Run.",
        solution: "Assign the missing title, master prompt, thumbnail, or script in the dashboard, then click Run.",
        canRetry: !1,
        timestamp: Date.now(),
        ...t
      };
    case "PARSE_ERROR":
      return {
        id: n,
        title: "Part Detection Ambiguity",
        problem: "The extension could not identify the generated script parts from the assistant response.",
        why: "Qwen formatted the response without standard Part headings or used an unexpected layout.",
        solution: "Verify the assistant message format in the tab or use the floating panel to manually assign parts.",
        canRetry: !0,
        timestamp: Date.now(),
        ...t
      };
    default:
      return {
        id: n,
        title: (t == null ? void 0 : t.title) || "Execution Error",
        problem: (t == null ? void 0 : t.problem) || "An unexpected operation error occurred.",
        why: (t == null ? void 0 : t.why) || "The browser or webpage state was not in the expected condition.",
        solution: (t == null ? void 0 : t.solution) || "Review the tab state and click Retry.",
        canRetry: (t == null ? void 0 : t.canRetry) ?? !0,
        timestamp: Date.now(),
        ...t
      };
  }
}
function x(m) {
  const t = m.id || "V1", n = m.totalParts || 0, o = m.parts || [], d = [], u = [], e = [], a = o.filter((l) => l.status === "done" && l.content && l.content.trim().length > 0), s = /^V\d+$/i.test(t);
  d.push({
    id: "check-vnum",
    name: "Correct Video Number",
    passed: s,
    detail: s ? `Video ID is verified as ${t}` : `Invalid Video ID: ${t}`
  }), s || u.push(`Invalid video ID: "${t}". Expected format: V1, V2, etc.`);
  const i = n > 0;
  d.push({
    id: "check-total",
    name: "Total Parts Defined",
    passed: i,
    detail: i ? `Total parts detected/specified: ${n}` : "Total parts is undefined or 0"
  }), i || u.push(`${t}: Total parts count has not been detected or set.`);
  const c = a.map((l) => l.partNumber), r = [];
  if (n > 0)
    for (let l = 1; l <= n; l++)
      c.includes(l) || r.push(l);
  else
    for (let l = 1; l <= a.length; l++)
      c.includes(l) || r.push(l);
  const h = r.length === 0 && a.length > 0 && n > 0;
  d.push({
    id: "check-missing",
    name: "No Missing Parts",
    passed: h,
    detail: h ? `All ${n} parts are present` : `MISSING: ${r.map((l) => `${t} P${l}`).join(", ")}`
  }), !h && r.length > 0 && u.push(`MISSING: ${r.map((l) => `${t} P${l}`).join(", ")}`);
  const p = c.filter((l, E) => c.indexOf(l) !== E), b = Array.from(new Set(p)), I = b.length === 0;
  d.push({
    id: "check-duplicates",
    name: "No Duplicated Parts",
    passed: I,
    detail: I ? "Zero duplicate parts" : `DUPLICATE: ${b.map((l) => `${t} P${l}`).join(", ")}`
  }), I || u.push(`DUPLICATE: ${b.map((l) => `${t} P${l}`).join(", ")}`);
  const P = [...a].sort((l, E) => l.partNumber - E.partNumber);
  let S = !0;
  for (let l = 0; l < P.length; l++)
    if (P[l].partNumber !== l + 1) {
      S = !1;
      break;
    }
  d.push({
    id: "check-sequential",
    name: "Sequential Ordering",
    passed: S,
    detail: S ? "Strict 1..N numerical ordering confirmed" : "Parts are out of order or contain gaps"
  }), S || u.push(`${t}: Parts sequence is non-contiguous or contains gaps.`);
  const y = a.filter((l) => !l.heading || l.heading.trim().length === 0 || /^part\s*\d+$/i.test(l.heading.trim())), M = y.length === 0;
  d.push({
    id: "check-headings",
    name: "Content-Based Headings",
    passed: M,
    detail: M ? "All parts have meaningful headings" : `${y.length} part(s) using generic or empty heading`
  }), M || e.push(`${t}: Parts ${y.map((l) => `P${l.partNumber}`).join(", ")} will be assigned intelligent content-based headings upon export.`);
  const A = a.filter((l) => !l.content || l.content.trim().length < 25), _ = A.length === 0;
  d.push({
    id: "check-content",
    name: "Complete Script Content",
    passed: _,
    detail: _ ? "All parts contain complete script prose" : `${A.length} part(s) contain empty or partial content`
  }), _ || u.push(`${t}: Part(s) ${A.map((l) => `P${l.partNumber}`).join(", ")} have incomplete script content.`);
  const f = a.some((l) => {
    const E = l.partNumber === 1, U = /^(?:#+\s*)?(?:video\s+|script\s+)?outline\b/i.test(l.content.trim());
    return E && U && l.content.trim().length < 400;
  });
  d.push({
    id: "check-no-outline",
    name: "Outline Isolated",
    passed: !f,
    detail: f ? "Part 1 appears to contain an outline instead of script prose" : "No outline is treated as a script part"
  }), f && u.push(`${t}: Part 1 appears to contain the Outline rather than actual script text. Wait for Part 1 generation.`);
  const T = parseInt(t.replace(/\D/g, ""), 10) || 1, N = a.filter((l) => {
    if (l.videoNumber && l.videoNumber !== T) return !0;
    if (l.explicitMarker) {
      const E = l.explicitMarker.match(/V(\d+)/i);
      if (E && parseInt(E[1], 10) !== T) return !0;
    }
    return !1;
  }), g = N.length === 0;
  d.push({
    id: "check-cross-video",
    name: "Strict Video Isolation",
    passed: g,
    detail: g ? `All parts strictly isolated to ${t}` : `Cross-video parts detected: ${N.map((l) => l.explicitMarker || `P${l.partNumber}`).join(", ")}`
  }), g || u.push(`${t}: Foreign video parts detected: ${N.map((l) => l.explicitMarker || `P${l.partNumber}`).join(", ")}. Different videos must never be merged.`);
  const $ = n > 0 && a.length === n && r.length === 0 && u.length === 0;
  let w;
  return $ ? w = "TXT MERGE VERIFIED ✓" : r.length > 0 ? w = `MERGE INCOMPLETE — ${r.map((l) => `P${l}`).join(", ")} MISSING` : n > 0 && a.length < n ? w = `MERGE INCOMPLETE — ${a.length}/${n} Parts (${n - a.length} Missing)` : u.length > 0 ? w = "MERGE VALIDATION FAILED ✕" : w = "IN PROGRESS ⏳", {
    valid: $,
    videoNumber: t,
    totalParts: n,
    completedPartsCount: a.length,
    missingParts: r,
    duplicateParts: b,
    checks: d,
    errors: u,
    warnings: e,
    statusLabel: w
  };
}
class j {
  constructor() {
    C(this, "state", {
      config: {
        workflowId: `META-${Date.now()}`,
        initialPrompt: "My Version of Title is:",
        masterPrompt: "",
        nextPartPromptTemplate: "Please write Part {n} script now.",
        concurrencyLimit: 2,
        autoInsertNextPart: !1,
        debugMode: !1,
        scriptMode: "original",
        competitorScriptEnabled: !1,
        competitorScriptText: "",
        partWordCount: 4e3
      },
      tabs: [],
      logs: [],
      isPaused: !1,
      activeExecutionCount: 0,
      downloadManagerLoaded: !1
    });
    C(this, "executionQueue", []);
    C(this, "isProcessingQueue", !1);
    C(this, "readyPromise");
    this.setupListeners(), this.readyPromise = this.init();
  }
  setupListeners() {
    chrome.runtime.onMessage.addListener((t, n, o) => (this.readyPromise.then(() => this.handleMessage(t, n)).then((d) => o(d)).catch((d) => o({ success: !1, error: d.message })), !0)), chrome.tabs.onRemoved.addListener((t) => {
      this.readyPromise.then(() => this.handleTabClosed(t));
    }), chrome.tabs.onUpdated.addListener((t, n) => {
      n.status === "complete" && this.readyPromise.then(() => this.handleTabLoaded(t));
    }), chrome.runtime.onInstalled.addListener(() => {
      this.readyPromise.then(() => this.reconcileAndInjectTabs());
    }), chrome.runtime.onStartup.addListener(() => {
      this.readyPromise.then(() => this.reconcileAndInjectTabs());
    });
  }
  async init() {
    const t = await B();
    t && (this.state = t, this.addLog("INFO", "Restored previous workflow state from storage.")), chrome.sidePanel && chrome.sidePanel.setPanelBehavior && chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: !1 }).catch(() => {
    }), await this.reconcileAndInjectTabs();
  }
  async handleMessage(t, n) {
    var o, d, u;
    switch (t.type) {
      case "GET_STATE":
        return { success: !0, state: this.state };
      case "SET_STATE":
        return this.state = { ...this.state, ...t.state }, await this.persist(), { success: !0, state: this.state };
      case "THUMBNAIL_UPLOAD_STARTED": {
        const e = this.state.tabs.find((a) => a.id === t.vNumber);
        return e && (e.thumbnailUploading = !0, this.persist()), { success: !0 };
      }
      case "THUMBNAIL_UPLOAD_COMPLETE": {
        const e = this.state.tabs.find((a) => a.id === t.vNumber);
        return e && (e.thumbnailUploading = !1, e.thumbnailPasted = !0, this.recalculateTabStatus(e), this.persist()), { success: !0 };
      }
      case "GET_ACTIVE_META_TAB":
      case "GET_ACTIVE_QWEN_TAB": {
        const a = (await chrome.tabs.query({ active: !0, currentWindow: !0 }))[0], s = (a == null ? void 0 : a.url) && this.isMetaUrl(a.url);
        return { success: !0, tab: a, isQwen: s, isMeta: s };
      }
      case "DUPLICATE_CHATS":
        return await this.duplicateChats(
          t.count,
          t.initialText,
          t.startVideoId,
          t.endVideoId,
          t.explicitVideoIds
        );
      case "UPDATE_CONFIG":
        return this.state.config = { ...this.state.config, ...t.config }, await this.persist(), { success: !0, config: this.state.config };
      case "SELECT_TABS": {
        const { tabIds: e, selected: a } = t;
        return this.state.tabs.forEach((s) => {
          e.includes(s.id) && (s.selected = a);
        }), await this.persist(), { success: !0, tabs: this.state.tabs };
      }
      case "SELECT_RANGE": {
        const { startIndex: e, endIndex: a } = t;
        return this.state.tabs.forEach((s, i) => {
          const c = i + 1;
          s.selected = s.index >= e && s.index <= a || c >= e && c <= a;
        }), await this.persist(), { success: !0, tabs: this.state.tabs };
      }
      case "ASSIGN_TITLES":
        return await this.assignTitles(t.titles, t.startIndex, t.endIndex);
      case "SET_MASTER_PROMPT": {
        const { prompt: e, target: a } = t;
        return this.state.config.masterPrompt = e, this.state.tabs.forEach((s) => {
          (a === "all" || s.selected) && (s.masterPrompt = e, this.recalculateTabStatus(s));
        }), this.addLog("SUCCESS", `Master prompt applied to ${a === "all" ? "all" : "selected"} tabs.`), await this.persist(), { success: !0, tabs: this.state.tabs };
      }
      case "ASSIGN_THUMBNAILS":
        return t.assets.forEach((e) => {
          const a = this.state.tabs.find((s) => s.id === e.vNumber);
          a && (a.thumbnailId = e.assetId, a.thumbnailName = e.name, a.thumbnailStatus = "assigned", this.recalculateTabStatus(a));
        }), this.addLog("SUCCESS", `Thumbnails mapped to ${t.assets.length} tabs.`), await this.persist(), { success: !0, tabs: this.state.tabs };
      case "ASSIGN_SCRIPTS":
        return t.assets.forEach((e) => {
          const a = this.state.tabs.find((s) => s.id === e.vNumber);
          a && (a.scriptId = e.assetId, a.scriptName = e.name, a.scriptStatus = "assigned", this.recalculateTabStatus(a));
        }), this.addLog("SUCCESS", `Scripts mapped to ${t.assets.length} tabs.`), await this.persist(), { success: !0, tabs: this.state.tabs };
      case "RUN_EXECUTION":
        return await this.startExecution(t.target);
      case "PAUSE_EXECUTION":
        return this.state.isPaused = !0, this.addLog("WARNING", "Execution paused by user."), await this.persist(), { success: !0 };
      case "RESUME_EXECUTION":
        return this.state.isPaused = !1, this.addLog("INFO", "Execution resumed."), this.processQueue(), await this.persist(), { success: !0 };
      case "STOP_EXECUTION":
        return this.state.isPaused = !1, this.executionQueue = [], this.state.tabs.forEach((e) => {
          e.status === "running" && (e.status = "ready");
        }), this.addLog("WARNING", "Execution stopped."), await this.persist(), { success: !0 };
      case "RETRY_TAB":
        return await this.retryTab(t.vNumber);
      case "RETRY_PART":
        return await this.retryPart(t.vNumber, t.partNumber);
      case "LOAD_DOWNLOAD_MANAGER":
        return this.state.downloadManagerLoaded = !0, this.addLog("SUCCESS", "Loaded all synchronized script parts into Download Manager."), await this.persist(), { success: !0 };
      case "CLEAR_DOWNLOAD_MANAGER":
        return this.state.downloadManagerLoaded = !1, await this.persist(), { success: !0 };
      case "SET_SCRIPT_MODE": {
        const e = t.mode === "competitor" ? "competitor" : "original";
        return this.state.config.scriptMode = e, this.state.config.competitorScriptEnabled = e === "competitor", this.state.tabs.forEach((a) => {
          a.scriptMode = e, a.scriptOptional = e === "original", this.recalculateTabStatus(a);
        }), this.addLog(
          "INFO",
          `Script Mode set to ${e === "original" ? "Original Script Mode" : "Competitor Script Mode"}.`
        ), await this.persist(), { success: !0, config: this.state.config, scriptMode: e };
      }
      case "SET_COMPETITOR_SCRIPT":
        return this.state.config.competitorScriptEnabled = t.enabled, t.text !== void 0 && (this.state.config.competitorScriptText = t.text), this.state.tabs.forEach((e) => {
          e.scriptOptional = !t.enabled;
        }), this.addLog(
          "INFO",
          t.enabled ? "Optional Competitor Script input enabled." : "Competitor Script disabled (running normally without competitor script)."
        ), await this.persist(), { success: !0, config: this.state.config };
      case "SET_PART_WORD_COUNT": {
        const e = typeof t.wordCount == "number" && t.wordCount > 0 ? t.wordCount : 4e3;
        return this.state.config.partWordCount = e, this.state.tabs.forEach((a) => {
          a.partWordCount = e;
        }), this.addLog("INFO", `Part Word Count updated to ${e} words.`), await this.persist(), { success: !0, partWordCount: e };
      }
      case "SET_SCRIPT_OPTIONAL": {
        const e = this.state.tabs.find((a) => a.id === t.vNumber);
        return e && (e.scriptOptional = t.optional, await this.persist()), { success: !0 };
      }
      case "INSERT_NEXT_PART":
        return await this.insertNextPart(t.vNumber, t.partNumber);
      case "CANCEL_TAB": {
        const e = t.vNumber;
        this.executionQueue = this.executionQueue.filter((s) => s !== e);
        const a = this.state.tabs.find((s) => s.id === e);
        return a && (a.status = "ready", this.addLog("WARNING", `Execution cancelled for ${e}.`, e), await this.persist()), { success: !0 };
      }
      case "RESTART_TAB": {
        const e = t.vNumber, a = this.state.tabs.find((s) => s.id === e);
        return a && (a.status = "ready", a.parts = [], a.totalParts = 0, a.currentPart = 1, a.error = null, this.recalculateTabStatus(a), this.executionQueue.includes(e) || this.executionQueue.push(e), this.addLog("INFO", `Restarted ${e} from beginning. Queued for execution.`, e), this.processQueue(), await this.persist()), { success: !0 };
      }
      case "REFRESH_TAB": {
        const e = t.vNumber, a = this.state.tabs.find((s) => s.id === e);
        return a && a.chromeTabId && (await new Promise((i) => {
          chrome.tabs.sendMessage(a.chromeTabId, { type: "PING" }, (c) => {
            i(!chrome.runtime.lastError && c && c.pong);
          }), setTimeout(() => i(!1), 200);
        }) ? chrome.tabs.sendMessage(a.chromeTabId, { type: "SCAN_DOM_NOW", tab: a }).catch(() => {
        }) : (await chrome.scripting.executeScript({
          target: { tabId: a.chromeTabId },
          files: ["content.js"]
        }).catch(() => {
        }), await chrome.scripting.insertCSS({
          target: { tabId: a.chromeTabId },
          files: ["floatingPanel.css"]
        }).catch(() => {
        })), this.addLog("INFO", `Re-synced state for ${e} in-place (no page reload).`, e)), { success: !0 };
      }
      case "REFRESH_ALL_TABS":
      case "RESYNC_ALL_TABS":
        return { success: !0, tabs: await this.resyncAllTabs() };
      case "REMOVE_TAB": {
        const e = t.vNumber;
        return this.executionQueue = this.executionQueue.filter((a) => a !== e), this.state.tabs = this.state.tabs.filter((a) => a.id !== e), this.reindexTabs(), this.addLog("INFO", `Removed ${e} from dashboard. Reindexed remaining tabs to V1..V${this.state.tabs.length}.`), await this.persist(), { success: !0, tabs: this.state.tabs };
      }
      case "CLEAR_COMPLETED_TABS": {
        const e = this.state.tabs.length;
        return this.state.tabs = this.state.tabs.filter((a) => a.status !== "completed"), this.reindexTabs(), this.addLog("INFO", `Cleared ${e - this.state.tabs.length} completed tabs. Reindexed remaining to V1..V${this.state.tabs.length}.`), await this.persist(), { success: !0, tabs: this.state.tabs };
      }
      case "CLEAR_CLOSED_TABS": {
        const e = await chrome.tabs.query({}), a = new Set(e.map((i) => i.id)), s = this.state.tabs.length;
        return this.state.tabs = this.state.tabs.filter((i) => i.chromeTabId && a.has(i.chromeTabId)), this.reindexTabs(), this.addLog("INFO", `Cleared ${s - this.state.tabs.length} closed tabs. Reindexed remaining to V1..V${this.state.tabs.length}.`), await this.persist(), { success: !0, tabs: this.state.tabs };
      }
      case "REINDEX_TABS":
        return this.reindexTabs(), this.addLog("INFO", `Renumbered all tabs sequentially (V1..V${this.state.tabs.length}).`), await this.persist(), { success: !0, tabs: this.state.tabs };
      case "BATCH_TAB_ACTION": {
        const { action: e, tabIds: a } = t, s = this.state.tabs.filter((i) => a.includes(i.id));
        if (e === "restart") {
          for (const i of s)
            i.status = "ready", i.parts = [], i.totalParts = 0, i.currentPart = 1, i.error = null, this.recalculateTabStatus(i), this.executionQueue.includes(i.id) || this.executionQueue.push(i.id);
          this.addLog("INFO", `Restarted ${s.length} selected tabs from Part 1.`), this.processQueue();
        } else if (e === "retry") {
          const i = s.filter((c) => c.status === "error" || c.status === "incomplete");
          for (const c of i)
            c.error = null, this.recalculateTabStatus(c), this.executionQueue.includes(c.id) || this.executionQueue.push(c.id);
          this.addLog("INFO", `Retried ${i.length} selected tabs.`), this.processQueue();
        } else if (e === "refresh") {
          for (const i of s)
            i.chromeTabId && (await new Promise((r) => {
              chrome.tabs.sendMessage(i.chromeTabId, { type: "PING" }, (h) => {
                r(!chrome.runtime.lastError && h && h.pong);
              }), setTimeout(() => r(!1), 200);
            }) ? chrome.tabs.sendMessage(i.chromeTabId, { type: "SCAN_DOM_NOW", tab: i }).catch(() => {
            }) : (await chrome.scripting.executeScript({
              target: { tabId: i.chromeTabId },
              files: ["content.js"]
            }).catch(() => {
            }), await chrome.scripting.insertCSS({
              target: { tabId: i.chromeTabId },
              files: ["floatingPanel.css"]
            }).catch(() => {
            })));
          this.addLog("INFO", `Re-synced state in-place for ${s.length} selected tabs.`);
        } else if (e === "cancel") {
          this.executionQueue = this.executionQueue.filter((i) => !a.includes(i));
          for (const i of s)
            i.status === "running" && (i.status = "ready");
          this.addLog("WARNING", `Cancelled execution for ${s.length} selected tabs.`);
        } else e === "remove" && (this.executionQueue = this.executionQueue.filter((i) => !a.includes(i)), this.state.tabs = this.state.tabs.filter((i) => !a.includes(i.id)), this.reindexTabs(), this.addLog("INFO", `Removed ${s.length} selected tabs. Reindexed remaining tabs to V1..V${this.state.tabs.length}.`));
        return await this.persist(), { success: !0, tabs: this.state.tabs };
      }
      case "PUSH_TITLES_TO_CHATS":
      case "STAGE_PASTE_PROMPTS": {
        const e = t.target || "all", a = this.getTargetTabs(e);
        let s = 0, i = 0, c = 0;
        for (const r of a)
          if (!(!r.chromeTabId || !r.title)) {
            if (!t.force && r.titlePushStatus === "pasted" && r.pushedTitleText === r.title) {
              i++, this.addLog("INFO", `${r.id}: Title already verified pasted ("${r.title}"). Skipping duplicate push.`, r.id);
              continue;
            }
            r.titlePushStatus = "pasting";
            try {
              const h = await chrome.tabs.sendMessage(r.chromeTabId, {
                type: "PASTE_PROMPT_ONLY",
                title: r.title,
                masterPrompt: r.masterPrompt || this.state.config.masterPrompt,
                vNumber: r.id
              });
              h && (h.verified || h.success) ? (r.titleInjected = !0, r.titlePushed = !0, r.titlePushStatus = "pasted", r.titleVerified = !0, r.pushedTitleText = r.title, r.verifiedTitleText = r.title, s++) : (r.titlePushStatus = "failed", r.titleVerified = !1, c++, this.addLog("ERROR", `${r.id}: Title paste failed verification: ${(h == null ? void 0 : h.error) || "Verification failed"}`, r.id));
            } catch (h) {
              r.titlePushStatus = "failed", r.titleVerified = !1, c++, this.addLog("ERROR", `${r.id}: Could not connect to tab to push title (${h.message}).`, r.id);
            }
            this.recalculateTabStatus(r), chrome.tabs.sendMessage(r.chromeTabId, { type: "UPDATE_HUD", tab: r }).catch(() => {
            });
          }
        return this.addLog("INFO", `Push Titles: Verified ${s} titles, ${c} failed, ${i} skipped.`), await this.persist(), { success: !0, count: s, failed: c, skipped: i, tabs: this.state.tabs };
      }
      case "PUSH_PROMPT_TO_CHATS": {
        const e = t.target || "all", a = this.getTargetTabs(e);
        let s = 0, i = 0, c = 0;
        for (const r of a) {
          if (!r.chromeTabId) continue;
          const h = r.masterPrompt || this.state.config.masterPrompt;
          if (h) {
            if (!t.force && r.masterPromptStatus === "sent") {
              c++;
              continue;
            }
            r.masterPromptStatus = "sending";
            try {
              const p = await chrome.tabs.sendMessage(r.chromeTabId, {
                type: "PASTE_MASTER_PROMPT_ONLY",
                masterPrompt: h,
                vNumber: r.id
              });
              p && (p.verified || p.success) ? (r.promptInjected = !0, r.masterPromptStatus = "sent", r.masterPromptVerified = !0, s++) : (r.masterPromptStatus = "failed", r.masterPromptVerified = !1, i++);
            } catch {
              r.masterPromptStatus = "failed", r.masterPromptVerified = !1, i++;
            }
            this.recalculateTabStatus(r), chrome.tabs.sendMessage(r.chromeTabId, { type: "UPDATE_HUD", tab: r }).catch(() => {
            });
          }
        }
        return this.addLog("INFO", `Push Prompt: Verified sent ${s} tabs, ${i} failed, ${c} skipped.`), await this.persist(), { success: !0, count: s, failed: i, skipped: c, tabs: this.state.tabs };
      }
      case "PUSH_THUMBNAILS_TO_CHATS":
      case "STAGE_PASTE_THUMBNAILS": {
        const e = t.target || "all", a = this.getTargetTabs(e);
        let s = 0, i = 0, c = 0;
        for (const r of a) {
          if (!r.chromeTabId || !r.thumbnailId) continue;
          if (!t.force && r.thumbnailPushStatus === "pasted") {
            c++, this.addLog("INFO", `${r.id}: Thumbnail already verified pasted. Skipping duplicate push.`, r.id);
            continue;
          }
          const h = await R(r.thumbnailId);
          if (!h) {
            r.thumbnailPushStatus = "failed", i++;
            continue;
          }
          r.thumbnailPushStatus = "uploading";
          try {
            const p = await this.blobToBase64(h.blob), b = await chrome.tabs.sendMessage(r.chromeTabId, {
              type: "PASTE_THUMBNAIL_ONLY",
              thumbnail: {
                name: h.asset.name || `${r.id}_thumb`,
                type: h.asset.type,
                base64: p
              },
              vNumber: r.id
            });
            b && (b.verified || b.success) ? (r.thumbnailPasted = !0, r.thumbnailPushStatus = "pasted", r.thumbnailVerified = !0, s++) : (r.thumbnailPushStatus = "failed", r.thumbnailVerified = !1, i++);
          } catch {
            r.thumbnailPushStatus = "failed", r.thumbnailVerified = !1, i++;
          }
          this.recalculateTabStatus(r), chrome.tabs.sendMessage(r.chromeTabId, { type: "UPDATE_HUD", tab: r }).catch(() => {
          });
        }
        return this.addLog("INFO", `Push Thumbnails: Verified ${s}, ${i} failed, ${c} skipped.`), await this.persist(), { success: !0, count: s, failed: i, skipped: c, tabs: this.state.tabs };
      }
      case "PUSH_SCRIPTS_TO_CHATS":
      case "STAGE_PASTE_SCRIPTS": {
        const e = t.target || "all", a = this.getTargetTabs(e);
        let s = 0, i = 0, c = 0;
        for (const r of a) {
          if (!r.chromeTabId) continue;
          if (!t.force && r.scriptPushStatus === "pasted") {
            c++;
            continue;
          }
          let h = "", p = `${r.id}_script.txt`;
          if (r.scriptId) {
            const b = await R(r.scriptId);
            b && (h = await b.blob.text(), p = b.asset.name || p);
          } else this.state.config.competitorScriptEnabled && ((o = this.state.config.competitorScriptText) != null && o.trim()) && (h = this.state.config.competitorScriptText.trim(), p = `${r.id}_Competitor_Script.txt`);
          if (h) {
            r.scriptPushStatus = "uploading";
            try {
              const b = await chrome.tabs.sendMessage(r.chromeTabId, {
                type: "PASTE_SCRIPT_ONLY",
                script: {
                  name: p,
                  content: h
                },
                vNumber: r.id
              });
              b && (b.verified || b.success) ? (r.scriptInjected = !0, r.scriptPushStatus = "pasted", r.scriptVerified = !0, s++) : (r.scriptPushStatus = "failed", r.scriptVerified = !1, i++);
            } catch {
              r.scriptPushStatus = "failed", r.scriptVerified = !1, i++;
            }
            this.recalculateTabStatus(r), chrome.tabs.sendMessage(r.chromeTabId, { type: "UPDATE_HUD", tab: r }).catch(() => {
            });
          }
        }
        return this.addLog("INFO", `Push Scripts: Verified ${s}, ${i} failed, ${c} skipped.`), await this.persist(), { success: !0, count: s, failed: i, skipped: c, tabs: this.state.tabs };
      }
      case "PUSH_ALL_ASSETS_TO_CHATS": {
        const e = t.target || "all", a = this.getTargetTabs(e);
        let s = 0;
        for (const i of a) {
          if (!i.chromeTabId) continue;
          if (i.title && (i.titlePushStatus !== "pasted" || i.pushedTitleText !== i.title)) {
            i.titlePushStatus = "pasting";
            try {
              const r = await chrome.tabs.sendMessage(i.chromeTabId, {
                type: "PASTE_PROMPT_ONLY",
                title: i.title,
                masterPrompt: i.masterPrompt || this.state.config.masterPrompt,
                vNumber: i.id
              });
              r && (r.verified || r.success) ? (i.titleInjected = !0, i.titlePushed = !0, i.titlePushStatus = "pasted", i.titleVerified = !0, i.pushedTitleText = i.title, i.verifiedTitleText = i.title) : (i.titlePushStatus = "failed", i.titleVerified = !1);
            } catch {
              i.titlePushStatus = "failed", i.titleVerified = !1;
            }
          }
          if (i.thumbnailId && i.thumbnailPushStatus !== "pasted") {
            const r = await R(i.thumbnailId);
            if (r) {
              const h = await this.blobToBase64(r.blob);
              i.thumbnailPushStatus = "uploading";
              try {
                const p = await chrome.tabs.sendMessage(i.chromeTabId, {
                  type: "PASTE_THUMBNAIL_ONLY",
                  thumbnail: {
                    name: r.asset.name || `${i.id}_thumb`,
                    type: r.asset.type,
                    base64: h
                  },
                  vNumber: i.id
                });
                p && (p.verified || p.success) ? (i.thumbnailPasted = !0, i.thumbnailPushStatus = "pasted", i.thumbnailVerified = !0) : (i.thumbnailPushStatus = "failed", i.thumbnailVerified = !1);
              } catch {
                i.thumbnailPushStatus = "failed", i.thumbnailVerified = !1;
              }
            }
          }
          if (i.scriptId && i.scriptPushStatus !== "pasted") {
            const r = await R(i.scriptId);
            if (r) {
              const h = await r.blob.text();
              i.scriptPushStatus = "uploading";
              try {
                const p = await chrome.tabs.sendMessage(i.chromeTabId, {
                  type: "PASTE_SCRIPT_ONLY",
                  script: {
                    name: r.asset.name || `${i.id}_script.txt`,
                    content: h
                  },
                  vNumber: i.id
                });
                p && (p.verified || p.success) ? (i.scriptInjected = !0, i.scriptPushStatus = "pasted", i.scriptVerified = !0) : (i.scriptPushStatus = "failed", i.scriptVerified = !1);
              } catch {
                i.scriptPushStatus = "failed", i.scriptVerified = !1;
              }
            }
          }
          (i.masterPrompt || this.state.config.masterPrompt) && i.titlePushStatus === "pasted" && (i.promptInjected = !0, i.masterPromptStatus = "sent", i.masterPromptVerified = !0), this.recalculateTabStatus(i), chrome.tabs.sendMessage(i.chromeTabId, { type: "UPDATE_HUD", tab: i }).catch(() => {
          }), s++;
        }
        return this.addLog("INFO", `Push All Assets: Completed for ${s} tabs (${e}).`), await this.persist(), { success: !0, count: s, tabs: this.state.tabs };
      }
      case "STAGE_RUN_ALL_PACED": {
        const e = t.target || "all";
        return await this.startExecution(e);
      }
      case "CLEAR_TITLES":
        return this.state.tabs.forEach((e) => {
          e.title = "", e.titleInjected = !1, e.titlePushed = !1, e.titlePushStatus = "none", e.titleVerified = !1, e.pushedTitleText = void 0, e.verifiedTitleText = void 0, this.recalculateTabStatus(e);
        }), this.addLog("INFO", "Cleared all assigned titles."), await this.persist(), { success: !0, tabs: this.state.tabs };
      case "CLEAR_PROMPT":
        return this.state.config.masterPrompt = "", this.state.tabs.forEach((e) => {
          e.masterPrompt = "", this.recalculateTabStatus(e);
        }), this.addLog("INFO", "Cleared Master Prompt."), await this.persist(), { success: !0, tabs: this.state.tabs };
      case "CLEAR_THUMBNAILS":
        return this.state.tabs.forEach((e) => {
          e.thumbnailId = void 0, e.thumbnailName = void 0, e.thumbnailStatus = "none", this.recalculateTabStatus(e);
        }), this.addLog("INFO", "Cleared all assigned thumbnails."), await this.persist(), { success: !0, tabs: this.state.tabs };
      case "CLEAR_SCRIPTS":
        return this.state.tabs.forEach((e) => {
          e.scriptId = void 0, e.scriptName = void 0, e.scriptStatus = "none", this.recalculateTabStatus(e);
        }), this.addLog("INFO", "Cleared all assigned scripts."), await this.persist(), { success: !0, tabs: this.state.tabs };
      case "CLEAR_LOGS":
        return this.state.logs = [], await this.persist(), { success: !0 };
      case "RESET_WORKFLOW":
        return t.mode === "all" ? (this.state.tabs = [], this.state.logs = [], this.state.config.masterPrompt = "", this.state.config.initialPrompt = "") : this.state.tabs.forEach((e) => {
          e.status = "uninitialized", e.parts = [], e.totalParts = 0, e.currentPart = 1, e.error = null, this.recalculateTabStatus(e);
        }), this.addLog("INFO", `Workflow reset (${t.mode}).`), await this.persist(), { success: !0, state: this.state };
      case "CONTENT_TAB_READY": {
        const e = (d = n.tab) == null ? void 0 : d.id;
        if (e) {
          let a;
          if (t.detectedVideoNumber) {
            const s = `V${t.detectedVideoNumber}`;
            return this.state.tabs.forEach((i) => {
              i.chromeTabId === e && i.id !== s && (i.chromeTabId = null);
            }), a = this.state.tabs.find((i) => i.id === s), a || (a = {
              id: s,
              index: t.detectedVideoNumber,
              title: "",
              masterPrompt: this.state.config.masterPrompt || "",
              qwenUrl: "https://chat.qwen.ai",
              initialMessage: "",
              status: "ready",
              currentPart: 1,
              totalParts: 0,
              parts: [],
              selected: !1,
              chromeTabId: e,
              thumbnailStatus: "none",
              scriptStatus: "none",
              scriptMode: this.state.config.scriptMode || "original",
              scriptOptional: (this.state.config.scriptMode || "original") === "original" || !this.state.config.competitorScriptEnabled,
              lastUpdated: Date.now()
            }, this.state.tabs.push(a)), a.chromeTabId = e, this.addLog("INFO", `Linked ${a.id} to browser tab ${e} via explicit marker`, a.id), await this.persist(), { success: !0, tab: a };
          }
          if (a = this.state.tabs.find((s) => s.chromeTabId === e), !a) {
            const s = await chrome.tabs.query({}), i = new Set(s.map((c) => c.id));
            this.state.tabs.forEach((c) => {
              c.chromeTabId && !i.has(c.chromeTabId) && (c.chromeTabId = null);
            }), a = this.state.tabs.find((c) => !c.chromeTabId), a ? (a.chromeTabId = e, this.addLog("INFO", `Linked ${a.id} to browser tab ${e}`, a.id), await this.persist()) : this.state.tabs.length === 0 && (a = {
              id: "V1",
              index: 1,
              title: "",
              masterPrompt: this.state.config.masterPrompt || "",
              qwenUrl: "https://chat.qwen.ai",
              initialMessage: "",
              status: "ready",
              currentPart: 1,
              totalParts: 0,
              parts: [],
              selected: !1,
              chromeTabId: e,
              thumbnailStatus: "none",
              scriptStatus: "none",
              scriptMode: this.state.config.scriptMode || "original",
              scriptOptional: (this.state.config.scriptMode || "original") === "original" || !this.state.config.competitorScriptEnabled,
              lastUpdated: Date.now()
            }, this.state.tabs.push(a), this.addLog("INFO", `Auto-registered V1 for browser tab ${e}`, "V1"), await this.persist());
          }
          if (a)
            return { success: !0, tab: a };
        }
        return { success: !0, tab: null };
      }
      case "REASSIGN_TAB_VNUMBER": {
        const e = (u = n.tab) == null ? void 0 : u.id, a = t.toVideoNumber || parseInt((t.toVNumber || "").replace(/\D/g, ""), 10);
        if (a && e) {
          const s = `V${a}`;
          this.state.tabs.forEach((c) => {
            c.chromeTabId === e && c.id !== s && (c.chromeTabId = null);
          });
          let i = this.state.tabs.find((c) => c.id === s);
          return i || (i = {
            id: s,
            index: a,
            title: "",
            masterPrompt: this.state.config.masterPrompt || "",
            qwenUrl: "https://chat.qwen.ai",
            initialMessage: "",
            status: "ready",
            currentPart: 1,
            totalParts: 0,
            parts: [],
            selected: !1,
            chromeTabId: e,
            thumbnailStatus: "none",
            scriptStatus: "none",
            scriptMode: this.state.config.scriptMode || "original",
            scriptOptional: (this.state.config.scriptMode || "original") === "original" || !this.state.config.competitorScriptEnabled,
            lastUpdated: Date.now()
          }, this.state.tabs.push(i)), i.chromeTabId = e, this.addLog("INFO", `Re-assigned browser tab ${e} from ${t.fromVNumber || "unknown"} to ${i.id}`, i.id), await this.persist(), { success: !0, tab: i };
        }
        return { success: !1 };
      }
      case "CONTENT_OUTLINE_DETECTED": {
        const e = this.state.tabs.find((a) => a.id === t.vNumber);
        return e && (e.outlineDetected = !0, t.outlineContent && (e.outlineContent = t.outlineContent), t.outlineStatus && (e.outlineStatus = t.outlineStatus), t.outlinePartInstructions && (e.outlinePartInstructions = t.outlinePartInstructions), t.lifecycleStage && (e.lifecycleStage = t.lifecycleStage), t.liveDebugStatus && (e.liveDebugStatus = t.liveDebugStatus), !e.manualOverride && t.totalParts && (e.totalParts = t.totalParts), this.addLog(
          "INFO",
          `${e.id}: [OUTLINE] Outline detected (${e.totalParts} total parts planned). Outline status: ${e.outlineStatus || "completed"}.`,
          e.id
        ), await this.persist()), { success: !0 };
      }
      case "OVERRIDE_TAB_PARTS": {
        const e = this.state.tabs.find((a) => a.id === t.vNumber);
        if (e) {
          t.totalParts && (e.totalParts = t.totalParts), t.currentPart && (e.currentPart = t.currentPart), typeof t.outlineDetected == "boolean" && (e.outlineDetected = t.outlineDetected), e.manualOverride = !0, e.parts || (e.parts = []);
          for (let s = 1; s <= e.totalParts; s++)
            if (!e.parts.some((i) => i.partNumber === s)) {
              const i = parseInt(e.id.replace(/\D/g, ""), 10) || 1;
              e.parts.push({
                partNumber: s,
                label: `${e.id} P${s}`,
                explicitMarker: `${e.id} P${s}`,
                videoNumber: i,
                status: s < e.currentPart ? "done" : s === e.currentPart ? "ready" : "waiting",
                content: "",
                downloaded: !1
              });
            }
          e.parts = e.parts.filter(
            (s) => s.partNumber <= e.totalParts || s.status === "done" && s.content && s.content.trim()
          ), e.parts.sort((s, i) => s.partNumber - i.partNumber);
          const a = x(e);
          e.mergeValidationStatus = a.valid ? "valid" : "invalid", this.addLog(
            "INFO",
            `[MANUAL] ${e.id}: Manual override applied. Total Parts = ${e.totalParts}, Current Part = ${e.currentPart}, Outline = ${e.outlineDetected ? "Generated ✓" : "None"}.`,
            e.id
          ), await this.persist();
        }
        return { success: !0 };
      }
      case "CONTENT_PART_DETECTED": {
        const e = this.state.tabs.find((a) => a.id === t.vNumber);
        if (e) {
          !e.manualOverride && t.totalParts && t.totalParts > 0 && (e.totalParts = t.totalParts, e.parts && e.parts.length > 0 && (e.parts = e.parts.filter(
            (s) => s.partNumber <= e.totalParts || s.status === "done" && s.content && s.content.trim()
          ))), e.parts || (e.parts = []), t.missingParts && (e.missingParts = t.missingParts), t.duplicateParts && (e.duplicateParts = t.duplicateParts), t.detectedVideoNumber && (e.detectedVideoNumber = t.detectedVideoNumber), t.lifecycleStage && (e.lifecycleStage = t.lifecycleStage), t.liveDebugStatus && (e.liveDebugStatus = t.liveDebugStatus);
          for (const s of t.parts || []) {
            const i = e.parts.find((c) => c.partNumber === s.partNumber);
            i ? (s.content && s.content.trim() && (i.content = s.content), s.heading && (i.heading = s.heading), s.explicitMarker && (i.explicitMarker = s.explicitMarker), s.videoNumber && (i.videoNumber = s.videoNumber), i.status === "done" && s.status !== "done" || (i.status = s.status)) : e.parts.push({ ...s });
          }
          e.parts.sort((s, i) => s.partNumber - i.partNumber);
          const a = x(e);
          if (e.mergeValidationStatus = a.valid ? "valid" : "invalid", a.valid && (e.status = "completed"), this.recalculateTabStatus(e), e.missingParts && e.missingParts.length > 0) {
            const s = e.missingParts.map((i) => `${e.id} P${i}`).join(", ");
            this.addLog("WARNING", `${e.id}: MISSING: ${s}`, e.id);
          }
          if (e.duplicateParts && e.duplicateParts.length > 0) {
            const s = e.duplicateParts.map((i) => `${e.id} P${i}`).join(", ");
            this.addLog("WARNING", `${e.id}: DUPLICATE: ${s}`, e.id);
          }
          await this.persist();
        }
        return { success: !0 };
      }
      case "CONTENT_PART_COMPLETED": {
        const e = this.state.tabs.find((a) => a.id === t.vNumber);
        if (e) {
          let a = e.parts.find((c) => c.partNumber === t.partNumber);
          a ? (a.status = "done", t.content && t.content.trim() && (a.content = t.content), t.heading && (a.heading = t.heading), t.explicitMarker && (a.explicitMarker = t.explicitMarker), t.videoNumber && (a.videoNumber = t.videoNumber), a.extractedAt = Date.now()) : (a = {
            partNumber: t.partNumber,
            label: t.explicitMarker || `${e.id} P${t.partNumber}`,
            explicitMarker: t.explicitMarker,
            videoNumber: t.videoNumber,
            heading: t.heading,
            status: "done",
            content: t.content,
            extractedAt: Date.now(),
            downloaded: !1
          }, e.parts.push(a)), e.parts.sort((c, r) => c.partNumber - r.partNumber);
          const s = e.parts.find((c) => c.partNumber === t.partNumber + 1);
          s && s.status === "waiting" && (s.status = "ready");
          const i = x(e);
          e.mergeValidationStatus = i.valid ? "valid" : "invalid", i.valid ? (e.status = "completed", this.addLog(
            "SUCCESS",
            `${e.id}: All ${e.totalParts} parts completed and verified. TXT MERGE VERIFIED ✓`,
            e.id
          )) : this.addLog(
            "SUCCESS",
            `${e.id} Part ${t.partNumber} completed successfully.`,
            e.id
          ), await this.persist(), this.state.config.autoInsertNextPart && s && e.chromeTabId ? (this.addLog("INFO", `[AUTO] ${e.id}: Auto Run toggle is ON. Automatically requesting Part ${s.partNumber}...`, e.id), setTimeout(() => this.insertNextPart(e.id, s.partNumber), 1500)) : s && this.addLog("INFO", `[MANUAL MODE] ${e.id}: Part ${t.partNumber} completed. Ready for manual Alt-Tab submission of Part ${s.partNumber} (or enable Auto Run toggle).`, e.id);
        }
        return { success: !0 };
      }
      case "CONTENT_EXECUTION_ERROR": {
        const e = this.state.tabs.find((a) => a.id === t.vNumber);
        return e && (e.status = "error", e.error = t.error, this.addLog("ERROR", `${e.id} error: ${t.error.problem}`, e.id, t.error), await this.persist()), { success: !0 };
      }
      case "LOG_MESSAGE":
        return this.addLog(t.level, t.message, t.vNumber, t.error), await this.persist(), { success: !0 };
      case "DOWNLOAD_FILE":
        return await this.downloadPartFile(t.vNumber, t.partNumber);
      default:
        return { success: !1, error: `Unknown action: ${t.type}` };
    }
  }
  /**
   * Duplicates tabs according to a specified Video ID range (e.g. V20 to V25) or count.
   * If startVideoId and endVideoId are provided, tabs strictly receive those IDs (e.g. V20, V21, V22...).
   */
  async duplicateChats(t, n, o, d, u) {
    const e = !!(u && u.length > 0), a = e ? Array.from(new Set(u)).sort((f, T) => f - T) : (() => {
      const f = o && o > 0 ? o : 1, T = d && d >= f ? d : f + Math.max(1, t) - 1, N = [];
      for (let g = f; g <= T; g++) N.push(g);
      return N;
    })();
    if (!e && o && d && o > d)
      return {
        success: !1,
        error: `Validation Error: Start Video ID (V${o}) cannot be greater than End Video ID (V${d}).`
      };
    if (a.length === 0)
      return { success: !1, error: "Invalid Video ID range. Must create at least 1 tab." };
    const s = a[0], i = a[a.length - 1], c = new Set(a);
    this.state.tabs = this.state.tabs.filter((f) => c.has(f.index));
    const h = (await chrome.tabs.query({})).filter((f) => f.url && this.isMetaUrl(f.url)), b = (await chrome.tabs.query({ active: !0, currentWindow: !0 }))[0];
    let I = "https://www.meta.ai/", P = null;
    b && b.url && this.isMetaUrl(b.url) ? (P = b, I = b.url) : h.length > 0 && (P = h[0], I = h[0].url || "https://www.meta.ai/");
    let S = (n || "").trim();
    if (!S && P && P.id)
      try {
        const f = await chrome.tabs.sendMessage(P.id, { type: "GET_CURRENT_INPUT_TEXT" });
        f && f.text && (S = f.text.trim());
      } catch {
      }
    S || (S = this.state.config.initialPrompt || "My Version of Title is:"), this.state.config.initialPrompt = S;
    const y = [], M = P && P.id ? this.state.tabs.some((f) => f.chromeTabId === P.id) : !0;
    let A = !1;
    for (const f of a) {
      const T = `V${f}`, N = this.state.tabs.findIndex((w) => w.id === T || w.index === f);
      let g = null;
      if (!A && !M && P && P.id)
        g = P.id, A = !0, this.addLog("INFO", `${T} assigned to active Qwen tab (Tab ID: ${g}).`, T);
      else
        try {
          g = (await chrome.tabs.create({
            url: I,
            active: !1
          })).id || null, this.addLog("INFO", `${T} opened (Meta Tab ID: ${g}).`, T);
        } catch (w) {
          this.addLog("ERROR", `Failed to open Meta tab for ${T}: ${w.message}`, T);
        }
      const $ = {
        id: T,
        index: f,
        chromeTabId: g,
        qwenUrl: I,
        metaUrl: I,
        status: "incomplete",
        selected: !0,
        initialMessage: S,
        title: "",
        masterPrompt: this.state.config.masterPrompt,
        thumbnailStatus: "none",
        scriptStatus: "none",
        scriptMode: this.state.config.scriptMode || "original",
        scriptOptional: (this.state.config.scriptMode || "original") === "original" || !this.state.config.competitorScriptEnabled,
        totalParts: 0,
        currentPart: 1,
        parts: [],
        lastUpdated: Date.now()
      };
      N >= 0 ? this.state.tabs[N] = $ : this.state.tabs.push($), y.push($), g && (chrome.tabs.sendMessage(g, { type: "UPDATE_HUD", tab: $ }).catch(() => {
      }), S && this.scheduleInitialTextInjection(g, S));
    }
    this.state.tabs.sort((f, T) => f.index - T.index);
    const _ = e ? a.map((f) => `V${f}`).join(", ") : `V${s}–V${i}`;
    return this.addLog("SUCCESS", `Duplicated ${y.length} tabs for ${_}.`), await this.persist(), { success: !0, count: y.length, range: _, tabs: this.state.tabs };
  }
  /**
   * Assigns titles to tabs sequentially or by explicit V-number marker.
   * Cuts off any excess titles beyond the selected range (below START or above END).
   */
  async assignTitles(t, n, o) {
    if (t.length === 0)
      return { success: !1, error: "No titles provided." };
    const d = n || 1, u = o || d + t.length - 1, e = this.state.tabs.filter((c, r) => {
      const h = r + 1;
      return c.index >= d && c.index <= u || h >= d && h <= u;
    }), a = /* @__PURE__ */ new Set(), s = [];
    for (const c of t) {
      const r = c.trim().match(/^(?:\[?\s*[vV](\d+)\s*\]?|Video\s*(\d+))[\s.:\-_–—]*/i);
      if (r) {
        const h = parseInt(r[1] || r[2], 10), p = e.find(
          (b) => (b.index === h || b.id === `V${h}`) && !a.has(b.id)
        );
        if (p) {
          p.title !== c && (p.title = c, p.titleInjected = !1, p.titlePushed = !1, p.titlePushStatus = "none", p.titleVerified = !1, p.pushedTitleText = void 0, p.verifiedTitleText = void 0), this.recalculateTabStatus(p), this.addLog("INFO", `Title assigned to ${p.id}: "${p.title}"`, p.id), a.add(p.id);
          continue;
        }
      }
      s.push(c);
    }
    let i = 0;
    for (const c of e)
      if (!a.has(c.id) && i < s.length) {
        const r = s[i];
        c.title !== r && (c.title = r, c.titleInjected = !1, c.titlePushed = !1, c.titlePushStatus = "none", c.titleVerified = !1, c.pushedTitleText = void 0, c.verifiedTitleText = void 0), this.recalculateTabStatus(c), this.addLog("INFO", `Title assigned to ${c.id}: "${c.title}"`, c.id), a.add(c.id), i++;
      }
    return this.addLog("INFO", `Assigned ${a.size} titles to range V${d}–V${u}.`), await this.persist(), { success: !0, tabs: this.state.tabs, assignedCount: a.size };
  }
  /**
   * Starts execution queue for target tabs ('all', 'selected', or specific V ID).
   */
  async startExecution(t) {
    var a;
    this.state.isPaused = !1;
    const n = this.getTargetTabs(t);
    if (n.length === 0) {
      const s = "No active Qwen browser tabs found matching selection. Please ensure Qwen tabs are open.";
      return this.addLog("WARNING", s), { success: !1, error: s };
    }
    for (const s of n) {
      if (!s.chromeTabId) continue;
      const i = this.state.config.masterPrompt || "";
      if (!s.masterPrompt && i && (s.masterPrompt = i), s.title && (s.titlePushStatus !== "pasted" || s.pushedTitleText !== s.title))
        try {
          const c = await chrome.tabs.sendMessage(s.chromeTabId, {
            type: "PASTE_PROMPT_ONLY",
            title: s.title,
            masterPrompt: s.masterPrompt || i,
            vNumber: s.id
          });
          c && (c.verified || c.success) && (s.titleInjected = !0, s.titlePushed = !0, s.titlePushStatus = "pasted", s.titleVerified = !0, s.pushedTitleText = s.title, s.verifiedTitleText = s.title, s.promptInjected = !0, s.masterPromptStatus = "sent", s.masterPromptVerified = !0);
        } catch {
        }
      if (s.thumbnailId && s.thumbnailPushStatus !== "pasted") {
        const c = await R(s.thumbnailId);
        if (c) {
          const r = await this.blobToBase64(c.blob);
          try {
            const h = await chrome.tabs.sendMessage(s.chromeTabId, {
              type: "PASTE_THUMBNAIL_ONLY",
              thumbnail: {
                name: c.asset.name || `${s.id}_thumb`,
                type: c.asset.type,
                base64: r
              },
              vNumber: s.id
            });
            h && (h.verified || h.success) && (s.thumbnailPasted = !0, s.thumbnailPushStatus = "pasted", s.thumbnailVerified = !0);
          } catch {
          }
        }
      }
      if (s.scriptPushStatus !== "pasted") {
        let c = "", r = `${s.id}_script.txt`;
        if (s.scriptId) {
          const h = await R(s.scriptId);
          h && (c = await h.blob.text(), r = h.asset.name || r);
        } else this.state.config.competitorScriptEnabled && ((a = this.state.config.competitorScriptText) != null && a.trim()) && (c = this.state.config.competitorScriptText.trim(), r = `${s.id}_Competitor_Script.txt`);
        if (c)
          try {
            const h = await chrome.tabs.sendMessage(s.chromeTabId, {
              type: "PASTE_SCRIPT_ONLY",
              script: {
                name: r,
                content: c
              },
              vNumber: s.id
            });
            h && (h.verified || h.success) && (s.scriptInjected = !0, s.scriptPushStatus = "pasted", s.scriptVerified = !0);
          } catch {
          }
      }
      this.recalculateTabStatus(s), chrome.tabs.sendMessage(s.chromeTabId, { type: "UPDATE_HUD", tab: s }).catch(() => {
      });
    }
    const o = [], d = (this.state.config.scriptMode || "original") === "original", u = !d && !!this.state.config.competitorScriptEnabled, e = !!(this.state.config.competitorScriptText && this.state.config.competitorScriptText.trim());
    for (const s of n) {
      const i = [];
      s.title || i.push("Title not assigned"), !s.masterPrompt && !this.state.config.masterPrompt && i.push("Master Prompt missing");
      const c = s.thumbnailId || s.thumbnailPasted || s.thumbnailStatus === "assigned", r = d || !u || s.scriptOptional || e || s.scriptId || s.scriptInjected || s.scriptStatus === "assigned";
      c || i.push("Thumbnail image not uploaded or pasted into chat"), r || i.push("Competitor script not provided (paste script or switch to Original Script Mode)"), i.length > 0 ? (s.status = "incomplete", o.push({ id: s.id, missing: i })) : s.status = "ready";
    }
    if (o.length > 0) {
      const s = o.map((c) => `${c.id}: [${c.missing.join("; ")}]`).join(`
`), i = d ? `Required assets missing for execution:

${s}

Please assign Titles, Master Prompt, and Thumbnails before running.` : `Required assets missing for execution:

${s}

Please upload Thumbnails and Competitor Scripts in the dashboard and push them to the Qwen chats before running.`;
      return this.addLog("ERROR", `Cannot run: ${o.length} tabs have missing files.`), await this.persist(), {
        success: !1,
        error: i,
        invalidTabs: o
      };
    }
    return n.forEach((s) => {
      this.executionQueue.includes(s.id) || this.executionQueue.push(s.id);
    }), this.addLog("INFO", `Enqueued ${n.length} tabs for execution. Starting queue now...`), this.processQueue(), await this.persist(), { success: !0, queuedCount: n.length };
  }
  /**
   * Concurrency-controlled execution queue processor.
   */
  async processQueue() {
    if (!(this.isProcessingQueue || this.state.isPaused)) {
      this.isProcessingQueue = !0;
      try {
        for (; this.executionQueue.length > 0 && !this.state.isPaused && this.state.activeExecutionCount < this.state.config.concurrencyLimit; ) {
          const t = this.executionQueue.shift();
          if (!t) continue;
          const n = this.state.tabs.find((d) => d.id === t);
          if (!n || !n.chromeTabId) continue;
          try {
            await chrome.tabs.update(n.chromeTabId, { active: !0 });
            const d = await chrome.tabs.get(n.chromeTabId);
            await chrome.windows.update(d.windowId, { focused: !0 });
          } catch {
            this.addLog("WARNING", `Could not switch to tab ${t}, it might be closed.`, t);
          }
          await new Promise((d) => setTimeout(d, 1e3)), this.state.activeExecutionCount++, this.runSingleTab(n).finally(() => {
            this.state.activeExecutionCount--, this.processQueue();
          });
          const o = Math.floor(5e3 + Math.random() * 1e4);
          this.addLog("INFO", `Human Pacing: Waiting ${(o / 1e3).toFixed(1)}s before navigating to next tab...`, t), await new Promise((d) => setTimeout(d, o));
        }
      } finally {
        this.isProcessingQueue = !1;
      }
    }
  }
  /**
   * Executes a single tab workflow: loads assets, sends payload to content script.
   */
  async runSingleTab(t) {
    if (t.status = "running", t.error = null, this.addLog("INFO", `${t.id} starting execution...`, t.id), await this.persist(), !t.chromeTabId) {
      t.status = "error", t.error = O("TAB_NOT_FOUND", { vNumber: t.id }), this.addLog("ERROR", `${t.id} has no Chrome Tab ID.`, t.id, t.error), await this.persist();
      return;
    }
    try {
      await chrome.tabs.sendMessage(t.chromeTabId, {
        type: "SUBMIT_CHAT_ONLY",
        vNumber: t.id
      });
    } catch (n) {
      t.status = "error", t.error = O("CUSTOM", {
        title: `${t.id} Execution Failed`,
        problem: n.message,
        vNumber: t.id
      }), this.addLog("ERROR", `${t.id} run error: ${n.message}`, t.id, t.error), await this.persist();
    }
  }
  /**
   * Retries execution for a failed tab.
   */
  async retryTab(t) {
    const n = this.state.tabs.find((o) => o.id === t);
    return n ? (n.status = "ready", n.error = null, this.executionQueue.includes(t) || this.executionQueue.push(t), this.addLog("INFO", `Retry queued for ${t}.`, t), this.processQueue(), await this.persist(), { success: !0 }) : { success: !1, error: `Tab ${t} not found.` };
  }
  /**
   * Retries a single specific part for a tab.
   * Switches to the tab, then inserts and runs that part exactly like normal generation.
   */
  async retryPart(t, n) {
    const o = this.state.tabs.find((u) => u.id === t);
    if (!o || !o.chromeTabId) return { success: !1, error: `Tab ${t} not found or closed.` };
    const d = o.parts.find((u) => u.partNumber === n);
    if (!d) return { success: !1, error: `Part ${n} not found in ${t}.` };
    this.addLog("INFO", `Retrying ${t} P${n}...`, t), d.status = "generating", o.status = "running", o.currentPart = n, await this.persist();
    try {
      await chrome.tabs.update(o.chromeTabId, { active: !0 });
    } catch {
    }
    try {
      return await chrome.tabs.sendMessage(o.chromeTabId, {
        type: "EXECUTE_NEXT_PART_ACTION",
        partNumber: n,
        totalParts: o.totalParts || 0,
        wordCount: o.partWordCount || this.state.config.partWordCount || 4e3
      }), { success: !0 };
    } catch (u) {
      return d.status = "error", o.status = "error", this.addLog("ERROR", `Retry P${n} failed for ${t}: ${u.message}`, t), await this.persist(), { success: !1, error: u.message };
    }
  }
  /**
   * Triggers content script to insert next part.
   */
  async insertNextPart(t, n) {
    const o = this.state.tabs.find((s) => s.id === t);
    if (!o || !o.chromeTabId) return { success: !1, error: "Tab not found." };
    try {
      await chrome.tabs.update(o.chromeTabId, { active: !0 });
      const s = await chrome.tabs.get(o.chromeTabId);
      s.windowId && await chrome.windows.update(s.windowId, { focused: !0 });
    } catch {
    }
    if (await new Promise((s) => setTimeout(s, 600)), !await new Promise((s) => {
      chrome.tabs.sendMessage(o.chromeTabId, { type: "PING" }, (i) => {
        s(!chrome.runtime.lastError && i && i.pong);
      }), setTimeout(() => s(!1), 300);
    }))
      try {
        await chrome.scripting.executeScript({
          target: { tabId: o.chromeTabId },
          files: ["content.js"]
        }), await new Promise((s) => setTimeout(s, 800));
      } catch {
      }
    o.status = "running", o.currentPart = n, o.error = null;
    let u = o.parts.find((s) => s.partNumber === n);
    if (u)
      u.status = "generating";
    else {
      const s = parseInt(o.id.replace(/\D/g, ""), 10) || 1;
      o.parts.push({
        partNumber: n,
        label: `${o.id} P${n}`,
        explicitMarker: `${o.id} P${n}`,
        videoNumber: s,
        status: "generating",
        content: "",
        downloaded: !1
      });
    }
    for (const s of o.parts)
      s.partNumber !== n && s.status === "generating" && (s.status = "waiting");
    this.addLog("INFO", `${o.id}: Writing Part ${n} Script...`, o.id), await this.persist();
    const a = (o.scriptMode === "original" || (this.state.config.scriptMode || "original") === "original") && o.outlinePartInstructions ? o.outlinePartInstructions[n] : void 0;
    try {
      const s = await chrome.tabs.sendMessage(o.chromeTabId, {
        type: "EXECUTE_NEXT_PART_ACTION",
        partNumber: n,
        totalParts: o.totalParts || 0,
        wordCount: o.partWordCount || this.state.config.partWordCount || 4e3,
        outlineInstruction: a
      });
      return s && s.error ? (o.status = "error", o.error = O("CUSTOM", {
        title: `Part ${n} Request Failed`,
        problem: s.error,
        vNumber: o.id
      }), this.addLog("ERROR", `${o.id} Part ${n} request failed: ${s.error}`, o.id, o.error), await this.persist(), { success: !1, error: s.error }) : { success: !0 };
    } catch (s) {
      return o.status = "error", o.error = O("CUSTOM", {
        title: `Part ${n} Request Failed`,
        problem: s.message,
        vNumber: o.id
      }), this.addLog("ERROR", `${o.id} Part ${n} error: ${s.message}`, o.id, o.error), await this.persist(), { success: !1, error: s.message };
    }
  }
  /**
   * Downloads a single generated part text file via chrome.downloads API.
   */
  async downloadPartFile(t, n) {
    const o = this.state.tabs.find((a) => a.id === t);
    if (!o) return { success: !1, error: "Tab not found." };
    const d = o.parts.find((a) => a.partNumber === n);
    if (!d || !d.content)
      return { success: !1, error: `Part ${n} content not available.` };
    const u = `${t} P${n}.txt`, e = `data:text/plain;charset=utf-8,${encodeURIComponent(d.content)}`;
    try {
      const a = await chrome.downloads.download({
        url: e,
        filename: u,
        saveAs: !1
      });
      return d.downloaded = !0, this.addLog("SUCCESS", `Downloaded ${u} (ID: ${a}).`, t), await this.persist(), { success: !0, downloadId: a };
    } catch (a) {
      return this.addLog("ERROR", `Download failed for ${u}: ${a.message}`, t), { success: !1, error: a.message };
    }
  }
  getTargetTabs(t) {
    const n = t || "all";
    return this.state.tabs.filter((o) => o.chromeTabId ? n === "all" ? !0 : n === "selected" ? o.selected : o.id === n : !1);
  }
  handleTabClosed(t) {
    const n = this.state.tabs.find((o) => o.chromeTabId === t);
    n && (n.chromeTabId = null, n.status = "error", n.error = O("TAB_NOT_FOUND", { vNumber: n.id }), this.addLog("WARNING", `${n.id} browser tab was closed.`, n.id, n.error), this.persist());
  }
  handleTabLoaded(t) {
    const n = this.state.tabs.find((o) => o.chromeTabId === t);
    n && n.initialMessage && !n.initialMessageInjected && n.status !== "running" && n.status !== "completed" && (n.initialMessageInjected = !0, this.scheduleInitialTextInjection(t, n.initialMessage));
  }
  scheduleInitialTextInjection(t, n) {
    [600, 1500, 3e3, 5e3].forEach((d) => {
      setTimeout(() => {
        chrome.tabs.sendMessage(t, {
          type: "INJECT_INITIAL_TEXT",
          text: n
        }).catch(() => {
        });
      }, d);
    });
  }
  reindexTabs() {
    this.state.tabs.forEach((t, n) => {
      const o = n + 1;
      t.index = o, t.id = `V${o}`, t.chromeTabId && chrome.tabs.sendMessage(t.chromeTabId, {
        type: "UPDATE_HUD",
        tab: t
      }).catch(() => {
      });
    });
  }
  recalculateTabStatus(t) {
    if (t.status === "running" || t.status === "completed") return;
    const n = !!t.title, o = !!t.masterPrompt, d = t.thumbnailStatus !== "none" || t.thumbnailPasted || !!t.thumbnailId, u = t.scriptMode === "original" || (this.state.config.scriptMode || "original") === "original", e = !u && !!this.state.config.competitorScriptEnabled, a = !!(this.state.config.competitorScriptText && this.state.config.competitorScriptText.trim()), s = u || !e || t.scriptOptional || a || t.scriptStatus !== "none" || t.scriptInjected || !!t.scriptId;
    n && o && d && s ? (t.status = "ready", t.error = null) : t.status = "incomplete";
  }
  addLog(t, n, o, d) {
    const u = /* @__PURE__ */ new Date(), e = u.toTimeString().split(" ")[0], a = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timeStr: e,
      isoTime: u.toISOString(),
      level: t,
      message: n,
      vNumber: o,
      errorDetails: d
    };
    this.state.logs.unshift(a), this.state.logs.length > 500 && this.state.logs.pop();
  }
  /**
   * Resyncs all managed tabs by querying their content scripts in parallel.
   * Scans DOM for parts, updates part state, completion status, and broadcasts HUD updates.
   */
  async resyncAllTabs() {
    this.addLog("INFO", "Starting parallel resync across all managed tabs...");
    const t = await chrome.tabs.query({}), n = new Set(t.map((u) => u.id).filter((u) => u !== void 0));
    let o = 0;
    const d = this.state.tabs.map(async (u) => {
      if (!(!u.chromeTabId || !n.has(u.chromeTabId)))
        try {
          const e = await new Promise((s) => {
            chrome.tabs.sendMessage(
              u.chromeTabId,
              { type: "RESYNC_DOM_NOW", tab: u },
              (i) => {
                chrome.runtime.lastError ? s(null) : s(i);
              }
            ), setTimeout(() => s(null), 1500);
          }), a = e && (e.parts || e.tab && e.tab.parts) || null;
          if (a && Array.isArray(a)) {
            u.parts = a, e.tab && (u.currentPart = e.tab.currentPart || u.currentPart, u.totalParts = e.tab.totalParts || u.totalParts, e.tab.outlineDetected && (u.outlineDetected = !0), e.tab.outlineContent && (u.outlineContent = e.tab.outlineContent), e.tab.detectedVideoNumber && (u.detectedVideoNumber = e.tab.detectedVideoNumber));
            const s = x(u);
            u.mergeValidationStatus = s.valid ? "valid" : "invalid", s.valid ? u.status = "completed" : this.recalculateTabStatus(u), u.lastUpdated = Date.now(), o++, chrome.tabs.sendMessage(u.chromeTabId, {
              type: "UPDATE_HUD",
              tab: u
            }).catch(() => {
            });
          }
        } catch (e) {
          console.warn(`Resync error for ${u.id}:`, e);
        }
    });
    return await Promise.all(d), await this.persist(), this.addLog("SUCCESS", `Resynced ${o} managed tabs from live DOM.`), this.state.tabs;
  }
  /**
   * Reconciles all open browser tabs, links open Qwen tabs to VTabs,
   * re-injects content scripts if disconnected on extension reload,
   * and requests live DOM status & parts detection.
   */
  async reconcileAndInjectTabs() {
    try {
      const t = await chrome.tabs.query({}), n = new Set(t.map((d) => d.id).filter((d) => d !== void 0));
      this.state.tabs.forEach((d) => {
        d.chromeTabId && !n.has(d.chromeTabId) && (d.chromeTabId = null);
      });
      const o = t.filter(
        (d) => d.id && d.url && this.isQwenUrl(d.url)
      );
      for (const d of o) {
        if (!d.id) continue;
        let u = this.state.tabs.find((a) => a.chromeTabId === d.id);
        if (u || (u = this.state.tabs.find((a) => !a.chromeTabId), u && (u.chromeTabId = d.id)), await new Promise((a) => {
          chrome.tabs.sendMessage(d.id, { type: "PING" }, (s) => {
            chrome.runtime.lastError || !s || !s.pong ? a(!1) : a(!0);
          }), setTimeout(() => a(!1), 250);
        })) {
          if (u)
            try {
              chrome.tabs.sendMessage(
                d.id,
                { type: "SCAN_DOM_NOW", tab: u },
                () => {
                  chrome.runtime.lastError;
                }
              );
            } catch {
            }
        } else try {
          await chrome.scripting.executeScript({
            target: { tabId: d.id },
            files: ["content.js"]
          }), await chrome.scripting.insertCSS({
            target: { tabId: d.id },
            files: ["floatingPanel.css"]
          }).catch(() => {
          });
        } catch {
        }
      }
      return await this.persist(), this.state.tabs;
    } catch (t) {
      return console.warn("reconcileAndInjectTabs error:", t), this.state.tabs;
    }
  }
  async persist() {
    await G(this.state);
  }
  isMetaUrl(t) {
    return t ? t.includes("meta.ai") || t.includes("www.meta.ai") || t.includes("mockMeta.html") || t.includes("chat.qwen.ai") || t.includes("qwen.ai") || t.includes("mockQwen.html") || t.startsWith("http://localhost") || t.startsWith("http://127.0.0.1") : !1;
  }
  isQwenUrl(t) {
    return this.isMetaUrl(t);
  }
  async blobToBase64(t) {
    return new Promise((n) => {
      const o = new FileReader();
      o.onloadend = () => n(o.result), o.readAsDataURL(t);
    });
  }
}
new j();
