import { QWEN_SELECTORS } from './selectors';
import { detectPartsInText, detectPartsFromMessages, cleanScriptContent, PartDetectionResult } from '../utils/partDetector';

export class QwenAdapter {
  private document: Document;

  constructor(doc: Document = document) {
    this.document = doc;
  }

  /**
   * Locates the active chat input field (textarea or contenteditable).
   */
  public findChatInput(): HTMLElement | null {
    for (const selector of QWEN_SELECTORS.CHAT_INPUTS) {
      try {
        const el = this.document.querySelector<HTMLElement>(selector);
        if (el && this.isElementVisible(el)) {
          return el;
        }
      } catch {
        // Ignore invalid selector syntax on edge browsers
      }
    }
    return null;
  }

  /**
   * Locates the send/submit button.
   * Scoped to the chat input container to NEVER accidentally click sidebar, back, or navigation buttons!
   */
  public findSendButton(): HTMLElement | null {
    const input = this.findChatInput();

    // Priority 1: Search inside or adjacent to the chat input container (footer / form / input box)
    if (input) {
      const container =
        input.closest('form, div[class*="input" i], div[class*="chat-bottom" i], div[class*="footer" i], div[class*="send" i], div[class*="prompt" i]') ||
        input.parentElement?.parentElement ||
        input.parentElement;

      if (container) {
        for (const selector of QWEN_SELECTORS.SEND_BUTTONS) {
          try {
            const el = container.querySelector<HTMLElement>(selector);
            if (el && this.isElementVisible(el)) {
              return el;
            }
          } catch {}
        }
      }
    }

    // Priority 2: Document search, strictly filtering out navigation, sidebar, headers
    for (const selector of QWEN_SELECTORS.SEND_BUTTONS) {
      try {
        const matches = this.document.querySelectorAll<HTMLElement>(selector);
        for (let i = 0; i < matches.length; i++) {
          const el = matches[i];
          // Exclude sidebars, headers, history nav, top bars
          if (el.closest('header, nav, aside, [class*="sidebar" i], [class*="history" i], [class*="nav" i], [class*="menu" i]')) {
            continue;
          }
          if (this.isElementVisible(el)) {
            return el;
          }
        }
      } catch {
        // Ignore error
      }
    }
    return null;
  }

  /**
   * Locates the file input element. If not found, attempts to trigger the upload button to reveal it.
   */
  public findFileInput(): HTMLInputElement | null {
    for (const selector of QWEN_SELECTORS.FILE_INPUTS) {
      const el = this.document.querySelector<HTMLInputElement>(selector);
      if (el) return el;
    }
    return null;
  }

  /**
   * Locates the upload/attachment trigger button.
   */
  public findUploadButton(): HTMLElement | null {
    for (const selector of QWEN_SELECTORS.UPLOAD_BUTTONS) {
      const el = this.document.querySelector<HTMLElement>(selector);
      if (el && this.isElementVisible(el)) return el;
    }
    return null;
  }

  /**
   * Reads current text value inside the chat input field.
   */
  public getInputValue(): string {
    const input = this.findChatInput();
    if (!input) return '';

    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      return input.value || '';
    }
    return input.innerText || input.textContent || '';
  }

  /**
   * Inserts text into the chat input while dispatching framework-compliant synthetic events (React/Vue).
   */
  public insertText(text: string): boolean {
    const input = this.findChatInput();
    if (!input) return false;

    input.focus();

    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      // Use native value setter to bypass React/Vue property interception
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(input, text);
      } else {
        input.value = text;
      }

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (input.isContentEditable) {
      input.focus();
      // Use document.execCommand for rich-text framework compatibility
      document.execCommand('selectAll', false, undefined);
      const success = document.execCommand('insertText', false, text);
      if (!success || !input.textContent || !input.textContent.includes(text.slice(0, 20))) {
        try {
          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: new DataTransfer()
          });
          pasteEvent.clipboardData?.setData('text/plain', text);
          input.dispatchEvent(pasteEvent);
        } catch {}
      }
      if (!input.textContent || !input.textContent.includes(text.slice(0, 20))) {
        input.textContent = text;
      }
      input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }

    return true;
  }

  /**
   * Explicitly clears the chat input element to ensure no leftover prompt text sits in the input.
   */
  public clearInput(): void {
    const input = this.findChatInput();
    if (!input) return;

    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(input, '');
      } else {
        input.value = '';
      }

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (input.isContentEditable) {
      input.focus();
      document.execCommand('selectAll', false, undefined);
      document.execCommand('delete', false, undefined);
      input.textContent = '';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    }
  }

  /**
   * Submits the current message either by clicking the send button or firing an Enter key event.
   */
  public submitMessage(): boolean {
    const sendBtn = this.findSendButton();
    if (sendBtn && !sendBtn.hasAttribute('disabled')) {
      sendBtn.click();
      return true;
    }

    // Fallback: Dispatch Enter keydown on input field
    const input = this.findChatInput();
    if (input) {
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        })
      );
      return true;
    }

    return false;
  }

  /**
   * Attaches a File to the chat interface using DataTransfer and standard FileList simulation.
   */
  /**
   * Waits for file/thumbnail upload spinners to disappear.
   */
  public async waitForUploadToComplete(timeoutMs = 15000): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      // Check for any common loading indicators inside the upload previews
      let isUploading = false;
      const previews = this.document.querySelectorAll('.file-chip, .attachment-preview, .uploaded-file, [data-testid="file-preview"], .ant-upload-list-item, .preview-badge, [class*="uploading"], [class*="progress"]');
      
      for (let i = 0; i < previews.length; i++) {
        const p = previews[i];
        // If it contains a spinner SVG or a loading class
        if (p.querySelector('svg.animate-spin, .loading, .spinner') || p.className.includes('uploading')) {
          isUploading = true;
          break;
        }
      }

      // Also check if Send button is explicitly disabled (often disabled during upload)
      const sendBtn = this.findSendButton();
      if (sendBtn && sendBtn.hasAttribute('disabled')) {
        isUploading = true;
      }

      if (!isUploading) {
        // Double check after 500ms to ensure it didn't just flicker
        await new Promise((r) => setTimeout(r, 500));
        return true; 
      }
      
      await new Promise((r) => setTimeout(r, 500));
    }
    return false; // Timeout
  }

  public async attachFile(file: File): Promise<boolean> {
    let fileInput = this.findFileInput();

    // If file input isn't in DOM yet, click the upload button to instantiate it
    if (!fileInput) {
      const uploadBtn = this.findUploadButton();
      if (uploadBtn) {
        uploadBtn.click();
        await new Promise((resolve) => setTimeout(resolve, 200));
        fileInput = this.findFileInput();
      }
    }

    if (fileInput) {
      try {
        const dataTransfer = new DataTransfer();
        if (fileInput.multiple && fileInput.files && fileInput.files.length > 0) {
          Array.from(fileInput.files).forEach((f) => dataTransfer.items.add(f));
        }
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;

        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));

        // Allow UI to render preview badge
        await new Promise((resolve) => setTimeout(resolve, 600));
        return true;
      } catch (err) {
        console.warn('[QwenAdapter] Direct fileInput.files assignment failed:', err);
      }
    }

    // Fallback: Drag-and-Drop simulation on input container
    const targetArea = this.findChatInput()?.parentElement || this.findChatInput();
    if (targetArea) {
      try {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        targetArea.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer }));
        targetArea.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer }));
        targetArea.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));

        await new Promise((resolve) => setTimeout(resolve, 300));
        return true;
      } catch (err) {
        console.warn('[QwenAdapter] Drag-and-drop fallback failed:', err);
      }
    }

    return false;
  }

  /**
   * Simulates pasting an image from clipboard (Cmd+V / Ctrl+V) directly into Qwen's chat box.
   * Also cascades to synthetic drag-drop and file input if needed.
   */
  public async pasteImageViaClipboard(file: File): Promise<boolean> {
    const input = this.findChatInput();
    if (input) {
      input.focus();

      try {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        // 1. Dispatch synthetic ClipboardEvent('paste')
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer
        });
        input.dispatchEvent(pasteEvent);

        // Short pause to let clipboard event handler run
        await new Promise((resolve) => setTimeout(resolve, 600));

        // If preview element appeared, return true
        if (this.hasUploadPreview()) {
          return true;
        }
      } catch (err) {
        console.warn('[QwenAdapter] Clipboard paste failed:', err);
      }
    }

    // 2. Fallback to attachFile (fileInput and drag-drop)
    return await this.attachFile(file);
  }

  /**
   * Checks if an upload preview/chip element is currently visible in the DOM.
   */
  public hasUploadPreview(): boolean {
    for (const selector of QWEN_SELECTORS.UPLOAD_PREVIEWS) {
      const el = this.document.querySelector(selector);
      if (el && this.isElementVisible(el as HTMLElement)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Reads current text from chat input field.
   */
  public getCurrentInputText(): string {
    const input = this.findChatInput();
    if (!input) return '';
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      return input.value || '';
    }
    return input.innerText || input.textContent || '';
  }

  /**
   * Finds all assistant message nodes in the chat.
   */
  public findGeneratedMessages(): HTMLElement[] {
    const list: HTMLElement[] = [];
    for (const selector of QWEN_SELECTORS.ASSISTANT_MESSAGES) {
      const matches = this.document.querySelectorAll<HTMLElement>(selector);
      if (matches.length > 0) {
        return Array.from(matches);
      }
    }
    return list;
  }

  /**
   * Extracts the text content of the latest assistant message.
   */
  public findLatestResponse(): string | null {
    const messages = this.findGeneratedMessages();
    if (messages.length > 0) {
      const latest = messages[messages.length - 1];
      const text = latest.innerText || latest.textContent || null;
      if (text && text.trim()) return text;
    }

    // Fallback: search for any container with "Total Parts:" or "Part 1"
    const candidates = this.document.querySelectorAll<HTMLElement>('.qwen-markdown, .markdown-body, div[class*="message"], article, section');
    for (let i = candidates.length - 1; i >= 0; i--) {
      const el = candidates[i];
      const text = el.innerText || el.textContent || '';
      if (/(total\s*parts?|всего\s*частей|part\s*0*1\b)/i.test(text)) {
        if (!el.querySelector('textarea, input, [contenteditable="true"]')) {
          return text;
        }
      }
    }
    return null;
  }

  /**
   * Checks whether Qwen is currently generating, thinking, or streaming an answer.
   * Accurately catches Qwen 2.5 thinking mode ("💡 Crafting a narrative... > Skip"), stop buttons, and reasoning states.
   */
  public isGenerating(): boolean {
    // 1. Selector checks
    for (const selector of QWEN_SELECTORS.GENERATING_INDICATORS) {
      try {
        const el = this.document.querySelector(selector);
        if (el && this.isElementVisible(el as HTMLElement)) {
          return true;
        }
      } catch {}
    }

    // 2. Qwen Thinking / Reasoning state (e.g. "💡 Crafting a narrative... > Skip")
    const buttons = this.document.querySelectorAll('button, div[role="button"], a');
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i] as HTMLElement;
      const text = (btn.textContent || btn.innerText || '').trim();
      if (/^(skip|跳过|stop|停止)$/i.test(text) && this.isElementVisible(btn)) {
        return true;
      }
    }

    // 3. Active thinking container with spinner or active child (strictly excluding completed thinking)
    const thinkingContainers = this.document.querySelectorAll(
      'div[class*="think" i], div[class*="thought" i], div[class*="reasoning" i], [data-testid*="think" i]'
    );
    for (let i = 0; i < thinkingContainers.length; i++) {
      const c = thinkingContainers[i] as HTMLElement;
      if (this.isElementVisible(c)) {
        const text = (c.textContent || c.innerText || '').toLowerCase();
        // If this container marks completed thinking (e.g. "Thinking completed >" or "Thought for 12s"), skip it!
        if (text.includes('thinking completed') || text.includes('thought for') || text.includes('подумал')) {
          continue;
        }
        // Only return true if an active spinner or skip/stop control is inside
        const hasActiveIndicator = c.querySelector('button[aria-label*="skip" i], button[aria-label*="stop" i], svg[class*="spin" i], [class*="animate-spin" i], .ant-spin');
        if (hasActiveIndicator && this.isElementVisible(hasActiveIndicator as HTMLElement)) {
          return true;
        }
      }
    }

    // 4. Send button converted to stop button (square/rect icon)
    const sendBtn = this.findSendButton();
    if (sendBtn) {
      if (sendBtn.querySelector('rect') || /stop|停止/i.test(sendBtn.getAttribute('aria-label') || '')) {
        return true;
      }
    }

    // 5. Input disabled while generating
    const input = this.findChatInput();
    if (input) {
      if ((input as any).disabled || input.getAttribute('aria-disabled') === 'true') {
        return true;
      }
    }

    return false;
  }

  /**
   * Waits for Qwen text generation / thinking to finish.
   * In accordance with Rule #8, waits indefinitely without artificial timeout failures.
   * Resolves when generation completes and response stabilizes.
   */
  public async waitForGenerationComplete(
    timeoutMs = 0,
    pollIntervalMs = 800,
    isCancelled?: () => boolean
  ): Promise<{ complete: boolean; responseText: string }> {
    const startTime = Date.now();
    let lastText = '';
    let stableCount = 0;

    // Give initial 1.5 seconds for generation to start
    await new Promise((resolve) => setTimeout(resolve, 1500));

    while (timeoutMs === 0 || Date.now() - startTime < timeoutMs) {
      if (isCancelled && isCancelled()) {
        return { complete: false, responseText: lastText };
      }

      const generating = this.isGenerating();
      const currentText = this.findLatestResponse() || '';

      if (!generating) {
        // If not generating, verify if text has been stable for 2 cycles
        if (currentText && currentText === lastText) {
          stableCount++;
          if (stableCount >= 2) {
            return { complete: true, responseText: currentText };
          }
        } else {
          stableCount = 0;
        }
      } else {
        stableCount = 0;
      }

      lastText = currentText;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return { complete: false, responseText: lastText };
  }

  /**
   * Reads all assistant message texts across all turns in chronological order.
   */
  public getAllAssistantMessagesText(): string[] {
    const messages = this.findGeneratedMessages();
    if (messages.length > 0) {
      return messages
        .map((m) => m.innerText || m.textContent || '')
        .filter((t) => t && t.trim().length > 0);
    }
    const latest = this.findLatestResponse();
    return latest ? [latest] : [];
  }

  /**
   * Extracts and detects script parts across all assistant messages in the chat.
   * Accurately reflects Generating vs Done status.
   */
  public extractParts(
    expectedPart = 1,
    isGenerating = false,
    targetVideoNumber?: number,
    hasCompetitorScript = false
  ): PartDetectionResult {
    const allMsgs = this.getAllAssistantMessagesText();
    return detectPartsFromMessages(allMsgs, expectedPart, isGenerating, targetVideoNumber, hasCompetitorScript);
  }

  private isElementVisible(el: HTMLElement): boolean {
    if (!el.offsetParent && el.offsetWidth === 0 && el.offsetHeight === 0) {
      // Check if display: none or visibility: hidden
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }
    return true;
  }
}

export const MetaAdapter = QwenAdapter;
export type MetaAdapter = QwenAdapter;
