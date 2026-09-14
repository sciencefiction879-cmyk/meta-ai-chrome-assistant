export type TabExecutionStatus = 
  | 'uninitialized' 
  | 'incomplete' 
  | 'ready' 
  | 'running' 
  | 'paused' 
  | 'completed' 
  | 'error';

export type ScriptLifecycleStage =
  | 'WAITING'
  | 'OUTLINE_GENERATING'
  | 'OUTLINE_GENERATED'
  | 'PART_GENERATING'
  | 'PART_GENERATED'
  | 'NEXT_PART_QUEUE'
  | 'FINAL_PART_GENERATED';

export type ScriptMode = 'original' | 'competitor';

export type PartStatus = 'waiting' | 'ready' | 'generating' | 'done' | 'error';

export interface GeneratedPart {
  partNumber: number;
  label: string;
  heading?: string;
  explicitMarker?: string;
  videoNumber?: number;
  status: PartStatus;
  content: string;
  extractedAt?: number;
  downloaded: boolean;
  hasDoubleResponse?: boolean;
  candidateCount?: number;
}

export interface DiagnosticError {
  id: string;
  title: string;
  problem: string;
  why: string;
  solution: string;
  canRetry: boolean;
  timestamp: number;
  vNumber?: string;
}

export interface StoredAsset {
  id: string;
  name: string;
  size: number;
  type: string;
  dataUrl?: string; // for thumbnail preview
  textSnippet?: string; // preview
  createdAt: number;
}

export interface VTab {
  id: string; // "V1", "V2", etc.
  index: number; // 1, 2, ...
  chromeTabId: number | null;
  metaUrl?: string;
  qwenUrl?: string;
  status: TabExecutionStatus;
  lifecycleStage?: ScriptLifecycleStage;
  liveDebugStatus?: string;
  selected: boolean;
  initialMessage: string;
  initialMessageInjected?: boolean;
  title: string;
  titleInjected?: boolean;
  titlePushed?: boolean;
  pushedTitleText?: string;
  masterPrompt: string;
  promptInjected?: boolean;
  thumbnailId?: string;
  thumbnailName?: string;
  thumbnailStatus: 'none' | 'assigned' | 'uploaded';
  thumbnailPasted?: boolean;
  thumbnailUploading?: boolean;
  scriptId?: string;
  scriptName?: string;
  scriptStatus: 'none' | 'assigned' | 'uploaded';
  scriptInjected?: boolean;
  scriptOptional?: boolean;  // When true, skip script requirement check
  totalParts: number;
  currentPart: number;
  parts: GeneratedPart[];
  missingParts?: number[];
  duplicateParts?: number[];
  detectedVideoNumber?: number;
  scriptMode?: ScriptMode;
  outlineDetected?: boolean;
  outlineContent?: string;
  outlineStatus?: 'not_started' | 'generating' | 'completed';
  outlinePartInstructions?: Record<number, string>;
  partWordCount?: number;
  hasDoubleResponse?: boolean;
  doubleResponseInfo?: string;
  manualOverride?: boolean;
  mergeValidationStatus?: 'idle' | 'valid' | 'invalid';
  mergeValidationError?: string;
  error?: DiagnosticError | null;
  lastUpdated: number;
}

export type LogLevel = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

export interface LogEntry {
  id: string;
  timeStr: string;
  isoTime: string;
  level: LogLevel;
  message: string;
  vNumber?: string;
  errorDetails?: DiagnosticError;
}

export interface WorkflowConfig {
  workflowId: string;
  initialPrompt: string;
  masterPrompt: string;
  nextPartPromptTemplate: string;
  concurrencyLimit: number;
  autoInsertNextPart: boolean;
  debugMode: boolean;
  scriptMode?: ScriptMode;
  competitorScriptEnabled?: boolean;
  competitorScriptText?: string;
  partWordCount?: number;
}

export interface WorkflowState {
  config: WorkflowConfig;
  tabs: VTab[];
  logs: LogEntry[];
  isPaused: boolean;
  activeExecutionCount: number;
  downloadManagerLoaded?: boolean;
}

// Runtime messages
export type RuntimeAction =
  | { type: 'GET_STATE' }
  | { type: 'SET_STATE'; state: Partial<WorkflowState> }
  | { type: 'LOAD_DOWNLOAD_MANAGER' }
  | { type: 'CLEAR_DOWNLOAD_MANAGER' }
  | { type: 'SET_SCRIPT_MODE'; mode: ScriptMode }
  | { type: 'SET_COMPETITOR_SCRIPT'; enabled: boolean; text?: string }
  | { type: 'SET_PART_WORD_COUNT'; wordCount: number }
  | { type: 'GET_ACTIVE_META_TAB' }
  | { type: 'GET_ACTIVE_QWEN_TAB' }
  | { type: 'DUPLICATE_CHATS'; count: number; initialText?: string; startVideoId?: number; endVideoId?: number; explicitVideoIds?: number[] }
  | { type: 'UPDATE_TAB'; tabId: string; updates: Partial<VTab> }
  | { type: 'SELECT_TABS'; tabIds: string[]; selected: boolean }
  | { type: 'SELECT_RANGE'; startIndex: number; endIndex: number }
  | { type: 'ASSIGN_TITLES'; titles: string[]; startIndex?: number; endIndex?: number }
  | { type: 'SET_MASTER_PROMPT'; prompt: string; target: 'selected' | 'all' }
  | { type: 'ASSIGN_THUMBNAILS'; assets: { vNumber: string; assetId: string; name: string }[] }
  | { type: 'ASSIGN_SCRIPTS'; assets: { vNumber: string; assetId: string; name: string }[] }
  | { type: 'RUN_EXECUTION'; target: 'all' | 'selected' | string }
  | { type: 'PAUSE_EXECUTION' }
  | { type: 'RESUME_EXECUTION' }
  | { type: 'STOP_EXECUTION' }
  | { type: 'RETRY_TAB'; vNumber: string }
  | { type: 'RETRY_PART'; vNumber: string; partNumber: number }
  | { type: 'SET_SCRIPT_OPTIONAL'; vNumber: string; optional: boolean }
  | { type: 'CANCEL_TAB'; vNumber: string }
  | { type: 'RESTART_TAB'; vNumber: string }
  | { type: 'REFRESH_TAB'; vNumber: string }
  | { type: 'REFRESH_ALL_TABS' }
  | { type: 'RESYNC_ALL_TABS' }
  | { type: 'REMOVE_TAB'; vNumber: string }
  | { type: 'CLEAR_COMPLETED_TABS' }
  | { type: 'CLEAR_TITLES' }
  | { type: 'CLEAR_PROMPT' }
  | { type: 'CLEAR_THUMBNAILS' }
  | { type: 'CLEAR_SCRIPTS' }
  | { type: 'CLEAR_LOGS' }
  | { type: 'REINDEX_TABS' }
  | { type: 'CLEAR_CLOSED_TABS' }
  | { type: 'BATCH_TAB_ACTION'; action: 'restart' | 'retry' | 'refresh' | 'cancel' | 'remove'; tabIds: string[] }
  | { type: 'STAGE_PASTE_PROMPTS'; target?: 'all' | 'selected' | string }
  | { type: 'STAGE_PASTE_THUMBNAILS'; target?: 'all' | 'selected' | string }
  | { type: 'STAGE_PASTE_SCRIPTS'; target?: 'all' | 'selected' | string }
  | { type: 'STAGE_RUN_ALL_PACED'; target?: 'all' | 'selected' | string }
  | { type: 'PUSH_TITLES_TO_CHATS'; target?: 'all' | 'selected' | string }
  | { type: 'PUSH_PROMPT_TO_CHATS'; target?: 'all' | 'selected' | string }
  | { type: 'PUSH_THUMBNAILS_TO_CHATS'; target?: 'all' | 'selected' | string }
  | { type: 'PUSH_SCRIPTS_TO_CHATS'; target?: 'all' | 'selected' | string }
  | { type: 'PUSH_ALL_ASSETS_TO_CHATS'; target?: 'all' | 'selected' | string }
  | { type: 'INSERT_NEXT_PART'; vNumber: string; partNumber: number }
  | { type: 'RESET_WORKFLOW'; mode: 'current' | 'all' }
  | { type: 'LOG_MESSAGE'; level: LogLevel; message: string; vNumber?: string; error?: DiagnosticError }
  | { type: 'CONTENT_TAB_READY'; vNumber?: string; currentUrl: string }
  | {
      type: 'CONTENT_OUTLINE_DETECTED';
      vNumber: string;
      totalParts?: number;
      outlineContent?: string;
      outlineStatus?: 'not_started' | 'generating' | 'completed';
      outlinePartInstructions?: Record<number, string>;
      lifecycleStage?: ScriptLifecycleStage;
      liveDebugStatus?: string;
    }
  | { type: 'OVERRIDE_TAB_PARTS'; vNumber: string; totalParts?: number; currentPart?: number; outlineDetected?: boolean }
  | { type: 'CONTENT_PART_DETECTED'; vNumber: string; totalParts: number; parts: GeneratedPart[]; missingParts?: number[]; duplicateParts?: number[]; detectedVideoNumber?: number; lifecycleStage?: ScriptLifecycleStage; liveDebugStatus?: string }
  | { type: 'CONTENT_PART_COMPLETED'; vNumber: string; partNumber: number; content: string; heading?: string; explicitMarker?: string; videoNumber?: number }
  | { type: 'CONTENT_EXECUTION_ERROR'; vNumber: string; error: DiagnosticError };

export interface MessageResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}
