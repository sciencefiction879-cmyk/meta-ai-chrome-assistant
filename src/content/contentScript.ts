import { MetaAdapter, QwenAdapter } from '../adapter/qwenAdapter';
import { FloatingPanel } from './floatingPanel';
import { VTab, GeneratedPart, DiagnosticError } from '../types';
import { createDiagnosticError } from '../utils/diagnostics';
import { createTxtBlob, triggerDownload, formatMergedScriptPart } from '../utils/fileHelper';
import { formatPromptWithTitle, generateWritePartPrompt } from '../utils/normalizer';
import { detectPartsInText, extractStartingExplicitMarker, extractTopExplicitMarker, detectOutlineInText, findExplicitMarkersInText } from '../utils/partDetector';

class MetaContentController {
  private adapter: MetaAdapter;
  private hud: FloatingPanel;
  private currentTabState: VTab | null = null;
  private isProcessing = false;
  private monitorInterval: number | null = null;
  private monitorObserver: MutationObserver | null = null;
  private lastDetectedText = '';

  constructor() {
    this.adapter = new MetaAdapter(document);
    this.hud = new FloatingPanel(
      (partNum) => this.handleInsertNextPart(partNum),
      () => this.handleDownloadParts(),
      () => this.handleRetry(),
      () => this.handleRestart(),
      () => this.handleCancel(),
      () => this.handleRefresh(),
      (total, current, outline) => this.handleOverrideParts(total, current, outline)
    );

    this.init();
  }

  private hasCompetitorScript(): boolean {
    if (!this.currentTabState) return false;
    if (this.currentTabState.scriptMode === 'original') return false;
    if (this.currentTabState.scriptMode === 'competitor') return true;
    return Boolean(
      (this.currentTabState.scriptStatus && this.currentTabState.scriptStatus !== 'none') ||
      this.currentTabState.scriptId ||
      this.currentTabState.scriptInjected
    );
  }

  private handleOverrideParts(totalParts: number, currentPart: number, outlineDetected: boolean): void {
    if (!this.currentTabState || !this.currentTabState.id) return;
    const vId = this.currentTabState.id;
    this.currentTabState.totalParts = totalParts;
    this.currentTabState.currentPart = currentPart;
    this.currentTabState.outlineDetected = outlineDetected;
    this.currentTabState.manualOverride = true;

    if (!this.currentTabState.parts) this.currentTabState.parts = [];
    for (let p = 1; p <= totalParts; p++) {
      if (!this.currentTabState.parts.some((x) => x.partNumber === p)) {
        this.currentTabState.parts.push({
          partNumber: p,
          label: `Part ${p}`,
          status: p < currentPart ? 'done' : p === currentPart ? 'ready' : 'waiting',
          content: '',
          downloaded: false
        });
      }
    }
    this.currentTabState.parts.sort((a, b) => a.partNumber - b.partNumber);

    this.hud.update(this.currentTabState);

    chrome.runtime.sendMessage({
      type: 'OVERRIDE_TAB_PARTS',
      vNumber: vId,
      totalParts,
      currentPart,
      outlineDetected
    });

    chrome.runtime.sendMessage({
      type: 'LOG_MESSAGE',
      level: 'INFO',
      message: `[MANUAL] ${vId}: Manually overridden Total Parts = ${totalParts}, Current Part = ${currentPart}, Outline = ${outlineDetected ? 'Generated ✓' : 'None'}.`,
      vNumber: vId
    });
  }

  private safeSendMessage(message: any, callback?: (res: any) => void): void {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
        return;
      }
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          return;
        }
        callback?.(response);
      });
    } catch {
      // Ignored if extension context invalidated
    }
  }

  private init(): void {
    // Mount the floating HUD in the docked position
    this.hud.mount();

    // Start continuous observer to monitor script content and automatically detect Total Parts
    this.startContinuousMonitoring();

    // Listen for messages from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleIncomingMessage(message, sendResponse);
      return true; // Keep channel open for async responses
    });

    // Detect if explicit video marker exists in DOM (e.g. "V20 P1", "V6/P1", "v6p1")
    let detectedVNum: number | undefined;
    try {
      const pageText = this.adapter.findLatestResponse() || document.body.innerText || '';
      const markers = findExplicitMarkersInText(pageText);
      if (markers.length > 0) {
        detectedVNum = markers[0].videoNumber;
      }
    } catch {}

    // Notify background that this content script is ready
    this.safeSendMessage(
      {
        type: 'CONTENT_TAB_READY',
        currentUrl: window.location.href,
        detectedVideoNumber: detectedVNum
      },
      async (response) => {
        if (response && response.tab) {
          this.currentTabState = response.tab;
          this.hud.update(response.tab);

          // Force an immediate DOM scan to extract parts and notify background
          this.checkAndReportPartsUpdate(true);

          // Only insert initial message once before run
          if (
            response.tab.initialMessage &&
            !response.tab.initialMessageInjected &&
            response.tab.status !== 'running' &&
            response.tab.status !== 'completed'
          ) {
            await this.reliablyInsertInitialText(response.tab.initialMessage);
          }
        }
      }
    );
  }

  private async reliablyInsertInitialText(text: string): Promise<boolean> {
    const trimmed = (text || '').trim();
    if (!trimmed) return true;

    // Check if input is already filled
    if (this.adapter.getInputValue()) {
      return true;
    }

    // Try immediately
    if (this.adapter.insertText(trimmed)) {
      return true;
    }

    // Retry up to 5 times with backoff
    for (let attempt = 1; attempt <= 5; attempt++) {
      await new Promise((r) => setTimeout(r, 600 * attempt));
      if (this.adapter.insertText(trimmed)) {
        return true;
      }
    }
    return false;
  }

  private async handleIncomingMessage(
    message: any,
    sendResponse: (res: any) => void
  ): Promise<void> {
    try {
      switch (message.type) {
        case 'PING': {
          sendResponse({
            pong: true,
            vNumber: this.currentTabState?.id,
            totalParts: this.currentTabState?.totalParts || 0
          });
          break;
        }

        case 'SCAN_DOM_NOW': {
          if (message.tab) {
            this.currentTabState = message.tab;
            this.hud.update(message.tab);
          }
          this.checkAndReportPartsUpdate(true);
          sendResponse({ success: true, tab: this.currentTabState });
          break;
        }

        case 'GET_CURRENT_INPUT_TEXT': {
          const text = this.adapter.getInputValue();
          sendResponse({ success: true, text });
          break;
        }

        case 'INJECT_INITIAL_TEXT': {
          const ok = await this.reliablyInsertInitialText(message.text || '');
          sendResponse({ success: ok });
          break;
        }

        case 'UPDATE_HUD': {
          if (message.tab) {
            this.currentTabState = message.tab;
            this.hud.update(message.tab);
          }
          sendResponse({ success: true });
          break;
        }

        case 'EXECUTE_TAB_PROMPT': {
          this.executeTabPrompt(message)
            .then(() => sendResponse({ success: true }))
            .catch((err) => {
              sendResponse({ success: false, error: err.message });
            });
          break;
        }

        case 'EXECUTE_NEXT_PART_ACTION': {
          this.handleInsertNextPart(message.partNumber, message.totalParts, message.wordCount, message.outlineInstruction)
            .then(() => sendResponse({ success: true }))
            .catch((err) => {
              sendResponse({ success: false, error: err.message });
            });
          break;
        }

        case 'PASTE_PROMPT_ONLY': {
          const vId = message.vNumber || this.currentTabState?.id || 'Tab';
          const promptText = formatPromptWithTitle(message.title, message.masterPrompt, vId);
          const ok = this.adapter.insertText(promptText);
          chrome.runtime.sendMessage({
            type: 'LOG_MESSAGE',
            level: ok ? 'SUCCESS' : 'ERROR',
            message: ok
              ? `${vId}: Title & Master Prompt pasted into chat input (Stage 1 confirmed).`
              : `${vId}: Failed to paste prompt into chat input.`,
            vNumber: vId
          });
          sendResponse({ success: ok });
          break;
        }

        case 'PASTE_THUMBNAIL_ONLY': {
          const vId = message.vNumber || this.currentTabState?.id || 'Tab';
          if (!message.thumbnail || !message.thumbnail.base64) {
            sendResponse({ success: false, error: 'No thumbnail data provided.' });
            break;
          }
          const thumbBlob = this.base64ToBlob(message.thumbnail.base64, message.thumbnail.type);
          const thumbFile = new File([thumbBlob], message.thumbnail.name, { type: message.thumbnail.type });
          
          if (this.currentTabState) {
            this.currentTabState.thumbnailUploading = true;
            this.hud.update(this.currentTabState);
          }
          chrome.runtime.sendMessage({
            type: 'THUMBNAIL_UPLOAD_STARTED',
            vNumber: vId
          });

          this.adapter.pasteImageViaClipboard(thumbFile).then(async (attached) => {
            if (attached) {
               await this.adapter.waitForUploadToComplete(20000);
               if (this.currentTabState) {
                 this.currentTabState.thumbnailUploading = false;
                 this.hud.update(this.currentTabState);
               }
               chrome.runtime.sendMessage({
                 type: 'THUMBNAIL_UPLOAD_COMPLETE',
                 vNumber: vId
               });
            }
            chrome.runtime.sendMessage({
              type: 'LOG_MESSAGE',
              level: attached ? 'SUCCESS' : 'WARNING',
              message: attached
                ? `${vId}: Thumbnail "${message.thumbnail.name}" pasted and uploaded (Stage 2 confirmed).`
                : `${vId}: Thumbnail paste attempted, check chat input.`,
              vNumber: vId
            });
            sendResponse({ success: attached });
          });
          break;
        }

        case 'PASTE_SCRIPT_ONLY': {
          const vId = message.vNumber || this.currentTabState?.id || 'Tab';
          if (!message.script || !message.script.content) {
            sendResponse({ success: false, error: 'No script content provided.' });
            break;
          }
          const currentText = this.adapter.getCurrentInputText();
          const scriptBlock = `\n\n--- COMPETITOR SCRIPT (${vId}: ${message.script.name}) ---\n${message.script.content}\n--------------------------------------------------`;
          const combined = currentText ? `${currentText}${scriptBlock}` : scriptBlock;
          const ok = this.adapter.insertText(combined);
          chrome.runtime.sendMessage({
            type: 'LOG_MESSAGE',
            level: ok ? 'SUCCESS' : 'ERROR',
            message: ok
              ? `${vId}: Competitor script "${message.script.name}" embedded into chat input (Stage 3 confirmed).`
              : `${vId}: Failed to paste competitor script.`,
            vNumber: vId
          });
          sendResponse({ success: ok });
          break;
        }

        case 'SUBMIT_CHAT_ONLY': {
          const vId = message.vNumber || this.currentTabState?.id || 'Tab';
          this.submitChatAndCollectResponse(vId)
            .then(() => sendResponse({ success: true }))
            .catch((err) => sendResponse({ success: false, error: err.message }));
          break;
        }

        case 'OVERRIDE_TAB_PARTS': {
          if (this.currentTabState && this.currentTabState.id === message.vNumber) {
            if (message.totalParts) this.currentTabState.totalParts = message.totalParts;
            if (message.currentPart) this.currentTabState.currentPart = message.currentPart;
            if (typeof message.outlineDetected === 'boolean') {
              this.currentTabState.outlineDetected = message.outlineDetected;
            }
            this.currentTabState.manualOverride = true;
            this.hud.update(this.currentTabState);
          }
          sendResponse({ success: true });
          break;
        }

        default:
          sendResponse({ success: true, ignored: true });
      }
    } catch (err: any) {
      console.error('[QwenAssistant Content] Error handling message:', err);
      sendResponse({ success: false, error: err.message });
    }
  }

  /**
   * Orchestrates prompt injection, file attachments, and submission with human-like pacing.
   * Dynamically formats the title at "My Version of Title:" or replaces markers.
   */
  private async executeTabPrompt(data: {
    tab: VTab;
    title: string;
    masterPrompt: string;
    thumbnail?: { name: string; type: string; base64: string };
    script?: { name: string; type: string; base64: string };
    nextPartTemplate?: string;
  }): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    const vId = data.tab.id;
    this.currentTabState = { ...data.tab, status: 'running' };
    this.hud.update(this.currentTabState);

    try {
      chrome.runtime.sendMessage({
        type: 'LOG_MESSAGE',
        level: 'INFO',
        message: `${vId}: Preparing prompt and attaching assets with natural human pacing...`,
        vNumber: vId
      });

      // 1. Build prompt dynamically with title placed at "My Version of Title:" or marker, including V-number prefix
      const promptText = formatPromptWithTitle(data.title, data.masterPrompt, vId);

      // Wait for input to be ready if page was busy
      let inputInserted = this.adapter.insertText(promptText);
      if (!inputInserted) {
        for (let i = 0; i < 12; i++) {
          await new Promise((r) => setTimeout(r, 400));
          inputInserted = this.adapter.insertText(promptText);
          if (inputInserted) break;
        }
      }

      if (!inputInserted) {
        throw createDiagnosticError('INPUT_NOT_FOUND', { vNumber: vId });
      }

      // Human-like pause after typing (700ms - 1300ms)
      await new Promise((resolve) => setTimeout(resolve, 700 + Math.random() * 600));

      // 2. Attach thumbnail if present (Thumbnail 1 for V1, Thumbnail 2 for V2, etc.)
      if (data.thumbnail && data.thumbnail.base64) {
        chrome.runtime.sendMessage({
          type: 'LOG_MESSAGE',
          level: 'INFO',
          message: `${vId}: Pasting thumbnail "${data.thumbnail.name}" via clipboard...`,
          vNumber: vId
        });
        const thumbBlob = this.base64ToBlob(data.thumbnail.base64, data.thumbnail.type);
        const thumbFile = new File([thumbBlob], data.thumbnail.name, { type: data.thumbnail.type });
        await this.adapter.pasteImageViaClipboard(thumbFile);
        // Human pause after attaching file (800ms - 1500ms)
        await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 700));
      }

      // 3. Attach competitor script if present (V1 script for V1, V2 script for V2, etc.)
      if (data.script && data.script.base64) {
        chrome.runtime.sendMessage({
          type: 'LOG_MESSAGE',
          level: 'INFO',
          message: `${vId}: Embedding competitor script "${data.script.name}"...`,
          vNumber: vId
        });
        const scriptBlob = this.base64ToBlob(data.script.base64, data.script.type);
        const scriptFile = new File([scriptBlob], data.script.name, { type: data.script.type });
        await this.adapter.attachFile(scriptFile);

        const scriptText = await scriptFile.text();
        const currentInput = this.adapter.getInputValue();
        if (!currentInput.includes('--- COMPETITOR SCRIPT')) {
          const scriptBlock = `\n\n--- COMPETITOR SCRIPT (${vId}: ${data.script.name}) ---\n${scriptText}\n--------------------------------------------------`;
          this.adapter.insertText(currentInput ? `${currentInput}${scriptBlock}` : scriptBlock);
        }
        // Human pause after attaching file (800ms - 1500ms)
        await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 700));
      }

      // 4. Verification: All assets attached, pause naturally before sending
      chrome.runtime.sendMessage({
        type: 'LOG_MESSAGE',
        level: 'INFO',
        message: `${vId}: All assets (Title, Prompt, Thumbnail, Script) verified. Submitting chat...`,
        vNumber: vId
      });

      // Natural pause before clicking send (1000ms - 1800ms)
      await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 800));

      // 5. Submit chat with retry for button activation
      let submitted = this.adapter.submitMessage();
      if (!submitted) {
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 500));
          submitted = this.adapter.submitMessage();
          if (submitted) break;
        }
      }
      if (!submitted) {
        throw createDiagnosticError('SEND_BUTTON_NOT_FOUND', { vNumber: vId });
      }

      // Accurately show Part 1 as generating while Qwen is streaming
      if (this.currentTabState) {
        this.currentTabState.status = 'running';
        this.currentTabState.currentPart = 1;
        const p1 = this.currentTabState.parts.find((p) => p.partNumber === 1);
        if (p1) {
          p1.status = 'generating';
        } else {
          this.currentTabState.parts.push({
            partNumber: 1,
            label: 'Part 1',
            status: 'generating',
            content: '',
            downloaded: false
          });
        }
        this.hud.update(this.currentTabState);
        chrome.runtime.sendMessage({
          type: 'CONTENT_PART_DETECTED',
          vNumber: vId,
          totalParts: this.currentTabState.totalParts || 1,
          parts: this.currentTabState.parts
        }).catch(() => {});
      }

      chrome.runtime.sendMessage({
        type: 'LOG_MESSAGE',
        level: 'INFO',
        message: `${vId}: Prompt submitted naturally. Qwen is now streaming the response...`,
        vNumber: vId
      });

      // 5. Wait for Qwen generation to complete (Rule #8: patient indefinite wait without timeout)
      const genResult = await this.adapter.waitForGenerationComplete(0, 800, () => !this.isProcessing);
      if (!genResult.complete && !this.isProcessing) {
        return;
      }

      // 6. Detect parts in the completed response (isGenerating = false)
      const isGeneratingNow = this.adapter.isGenerating();
      const vNum = parseInt(vId.replace(/\D/g, ''), 10) || 1;
      const detection = this.adapter.extractParts(1, isGeneratingNow, vNum, this.hasCompetitorScript());

      // Report detected parts
      this.safeSendMessage({
        type: 'CONTENT_PART_DETECTED',
        vNumber: vId,
        totalParts: detection.totalParts,
        parts: detection.parts,
        missingParts: detection.missingParts,
        duplicateParts: detection.duplicateParts,
        detectedVideoNumber: detection.detectedVideoNumber || vNum
      });

      // If Part 1 has content and response is finished, report completion
      const part1 = detection.parts.find((p) => p.partNumber === 1);
      if (!isGeneratingNow && part1 && part1.content && part1.status === 'done') {
        this.safeSendMessage({
          type: 'CONTENT_PART_COMPLETED',
          vNumber: vId,
          partNumber: 1,
          content: part1.content,
          heading: part1.heading,
          explicitMarker: part1.explicitMarker || `V${vNum} P1`,
          videoNumber: part1.videoNumber || vNum
        });
      }

      this.safeSendMessage({
        type: 'LOG_MESSAGE',
        level: 'SUCCESS',
        message: `${vId}: Generation completed! Detected ${detection.totalParts} script parts.`,
        vNumber: vId
      });

      // Update local state
      if (this.currentTabState) {
        this.currentTabState.parts = detection.parts;
        this.currentTabState.totalParts = detection.totalParts;
        this.currentTabState.currentPart = 1;
        this.currentTabState.status = detection.totalParts === 1 ? 'completed' : 'ready';
        this.hud.update(this.currentTabState);
      }
    } catch (err: any) {
      const diagError: DiagnosticError = err.problem
        ? err
        : createDiagnosticError('CUSTOM', {
            title: `Error on ${vId}`,
            problem: err.message || 'Automation paused unexpectedly.',
            why: 'The page took longer than expected to respond, or the input area was busy.',
            solution: 'Check the Qwen tab to ensure it is responsive, then click Retry.',
            vNumber: vId
          });

      if (this.currentTabState) {
        this.currentTabState.status = 'error';
        this.currentTabState.error = diagError;
        this.hud.update(this.currentTabState);
      }

      chrome.runtime.sendMessage({
        type: 'CONTENT_EXECUTION_ERROR',
        vNumber: vId,
        error: diagError
      });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Inserts request for next part (e.g. "Write Part 2 Script"), submits, and extracts result.
   */
  private async handleInsertNextPart(
    partNum: number,
    overrideTotalParts?: number,
    overrideWordCount?: number,
    overrideOutlineInstruction?: string
  ): Promise<void> {
    const vId = this.currentTabState?.id || 'V?';
    if (this.isProcessing) {
      if (!this.adapter.isGenerating()) {
        // Clear stale processing lock from prior cycle
        this.isProcessing = false;
      } else {
        chrome.runtime.sendMessage({
          type: 'LOG_MESSAGE',
          level: 'WARNING',
          message: `${vId}: Cannot insert Part ${partNum} — generation is currently in progress.`,
          vNumber: vId
        });
        return;
      }
    }
    this.isProcessing = true;

    const totalParts = overrideTotalParts || this.currentTabState?.totalParts || 0;
    const wordCount = overrideWordCount || this.currentTabState?.partWordCount || 4000;
    const isOriginalMode = !this.hasCompetitorScript();
    const outlineInstruction = isOriginalMode
      ? (overrideOutlineInstruction || this.currentTabState?.outlinePartInstructions?.[partNum])
      : undefined;

    try {
      if (this.currentTabState) {
        // Mark part as generating immediately
        this.currentTabState.status = 'running';
        this.currentTabState.currentPart = partNum;
        let p = this.currentTabState.parts.find((x) => x.partNumber === partNum);
        if (p) {
          p.status = 'generating';
        } else {
          this.currentTabState.parts.push({
            partNumber: partNum,
            label: `${vId} P${partNum}`,
            explicitMarker: `${vId} P${partNum}`,
            videoNumber: parseInt(vId.replace(/\D/g, ''), 10) || 1,
            status: 'generating',
            content: '',
            downloaded: false
          });
        }
        // Ensure all other incomplete parts remain in waiting (Queue)
        for (const other of this.currentTabState.parts) {
          if (other.partNumber !== partNum && other.status === 'generating') {
            other.status = 'waiting';
          }
        }
        this.hud.update(this.currentTabState);
        chrome.runtime.sendMessage({
          type: 'CONTENT_PART_DETECTED',
          vNumber: vId,
          totalParts: this.currentTabState.totalParts || partNum,
          parts: this.currentTabState.parts
        }).catch(() => {});
      }

      // Natural human-like pause before requesting the next part (600ms - 1200ms)
      await new Promise((resolve) => setTimeout(resolve, 600 + Math.random() * 600));

      // Find chat input with retry (to handle dynamic DOM updates)
      let input = this.adapter.findChatInput();
      if (!input) {
        for (let r = 0; r < 10; r++) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          input = this.adapter.findChatInput();
          if (input) break;
        }
      }
      if (!input) {
        throw createDiagnosticError('INPUT_NOT_FOUND', { vNumber: vId });
      }

      const promptText = generateWritePartPrompt(partNum, totalParts, wordCount, outlineInstruction);
      let inserted = this.adapter.insertText(promptText);
      if (!inserted) {
        for (let r = 0; r < 5; r++) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          inserted = this.adapter.insertText(promptText);
          if (inserted) break;
        }
      }
      if (!inserted) {
        throw createDiagnosticError('INPUT_NOT_FOUND', { vNumber: vId });
      }

      // Short delay after typing prompt
      await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 400));

      let submitted = this.adapter.submitMessage();
      if (!submitted) {
        for (let r = 0; r < 12; r++) {
          await new Promise((resolve) => setTimeout(resolve, 350));
          submitted = this.adapter.submitMessage();
          if (submitted) break;
        }
      }
      if (!submitted) {
        throw createDiagnosticError('SEND_BUTTON_NOT_FOUND', { vNumber: vId });
      }

      chrome.runtime.sendMessage({
        type: 'LOG_MESSAGE',
        level: 'INFO',
        message: `[AUTO] ${vId}: Part ${partNum} requested. Qwen is now streaming...`,
        vNumber: vId
      });

      const genResult = await this.adapter.waitForGenerationComplete(0, 800, () => !this.isProcessing);
      if (!genResult.complete && !this.isProcessing) {
        return;
      }

      // Generation complete: extract parts with isGenerating = false
      const isGeneratingNow = this.adapter.isGenerating();
      const vNum = parseInt(vId.replace(/\D/g, ''), 10) || 1;
      const detection = this.adapter.extractParts(partNum, isGeneratingNow, vNum, this.hasCompetitorScript());
      const generatedPart = detection.parts.find((p) => p.partNumber === partNum);

      if (!isGeneratingNow && generatedPart && generatedPart.content && generatedPart.status === 'done') {
        this.safeSendMessage({
          type: 'CONTENT_PART_COMPLETED',
          vNumber: vId,
          partNumber: partNum,
          content: generatedPart.content,
          heading: generatedPart.heading,
          explicitMarker: generatedPart.explicitMarker || `V${vNum} P${partNum}`,
          videoNumber: generatedPart.videoNumber || vNum
        });
      }

      this.safeSendMessage({
        type: 'LOG_MESSAGE',
        level: 'SUCCESS',
        message: `[AUTO] ${vId}: Part ${partNum} completed successfully!`,
        vNumber: vId
      });

      if (this.currentTabState) {
        this.currentTabState.parts = this.currentTabState.parts.map((p) =>
          p.partNumber === partNum
            ? { ...p, status: 'done', content: generatedPart?.content || p.content }
            : p.partNumber === partNum + 1 && p.status === 'waiting'
            ? { ...p, status: 'ready' }
            : p
        );

        const allDone = this.currentTabState.totalParts > 0 &&
          this.currentTabState.parts.length >= this.currentTabState.totalParts &&
          this.currentTabState.parts.every((p) => p.status === 'done');
        this.currentTabState.status = allDone ? 'completed' : 'ready';
        this.hud.update(this.currentTabState);
      }
    } catch (err: any) {
      const diagError: DiagnosticError = err.problem
        ? err
        : createDiagnosticError('CUSTOM', {
            title: `Part ${partNum} Error on ${vId}`,
            problem: err.message,
            why: 'The model generation was interrupted or timed out.',
            solution: 'Wait a moment for the page to stabilize and click Retry.',
            vNumber: vId
          });

      if (this.currentTabState) {
        this.currentTabState.error = diagError;
        this.hud.update(this.currentTabState);
      }

      chrome.runtime.sendMessage({
        type: 'CONTENT_EXECUTION_ERROR',
        vNumber: vId,
        error: diagError
      });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Downloads all completed parts for this specific V-tab directly from the page HUD,
   * merged in strict order (P1 -> P2 -> P3...).
   */
  private handleDownloadParts(): void {
    if (!this.currentTabState) return;
    const vId = this.currentTabState.id;
    const doneParts = this.currentTabState.parts.filter(
      (p) => p.status === 'done' && p.content && p.content.trim() && !detectOutlineInText(p.content).isOutline
    );

    if (doneParts.length === 0) return;

    // Strict numerical order: P1, then P2, then P3...
    doneParts.sort((a, b) => a.partNumber - b.partNumber);

    let mergedContent = '';
    doneParts.forEach((part, idx) => {
      if (idx > 0) mergedContent += '\n\n';
      mergedContent += formatMergedScriptPart(vId, part.partNumber, part.heading, part.content);
    });

    const filename = `${vId} Script.txt`;
    const blob = createTxtBlob(mergedContent.trim());
    triggerDownload(blob, filename);
  }

  private handleRetry(): void {
    if (!this.currentTabState) return;
    chrome.runtime.sendMessage({
      type: 'RETRY_TAB',
      vNumber: this.currentTabState.id
    });
  }

  private handleRestart(): void {
    if (!this.currentTabState) return;
    chrome.runtime.sendMessage({
      type: 'RESTART_TAB',
      vNumber: this.currentTabState.id
    });
  }

  private handleCancel(): void {
    if (!this.currentTabState) return;
    this.isProcessing = false;
    chrome.runtime.sendMessage({
      type: 'CANCEL_TAB',
      vNumber: this.currentTabState.id
    });
  }

  private async submitChatAndCollectResponse(vId: string): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    const hasScript = this.hasCompetitorScript();
    if (this.currentTabState) {
      this.currentTabState.status = 'running';
      if (hasScript) {
        // Direct parts mode: Turn 1 is Part 1
        this.currentTabState.currentPart = 1;
        const p1 = this.currentTabState.parts.find((p) => p.partNumber === 1);
        if (p1) {
          p1.status = 'generating';
        } else {
          this.currentTabState.parts.push({
            partNumber: 1,
            label: `${vId} P1`,
            explicitMarker: `${vId} P1`,
            videoNumber: parseInt(vId.replace(/\D/g, ''), 10) || 1,
            status: 'generating',
            content: '',
            downloaded: false
          });
        }
      } else {
        // No competitor script: Turn 1 is strictly OUTLINE generation!
        this.currentTabState.outlineStatus = 'generating';
        for (const p of this.currentTabState.parts) {
          if (p.status === 'generating') p.status = 'waiting';
        }
      }
      this.hud.update(this.currentTabState);
      chrome.runtime.sendMessage({
        type: 'CONTENT_PART_DETECTED',
        vNumber: vId,
        totalParts: this.currentTabState.totalParts || 1,
        parts: this.currentTabState.parts
      }).catch(() => {});
    }

    try {
      let submitted = this.adapter.submitMessage();
      if (!submitted) {
        for (let i = 0; i < 15; i++) {
          await new Promise((r) => setTimeout(r, 600));
          submitted = this.adapter.submitMessage();
          if (submitted) break;
        }
      }

      if (!submitted) {
        throw createDiagnosticError('SEND_BUTTON_NOT_FOUND', { vNumber: vId });
      }

      chrome.runtime.sendMessage({
        type: 'LOG_MESSAGE',
        level: 'INFO',
        message: hasScript
          ? `[AUTO] ${vId}: Chat submitted. Qwen is now streaming Part 1...`
          : `[AUTO] ${vId}: Chat submitted. Qwen is now streaming Outline...`,
        vNumber: vId
      });

      const genResult = await this.adapter.waitForGenerationComplete(0, 800, () => !this.isProcessing);
      if (!genResult.complete && !this.isProcessing) {
        return;
      }

      // Generation finished: extract parts with isGenerating = false
      const isGeneratingNow = this.adapter.isGenerating();
      let vNum = parseInt(vId.replace(/\D/g, ''), 10) || 1;
      const detection = this.adapter.extractParts(1, isGeneratingNow, vNum, this.hasCompetitorScript());

      if (detection.detectedVideoNumber && detection.detectedVideoNumber !== vNum) {
        const oldVId = vId;
        vNum = detection.detectedVideoNumber;
        vId = `V${vNum}`;
        if (this.currentTabState) {
          this.currentTabState.id = vId;
          this.currentTabState.index = vNum;
          this.currentTabState.detectedVideoNumber = vNum;
          this.currentTabState.parts = [];
        }
        this.safeSendMessage({
          type: 'REASSIGN_TAB_VNUMBER',
          fromVNumber: oldVId,
          toVideoNumber: vNum
        });
      }

      if (!hasScript && detection.outlineDetected) {
        // Outline generated! Do not mark any part as completed yet!
        if (this.currentTabState) {
          this.currentTabState.outlineDetected = true;
          this.currentTabState.outlineStatus = 'completed';
          this.currentTabState.outlineContent = detection.outlineContent;
          if (!this.currentTabState.manualOverride && detection.totalParts > 0) {
            this.currentTabState.totalParts = detection.totalParts;
          }
          // Planned parts from outline are strictly in Queue
          this.currentTabState.parts = detection.parts.map((p) => ({
            ...p,
            status: 'waiting',
            content: ''
          }));
          this.currentTabState.status = 'ready';
          this.hud.update(this.currentTabState);
        }

        this.safeSendMessage({
          type: 'CONTENT_OUTLINE_DETECTED',
          vNumber: vId,
          totalParts: this.currentTabState?.totalParts || detection.totalParts,
          outlineContent: detection.outlineContent,
          outlineStatus: 'completed',
          outlinePartInstructions: this.currentTabState?.outlinePartInstructions,
          lifecycleStage: 'OUTLINE_GENERATED',
          liveDebugStatus: `OUTLINE GENERATED ✓ | Total Parts: ${this.currentTabState?.totalParts || detection.totalParts} ✓ | Ready for ${vId}, P1`
        });

        this.safeSendMessage({
          type: 'LOG_MESSAGE',
          level: 'SUCCESS',
          message: `${vId}: Outline generated (${this.currentTabState?.totalParts || detection.totalParts} total parts planned). Outline is not counted as Part 1. Ready for Part 1!`,
          vNumber: vId
        });
      } else {
        // Direct script part completed
        if (this.currentTabState) {
          this.currentTabState.totalParts = Math.max(this.currentTabState.totalParts || 0, detection.totalParts);
          detection.parts.forEach((newP) => {
            const existP = this.currentTabState!.parts.find((x) => x.partNumber === newP.partNumber);
            if (existP) {
              if (newP.content && newP.content.trim()) existP.content = newP.content;
              if (newP.heading) existP.heading = newP.heading;
              if (newP.explicitMarker) existP.explicitMarker = newP.explicitMarker;
              if (newP.videoNumber) existP.videoNumber = newP.videoNumber;
              existP.status = newP.status;
            } else {
              this.currentTabState!.parts.push({ ...newP });
            }
          });
          this.currentTabState.parts.sort((a, b) => a.partNumber - b.partNumber);
          this.hud.update(this.currentTabState);
        }

        this.safeSendMessage({
          type: 'CONTENT_PART_DETECTED',
          vNumber: vId,
          totalParts: this.currentTabState?.totalParts || detection.totalParts,
          parts: this.currentTabState?.parts || detection.parts,
          missingParts: detection.missingParts,
          duplicateParts: detection.duplicateParts,
          detectedVideoNumber: detection.detectedVideoNumber || vNum
        });

        const part1 = this.currentTabState?.parts.find((p) => p.partNumber === 1 && p.status === 'done') || detection.parts.find((p) => p.partNumber === 1 && p.status === 'done');
        if (!isGeneratingNow && part1 && part1.content) {
          this.safeSendMessage({
            type: 'CONTENT_PART_COMPLETED',
            vNumber: vId,
            partNumber: 1,
            content: part1.content,
            heading: part1.heading,
            explicitMarker: part1.explicitMarker || `V${vNum} P1`,
            videoNumber: part1.videoNumber || vNum
          });
        }
      }
    } catch (err: any) {
      chrome.runtime.sendMessage({
        type: 'LOG_MESSAGE',
        level: 'ERROR',
        message: `${vId}: Error - ${err.message}`,
        vNumber: vId
      });
      if (this.currentTabState) {
        this.currentTabState.status = 'error';
        this.currentTabState.error = err.message;
        this.hud.update(this.currentTabState);
      }
      throw err;
    } finally {
      this.isProcessing = false;
    }
  }

  private async takeoverManualRun(vId: string): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    const currentP = this.currentTabState?.currentPart || 1;
    chrome.runtime.sendMessage({
      type: 'LOG_MESSAGE',
      level: 'INFO',
      message: `[MANUAL] ${vId}: Manual submission detected via user Alt-Tab/Enter. Now streaming Part ${currentP}...`,
      vNumber: vId
    });
    try {
      if (this.currentTabState) {
        this.currentTabState.status = 'running';
        let p = this.currentTabState.parts.find((x) => x.partNumber === currentP);
        if (p) {
          p.status = 'generating';
        } else {
          this.currentTabState.parts.push({
            partNumber: currentP,
            label: `Part ${currentP}`,
            status: 'generating',
            content: '',
            downloaded: false
          });
        }
        this.hud.update(this.currentTabState);
        chrome.runtime.sendMessage({
          type: 'CONTENT_PART_DETECTED',
          vNumber: vId,
          totalParts: this.currentTabState.totalParts || currentP,
          parts: this.currentTabState.parts
        }).catch(() => {});
      }

      const genResult = await this.adapter.waitForGenerationComplete(0, 800, () => !this.isProcessing);
      if (!genResult.complete && !this.isProcessing) {
        return;
      }
      
      // Generation finished: extract parts with isGenerating = false
      const isGeneratingNow = this.adapter.isGenerating();
      let vNum = parseInt(vId.replace(/\D/g, ''), 10) || 1;
      const detection = this.adapter.extractParts(currentP, isGeneratingNow, vNum, this.hasCompetitorScript());

      if (detection.detectedVideoNumber && detection.detectedVideoNumber !== vNum) {
        const oldVId = vId;
        vNum = detection.detectedVideoNumber;
        vId = `V${vNum}`;
        if (this.currentTabState) {
          this.currentTabState.id = vId;
          this.currentTabState.index = vNum;
          this.currentTabState.detectedVideoNumber = vNum;
          this.currentTabState.parts = [];
        }
        this.safeSendMessage({
          type: 'REASSIGN_TAB_VNUMBER',
          fromVNumber: oldVId,
          toVideoNumber: vNum
        });
      }

      if (this.currentTabState) {
        if (!this.currentTabState.manualOverride && detection.totalParts > 0) {
          this.currentTabState.totalParts = detection.totalParts;
          if (this.currentTabState.parts && this.currentTabState.parts.length > 0) {
            this.currentTabState.parts = this.currentTabState.parts.filter(
              (p) => p.partNumber <= detection.totalParts || (p.status === 'done' && p.content && p.content.trim())
            );
          }
        }

        if (detection.outlineDetected) {
          this.currentTabState.outlineDetected = true;
          this.currentTabState.outlineContent = detection.outlineContent;
        }

        detection.parts.forEach((newP) => {
          const existP = this.currentTabState!.parts.find((x) => x.partNumber === newP.partNumber);
          if (existP) {
            if (newP.content && newP.content.trim()) existP.content = newP.content;
            if (newP.heading) existP.heading = newP.heading;
            if (newP.explicitMarker) existP.explicitMarker = newP.explicitMarker;
            if (newP.videoNumber) existP.videoNumber = newP.videoNumber;
            existP.status = newP.status;
          } else {
            this.currentTabState!.parts.push({ ...newP });
          }
        });
        this.currentTabState.parts.sort((a, b) => a.partNumber - b.partNumber);
        this.hud.update(this.currentTabState);
      }

      if (detection.outlineDetected && !detection.parts.some((p) => p.content)) {
        // Outline generated! Do not complete Part 1 yet.
        this.safeSendMessage({
          type: 'CONTENT_OUTLINE_DETECTED',
          vNumber: vId,
          totalParts: this.currentTabState?.totalParts || detection.totalParts,
          outlineContent: detection.outlineContent
        });
        this.safeSendMessage({
          type: 'LOG_MESSAGE',
          level: 'SUCCESS',
          message: `[MANUAL] ${vId}: Outline generated (${this.currentTabState?.totalParts || detection.totalParts} total parts planned). Outline is not counted as Part 1. Ready for Part 1!`,
          vNumber: vId
        });
      } else {
        this.safeSendMessage({ 
          type: 'CONTENT_PART_DETECTED', 
          vNumber: vId, 
          totalParts: this.currentTabState?.totalParts || detection.totalParts,
          parts: this.currentTabState?.parts || detection.parts,
          missingParts: detection.missingParts,
          duplicateParts: detection.duplicateParts,
          detectedVideoNumber: detection.detectedVideoNumber || vNum
        });
        
        const finishedPart = this.currentTabState?.parts.find((p) => p.partNumber === currentP && p.status === 'done') || detection.parts.find((p) => p.partNumber === currentP && p.status === 'done');
        if (!isGeneratingNow && finishedPart && finishedPart.content) {
          this.safeSendMessage({
            type: 'CONTENT_PART_COMPLETED',
            vNumber: vId,
            partNumber: currentP,
            content: finishedPart.content,
            heading: finishedPart.heading,
            explicitMarker: finishedPart.explicitMarker || `V${vNum} P${currentP}`,
            videoNumber: finishedPart.videoNumber || vNum
          });
          this.safeSendMessage({
            type: 'LOG_MESSAGE',
            level: 'SUCCESS',
            message: `[MANUAL] ${vId}: Part ${currentP} (${finishedPart.heading || 'Script'}) generation finished and synced to dashboard!`,
            vNumber: vId
          });
        }
      }
    } catch (err: any) {
      if (this.currentTabState) {
        this.currentTabState.status = 'error';
        this.currentTabState.error = err.message;
        this.hud.update(this.currentTabState);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private handleRefresh(): void {
    // STRICT RULE: NEVER reload or navigate the Meta tab!
    // Instead, re-scan DOM for parts and dispatch global resync across ALL managed tabs.
    this.lastDetectedText = '';
    this.checkAndReportPartsUpdate(true);
    // Global resync across all tabs
    this.safeSendMessage({ type: 'RESYNC_ALL_TABS' }, () => {
      this.safeSendMessage({ type: 'GET_STATE' }, (resp) => {
        if (resp && resp.state && this.currentTabState?.id) {
          const tab = resp.state.tabs.find((t: VTab) => t.id === this.currentTabState!.id);
          if (tab) {
            this.currentTabState = tab;
            this.hud.update(tab);
          }
        }
      });
    });
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    const raw = base64.split(',')[1] || base64;
    const binaryString = atob(raw);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  private base64ToBlob(base64: string, mimeType: string): Blob {
    const byteCharacters = atob(base64.split(',')[1] || base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  }

  /**
   * Continuously monitors assistant response content to detect Total Parts and update HUD.
   */
  private startContinuousMonitoring(): void {
    // Immediate check after 1s
    setTimeout(() => this.checkAndReportPartsUpdate(), 1000);

    // Periodic check every 1500ms
    if (this.monitorInterval) clearInterval(this.monitorInterval);
    this.monitorInterval = window.setInterval(() => {
      this.checkAndReportPartsUpdate();
    }, 1500);

    // MutationObserver on document.body for instant reactive detection
    if (this.monitorObserver) this.monitorObserver.disconnect();
    this.monitorObserver = new MutationObserver(() => {
      this.checkAndReportPartsUpdate();
    });

    if (document.body) {
      this.monitorObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  }

  private checkAndReportPartsUpdate(force: boolean = false): void {
    // Tab MUST have a confirmed identity from background before reporting parts!
    if (!this.currentTabState || !this.currentTabState.id) {
      return;
    }

    // Check if user manually triggered a generation while we were waiting
    if (this.currentTabState?.status === 'ready' && !this.isProcessing && this.adapter.isGenerating()) {
      this.takeoverManualRun(this.currentTabState.id);
      return;
    }

    const latestText = this.adapter.findLatestResponse();
    if (!latestText) return;
    if (!force && latestText.trim() === this.lastDetectedText) return;
    this.lastDetectedText = latestText.trim();

    const isGeneratingNow = this.adapter.isGenerating() || this.isProcessing;
    let vId = this.currentTabState.id;
    let vNum = parseInt(vId.replace(/\D/g, ''), 10) || 1;

    // Detect if explicit top marker exists in latestText (e.g. "V14/P2", "V14 P2", "v6p1")
    const topMarker = extractTopExplicitMarker(latestText);
    const explicitMarkers = findExplicitMarkersInText(latestText);
    const primaryMarker = topMarker || (explicitMarkers.length > 0 ? explicitMarkers[0] : null);

    if (primaryMarker && primaryMarker.videoNumber && primaryMarker.videoNumber !== vNum) {
      const oldVId = vId;
      vNum = primaryMarker.videoNumber;
      vId = `V${vNum}`;
      this.currentTabState.id = vId;
      this.currentTabState.index = vNum;
      this.currentTabState.detectedVideoNumber = vNum;
      // Clear parts from previous wrongly-assigned video to prevent false duplicate errors
      this.currentTabState.parts = [];
      this.currentTabState.missingParts = [];
      this.currentTabState.duplicateParts = [];

      this.safeSendMessage({
        type: 'REASSIGN_TAB_VNUMBER',
        fromVNumber: oldVId,
        toVideoNumber: vNum
      });
      this.hud.update(this.currentTabState);
    }

    if (primaryMarker && primaryMarker.partNumber) {
      if (this.currentTabState.currentPart !== primaryMarker.partNumber) {
        this.currentTabState.currentPart = primaryMarker.partNumber;
      }
      this.currentTabState.detectedVideoNumber = primaryMarker.videoNumber;
    } else {
      // Fallback: detect if current stream starts with explicit marker
      const startMarker = extractStartingExplicitMarker(latestText);
      if (startMarker) {
        if (this.currentTabState.currentPart !== startMarker.partNumber) {
          this.currentTabState.currentPart = startMarker.partNumber;
        }
        this.currentTabState.detectedVideoNumber = startMarker.videoNumber;
      }
    }

    const currentPartNum = this.currentTabState.currentPart || 1;
    const detection = this.adapter.extractParts(currentPartNum, isGeneratingNow, vNum, this.hasCompetitorScript());

    if (detection.totalParts > 0 || detection.parts.length > 0 || detection.outlineDetected) {
      if (!this.currentTabState.manualOverride && detection.totalParts > 0) {
        this.currentTabState.totalParts = detection.totalParts;
        if (this.currentTabState.parts && this.currentTabState.parts.length > 0) {
          this.currentTabState.parts = this.currentTabState.parts.filter(
            (p) => p.partNumber <= detection.totalParts || (p.status === 'done' && p.content && p.content.trim())
          );
        }
      }

      if (detection.outlineDetected) {
        this.currentTabState.outlineDetected = true;
        this.currentTabState.outlineContent = detection.outlineContent;
      }

      this.currentTabState.missingParts = detection.missingParts;
      this.currentTabState.duplicateParts = detection.duplicateParts;
      this.currentTabState.detectedVideoNumber = detection.detectedVideoNumber || vNum;
      
      // Merge parts into currentTabState.parts without overwriting completed content
      if (!this.currentTabState.parts) this.currentTabState.parts = [];

      detection.parts.forEach((newP) => {
        const existP = this.currentTabState!.parts.find((x) => x.partNumber === newP.partNumber);
        if (existP) {
          if (newP.content && newP.content.trim()) existP.content = newP.content;
          if (newP.heading) existP.heading = newP.heading;
          if (newP.explicitMarker) existP.explicitMarker = newP.explicitMarker;
          if (newP.videoNumber) existP.videoNumber = newP.videoNumber;
          existP.status = newP.status;
        } else {
          this.currentTabState!.parts.push({ ...newP });
        }
      });

      this.currentTabState.parts.sort((a, b) => a.partNumber - b.partNumber);

      if (detection.lifecycleStage) {
        this.currentTabState.lifecycleStage = detection.lifecycleStage;
      }
      if (detection.liveDebugStatus) {
        this.currentTabState.liveDebugStatus = detection.liveDebugStatus;
      }

      // Update the floating HUD immediately in real time!
      this.hud.update(this.currentTabState);

      if (detection.outlineDetected && !detection.parts.some((p) => p.content)) {
        // Outline detected
        this.currentTabState.outlineStatus = isGeneratingNow ? 'generating' : (detection.outlineStatus || 'completed');
        if (detection.outlinePartInstructions && detection.outlinePartInstructions.size > 0) {
          this.currentTabState.outlinePartInstructions = Object.fromEntries(detection.outlinePartInstructions);
        }
        this.safeSendMessage({
          type: 'CONTENT_OUTLINE_DETECTED',
          vNumber: vId,
          totalParts: this.currentTabState.totalParts,
          outlineContent: detection.outlineContent,
          outlineStatus: this.currentTabState.outlineStatus,
          outlinePartInstructions: this.currentTabState.outlinePartInstructions,
          lifecycleStage: this.currentTabState.lifecycleStage,
          liveDebugStatus: this.currentTabState.liveDebugStatus
        });
      } else {
        if (detection.outlineStatus) {
          this.currentTabState.outlineStatus = detection.outlineStatus;
        }
        if (detection.outlinePartInstructions && detection.outlinePartInstructions.size > 0) {
          this.currentTabState.outlinePartInstructions = Object.fromEntries(detection.outlinePartInstructions);
        }
        // Notify background service worker of detected parts
        this.safeSendMessage({
          type: 'CONTENT_PART_DETECTED',
          vNumber: vId,
          totalParts: this.currentTabState.totalParts,
          parts: this.currentTabState.parts,
          missingParts: detection.missingParts,
          duplicateParts: detection.duplicateParts,
          detectedVideoNumber: this.currentTabState.detectedVideoNumber,
          lifecycleStage: this.currentTabState.lifecycleStage,
          liveDebugStatus: this.currentTabState.liveDebugStatus
        });

        // ONLY report completion if Qwen has completely finished generating!
        if (!isGeneratingNow) {
          const completedPart = this.currentTabState.parts.find(
            (p) => p.partNumber === currentPartNum && p.content && p.status === 'done'
          );
          if (completedPart && completedPart.content) {
            this.safeSendMessage({
              type: 'CONTENT_PART_COMPLETED',
              vNumber: vId,
              partNumber: completedPart.partNumber,
              content: completedPart.content,
              heading: completedPart.heading,
              explicitMarker: completedPart.explicitMarker,
              videoNumber: completedPart.videoNumber
            });
          }
        }
      }
    }
  }

  public destroy(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    if (this.monitorObserver) {
      this.monitorObserver.disconnect();
      this.monitorObserver = null;
    }
    document.getElementById('qwen-extension-hud-root')?.remove();
  }
}

declare global {
  interface Window {
    __metaAssistantController?: MetaContentController;
    __qwenAssistantController?: MetaContentController;
  }
}

if (typeof window !== 'undefined') {
  if (window.__metaAssistantController) {
    try {
      window.__metaAssistantController.destroy();
    } catch {}
  }
  if (window.__qwenAssistantController) {
    try {
      window.__qwenAssistantController.destroy();
    } catch {}
  }

  const startController = () => {
    const controller = new MetaContentController();
    window.__metaAssistantController = controller;
    window.__qwenAssistantController = controller;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startController);
  } else {
    startController();
  }
}

export const QwenContentController = MetaContentController;
export type QwenContentController = MetaContentController;
