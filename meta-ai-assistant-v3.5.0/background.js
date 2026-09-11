var F = Object.defineProperty;
var Q = (b, t, r) => t in b ? F(b, t, { enumerable: !0, configurable: !0, writable: !0, value: r }) : b[t] = r;
var O = (b, t, r) => Q(b, typeof t != "symbol" ? t + "" : t, r);
const k = "MetaExtensionDB";
const C = "assets";
function B() {
  return new Promise((b, t) => {
    const r = indexedDB.open(k, 1);
    r.onupgradeneeded = () => {
      const n = r.result;
      n.objectStoreNames.contains(C) || n.createObjectStore(C, { keyPath: "id" });
    }, r.onsuccess = () => b(r.result), r.onerror = () => t(r.error);
  });
}
async function R(b) {
  const t = await B();
  return new Promise((r, n) => {
    const e = t.transaction(C, "readonly").objectStore(C).get(b);
    e.onsuccess = () => {
      const s = e.result;
      if (!s) {
        r(null);
        return;
      }
      const a = new Blob([s.data], { type: s.type });
      r({
        asset: {
          id: s.id,
          name: s.name,
          size: s.size,
          type: s.type,
          dataUrl: s.dataUrl,
          textSnippet: s.textSnippet,
          createdAt: s.createdAt
        },
        blob: a
      });
    }, e.onerror = () => n(e.error);
  });
}
const x = "meta_assistant_workflow_state", v = "qwen_assistant_workflow_state";
async function V() {
  return typeof chrome > "u" || !chrome.storage || !chrome.storage.local ? null : new Promise((b) => {
    chrome.storage.local.get([x, v], (t) => {
      b(t[x] || t[v] || null);
    });
  });
}
async function j(b) {
  if (!(typeof chrome > "u" || !chrome.storage || !chrome.storage.local))
    return new Promise((t) => {
      chrome.storage.local.set({ [x]: b }, () => {
        t();
      });
    });
}
function L(b, t) {
  const r = `err_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  switch (b) {
    case "INPUT_NOT_FOUND":
      return {
        id: r,
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
        id: r,
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
        id: r,
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
        id: r,
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
        id: r,
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
        id: r,
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
        id: r,
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
        id: r,
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
        id: r,
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
        id: r,
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
function D(b) {
  const t = b.id || "V1", r = b.totalParts || 0, n = b.parts || [], c = [], d = [], e = [], s = n.filter((u) => u.status === "done" && u.content && u.content.trim().length > 0), a = /^V\d+$/i.test(t);
  c.push({
    id: "check-vnum",
    name: "Correct Video Number",
    passed: a,
    detail: a ? `Video ID is verified as ${t}` : `Invalid Video ID: ${t}`
  }), a || d.push(`Invalid video ID: "${t}". Expected format: V1, V2, etc.`);
  const i = r > 0;
  c.push({
    id: "check-total",
    name: "Total Parts Defined",
    passed: i,
    detail: i ? `Total parts detected/specified: ${r}` : "Total parts is undefined or 0"
  }), i || d.push(`${t}: Total parts count has not been detected or set.`);
  const o = s.map((u) => u.partNumber), l = [];
  for (let u = 1; u <= (r || s.length); u++)
    o.includes(u) || l.push(u);
  const p = l.length === 0 && s.length > 0;
  c.push({
    id: "check-missing",
    name: "No Missing Parts",
    passed: p,
    detail: p ? `All ${r} parts are present` : `MISSING: ${l.map((u) => `${t} P${u}`).join(", ")}`
  }), p || d.push(`MISSING: ${l.map((u) => `${t} P${u}`).join(", ")}`);
  const P = o.filter((u, N) => o.indexOf(u) !== N), T = Array.from(new Set(P)), I = T.length === 0;
  c.push({
    id: "check-duplicates",
    name: "No Duplicated Parts",
    passed: I,
    detail: I ? "Zero duplicate parts" : `DUPLICATE: ${T.map((u) => `${t} P${u}`).join(", ")}`
  }), I || d.push(`DUPLICATE: ${T.map((u) => `${t} P${u}`).join(", ")}`);
  const g = [...s].sort((u, N) => u.partNumber - N.partNumber);
  let w = !0;
  for (let u = 0; u < g.length; u++)
    if (g[u].partNumber !== u + 1) {
      w = !1;
      break;
    }
  c.push({
    id: "check-sequential",
    name: "Sequential Ordering",
    passed: w,
    detail: w ? "Strict 1..N numerical ordering confirmed" : "Parts are out of order or contain gaps"
  }), w || d.push(`${t}: Parts sequence is non-contiguous or contains gaps.`);
  const E = s.filter((u) => !u.heading || u.heading.trim().length === 0 || /^part\s*\d+$/i.test(u.heading.trim())), M = E.length === 0;
  c.push({
    id: "check-headings",
    name: "Content-Based Headings",
    passed: M,
    detail: M ? "All parts have meaningful headings" : `${E.length} part(s) using generic or empty heading`
  }), M || e.push(`${t}: Parts ${E.map((u) => `P${u.partNumber}`).join(", ")} will be assigned intelligent content-based headings upon export.`);
  const y = s.filter((u) => !u.content || u.content.trim().length < 25), $ = y.length === 0;
  c.push({
    id: "check-content",
    name: "Complete Script Content",
    passed: $,
    detail: $ ? "All parts contain complete script prose" : `${y.length} part(s) contain empty or partial content`
  }), $ || d.push(`${t}: Part(s) ${y.map((u) => `P${u.partNumber}`).join(", ")} have incomplete script content.`);
  const h = s.some((u) => {
    const N = u.partNumber === 1, U = /^(?:#+\s*)?(?:video\s+|script\s+)?outline\b/i.test(u.content.trim());
    return N && U && u.content.trim().length < 400;
  });
  c.push({
    id: "check-no-outline",
    name: "Outline Isolated",
    passed: !h,
    detail: h ? "Part 1 appears to contain an outline instead of script prose" : "No outline is treated as a script part"
  }), h && d.push(`${t}: Part 1 appears to contain the Outline rather than actual script text. Wait for Part 1 generation.`);
  const m = parseInt(t.replace(/\D/g, ""), 10) || 1, S = s.filter((u) => {
    if (u.videoNumber && u.videoNumber !== m) return !0;
    if (u.explicitMarker) {
      const N = u.explicitMarker.match(/V(\d+)/i);
      if (N && parseInt(N[1], 10) !== m) return !0;
    }
    return !1;
  }), f = S.length === 0;
  c.push({
    id: "check-cross-video",
    name: "Strict Video Isolation",
    passed: f,
    detail: f ? `All parts strictly isolated to ${t}` : `Cross-video parts detected: ${S.map((u) => u.explicitMarker || `P${u.partNumber}`).join(", ")}`
  }), f || d.push(`${t}: Foreign video parts detected: ${S.map((u) => u.explicitMarker || `P${u.partNumber}`).join(", ")}. Different videos must never be merged.`);
  const A = d.length === 0 && s.length > 0 && (r > 0 ? s.length >= r : !0), _ = A ? "TXT MERGE VERIFIED ✓" : d.length === 0 ? "IN PROGRESS ⏳" : "MERGE VALIDATION FAILED ✕";
  return {
    valid: A,
    videoNumber: t,
    totalParts: r,
    completedPartsCount: s.length,
    checks: c,
    errors: d,
    warnings: e,
    statusLabel: _
  };
}
class G {
  constructor() {
    O(this, "state", {
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
    O(this, "executionQueue", []);
    O(this, "isProcessingQueue", !1);
    O(this, "readyPromise");
    this.setupListeners(), this.readyPromise = this.init();
  }
  setupListeners() {
    chrome.runtime.onMessage.addListener((t, r, n) => (this.readyPromise.then(() => this.handleMessage(t, r)).then((c) => n(c)).catch((c) => n({ success: !1, error: c.message })), !0)), chrome.tabs.onRemoved.addListener((t) => {
      this.readyPromise.then(() => this.handleTabClosed(t));
    }), chrome.tabs.onUpdated.addListener((t, r) => {
      r.status === "complete" && this.readyPromise.then(() => this.handleTabLoaded(t));
    }), chrome.runtime.onInstalled.addListener(() => {
      this.readyPromise.then(() => this.reconcileAndInjectTabs());
    }), chrome.runtime.onStartup.addListener(() => {
      this.readyPromise.then(() => this.reconcileAndInjectTabs());
    });
  }
  async init() {
    const t = await V();
    t && (this.state = t, this.addLog("INFO", "Restored previous workflow state from storage.")), chrome.sidePanel && chrome.sidePanel.setPanelBehavior && chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: !1 }).catch(() => {
    }), await this.reconcileAndInjectTabs();
  }
  async handleMessage(t, r) {
    var n, c, d;
    switch (t.type) {
      case "GET_STATE":
        return { success: !0, state: this.state };
      case "SET_STATE":
        return this.state = { ...this.state, ...t.state }, await this.persist(), { success: !0, state: this.state };
      case "THUMBNAIL_UPLOAD_STARTED": {
        const e = this.state.tabs.find((s) => s.id === t.vNumber);
        return e && (e.thumbnailUploading = !0, this.persist()), { success: !0 };
      }
      case "THUMBNAIL_UPLOAD_COMPLETE": {
        const e = this.state.tabs.find((s) => s.id === t.vNumber);
        return e && (e.thumbnailUploading = !1, e.thumbnailPasted = !0, this.recalculateTabStatus(e), this.persist()), { success: !0 };
      }
      case "GET_ACTIVE_META_TAB":
      case "GET_ACTIVE_QWEN_TAB": {
        const s = (await chrome.tabs.query({ active: !0, currentWindow: !0 }))[0], a = (s == null ? void 0 : s.url) && this.isMetaUrl(s.url);
        return { success: !0, tab: s, isQwen: a, isMeta: a };
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
        const { tabIds: e, selected: s } = t;
        return this.state.tabs.forEach((a) => {
          e.includes(a.id) && (a.selected = s);
        }), await this.persist(), { success: !0, tabs: this.state.tabs };
      }
      case "SELECT_RANGE": {
        const { startIndex: e, endIndex: s } = t;
        return this.state.tabs.forEach((a, i) => {
          const o = i + 1;
          a.selected = a.index >= e && a.index <= s || o >= e && o <= s;
        }), await this.persist(), { success: !0, tabs: this.state.tabs };
      }
      case "ASSIGN_TITLES":
        return await this.assignTitles(t.titles, t.startIndex, t.endIndex);
      case "SET_MASTER_PROMPT": {
        const { prompt: e, target: s } = t;
        return this.state.config.masterPrompt = e, this.state.tabs.forEach((a) => {
          (s === "all" || a.selected) && (a.masterPrompt = e, this.recalculateTabStatus(a));
        }), this.addLog("SUCCESS", `Master prompt applied to ${s === "all" ? "all" : "selected"} tabs.`), await this.persist(), { success: !0, tabs: this.state.tabs };
      }
      case "ASSIGN_THUMBNAILS":
        return t.assets.forEach((e) => {
          const s = this.state.tabs.find((a) => a.id === e.vNumber);
          s && (s.thumbnailId = e.assetId, s.thumbnailName = e.name, s.thumbnailStatus = "assigned", this.recalculateTabStatus(s));
        }), this.addLog("SUCCESS", `Thumbnails mapped to ${t.assets.length} tabs.`), await this.persist(), { success: !0, tabs: this.state.tabs };
      case "ASSIGN_SCRIPTS":
        return t.assets.forEach((e) => {
          const s = this.state.tabs.find((a) => a.id === e.vNumber);
          s && (s.scriptId = e.assetId, s.scriptName = e.name, s.scriptStatus = "assigned", this.recalculateTabStatus(s));
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
        return this.state.config.scriptMode = e, this.state.config.competitorScriptEnabled = e === "competitor", this.state.tabs.forEach((s) => {
          s.scriptMode = e, s.scriptOptional = e === "original", this.recalculateTabStatus(s);
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
        return this.state.config.partWordCount = e, this.state.tabs.forEach((s) => {
          s.partWordCount = e;
        }), this.addLog("INFO", `Part Word Count updated to ${e} words.`), await this.persist(), { success: !0, partWordCount: e };
      }
      case "SET_SCRIPT_OPTIONAL": {
        const e = this.state.tabs.find((s) => s.id === t.vNumber);
        return e && (e.scriptOptional = t.optional, await this.persist()), { success: !0 };
      }
      case "INSERT_NEXT_PART":
        return await this.insertNextPart(t.vNumber, t.partNumber);
      case "CANCEL_TAB": {
        const e = t.vNumber;
        this.executionQueue = this.executionQueue.filter((a) => a !== e);
        const s = this.state.tabs.find((a) => a.id === e);
        return s && (s.status = "ready", this.addLog("WARNING", `Execution cancelled for ${e}.`, e), await this.persist()), { success: !0 };
      }
      case "RESTART_TAB": {
        const e = t.vNumber, s = this.state.tabs.find((a) => a.id === e);
        return s && (s.status = "ready", s.parts = [], s.totalParts = 0, s.currentPart = 1, s.error = null, this.recalculateTabStatus(s), this.executionQueue.includes(e) || this.executionQueue.push(e), this.addLog("INFO", `Restarted ${e} from beginning. Queued for execution.`, e), this.processQueue(), await this.persist()), { success: !0 };
      }
      case "REFRESH_TAB": {
        const e = t.vNumber, s = this.state.tabs.find((a) => a.id === e);
        return s && s.chromeTabId && (await new Promise((i) => {
          chrome.tabs.sendMessage(s.chromeTabId, { type: "PING" }, (o) => {
            i(!chrome.runtime.lastError && o && o.pong);
          }), setTimeout(() => i(!1), 200);
        }) ? chrome.tabs.sendMessage(s.chromeTabId, { type: "SCAN_DOM_NOW", tab: s }).catch(() => {
        }) : (await chrome.scripting.executeScript({
          target: { tabId: s.chromeTabId },
          files: ["content.js"]
        }).catch(() => {
        }), await chrome.scripting.insertCSS({
          target: { tabId: s.chromeTabId },
          files: ["floatingPanel.css"]
        }).catch(() => {
        })), this.addLog("INFO", `Re-synced state for ${e} in-place (no page reload).`, e)), { success: !0 };
      }
      case "REFRESH_ALL_TABS": {
        const e = await this.reconcileAndInjectTabs();
        return this.addLog("INFO", `Re-synced and verified ${e.length} managed Meta.ai tabs in-place.`), { success: !0, tabs: e };
      }
      case "RESYNC_ALL_TABS": {
        for (const e of this.state.tabs)
          e.chromeTabId && chrome.tabs.sendMessage(e.chromeTabId, { type: "SCAN_DOM_NOW", tab: e }).catch(() => {
          });
        return this.addLog("INFO", `Global Re-sync: Requested live DOM scan across all ${this.state.tabs.length} managed tabs.`), await this.persist(), { success: !0, tabs: this.state.tabs };
      }
      case "REMOVE_TAB": {
        const e = t.vNumber;
        return this.executionQueue = this.executionQueue.filter((s) => s !== e), this.state.tabs = this.state.tabs.filter((s) => s.id !== e), this.reindexTabs(), this.addLog("INFO", `Removed ${e} from dashboard. Reindexed remaining tabs to V1..V${this.state.tabs.length}.`), await this.persist(), { success: !0, tabs: this.state.tabs };
      }
      case "CLEAR_COMPLETED_TABS": {
        const e = this.state.tabs.length;
        return this.state.tabs = this.state.tabs.filter((s) => s.status !== "completed"), this.reindexTabs(), this.addLog("INFO", `Cleared ${e - this.state.tabs.length} completed tabs. Reindexed remaining to V1..V${this.state.tabs.length}.`), await this.persist(), { success: !0, tabs: this.state.tabs };
      }
      case "CLEAR_CLOSED_TABS": {
        const e = await chrome.tabs.query({}), s = new Set(e.map((i) => i.id)), a = this.state.tabs.length;
        return this.state.tabs = this.state.tabs.filter((i) => i.chromeTabId && s.has(i.chromeTabId)), this.reindexTabs(), this.addLog("INFO", `Cleared ${a - this.state.tabs.length} closed tabs. Reindexed remaining to V1..V${this.state.tabs.length}.`), await this.persist(), { success: !0, tabs: this.state.tabs };
      }
      case "REINDEX_TABS":
        return this.reindexTabs(), this.addLog("INFO", `Renumbered all tabs sequentially (V1..V${this.state.tabs.length}).`), await this.persist(), { success: !0, tabs: this.state.tabs };
      case "BATCH_TAB_ACTION": {
        const { action: e, tabIds: s } = t, a = this.state.tabs.filter((i) => s.includes(i.id));
        if (e === "restart") {
          for (const i of a)
            i.status = "ready", i.parts = [], i.totalParts = 0, i.currentPart = 1, i.error = null, this.recalculateTabStatus(i), this.executionQueue.includes(i.id) || this.executionQueue.push(i.id);
          this.addLog("INFO", `Restarted ${a.length} selected tabs from Part 1.`), this.processQueue();
        } else if (e === "retry") {
          const i = a.filter((o) => o.status === "error" || o.status === "incomplete");
          for (const o of i)
            o.error = null, this.recalculateTabStatus(o), this.executionQueue.includes(o.id) || this.executionQueue.push(o.id);
          this.addLog("INFO", `Retried ${i.length} selected tabs.`), this.processQueue();
        } else if (e === "refresh") {
          for (const i of a)
            i.chromeTabId && (await new Promise((l) => {
              chrome.tabs.sendMessage(i.chromeTabId, { type: "PING" }, (p) => {
                l(!chrome.runtime.lastError && p && p.pong);
              }), setTimeout(() => l(!1), 200);
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
          this.addLog("INFO", `Re-synced state in-place for ${a.length} selected tabs.`);
        } else if (e === "cancel") {
          this.executionQueue = this.executionQueue.filter((i) => !s.includes(i));
          for (const i of a)
            i.status === "running" && (i.status = "ready");
          this.addLog("WARNING", `Cancelled execution for ${a.length} selected tabs.`);
        } else e === "remove" && (this.executionQueue = this.executionQueue.filter((i) => !s.includes(i)), this.state.tabs = this.state.tabs.filter((i) => !s.includes(i.id)), this.reindexTabs(), this.addLog("INFO", `Removed ${a.length} selected tabs. Reindexed remaining tabs to V1..V${this.state.tabs.length}.`));
        return await this.persist(), { success: !0, tabs: this.state.tabs };
      }
      case "PUSH_TITLES_TO_CHATS":
      case "STAGE_PASTE_PROMPTS": {
        const e = t.target || "all", s = this.getTargetTabs(e);
        let a = 0;
        for (const i of s)
          i.chromeTabId && (i.titleInjected = !!i.title, i.promptInjected = !!(i.masterPrompt || this.state.config.masterPrompt), this.recalculateTabStatus(i), chrome.tabs.sendMessage(i.chromeTabId, {
            type: "PASTE_PROMPT_ONLY",
            title: i.title,
            masterPrompt: i.masterPrompt || this.state.config.masterPrompt,
            vNumber: i.id
          }).catch(() => {
          }), chrome.tabs.sendMessage(i.chromeTabId, { type: "UPDATE_HUD", tab: i }).catch(() => {
          }), a++);
        return this.addLog("INFO", `Stage 1 / Push Titles: Injected into ${a} Qwen chat inputs (${e}).`), await this.persist(), { success: !0, count: a, tabs: this.state.tabs };
      }
      case "PUSH_PROMPT_TO_CHATS": {
        const e = t.target || "all", s = this.getTargetTabs(e);
        let a = 0;
        for (const i of s)
          i.chromeTabId && (i.promptInjected = !0, this.recalculateTabStatus(i), chrome.tabs.sendMessage(i.chromeTabId, {
            type: "PASTE_PROMPT_ONLY",
            title: i.title,
            masterPrompt: i.masterPrompt || this.state.config.masterPrompt,
            vNumber: i.id
          }).catch(() => {
          }), chrome.tabs.sendMessage(i.chromeTabId, { type: "UPDATE_HUD", tab: i }).catch(() => {
          }), a++);
        return this.addLog("INFO", `Push Prompt: Injected master prompt into ${a} Qwen chats (${e}).`), await this.persist(), { success: !0, count: a, tabs: this.state.tabs };
      }
      case "PUSH_THUMBNAILS_TO_CHATS":
      case "STAGE_PASTE_THUMBNAILS": {
        const e = t.target || "all", s = this.getTargetTabs(e);
        let a = 0;
        for (const i of s)
          if (i.chromeTabId && i.thumbnailId) {
            const o = await R(i.thumbnailId);
            if (o) {
              const l = await this.blobToBase64(o.blob);
              i.thumbnailPasted = !0, this.recalculateTabStatus(i), chrome.tabs.sendMessage(i.chromeTabId, {
                type: "PASTE_THUMBNAIL_ONLY",
                thumbnail: {
                  name: o.asset.name || `${i.id}_thumb`,
                  type: o.asset.type,
                  base64: l
                },
                vNumber: i.id
              }).catch(() => {
              }), chrome.tabs.sendMessage(i.chromeTabId, { type: "UPDATE_HUD", tab: i }).catch(() => {
              }), a++;
            }
          }
        return this.addLog("INFO", `Stage 2 / Push Thumbnails: Dispatched clipboard paste to ${a} Qwen chats (${e}).`), await this.persist(), { success: !0, count: a, tabs: this.state.tabs };
      }
      case "PUSH_SCRIPTS_TO_CHATS":
      case "STAGE_PASTE_SCRIPTS": {
        const e = t.target || "all", s = this.getTargetTabs(e);
        let a = 0;
        for (const i of s) {
          if (!i.chromeTabId) continue;
          let o = "", l = `${i.id}_script.txt`;
          if (i.scriptId) {
            const p = await R(i.scriptId);
            p && (o = await p.blob.text(), l = p.asset.name || l);
          } else this.state.config.competitorScriptEnabled && ((n = this.state.config.competitorScriptText) != null && n.trim()) && (o = this.state.config.competitorScriptText.trim(), l = `${i.id}_Competitor_Script.txt`);
          o && (i.scriptInjected = !0, this.recalculateTabStatus(i), chrome.tabs.sendMessage(i.chromeTabId, {
            type: "PASTE_SCRIPT_ONLY",
            script: {
              name: l,
              content: o
            },
            vNumber: i.id
          }).catch(() => {
          }), chrome.tabs.sendMessage(i.chromeTabId, { type: "UPDATE_HUD", tab: i }).catch(() => {
          }), a++);
        }
        return this.addLog("INFO", `Stage 3 / Push Scripts: Embedded competitor scripts into ${a} Qwen chats (${e}).`), await this.persist(), { success: !0, count: a, tabs: this.state.tabs };
      }
      case "PUSH_ALL_ASSETS_TO_CHATS": {
        const e = t.target || "all", s = this.getTargetTabs(e);
        let a = 0;
        for (const i of s)
          if (i.chromeTabId) {
            if (i.titleInjected = !!i.title, i.promptInjected = !!(i.masterPrompt || this.state.config.masterPrompt), chrome.tabs.sendMessage(i.chromeTabId, {
              type: "PASTE_PROMPT_ONLY",
              title: i.title,
              masterPrompt: i.masterPrompt || this.state.config.masterPrompt,
              vNumber: i.id
            }).catch(() => {
            }), i.thumbnailId) {
              const o = await R(i.thumbnailId);
              if (o) {
                const l = await this.blobToBase64(o.blob);
                i.thumbnailPasted = !0, chrome.tabs.sendMessage(i.chromeTabId, {
                  type: "PASTE_THUMBNAIL_ONLY",
                  thumbnail: {
                    name: o.asset.name || `${i.id}_thumb`,
                    type: o.asset.type,
                    base64: l
                  },
                  vNumber: i.id
                }).catch(() => {
                });
              }
            }
            if (i.scriptId) {
              const o = await R(i.scriptId);
              if (o) {
                const l = await o.blob.text();
                i.scriptInjected = !0, chrome.tabs.sendMessage(i.chromeTabId, {
                  type: "PASTE_SCRIPT_ONLY",
                  script: {
                    name: o.asset.name || `${i.id}_script.txt`,
                    content: l
                  },
                  vNumber: i.id
                }).catch(() => {
                });
              }
            }
            this.recalculateTabStatus(i), chrome.tabs.sendMessage(i.chromeTabId, { type: "UPDATE_HUD", tab: i }).catch(() => {
            }), a++;
          }
        return this.addLog("INFO", `All Pushing: Pushed all 4 assets into ${a} Qwen chats (${e}).`), await this.persist(), { success: !0, count: a, tabs: this.state.tabs };
      }
      case "STAGE_RUN_ALL_PACED": {
        const e = t.target || "all";
        return await this.startExecution(e);
      }
      case "CLEAR_TITLES":
        return this.state.tabs.forEach((e) => {
          e.title = "", this.recalculateTabStatus(e);
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
        const e = (c = r.tab) == null ? void 0 : c.id;
        if (e) {
          let s;
          if (t.detectedVideoNumber) {
            const a = `V${t.detectedVideoNumber}`;
            return this.state.tabs.forEach((i) => {
              i.chromeTabId === e && i.id !== a && (i.chromeTabId = null);
            }), s = this.state.tabs.find((i) => i.id === a), s || (s = {
              id: a,
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
            }, this.state.tabs.push(s)), s.chromeTabId = e, this.addLog("INFO", `Linked ${s.id} to browser tab ${e} via explicit marker`, s.id), await this.persist(), { success: !0, tab: s };
          }
          if (s = this.state.tabs.find((a) => a.chromeTabId === e), !s) {
            const a = await chrome.tabs.query({}), i = new Set(a.map((o) => o.id));
            this.state.tabs.forEach((o) => {
              o.chromeTabId && !i.has(o.chromeTabId) && (o.chromeTabId = null);
            }), s = this.state.tabs.find((o) => !o.chromeTabId), s ? (s.chromeTabId = e, this.addLog("INFO", `Linked ${s.id} to browser tab ${e}`, s.id), await this.persist()) : this.state.tabs.length === 0 && (s = {
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
            }, this.state.tabs.push(s), this.addLog("INFO", `Auto-registered V1 for browser tab ${e}`, "V1"), await this.persist());
          }
          if (s)
            return { success: !0, tab: s };
        }
        return { success: !0, tab: null };
      }
      case "REASSIGN_TAB_VNUMBER": {
        const e = (d = r.tab) == null ? void 0 : d.id, s = t.toVideoNumber || parseInt((t.toVNumber || "").replace(/\D/g, ""), 10);
        if (s && e) {
          const a = `V${s}`;
          this.state.tabs.forEach((o) => {
            o.chromeTabId === e && o.id !== a && (o.chromeTabId = null);
          });
          let i = this.state.tabs.find((o) => o.id === a);
          return i || (i = {
            id: a,
            index: s,
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
        const e = this.state.tabs.find((s) => s.id === t.vNumber);
        return e && (e.outlineDetected = !0, t.outlineContent && (e.outlineContent = t.outlineContent), t.outlineStatus && (e.outlineStatus = t.outlineStatus), t.outlinePartInstructions && (e.outlinePartInstructions = t.outlinePartInstructions), t.lifecycleStage && (e.lifecycleStage = t.lifecycleStage), t.liveDebugStatus && (e.liveDebugStatus = t.liveDebugStatus), !e.manualOverride && t.totalParts && (e.totalParts = t.totalParts), this.addLog(
          "INFO",
          `${e.id}: [OUTLINE] Outline detected (${e.totalParts} total parts planned). Outline status: ${e.outlineStatus || "completed"}.`,
          e.id
        ), await this.persist()), { success: !0 };
      }
      case "OVERRIDE_TAB_PARTS": {
        const e = this.state.tabs.find((s) => s.id === t.vNumber);
        if (e) {
          t.totalParts && (e.totalParts = t.totalParts), t.currentPart && (e.currentPart = t.currentPart), typeof t.outlineDetected == "boolean" && (e.outlineDetected = t.outlineDetected), e.manualOverride = !0, e.parts || (e.parts = []);
          for (let a = 1; a <= e.totalParts; a++)
            if (!e.parts.some((i) => i.partNumber === a)) {
              const i = parseInt(e.id.replace(/\D/g, ""), 10) || 1;
              e.parts.push({
                partNumber: a,
                label: `${e.id} P${a}`,
                explicitMarker: `${e.id} P${a}`,
                videoNumber: i,
                status: a < e.currentPart ? "done" : a === e.currentPart ? "ready" : "waiting",
                content: "",
                downloaded: !1
              });
            }
          e.parts = e.parts.filter(
            (a) => a.partNumber <= e.totalParts || a.status === "done" && a.content && a.content.trim()
          ), e.parts.sort((a, i) => a.partNumber - i.partNumber);
          const s = D(e);
          e.mergeValidationStatus = s.valid ? "valid" : "invalid", this.addLog(
            "INFO",
            `[MANUAL] ${e.id}: Manual override applied. Total Parts = ${e.totalParts}, Current Part = ${e.currentPart}, Outline = ${e.outlineDetected ? "Generated ✓" : "None"}.`,
            e.id
          ), await this.persist();
        }
        return { success: !0 };
      }
      case "CONTENT_PART_DETECTED": {
        const e = this.state.tabs.find((s) => s.id === t.vNumber);
        if (e) {
          !e.manualOverride && t.totalParts && t.totalParts > 0 && (e.totalParts = t.totalParts, e.parts && e.parts.length > 0 && (e.parts = e.parts.filter(
            (s) => s.partNumber <= e.totalParts || s.status === "done" && s.content && s.content.trim()
          ))), e.parts || (e.parts = []), t.missingParts && (e.missingParts = t.missingParts), t.duplicateParts && (e.duplicateParts = t.duplicateParts), t.detectedVideoNumber && (e.detectedVideoNumber = t.detectedVideoNumber), t.lifecycleStage && (e.lifecycleStage = t.lifecycleStage), t.liveDebugStatus && (e.liveDebugStatus = t.liveDebugStatus);
          for (const s of t.parts || []) {
            const a = e.parts.find((i) => i.partNumber === s.partNumber);
            a ? (s.content && s.content.trim() && (a.content = s.content), s.heading && (a.heading = s.heading), s.explicitMarker && (a.explicitMarker = s.explicitMarker), s.videoNumber && (a.videoNumber = s.videoNumber), a.status = s.status) : e.parts.push({ ...s });
          }
          if (e.parts.sort((s, a) => s.partNumber - a.partNumber), e.missingParts && e.missingParts.length > 0) {
            const s = e.missingParts.map((a) => `${e.id} P${a}`).join(", ");
            this.addLog("WARNING", `${e.id}: MISSING: ${s}`, e.id);
          }
          if (e.duplicateParts && e.duplicateParts.length > 0) {
            const s = e.duplicateParts.map((a) => `${e.id} P${a}`).join(", ");
            this.addLog("WARNING", `${e.id}: DUPLICATE: ${s}`, e.id);
          }
          await this.persist();
        }
        return { success: !0 };
      }
      case "CONTENT_PART_COMPLETED": {
        const e = this.state.tabs.find((s) => s.id === t.vNumber);
        if (e) {
          let s = e.parts.find((o) => o.partNumber === t.partNumber);
          s ? (s.status = "done", t.content && t.content.trim() && (s.content = t.content), t.heading && (s.heading = t.heading), t.explicitMarker && (s.explicitMarker = t.explicitMarker), t.videoNumber && (s.videoNumber = t.videoNumber), s.extractedAt = Date.now()) : (s = {
            partNumber: t.partNumber,
            label: t.explicitMarker || `${e.id} P${t.partNumber}`,
            explicitMarker: t.explicitMarker,
            videoNumber: t.videoNumber,
            heading: t.heading,
            status: "done",
            content: t.content,
            extractedAt: Date.now(),
            downloaded: !1
          }, e.parts.push(s)), e.parts.sort((o, l) => o.partNumber - l.partNumber);
          const a = e.parts.find((o) => o.partNumber === t.partNumber + 1);
          a && a.status === "waiting" && (a.status = "ready");
          const i = D(e);
          e.mergeValidationStatus = i.valid ? "valid" : "invalid", i.valid ? (e.status = "completed", this.addLog(
            "SUCCESS",
            `${e.id}: All ${e.totalParts} parts completed and verified. TXT MERGE VERIFIED ✓`,
            e.id
          )) : this.addLog(
            "SUCCESS",
            `${e.id} Part ${t.partNumber} completed successfully.`,
            e.id
          ), await this.persist(), this.state.config.autoInsertNextPart && a && e.chromeTabId ? (this.addLog("INFO", `[AUTO] ${e.id}: Auto Run toggle is ON. Automatically requesting Part ${a.partNumber}...`, e.id), setTimeout(() => this.insertNextPart(e.id, a.partNumber), 1500)) : a && this.addLog("INFO", `[MANUAL MODE] ${e.id}: Part ${t.partNumber} completed. Ready for manual Alt-Tab submission of Part ${a.partNumber} (or enable Auto Run toggle).`, e.id);
        }
        return { success: !0 };
      }
      case "CONTENT_EXECUTION_ERROR": {
        const e = this.state.tabs.find((s) => s.id === t.vNumber);
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
  async duplicateChats(t, r, n, c, d) {
    const e = !!(d && d.length > 0), s = e ? Array.from(new Set(d)).sort((h, m) => h - m) : (() => {
      const h = n && n > 0 ? n : 1, m = c && c >= h ? c : h + Math.max(1, t) - 1, S = [];
      for (let f = h; f <= m; f++) S.push(f);
      return S;
    })();
    if (!e && n && c && n > c)
      return {
        success: !1,
        error: `Validation Error: Start Video ID (V${n}) cannot be greater than End Video ID (V${c}).`
      };
    if (s.length === 0)
      return { success: !1, error: "Invalid Video ID range. Must create at least 1 tab." };
    const a = s[0], i = s[s.length - 1], o = new Set(s);
    this.state.tabs = this.state.tabs.filter((h) => o.has(h.index));
    const p = (await chrome.tabs.query({})).filter((h) => h.url && this.isMetaUrl(h.url)), T = (await chrome.tabs.query({ active: !0, currentWindow: !0 }))[0];
    let I = "https://www.meta.ai/", g = null;
    T && T.url && this.isMetaUrl(T.url) ? (g = T, I = T.url) : p.length > 0 && (g = p[0], I = p[0].url || "https://www.meta.ai/");
    let w = (r || "").trim();
    if (!w && g && g.id)
      try {
        const h = await chrome.tabs.sendMessage(g.id, { type: "GET_CURRENT_INPUT_TEXT" });
        h && h.text && (w = h.text.trim());
      } catch {
      }
    w || (w = this.state.config.initialPrompt || "My Version of Title is:"), this.state.config.initialPrompt = w;
    const E = [], M = g && g.id ? this.state.tabs.some((h) => h.chromeTabId === g.id) : !0;
    let y = !1;
    for (const h of s) {
      const m = `V${h}`, S = this.state.tabs.findIndex((_) => _.id === m || _.index === h);
      let f = null;
      if (!y && !M && g && g.id)
        f = g.id, y = !0, this.addLog("INFO", `${m} assigned to active Qwen tab (Tab ID: ${f}).`, m);
      else
        try {
          f = (await chrome.tabs.create({
            url: I,
            active: !1
          })).id || null, this.addLog("INFO", `${m} opened (Meta Tab ID: ${f}).`, m);
        } catch (_) {
          this.addLog("ERROR", `Failed to open Meta tab for ${m}: ${_.message}`, m);
        }
      const A = {
        id: m,
        index: h,
        chromeTabId: f,
        qwenUrl: I,
        metaUrl: I,
        status: "incomplete",
        selected: !0,
        initialMessage: w,
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
      S >= 0 ? this.state.tabs[S] = A : this.state.tabs.push(A), E.push(A), f && (chrome.tabs.sendMessage(f, { type: "UPDATE_HUD", tab: A }).catch(() => {
      }), w && this.scheduleInitialTextInjection(f, w));
    }
    this.state.tabs.sort((h, m) => h.index - m.index);
    const $ = e ? s.map((h) => `V${h}`).join(", ") : `V${a}–V${i}`;
    return this.addLog("SUCCESS", `Duplicated ${E.length} tabs for ${$}.`), await this.persist(), { success: !0, count: E.length, range: $, tabs: this.state.tabs };
  }
  /**
   * Assigns titles to tabs sequentially or by explicit V-number marker.
   * Cuts off any excess titles beyond the selected range (below START or above END).
   */
  async assignTitles(t, r, n) {
    if (t.length === 0)
      return { success: !1, error: "No titles provided." };
    const c = r || 1, d = n || c + t.length - 1, e = this.state.tabs.filter((o, l) => {
      const p = l + 1;
      return o.index >= c && o.index <= d || p >= c && p <= d;
    }), s = /* @__PURE__ */ new Set(), a = [];
    for (const o of t) {
      const l = o.trim().match(/^(?:\[?\s*[vV](\d+)\s*\]?|Video\s*(\d+))[\s.:\-_–—]*/i);
      if (l) {
        const p = parseInt(l[1] || l[2], 10), P = e.find(
          (T) => (T.index === p || T.id === `V${p}`) && !s.has(T.id)
        );
        if (P) {
          P.title = o, this.recalculateTabStatus(P), this.addLog("INFO", `Title assigned to ${P.id}: "${P.title}"`, P.id), s.add(P.id);
          continue;
        }
      }
      a.push(o);
    }
    let i = 0;
    for (const o of e)
      !s.has(o.id) && i < a.length && (o.title = a[i], this.recalculateTabStatus(o), this.addLog("INFO", `Title assigned to ${o.id}: "${o.title}"`, o.id), s.add(o.id), i++);
    return this.addLog("INFO", `Assigned ${s.size} titles to range V${c}–V${d}.`), await this.persist(), { success: !0, tabs: this.state.tabs, assignedCount: s.size };
  }
  /**
   * Starts execution queue for target tabs ('all', 'selected', or specific V ID).
   */
  async startExecution(t) {
    var s;
    this.state.isPaused = !1;
    const r = this.getTargetTabs(t);
    if (r.length === 0) {
      const a = "No active Qwen browser tabs found matching selection. Please ensure Qwen tabs are open.";
      return this.addLog("WARNING", a), { success: !1, error: a };
    }
    for (const a of r) {
      if (!a.chromeTabId) continue;
      const i = this.state.config.masterPrompt || "";
      if (!a.masterPrompt && i && (a.masterPrompt = i), a.title && (!a.titleInjected || !a.promptInjected) && (a.titleInjected = !0, a.promptInjected = !0, chrome.tabs.sendMessage(a.chromeTabId, {
        type: "PASTE_PROMPT_ONLY",
        title: a.title,
        masterPrompt: a.masterPrompt || i,
        vNumber: a.id
      }).catch(() => {
      })), a.thumbnailId && !a.thumbnailPasted) {
        const o = await R(a.thumbnailId);
        if (o) {
          const l = await this.blobToBase64(o.blob);
          a.thumbnailPasted = !0, chrome.tabs.sendMessage(a.chromeTabId, {
            type: "PASTE_THUMBNAIL_ONLY",
            thumbnail: {
              name: o.asset.name || `${a.id}_thumb`,
              type: o.asset.type,
              base64: l
            },
            vNumber: a.id
          }).catch(() => {
          });
        }
      }
      if (!a.scriptInjected) {
        let o = "", l = `${a.id}_script.txt`;
        if (a.scriptId) {
          const p = await R(a.scriptId);
          p && (o = await p.blob.text(), l = p.asset.name || l);
        } else this.state.config.competitorScriptEnabled && ((s = this.state.config.competitorScriptText) != null && s.trim()) && (o = this.state.config.competitorScriptText.trim(), l = `${a.id}_Competitor_Script.txt`);
        o && (a.scriptInjected = !0, chrome.tabs.sendMessage(a.chromeTabId, {
          type: "PASTE_SCRIPT_ONLY",
          script: {
            name: l,
            content: o
          },
          vNumber: a.id
        }).catch(() => {
        }));
      }
      this.recalculateTabStatus(a), chrome.tabs.sendMessage(a.chromeTabId, { type: "UPDATE_HUD", tab: a }).catch(() => {
      });
    }
    const n = [], c = (this.state.config.scriptMode || "original") === "original", d = !c && !!this.state.config.competitorScriptEnabled, e = !!(this.state.config.competitorScriptText && this.state.config.competitorScriptText.trim());
    for (const a of r) {
      const i = [];
      a.title || i.push("Title not assigned"), !a.masterPrompt && !this.state.config.masterPrompt && i.push("Master Prompt missing");
      const o = a.thumbnailId || a.thumbnailPasted || a.thumbnailStatus === "assigned", l = c || !d || a.scriptOptional || e || a.scriptId || a.scriptInjected || a.scriptStatus === "assigned";
      o || i.push("Thumbnail image not uploaded or pasted into chat"), l || i.push("Competitor script not provided (paste script or switch to Original Script Mode)"), i.length > 0 ? (a.status = "incomplete", n.push({ id: a.id, missing: i })) : a.status = "ready";
    }
    if (n.length > 0) {
      const a = n.map((o) => `${o.id}: [${o.missing.join("; ")}]`).join(`
`), i = c ? `Required assets missing for execution:

${a}

Please assign Titles, Master Prompt, and Thumbnails before running.` : `Required assets missing for execution:

${a}

Please upload Thumbnails and Competitor Scripts in the dashboard and push them to the Qwen chats before running.`;
      return this.addLog("ERROR", `Cannot run: ${n.length} tabs have missing files.`), await this.persist(), {
        success: !1,
        error: i,
        invalidTabs: n
      };
    }
    return r.forEach((a) => {
      this.executionQueue.includes(a.id) || this.executionQueue.push(a.id);
    }), this.addLog("INFO", `Enqueued ${r.length} tabs for execution. Starting queue now...`), this.processQueue(), await this.persist(), { success: !0, queuedCount: r.length };
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
          const r = this.state.tabs.find((c) => c.id === t);
          if (!r || !r.chromeTabId) continue;
          try {
            await chrome.tabs.update(r.chromeTabId, { active: !0 });
            const c = await chrome.tabs.get(r.chromeTabId);
            await chrome.windows.update(c.windowId, { focused: !0 });
          } catch {
            this.addLog("WARNING", `Could not switch to tab ${t}, it might be closed.`, t);
          }
          await new Promise((c) => setTimeout(c, 1e3)), this.state.activeExecutionCount++, this.runSingleTab(r).finally(() => {
            this.state.activeExecutionCount--, this.processQueue();
          });
          const n = Math.floor(5e3 + Math.random() * 1e4);
          this.addLog("INFO", `Human Pacing: Waiting ${(n / 1e3).toFixed(1)}s before navigating to next tab...`, t), await new Promise((c) => setTimeout(c, n));
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
      t.status = "error", t.error = L("TAB_NOT_FOUND", { vNumber: t.id }), this.addLog("ERROR", `${t.id} has no Chrome Tab ID.`, t.id, t.error), await this.persist();
      return;
    }
    try {
      await chrome.tabs.sendMessage(t.chromeTabId, {
        type: "SUBMIT_CHAT_ONLY",
        vNumber: t.id
      });
    } catch (r) {
      t.status = "error", t.error = L("CUSTOM", {
        title: `${t.id} Execution Failed`,
        problem: r.message,
        vNumber: t.id
      }), this.addLog("ERROR", `${t.id} run error: ${r.message}`, t.id, t.error), await this.persist();
    }
  }
  /**
   * Retries execution for a failed tab.
   */
  async retryTab(t) {
    const r = this.state.tabs.find((n) => n.id === t);
    return r ? (r.status = "ready", r.error = null, this.executionQueue.includes(t) || this.executionQueue.push(t), this.addLog("INFO", `Retry queued for ${t}.`, t), this.processQueue(), await this.persist(), { success: !0 }) : { success: !1, error: `Tab ${t} not found.` };
  }
  /**
   * Retries a single specific part for a tab.
   * Switches to the tab, then inserts and runs that part exactly like normal generation.
   */
  async retryPart(t, r) {
    const n = this.state.tabs.find((d) => d.id === t);
    if (!n || !n.chromeTabId) return { success: !1, error: `Tab ${t} not found or closed.` };
    const c = n.parts.find((d) => d.partNumber === r);
    if (!c) return { success: !1, error: `Part ${r} not found in ${t}.` };
    this.addLog("INFO", `Retrying ${t} P${r}...`, t), c.status = "generating", n.status = "running", n.currentPart = r, await this.persist();
    try {
      await chrome.tabs.update(n.chromeTabId, { active: !0 });
    } catch {
    }
    try {
      return await chrome.tabs.sendMessage(n.chromeTabId, {
        type: "EXECUTE_NEXT_PART_ACTION",
        partNumber: r,
        totalParts: n.totalParts || 0,
        wordCount: n.partWordCount || this.state.config.partWordCount || 4e3
      }), { success: !0 };
    } catch (d) {
      return c.status = "error", n.status = "error", this.addLog("ERROR", `Retry P${r} failed for ${t}: ${d.message}`, t), await this.persist(), { success: !1, error: d.message };
    }
  }
  /**
   * Triggers content script to insert next part.
   */
  async insertNextPart(t, r) {
    const n = this.state.tabs.find((a) => a.id === t);
    if (!n || !n.chromeTabId) return { success: !1, error: "Tab not found." };
    try {
      await chrome.tabs.update(n.chromeTabId, { active: !0 });
      const a = await chrome.tabs.get(n.chromeTabId);
      a.windowId && await chrome.windows.update(a.windowId, { focused: !0 });
    } catch {
    }
    if (await new Promise((a) => setTimeout(a, 600)), !await new Promise((a) => {
      chrome.tabs.sendMessage(n.chromeTabId, { type: "PING" }, (i) => {
        a(!chrome.runtime.lastError && i && i.pong);
      }), setTimeout(() => a(!1), 300);
    }))
      try {
        await chrome.scripting.executeScript({
          target: { tabId: n.chromeTabId },
          files: ["content.js"]
        }), await new Promise((a) => setTimeout(a, 800));
      } catch {
      }
    n.status = "running", n.currentPart = r, n.error = null;
    let d = n.parts.find((a) => a.partNumber === r);
    if (d)
      d.status = "generating";
    else {
      const a = parseInt(n.id.replace(/\D/g, ""), 10) || 1;
      n.parts.push({
        partNumber: r,
        label: `${n.id} P${r}`,
        explicitMarker: `${n.id} P${r}`,
        videoNumber: a,
        status: "generating",
        content: "",
        downloaded: !1
      });
    }
    for (const a of n.parts)
      a.partNumber !== r && a.status === "generating" && (a.status = "waiting");
    this.addLog("INFO", `${n.id}: Writing Part ${r} Script...`, n.id), await this.persist();
    const s = (n.scriptMode === "original" || (this.state.config.scriptMode || "original") === "original") && n.outlinePartInstructions ? n.outlinePartInstructions[r] : void 0;
    try {
      const a = await chrome.tabs.sendMessage(n.chromeTabId, {
        type: "EXECUTE_NEXT_PART_ACTION",
        partNumber: r,
        totalParts: n.totalParts || 0,
        wordCount: n.partWordCount || this.state.config.partWordCount || 4e3,
        outlineInstruction: s
      });
      return a && a.error ? (n.status = "error", n.error = L("CUSTOM", {
        title: `Part ${r} Request Failed`,
        problem: a.error,
        vNumber: n.id
      }), this.addLog("ERROR", `${n.id} Part ${r} request failed: ${a.error}`, n.id, n.error), await this.persist(), { success: !1, error: a.error }) : { success: !0 };
    } catch (a) {
      return n.status = "error", n.error = L("CUSTOM", {
        title: `Part ${r} Request Failed`,
        problem: a.message,
        vNumber: n.id
      }), this.addLog("ERROR", `${n.id} Part ${r} error: ${a.message}`, n.id, n.error), await this.persist(), { success: !1, error: a.message };
    }
  }
  /**
   * Downloads a single generated part text file via chrome.downloads API.
   */
  async downloadPartFile(t, r) {
    const n = this.state.tabs.find((s) => s.id === t);
    if (!n) return { success: !1, error: "Tab not found." };
    const c = n.parts.find((s) => s.partNumber === r);
    if (!c || !c.content)
      return { success: !1, error: `Part ${r} content not available.` };
    const d = `${t} P${r}.txt`, e = `data:text/plain;charset=utf-8,${encodeURIComponent(c.content)}`;
    try {
      const s = await chrome.downloads.download({
        url: e,
        filename: d,
        saveAs: !1
      });
      return c.downloaded = !0, this.addLog("SUCCESS", `Downloaded ${d} (ID: ${s}).`, t), await this.persist(), { success: !0, downloadId: s };
    } catch (s) {
      return this.addLog("ERROR", `Download failed for ${d}: ${s.message}`, t), { success: !1, error: s.message };
    }
  }
  getTargetTabs(t) {
    const r = t || "all";
    return this.state.tabs.filter((n) => n.chromeTabId ? r === "all" ? !0 : r === "selected" ? n.selected : n.id === r : !1);
  }
  handleTabClosed(t) {
    const r = this.state.tabs.find((n) => n.chromeTabId === t);
    r && (r.chromeTabId = null, r.status = "error", r.error = L("TAB_NOT_FOUND", { vNumber: r.id }), this.addLog("WARNING", `${r.id} browser tab was closed.`, r.id, r.error), this.persist());
  }
  handleTabLoaded(t) {
    const r = this.state.tabs.find((n) => n.chromeTabId === t);
    r && r.initialMessage && !r.initialMessageInjected && r.status !== "running" && r.status !== "completed" && (r.initialMessageInjected = !0, this.scheduleInitialTextInjection(t, r.initialMessage));
  }
  scheduleInitialTextInjection(t, r) {
    [600, 1500, 3e3, 5e3].forEach((c) => {
      setTimeout(() => {
        chrome.tabs.sendMessage(t, {
          type: "INJECT_INITIAL_TEXT",
          text: r
        }).catch(() => {
        });
      }, c);
    });
  }
  reindexTabs() {
    this.state.tabs.forEach((t, r) => {
      const n = r + 1;
      t.index = n, t.id = `V${n}`, t.chromeTabId && chrome.tabs.sendMessage(t.chromeTabId, {
        type: "UPDATE_HUD",
        tab: t
      }).catch(() => {
      });
    });
  }
  recalculateTabStatus(t) {
    if (t.status === "running" || t.status === "completed") return;
    const r = !!t.title, n = !!t.masterPrompt, c = t.thumbnailStatus !== "none" || t.thumbnailPasted || !!t.thumbnailId, d = t.scriptMode === "original" || (this.state.config.scriptMode || "original") === "original", e = !d && !!this.state.config.competitorScriptEnabled, s = !!(this.state.config.competitorScriptText && this.state.config.competitorScriptText.trim()), a = d || !e || t.scriptOptional || s || t.scriptStatus !== "none" || t.scriptInjected || !!t.scriptId;
    r && n && c && a ? (t.status = "ready", t.error = null) : t.status = "incomplete";
  }
  addLog(t, r, n, c) {
    const d = /* @__PURE__ */ new Date(), e = d.toTimeString().split(" ")[0], s = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timeStr: e,
      isoTime: d.toISOString(),
      level: t,
      message: r,
      vNumber: n,
      errorDetails: c
    };
    this.state.logs.unshift(s), this.state.logs.length > 500 && this.state.logs.pop();
  }
  /**
   * Reconciles all open browser tabs, links open Qwen tabs to VTabs,
   * re-injects content scripts if disconnected on extension reload,
   * and requests live DOM status & parts detection.
   */
  async reconcileAndInjectTabs() {
    try {
      const t = await chrome.tabs.query({}), r = new Set(t.map((c) => c.id).filter((c) => c !== void 0));
      this.state.tabs.forEach((c) => {
        c.chromeTabId && !r.has(c.chromeTabId) && (c.chromeTabId = null);
      });
      const n = t.filter(
        (c) => c.id && c.url && this.isQwenUrl(c.url)
      );
      for (const c of n) {
        if (!c.id) continue;
        let d = this.state.tabs.find((s) => s.chromeTabId === c.id);
        if (d || (d = this.state.tabs.find((s) => !s.chromeTabId), d && (d.chromeTabId = c.id)), await new Promise((s) => {
          chrome.tabs.sendMessage(c.id, { type: "PING" }, (a) => {
            chrome.runtime.lastError || !a || !a.pong ? s(!1) : s(!0);
          }), setTimeout(() => s(!1), 250);
        })) {
          if (d)
            try {
              chrome.tabs.sendMessage(
                c.id,
                { type: "SCAN_DOM_NOW", tab: d },
                () => {
                  chrome.runtime.lastError;
                }
              );
            } catch {
            }
        } else try {
          await chrome.scripting.executeScript({
            target: { tabId: c.id },
            files: ["content.js"]
          }), await chrome.scripting.insertCSS({
            target: { tabId: c.id },
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
    await j(this.state);
  }
  isMetaUrl(t) {
    return t ? t.includes("meta.ai") || t.includes("www.meta.ai") || t.includes("mockMeta.html") || t.includes("chat.qwen.ai") || t.includes("qwen.ai") || t.includes("mockQwen.html") || t.startsWith("http://localhost") || t.startsWith("http://127.0.0.1") : !1;
  }
  isQwenUrl(t) {
    return this.isMetaUrl(t);
  }
  async blobToBase64(t) {
    return new Promise((r) => {
      const n = new FileReader();
      n.onloadend = () => r(n.result), n.readAsDataURL(t);
    });
  }
}
new G();
