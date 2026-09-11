import { DiagnosticError } from '../types';

export function createDiagnosticError(type: 
  | 'INPUT_NOT_FOUND' 
  | 'SEND_BUTTON_NOT_FOUND' 
  | 'UPLOAD_NOT_FOUND' 
  | 'UPLOAD_REJECTED' 
  | 'TAB_NOT_FOUND' 
  | 'TAB_DISCONNECTED' 
  | 'GENERATION_TIMEOUT' 
  | 'MISSING_ASSETS' 
  | 'PARSE_ERROR' 
  | 'NETWORK_ERROR'
  | 'CUSTOM', 
  customOptions?: Partial<DiagnosticError>
): DiagnosticError {
  const baseId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  switch (type) {
    case 'INPUT_NOT_FOUND':
      return {
        id: baseId,
        title: 'Qwen Chat Input Not Found',
        problem: 'The extension could not locate the text input area on this Qwen chat page.',
        why: 'The page might still be loading, or Qwen updated its web interface layout.',
        solution: 'Make sure the Qwen tab is fully loaded and you are logged in, then click Retry.',
        canRetry: true,
        timestamp: Date.now(),
        ...customOptions
      };

    case 'SEND_BUTTON_NOT_FOUND':
      return {
        id: baseId,
        title: 'Send Button Not Found',
        problem: 'The extension could not locate or activate the message submit button.',
        why: 'The input might be disabled, the model might be unavailable, or previous message is still generating.',
        solution: 'Check if Qwen is waiting for input or if an existing generation is active. Click Retry when ready.',
        canRetry: true,
        timestamp: Date.now(),
        ...customOptions
      };

    case 'UPLOAD_NOT_FOUND':
      return {
        id: baseId,
        title: 'Upload Control Unavailable',
        problem: 'The file upload/attachment button could not be located in the Qwen chat interface.',
        why: 'The upload feature might require logging into Qwen, or the selected model does not support file attachments.',
        solution: 'Verify that you are logged in to chat.qwen.ai and that the paperclip/upload icon is visible, then click Retry.',
        canRetry: true,
        timestamp: Date.now(),
        ...customOptions
      };

    case 'UPLOAD_REJECTED':
      return {
        id: baseId,
        title: 'File Attachment Incomplete',
        problem: 'The file could not be programmatically attached to the chat input.',
        why: 'Browser security prevented setting the file input, or the file format/size exceeds Qwen limits.',
        solution: 'Use drag-and-drop directly on the Qwen tab or click Retry to re-dispatch the upload event.',
        canRetry: true,
        timestamp: Date.now(),
        ...customOptions
      };

    case 'TAB_NOT_FOUND':
      return {
        id: baseId,
        title: 'Qwen Tab Not Accessible',
        problem: 'The target Chrome tab could not be found or is no longer open.',
        why: 'The browser tab may have been closed, crashed, or moved to another window.',
        solution: 'Click Reconnect to re-link an active Qwen tab or remove this tab from the dashboard.',
        canRetry: true,
        timestamp: Date.now(),
        ...customOptions
      };

    case 'TAB_DISCONNECTED':
      return {
        id: baseId,
        title: 'Content Script Disconnected',
        problem: 'The extension lost connection with the Qwen tab.',
        why: 'The page was refreshed, navigated away, or put to sleep by Chrome tab discarder.',
        solution: 'Refresh the Qwen tab and click Retry.',
        canRetry: true,
        timestamp: Date.now(),
        ...customOptions
      };

    case 'GENERATION_TIMEOUT':
      return {
        id: baseId,
        title: 'Response Generation Timeout',
        problem: 'Qwen took longer than expected to complete generating the response.',
        why: 'High server load, network throttling, or very long script output.',
        solution: 'Check the Qwen tab. If the model is still typing, wait a moment and click Retry to resume tracking.',
        canRetry: true,
        timestamp: Date.now(),
        ...customOptions
      };

    case 'MISSING_ASSETS':
      return {
        id: baseId,
        title: 'Required Assets Missing',
        problem: 'One or more required inputs (Title, Master Prompt, Thumbnail, Script) are missing.',
        why: 'Not all assets were assigned before clicking Run.',
        solution: 'Assign the missing title, master prompt, thumbnail, or script in the dashboard, then click Run.',
        canRetry: false,
        timestamp: Date.now(),
        ...customOptions
      };

    case 'PARSE_ERROR':
      return {
        id: baseId,
        title: 'Part Detection Ambiguity',
        problem: 'The extension could not identify the generated script parts from the assistant response.',
        why: 'Qwen formatted the response without standard Part headings or used an unexpected layout.',
        solution: 'Verify the assistant message format in the tab or use the floating panel to manually assign parts.',
        canRetry: true,
        timestamp: Date.now(),
        ...customOptions
      };

    default:
      return {
        id: baseId,
        title: customOptions?.title || 'Execution Error',
        problem: customOptions?.problem || 'An unexpected operation error occurred.',
        why: customOptions?.why || 'The browser or webpage state was not in the expected condition.',
        solution: customOptions?.solution || 'Review the tab state and click Retry.',
        canRetry: customOptions?.canRetry ?? true,
        timestamp: Date.now(),
        ...customOptions
      };
  }
}
