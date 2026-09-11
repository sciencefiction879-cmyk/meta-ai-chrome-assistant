/**
 * Centralized, prioritized DOM selector configurations for Meta.ai chat interfaces
 * Supports meta.ai, www.meta.ai, and local test mock harness.
 */
export const META_SELECTORS = {
  // Input elements: Textareas, Lexical contenteditables, role=textbox
  CHAT_INPUTS: [
    'div[contenteditable="true"][data-lexical-editor="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][aria-label*="Ask" i]',
    'div[contenteditable="true"][aria-label*="Message" i]',
    'div[contenteditable="true"][aria-label*="Prompt" i]',
    'div[contenteditable="true"]',
    'textarea[placeholder*="Ask" i]',
    'textarea[placeholder*="Message" i]',
    'textarea[placeholder*="Meta" i]',
    'textarea[placeholder*="Type" i]',
    'textarea',
    '#chat-input',
    '[data-testid="chat-input"]',
    '[data-testid="message-input"]',
    '[data-testid="composer-input"]'
  ],

  // Submit / Send buttons
  SEND_BUTTONS: [
    'button[aria-label*="Send" i]',
    'button[aria-label*="Submit" i]',
    'div[role="button"][aria-label*="Send" i]',
    'button[data-testid*="send" i]',
    'button[type="submit"]',
    'button:has(svg[data-icon="send"])',
    'button:has(svg path[d*="M2.01 21L23 12"])',
    'button:has(svg path[d*="M12"])',
    'button[class*="send" i]',
    'div[role="button"][class*="send" i]',
    '.send-button',
    '#send-button',
    'button.send-btn',
    'button.submit-btn'
  ],

  // Stop / Thinking / Generating indicators
  GENERATING_INDICATORS: [
    'button[aria-label*="Stop" i]',
    'button[aria-label*="Cancel" i]',
    'div[role="button"][aria-label*="Stop" i]',
    'button[data-testid*="stop" i]',
    'button:has(svg rect)',
    'button:has(rect)',
    '[class*="thinking" i]',
    '[class*="thought" i]',
    '[class*="reasoning" i]',
    '[aria-label*="Thinking" i]',
    '.loading-indicator',
    '.typing-cursor',
    '.generating',
    '[data-status="generating"]',
    'svg[class*="spin" i]',
    '.ant-spin'
  ],

  // File upload input and trigger buttons
  FILE_INPUTS: [
    'input[type="file"]',
    'input[accept*="image"]',
    'input[accept*="document"]',
    'input[accept*="*"]',
    '#file-upload-input'
  ],

  UPLOAD_BUTTONS: [
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Upload" i]',
    'button[aria-label*="Add" i]',
    'button[data-testid*="attachment" i]',
    'button[data-testid="upload-button"]',
    'button:has(svg[data-icon="paperclip"])',
    'button:has(svg[data-icon="plus"])',
    '.upload-btn',
    '#upload-button'
  ],

  // Uploaded file preview elements (chips / badges in input bar)
  UPLOAD_PREVIEWS: [
    '.file-chip',
    '.attachment-preview',
    '.uploaded-file',
    '[data-testid="file-preview"]',
    '.preview-badge',
    '.ant-upload-list-item'
  ],

  // Assistant response message containers
  ASSISTANT_MESSAGES: [
    '[data-role="assistant"]',
    '[data-message-author="assistant"]',
    'article',
    '[class*="prose" i]',
    '.assistant-message',
    '.message-assistant',
    '.message-content',
    'div[class*="markdown" i]',
    '.markdown-body'
  ]
};

export const QWEN_SELECTORS = META_SELECTORS;
