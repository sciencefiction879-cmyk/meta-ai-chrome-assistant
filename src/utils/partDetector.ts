import { GeneratedPart, PartStatus, ScriptLifecycleStage } from '../types';

export interface OutlineInfo {
  isOutline: boolean;
  isComplete?: boolean;
  totalParts?: number;
  detectedVideoNumber?: number;
  outlineText: string;
  partHeadings: Map<number, string>;
  expectedWordCounts?: Map<number, number>;
  partInstructions?: Map<number, string>;
}

export interface ExplicitMarkerMatch {
  videoNumber: number;
  partNumber: number;
  marker: string; // e.g. "V1 P1"
  heading?: string;
  fullMatch: string;
  index: number;
}

export interface PartDetectionResult {
  totalParts: number;
  parts: GeneratedPart[];
  detectedPattern: string;
  isMultiPartSingleResponse: boolean;
  outlineDetected: boolean;
  outlineContent?: string;
  outlineStatus?: 'not_started' | 'generating' | 'completed';
  outlinePartInstructions?: Map<number, string>;
  detectedHeadings: Map<number, string>;
  missingParts?: number[];
  duplicateParts?: number[];
  detectedVideoNumber?: number;
  hasDoubleResponse?: boolean;
  doubleResponseDetected?: boolean;
  lifecycleStage?: ScriptLifecycleStage;
  liveDebugStatus?: string;
}

/**
 * Checks whether a text block contains a side-by-side or combined double response (Response 1 and Response 2).
 */
export function isDoubleResponseBlock(text: string): boolean {
  if (!text) return false;
  return /(?:^|\n)[#*_\s\[\(`]*(?:Response|Ответ|回答)\s*1\b[\s\S]*?(?:^|\n)[#*_\s\[\(`]*(?:Response|Ответ|回答)\s*2\b/i.test(text);
}

/**
 * Splits a combined double response text block into primary (Response 1) and candidate (Response 2).
 */
export function splitDoubleResponseBlock(text: string): { primary: string; candidate2?: string } {
  if (!text) return { primary: '' };

  const match = text.match(/(?:^|\n)[#*_\s\[\(`]*(?:Response|Ответ|回答)\s*1\b([\s\S]*?)(?:^|\n)[#*_\s\[\(`]*(?:Response|Ответ|回答)\s*2\b([\s\S]*)$/i);
  if (match) {
    const r1 = cleanScriptContent(match[1]);
    const r2 = cleanScriptContent(match[2]);
    return {
      primary: r1 || cleanScriptContent(text),
      candidate2: r2 || undefined
    };
  }
  return { primary: cleanScriptContent(text) };
}

/**
 * Checks if a message starts as an explicit "Response 2" / candidate duplicate of a preceding response.
 */
export function isCandidateDuplicateResponse(text: string): boolean {
  if (!text) return false;
  return /^[#*_\s\[\(`]*(?:Response|Ответ|回答)\s*2\b/i.test(text.trim());
}

// Priority 1: Explicit Vx Py marker regex (e.g., "V1 P1", "V1 P2", "V10/P1", "v10p1", "v1p1", "v1p2", "**V1 P1**", "### V1 P1 — Heading", "Video 1 Part 2")
export const EXPLICIT_VX_PY_REGEX = /(?:^|\n)[#*_\s\[\(`]*(?:V|VIDEO)\s*0*(\d+)\s*[,/\\._\-–—:|~\s]*\s*(?:P|PART)\s*0*([1-9]\d*)(?=[^\d]|$)([^\n]*)/gi;

// Checks if text starts directly with an explicit Vx Py marker (e.g., "V10/P1", "v10p1", "V1 P1", "v1p1")
export const START_VX_PY_REGEX = /^\s*[#*_\s\[\(`]*(?:V|VIDEO)\s*0*(\d+)\s*[,/\\._\-–—:|~\s]*\s*(?:P|PART)\s*0*([1-9]\d*)(?=[^\d]|$)([^\n]*)/i;

// Priority 2: Standard Part header regex
export const PART_HEADER_REGEX = /(?:^|\n)(?:[#*_\s]*)(?:PART|Part|part|SECTION|Section)\s*0*([1-9]\d*)\b[^\n]*/g;

/**
 * Extracts declared total parts count from script text.
 * Matches: "Total Parts: 2", "Total Parts: 5", "Part 1 of 4", "Broken into 3 parts", etc.
 */
export function extractTotalPartsFromText(text: string): number | null {
  if (!text) return null;

  // 0. Primary Master Prompt declaration: "TOTAL PARTS = 4", "TOTAL PARTS: 4", "TOTAL PARTS - 4", "Total Parts = 4"
  const m0 = text.match(/(?:^|\n|\b)[#*_\s\[\(`]*TOTAL\s*PARTS\s*[:=\-]\s*(\d+)\b/i);
  if (m0 && parseInt(m0[1], 10) > 0) {
    const val = parseInt(m0[1], 10);
    if (val <= 20) return val;
  }

  // 1. Explicit declaration: "Total Parts: 2", "Total Parts: 5", "Total Parts - 3", "TOTAL PARTS: 2", "Total Script Parts: 4"
  // Strictly requires the word "parts", "part", or Russian "всего частей" — never bare "total"!
  const m1 = text.match(/(?:total\s*(?:script\s*)?parts?|всего\s*частей)\s*[:=\-]?\s*(\d+)\b/i);
  if (m1 && parseInt(m1[1], 10) > 0) {
    const val = parseInt(m1[1], 10);
    if (val <= 20) return val;
  }

  // 2. Turn pattern: "Part 1 of 5", "Part 1/5", "Part 1 of 2", "Часть 1 из 5"
  const m2 = text.match(/(?:part|section|часть)\s*\d+\s*(?:of|\/|из)\s*(\d+)\b/i);
  if (m2 && parseInt(m2[1], 10) > 0) {
    const val = parseInt(m2[1], 10);
    if (val <= 20) return val;
  }

  // 3. Broken down phrasing: "Broken into 5 parts", "divided into 3 parts", "in 4 parts", "Разделено на 5 частей"
  const m3 = text.match(/(?:broken into|divided into|split into|in|на)\s*(\d+)\s*(?:parts?|sections?|частей|части)\b/i);
  if (m3 && parseInt(m3[1], 10) > 0) {
    const val = parseInt(m3[1], 10);
    if (val <= 20) return val;
  }

  // 4. "5 parts in total", "2 parts total"
  const m4 = text.match(/\b(\d+)\s*(?:parts?|sections?)\s*(?:in\s*total|total)\b/i);
  if (m4 && parseInt(m4[1], 10) > 0) {
    const val = parseInt(m4[1], 10);
    if (val <= 20) return val;
  }

  return null;
}

/**
 * Checks if a script text ends with or contains the matching part completion marker:
 * E.g. "V1, P1 = COMPLETED" or "V14, P2 = COMPLETED" or "V1, P2 = COMPLETED".
 * 
 * Rules:
 * 1. Must match the exact part number.
 * 2. If video number is present in marker or known, must match that exact video number.
 * 3. Another part's completion marker (e.g. V1, P2 = COMPLETED) CANNOT confirm Part 1.
 */
export function hasPartCompletionMarker(
  text: string,
  videoNumber?: number,
  partNumber?: number
): boolean {
  if (!text || !partNumber) return false;

  // 1. Exact match with videoNumber: V{videoNumber}, P{partNumber} = COMPLETED
  if (videoNumber && videoNumber > 0) {
    const vMatchRegex = new RegExp(
      `[#*_\\[\\(\`\\s]*V\\s*0*${videoNumber}\\s*[,/\\\\._\\-–—:|~\\s]*\\s*(?:P|PART)\\s*0*${partNumber}[#*_\\]\\)\`\\s]*(?:[:=\\-–—~\\s]+)[#*_\\[\\(\`\\s]*(?:COMPLETED|COMPLETE|DONE|FINISHED|ЗАВЕРШЕНО|ВЫПОЛНЕНО)\\b`,
      'i'
    );
    if (vMatchRegex.test(text)) return true;
  }

  // 2. Part-only match: P{partNumber} = COMPLETED (ensure not prefixed by a conflicting video number)
  const pOnlyRegex = new RegExp(
    `[#*_\\[\\(\`\\s]*(?:P|PART)\\s*0*${partNumber}[#*_\\]\\)\`\\s]*(?:[:=\\-–—~\\s]+)[#*_\\[\\(\`\\s]*(?:COMPLETED|COMPLETE|DONE|FINISHED|ЗАВЕРШЕНО|ВЫПОЛНЕНО)\\b`,
    'i'
  );
  if (pOnlyRegex.test(text)) {
    const vMismatched = text.match(
      new RegExp(`[#*_\\[\\(\`\\s]*V\\s*0*(\\d+)\\s*[,/\\\\._\\-–—:|~\\s]*\\s*(?:P|PART)\\s*0*${partNumber}[#*_\\]\\)\`\\s]*(?:[:=\\-–—~\\s]+)[#*_\\[\\(\`\\s]*(?:COMPLETED|COMPLETE|DONE|FINISHED|ЗАВЕРШЕНО|ВЫПОЛНЕНО)\\b`, 'i')
    );
    if (vMismatched && videoNumber && videoNumber > 0) {
      const parsedV = parseInt(vMismatched[1], 10);
      if (parsedV !== videoNumber) return false;
    }
    return true;
  }

  // 3. General match: V{any}, P{partNumber} = COMPLETED
  const generalRegex = new RegExp(
    `[#*_\\[\\(\`\\s]*V\\s*0*(\\d+)\\s*[,/\\\\._\\-–—:|~\\s]*\\s*(?:P|PART)\\s*0*${partNumber}[#*_\\]\\)\`\\s]*(?:[:=\\-–—~\\s]+)[#*_\\[\\(\`\\s]*(?:COMPLETED|COMPLETE|DONE|FINISHED|ЗАВЕРШЕНО|ВЫПОЛНЕНО)\\b`,
    'i'
  );
  const generalMatch = text.match(generalRegex);
  if (generalMatch) {
    if (videoNumber && videoNumber > 0) {
      return parseInt(generalMatch[1], 10) === videoNumber;
    }
    return true;
  }

  return false;
}

/**
 * Reads and extracts the individual instructions for every part from the generated outline.
 * 
 * Works dynamically with any outline format, e.g.:
 * - PART 1 — Hook & Setup (Target: 20–22% ≈ 5,700–6,600 words internal)
 * - **PART 1: Hook & Setup** ...
 * - V14/P1 — 3,800 words — Hook & Setup ...
 * - 1. Part 1: ...
 * 
 * Does NOT use hard-coded titles, descriptions, percentages, word ranges, or stages.
 */
export function extractOutlinePartInstructions(
  outlineText: string,
  totalParts?: number
): Map<number, string> {
  const instructions = new Map<number, string>();
  if (!outlineText || !outlineText.trim()) return instructions;

  const lines = outlineText.split(/\r?\n/);
  const partHeaders: { partNumber: number; lineIndex: number; headerText: string }[] = [];

  const partLineRegex = /^[#*_\s\[\(`]*(?:(?:V|VIDEO)\s*0*\d+\s*[,/\\._\-–—:|~\s]*)?(?:PART|Part|part|SECTION|Section|P)\s*0*([1-9]\d*)\b\s*([—–\-:.]|\b)\s*(.*)$/i;
  const numberedLineRegex = /^[#*_\s]*0*([1-9]\d*)\.\s*(?:PART|Part|part)?\s*[:—–-]?\s*(.*)$/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/OUTLINE\s*[:=\-]\s*GENERATED/i.test(line)) continue;

    const m1 = line.match(partLineRegex);
    if (m1) {
      const pNum = parseInt(m1[1], 10);
      if (pNum > 0 && (!totalParts || pNum <= totalParts + 5)) {
        if (!partHeaders.some(h => h.partNumber === pNum)) {
          partHeaders.push({ partNumber: pNum, lineIndex: i, headerText: line });
          continue;
        }
      }
    }

    const m2 = line.match(numberedLineRegex);
    if (m2) {
      const pNum = parseInt(m2[1], 10);
      if (pNum > 0 && (!totalParts || pNum <= totalParts + 5)) {
        if (!partHeaders.some(h => h.partNumber === pNum)) {
          partHeaders.push({ partNumber: pNum, lineIndex: i, headerText: line });
        }
      }
    }
  }

  partHeaders.sort((a, b) => a.lineIndex - b.lineIndex);

  for (let k = 0; k < partHeaders.length; k++) {
    const current = partHeaders[k];
    const nextLineIndex = k + 1 < partHeaders.length ? partHeaders[k + 1].lineIndex : lines.length;

    const blockLines: string[] = [];
    for (let j = current.lineIndex; j < nextLineIndex; j++) {
      const l = lines[j];
      if (/OUTLINE\s*[:=\-]\s*GENERATED/i.test(l)) break;
      if (/^---+$/.test(l.trim())) break;
      blockLines.push(l);
    }

    let blockText = blockLines.join('\n').trim();
    blockText = blockText.replace(/\n{3,}/g, '\n\n').trim();
    if (blockText) {
      instructions.set(current.partNumber, blockText);
    }
  }

  return instructions;
}

/**
 * Cleans heading text by stripping markdown symbols and excessive punctuation.
 */
export function cleanHeadingText(raw: string): string {
  if (!raw) return '';
  let h = raw.trim();
  // Remove markdown formatting and wrapping brackets
  h = h.replace(/^[*_#`~\[\(\]]+|[*_#`~\[\(\)]+$/g, '').trim();
  // Remove leading numbers or symbols
  h = h.replace(/^(?:\d+\.|\d+\)|\-)\s*/, '').trim();
  // Remove leading equal signs, colons, dashes
  h = h.replace(/^[=:\-–—\s]+/, '').trim();

  // Reject completion markers and status words as headings
  if (/^(?:COMPLETED|COMPLETE|DONE|FINISHED|GENERATING)\b/i.test(h)) {
    return '';
  }
  // Strip trailing completion marker suffixes (e.g. "Hook & Setup = COMPLETED")
  h = h.replace(/[:=\-–—\s]*(?:COMPLETED|COMPLETE|DONE|FINISHED)\b.*$/i, '').trim();

  // Remove trailing descriptions if too long
  if (h.length > 50 && h.includes(' - ')) {
    h = h.split(' - ')[0].trim();
  }
  if (h.length > 50 && h.includes(' — ')) {
    h = h.split(' — ')[0].trim();
  }
  if (h.length > 60) {
    h = h.substring(0, 57).trim() + '...';
  }
  return h;
}

/**
 * Finds all explicit Vx Py markers in a text block.
 * Matches: "V1 P1", "V10/P1", "v10p1", "v1p1", "v1p2", "V1 P2", "V2 P3", "V3 P12", "**V1 P1**", "### V1 P1 — The Beginning", "Video 1 Part 2", etc.
 */
export function findExplicitMarkersInText(text: string): ExplicitMarkerMatch[] {
  if (!text) return [];

  const regex = new RegExp(EXPLICIT_VX_PY_REGEX.source, 'gi');
  const matches: ExplicitMarkerMatch[] = [];
  let m: RegExpExecArray | null;

  while ((m = regex.exec(text)) !== null) {
    const videoNum = parseInt(m[1], 10);
    const partNum = parseInt(m[2], 10);
    if (!isNaN(videoNum) && !isNaN(partNum) && partNum > 0) {
      let heading = '';
      if (m[3]) {
        const rest = m[3].replace(/^[\s:—–\-*#\]\)`]+/, '').replace(/[*_#\]\)`]+$/, '').trim();
        if (rest) {
          heading = cleanHeadingText(rest);
        }
      }
      matches.push({
        videoNumber: videoNum,
        partNumber: partNum,
        marker: `V${videoNum} P${partNum}`,
        heading: heading || undefined,
        fullMatch: m[0],
        index: m.index
      });
    }
  }

  return matches;
}

/**
 * Checks whether text starts with an explicit Vx Py marker (e.g., "V10/P1", "v10p1", "V1 P1", "v1p1", streaming Part 1 / Part 2)
 */
export function extractStartingExplicitMarker(text: string): ExplicitMarkerMatch | null {
  if (!text) return null;
  const m = text.match(START_VX_PY_REGEX);
  if (m) {
    const videoNum = parseInt(m[1], 10);
    const partNum = parseInt(m[2], 10);
    if (!isNaN(videoNum) && !isNaN(partNum) && partNum > 0) {
      let heading = '';
      if (m[3]) {
        const rest = m[3].replace(/^[\s:—–\-*#\]\)`]+/, '').replace(/[*_#\]\)`]+$/, '').trim();
        if (rest) {
          heading = cleanHeadingText(rest);
        }
      }
      return {
        videoNumber: videoNum,
        partNumber: partNum,
        marker: `V${videoNum} P${partNum}`,
        heading: heading || undefined,
        fullMatch: m[0],
        index: 0
      };
    }
  }
  return null;
}

/**
 * Extracts explicit top marker declaring the current part at the beginning of the response.
 * Looks within the first 300 characters / first 3 non-empty lines of the response.
 * Matches:
 *   "V14/P2", "V14 P2", "V14P2", "**V14/P2**", "### V14/P2", "V1/P1", "V2/P3", "V20/P7", "v10p1", etc.
 * Also handles optional prefix like "Here is V14/P2:" or "[V14/P2]".
 */
export function extractTopExplicitMarker(text: string): ExplicitMarkerMatch | null {
  if (!text || !text.trim()) return null;

  // Look at the beginning of the text (first 3 lines or first 300 chars)
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headText = lines.slice(0, 3).join('\n').slice(0, 300);

  const startMatch = headText.match(START_VX_PY_REGEX);
  if (startMatch) {
    const videoNum = parseInt(startMatch[1], 10);
    const partNum = parseInt(startMatch[2], 10);
    if (!isNaN(videoNum) && !isNaN(partNum) && partNum > 0) {
      let heading = '';
      if (startMatch[3]) {
        const rest = startMatch[3].replace(/^[\s:—–\-*#\]\)`]+/, '').replace(/[*_#\]\)`]+$/, '').trim();
        if (rest && !/^\d[\d,\.]*\s*words?\b/i.test(rest)) {
          heading = cleanHeadingText(rest);
        }
      }
      return {
        videoNumber: videoNum,
        partNumber: partNum,
        marker: `V${videoNum} P${partNum}`,
        heading: heading || undefined,
        fullMatch: startMatch[0],
        index: 0
      };
    }
  }

  // Fallback: search for first explicit marker within headText
  const matches = findExplicitMarkersInText(headText);
  if (matches.length > 0) {
    return matches[0];
  }

  return null;
}

/**
 * Calculates missing part numbers and duplicate part numbers from a list of part numbers.
 */
export function calculateMissingAndDuplicateParts(
  partNumbers: number[],
  declaredTotal?: number
): { missingParts: number[]; duplicateParts: number[]; maxPart: number } {
  const counts = new Map<number, number>();
  for (const p of partNumbers) {
    if (p > 0) {
      counts.set(p, (counts.get(p) || 0) + 1);
    }
  }

  const duplicateParts: number[] = [];
  for (const [p, count] of counts.entries()) {
    if (count > 1) {
      duplicateParts.push(p);
    }
  }
  duplicateParts.sort((a, b) => a - b);

  const unique = Array.from(counts.keys());
  const highest = unique.length > 0 ? Math.max(...unique) : 0;
  const maxPart = Math.max(highest, declaredTotal || 0);

  // Missing parts are strictly parts skipped in sequence (p < highest)
  const missingParts: number[] = [];
  if (highest > 1) {
    for (let i = 1; i < highest; i++) {
      if (!counts.has(i)) {
        missingParts.push(i);
      }
    }
  }

  return { missingParts, duplicateParts, maxPart };
}

/**
 * Detects if a text block is an Outline rather than an actual script part.
 * Extracts declared parts, part headings, and target word counts from the outline.
 * 
 * CRITICAL RULE:
 * Entries in an outline such as:
 *   "V14/P1 — 3,800 words..."
 *   "V14/P2 — 3,600 words..."
 *   "V14/P3 — 3,600 words..."
 * are PLANNING/OUTLINE information.
 * They define:
 *   - Total Parts
 *   - Expected part numbers
 *   - Expected word counts
 *   - Part structure / headings
 * But they MUST NOT mark parts as generated!
 */
export function detectOutlineInText(text: string, hasCompetitorScript = false): OutlineInfo {
  // If a competitor script was uploaded, do NOT expect or count an outline-generation stage!
  if (hasCompetitorScript || !text || !text.trim()) {
    return { isOutline: false, outlineText: '', partHeadings: new Map() };
  }

  const textToEvaluate = isDoubleResponseBlock(text) ? splitDoubleResponseBlock(text).primary : text;
  const cleaned = cleanScriptContent(textToEvaluate);

  // Check for explicit "V{n} OUTLINE" (e.g. "V14 OUTLINE", "V1 OUTLINE", "**V14 OUTLINE**")
  const vOutlineMatch = cleaned.match(/(?:^|\n)[#*_\s\[\(`]*V\s*0*(\d+)\s*(?:OUTLINE|Outline|outline)\b/i);
  let vOutlineNum: number | undefined = undefined;
  if (vOutlineMatch) {
    const parsedV = parseInt(vOutlineMatch[1], 10);
    if (!isNaN(parsedV) && parsedV > 0) vOutlineNum = parsedV;
  }

  // Explicit Outline indicators
  const hasOutlineHeader = Boolean(vOutlineMatch) || /(?:^|\n)[#*_\s\[\(`]*(?:V\s*0*\d+\s+)?(?:video\s+|script\s+|episode\s+)?(?:outline|plan|structure|overview|синопсис|план|структура|содержание)\b/i.test(cleaned);
  const hasOutlineIntro = /(?:here is|here's|below is|the following is|attached is|this is)\s+(?:the|an|a)?\s*(?:video\s+|script\s+)?(?:outline|plan|structure)/i.test(cleaned);

  // 1. Scan for explicit Vx/Py markers with planning details (e.g. "V14/P1 — 3,800 words...", "V14 P2: 3600 words", etc.)
  const vxPyMatches = Array.from(
    cleaned.matchAll(/(?:^|\n)\s*[#*_\s\[\(`]*(?:V|VIDEO)\s*0*(\d+)\s*[,/\\._\-–—:|~\s]*\s*(?:P|PART)\s*0*([1-9]\d*)\s*(?:[—–\-:]|\b)\s*([^\n]*)/gi)
  );

  // 2. Standard Part header lines: "Part 1: The Beginning" or "Part 1 - The Beginning"
  const partLineMatches = Array.from(
    cleaned.matchAll(/(?:^|\n)[#*_\s]*(?:PART|Part|part|SECTION|Section)\s*0*([1-9]\d*)\s*[:—–-]\s*([^\n\r*#]+)/gi)
  );

  // 3. Numbered outline points: "1. The Beginning - ..."
  const numberedMatches = Array.from(
    cleaned.matchAll(/(?:^|\n)\s*([1-9]\d*)\.\s*([^\n\r*#]+)/gi)
  );

  const explicitMarkers = findExplicitMarkersInText(cleaned);
  const distinctExplicitParts = new Set(explicitMarkers.map((m) => m.partNumber));
  const hasWordCountPhrases = /\b(?:\d[\d,\.]*)\s*(?:words?|слов)\b/i.test(cleaned);

  // An actual script part is generated ONE part per turn (with a top marker like V14/P2) and contains full script narrative.
  // A text is an OUTLINE if:
  // - It explicitly states it's an outline / plan / structure / overview / V{n} OUTLINE
  // - OR it declares 2 or more distinct parts with Vx/Py markers in the same response
  // - OR it lists 2 or more part lines in a planning format
  const isOutlineCandidate =
    Boolean(vOutlineMatch) ||
    hasOutlineHeader ||
    hasOutlineIntro ||
    distinctExplicitParts.size >= 2 ||
    partLineMatches.length >= 2 ||
    (numberedMatches.length >= 3 && cleaned.length < 1500);

  if (!isOutlineCandidate) {
    return { isOutline: false, outlineText: '', partHeadings: new Map() };
  }

  const headings = new Map<number, string>();
  const wordCounts = new Map<number, number>();
  let detectedVideoNum: number | undefined = vOutlineNum;

  // Extract from Vx/Py matches
  if (vxPyMatches.length > 0) {
    for (const m of vxPyMatches) {
      const vNum = parseInt(m[1], 10);
      const pNum = parseInt(m[2], 10);
      if (!detectedVideoNum && vNum > 0) detectedVideoNum = vNum;

      const rest = (m[3] || '').trim();
      // Extract word count if present: e.g. "3,800 words" or "3800 words"
      const wcMatch = rest.match(/(\d[\d,\.]*)\s*(?:words?|слов)\b/i);
      if (wcMatch) {
        const parsedWc = parseInt(wcMatch[1].replace(/[,.]/g, ''), 10);
        if (!isNaN(parsedWc) && parsedWc > 0) wordCounts.set(pNum, parsedWc);
      }

      // Clean heading (strip word counts and punctuation)
      let headingText = rest.replace(/[-–—:]?\s*\d[\d,\.]*\s*(?:words?|слов)\b/gi, '').trim();
      headingText = cleanHeadingText(headingText);
      if (pNum > 0 && headingText) {
        headings.set(pNum, headingText);
      }
    }
  }

  // Also check partLineMatches
  for (const m of partLineMatches) {
    const pNum = parseInt(m[1], 10);
    const heading = cleanHeadingText(m[2]);
    if (pNum > 0 && heading && !headings.has(pNum)) headings.set(pNum, heading);
  }

  // Also check numberedMatches if headings is still empty
  if (headings.size === 0) {
    for (const m of numberedMatches) {
      const pNum = parseInt(m[1], 10);
      const heading = cleanHeadingText(m[2]);
      if (pNum > 0 && heading) headings.set(pNum, heading);
    }
  }

  const hasOutlineCompletedMarker = /(?:^|\n|\b)[#*_\s\[\(`]*OUTLINE\s*[:=\-]\s*GENERATED[#*_\s\]\)`]*(?:\b|$)/i.test(cleaned);

  const explicitTotal = extractTotalPartsFromText(cleaned);
  const partInstructions = extractOutlinePartInstructions(cleaned, explicitTotal || undefined);

  const allPartKeys = Array.from(new Set([
    ...Array.from(headings.keys()),
    ...Array.from(wordCounts.keys()),
    ...Array.from(partInstructions.keys()),
    ...Array.from(distinctExplicitParts)
  ]));
  const highestPartNum = allPartKeys.length > 0 ? Math.max(...allPartKeys) : 0;
  
  // The Master Prompt explicit declaration (e.g. "Total Parts = 4") is the absolute ground truth!
  // Do NOT inflate totalParts using bullet points or random numbered lists if explicitTotal is declared.
  let totalParts: number | undefined = undefined;
  if (explicitTotal && explicitTotal > 0) {
    totalParts = explicitTotal;
  } else if (highestPartNum > 0) {
    totalParts = highestPartNum;
  } else if (allPartKeys.length > 0) {
    totalParts = allPartKeys.length;
  }

  return {
    isOutline: true,
    isComplete: hasOutlineCompletedMarker,
    totalParts: (totalParts && totalParts > 0) ? totalParts : undefined,
    detectedVideoNumber: detectedVideoNum,
    outlineText: cleaned,
    partHeadings: headings,
    expectedWordCounts: wordCounts,
    partInstructions
  };
}

/**
 * Extracts a heading from a single part's text content.
 */
export function extractHeadingFromPartText(text: string, partNum?: number): string | null {
  if (!text) return null;

  // 1. Direct "Part 1 — The Unexpected Call" or "Part 1: The Unexpected Call" or "V1 P1 — The Call" or "V10/P1 - The Call"
  const m0 = text.match(/(?:^|\n)[#*_\s\[\(`]*(?:V|VIDEO)\s*0*\d*\s*[,/\\._\-–—:|~\s]*\s*(?:P|PART)\s*0*\d*\s*[:—–-]\s*([^\n\r*#\]\)`]+)/i);
  if (m0 && m0[1] && m0[1].trim().length > 1) {
    const cleaned = cleanHeadingText(m0[1]);
    if (!/^part\s*\d+$/i.test(cleaned)) {
      return cleaned;
    }
  }

  const m1 = text.match(/(?:^|\n)[#*_\s]*(?:PART|Part|part|SECTION|Section)\s*0*\d*\s*[:—–-]\s*([^\n\r*#]+)/i);
  if (m1 && m1[1] && m1[1].trim().length > 1) {
    const cleaned = cleanHeadingText(m1[1]);
    if (!/^part\s*\d+$/i.test(cleaned)) {
      return cleaned;
    }
  }

  // 2. Heading on line immediately following Part N or Vx Py
  const m2 = text.match(/(?:^|\n)[#*_\s\[\(`]*(?:(?:V|VIDEO)\s*0*\d*\s*[,/\\._\-–—:|~\s]*\s*)?(?:PART|Part|part|SECTION|Section|P)\s*0*\d*\s*[\]\)`]*\s*\n+([^\s\d\n\r*#][^\n\r*#]{1,60})/i);
  if (m2 && m2[1] && m2[1].trim().length > 2) {
    const cleaned = cleanHeadingText(m2[1]);
    if (!/^part\s*\d+$/i.test(cleaned) && !/^(?:scene|act|int\.|ext\.)/i.test(cleaned)) {
      return cleaned;
    }
  }

  // 3. Scene Title or Chapter heading
  const m3 = text.match(/(?:^|\n)(?:Title|Scene Title|Chapter Title)\s*[:—–-]\s*([^\n\r*#]+)/i);
  if (m3 && m3[1] && m3[1].trim().length > 1) {
    return cleanHeadingText(m3[1]);
  }

  return null;
}

/**
 * Intelligently generates an appropriate, content-based heading if no explicit heading was found.
 * Never uses generic "Part N".
 */
export function generateIntelligentHeading(
  partNum: number,
  content: string,
  totalParts = 4,
  outlineHeading?: string
): string {
  // If outline gave a heading for this part, prioritize it
  if (outlineHeading && outlineHeading.trim().length > 0 && !/^part\s*\d+$/i.test(outlineHeading.trim())) {
    return outlineHeading.trim();
  }

  // Check for Scene tags in content
  const sceneMatch = content.match(/\[Scene:\s*([^\]\n]+)\]/i) || content.match(/\((?:Scene|Location):\s*([^)\n]+)\)/i);
  if (sceneMatch && sceneMatch[1]) {
    const h = cleanHeadingText(sceneMatch[1]);
    if (h.length > 2) return h;
  }

  // Content-driven story progression headings based on part position
  if (partNum === 1) {
    return 'The Beginning';
  } else if (partNum === 2) {
    return 'The First Conflict';
  } else if (partNum === 3) {
    return totalParts === 3 ? 'The Final Decision' : 'The Discovery';
  } else if (partNum === 4) {
    return totalParts === 4 ? 'The Final Confrontation' : 'The Rising Stakes';
  } else if (partNum === 5) {
    return totalParts === 5 ? 'The Climax and Resolution' : 'The Deepening Crisis';
  } else if (partNum === 6) {
    return totalParts === 6 ? 'The Final Resolution' : 'The Climax';
  } else if (partNum === totalParts) {
    return 'The Final Confrontation';
  } else {
    // Dynamic middle parts
    const middleThemes = [
      'The Unfolding Truth',
      'The Critical Turn',
      'The Unexpected Encounter',
      'The Gathering Storm',
      'The Decisive Moment'
    ];
    const themeIdx = (partNum - 1) % middleThemes.length;
    return middleThemes[themeIdx];
  }
}

/**
 * Formats a single part into the required TXT output:
 * V1 P1 — [Part 1 Heading]
 * [Part 1 script]
 */
export function formatPartForTxt(vNumber: string, part: GeneratedPart, totalParts = 4): string {
  const marker = part.explicitMarker || `${vNumber} P${part.partNumber}`;
  const heading = part.heading || generateIntelligentHeading(part.partNumber, part.content, totalParts);
  return `${marker} — ${heading}\n\n${part.content.trim()}`;
}

/**
 * Detects parts in an assistant response text.
 * Priority 1: Explicit Vx Py markers (V1 P1, V1 P2, V2 P3).
 * Priority 2: Standard part headers (PART 1, Part 2).
 * Priority 3: Fallback inference.
 * Accurately isolates Outlines (does NOT treat outline as Part 1!).
 */
export function detectPartsInText(
  text: string,
  expectedCurrentPart = 1,
  isGenerating = false,
  targetVideoNumber?: number,
  hasCompetitorScript = false
): PartDetectionResult {
  if (!text || !text.trim()) {
    const vPrefix = targetVideoNumber ? `V${targetVideoNumber} ` : '';
    return {
      totalParts: 1,
      parts: [
        {
          partNumber: expectedCurrentPart,
          label: `${vPrefix}P${expectedCurrentPart}`,
          explicitMarker: `${vPrefix}P${expectedCurrentPart}`,
          videoNumber: targetVideoNumber,
          heading: generateIntelligentHeading(expectedCurrentPart, '', 1),
          status: isGenerating ? 'generating' : 'ready',
          content: '',
          downloaded: false
        }
      ],
      detectedPattern: 'None',
      isMultiPartSingleResponse: false,
      outlineDetected: false,
      detectedHeadings: new Map()
    };
  }

  const isDouble = isDoubleResponseBlock(text);
  const { primary: textToProcess } = isDouble ? splitDoubleResponseBlock(text) : { primary: text };

  // Check if text is an Outline (Section 6)
  const outlineInfo = detectOutlineInText(textToProcess, hasCompetitorScript);
  if (outlineInfo.isOutline) {
    const totalParts = outlineInfo.totalParts || extractTotalPartsFromText(textToProcess) || 4;
    const parts: GeneratedPart[] = [];
    const primaryVideoNum = outlineInfo.detectedVideoNumber || targetVideoNumber;
    const vPrefix = primaryVideoNum ? `V${primaryVideoNum} ` : '';

    for (let p = 1; p <= totalParts; p++) {
      const heading = outlineInfo.partHeadings.get(p) || generateIntelligentHeading(p, '', totalParts);
      parts.push({
        partNumber: p,
        label: `${vPrefix}P${p}`,
        explicitMarker: `${vPrefix}P${p}`,
        videoNumber: primaryVideoNum,
        heading,
        status: 'waiting',
        content: '',
        downloaded: false,
        hasDoubleResponse: isDouble
      });
    }

    const isComplete = Boolean(outlineInfo.isComplete);
    const outlineStatus = isComplete ? 'completed' : 'generating';
    const lifecycleStage = isComplete ? 'OUTLINE_GENERATED' : 'OUTLINE_GENERATING';
    const liveDebugStatus = isComplete
      ? `OUTLINE GENERATED ✓ | Total Parts: ${totalParts} ✓ | Ready for V${primaryVideoNum || 1}, P1`
      : 'Generating Outline / Incomplete | Waiting for Qwen';

    return {
      totalParts,
      parts,
      detectedPattern: 'Outline detected',
      isMultiPartSingleResponse: false,
      outlineDetected: true,
      outlineContent: outlineInfo.outlineText,
      outlineStatus,
      outlinePartInstructions: outlineInfo.partInstructions,
      detectedHeadings: outlineInfo.partHeadings,
      detectedVideoNumber: primaryVideoNum,
      hasDoubleResponse: isDouble,
      lifecycleStage,
      liveDebugStatus
    };
  }

  const explicitTotal = extractTotalPartsFromText(textToProcess) || extractTotalPartsFromText(text);
  const detectedHeadings = new Map<number, string>();

  // PRIORITY 1: Explicit Vx Py markers
  const explicitMatches = findExplicitMarkersInText(textToProcess);
  if (explicitMatches.length > 0) {
    const primaryVideoNum = targetVideoNumber || explicitMatches[0].videoNumber;
    const activeMatches = explicitMatches;

    // Check if distinct part numbers exist
    const distinctPartNums = Array.from(new Set(activeMatches.map((m) => m.partNumber)));

    if (distinctPartNums.length > 1) {
      // Multi-part response with explicit markers
      const parts: GeneratedPart[] = [];
      const partNums: number[] = [];

      for (let i = 0; i < activeMatches.length; i++) {
        const current = activeMatches[i];
        if (!partNums.includes(current.partNumber)) {
          partNums.push(current.partNumber);
        }
        const nextIndex = i + 1 < activeMatches.length ? activeMatches[i + 1].index : textToProcess.length;
        const isLast = i === activeMatches.length - 1;

        const rawContent = textToProcess.slice(current.index, nextIndex).trim();
        const cleaned = cleanScriptContent(rawContent);

        const heading = current.heading ||
          extractHeadingFromPartText(rawContent, current.partNumber) ||
          generateIntelligentHeading(current.partNumber, cleaned, activeMatches.length);
        detectedHeadings.set(current.partNumber, heading);

        const partStatus = isLast && isGenerating ? 'generating' : (cleaned && cleaned.trim().length > 20 ? 'done' : 'ready');

        parts.push({
          partNumber: current.partNumber,
          label: current.marker,
          explicitMarker: current.marker,
          videoNumber: current.videoNumber,
          heading,
          status: partStatus,
          content: cleaned,
          extractedAt: partStatus === 'done' ? Date.now() : undefined,
          downloaded: false,
          hasDoubleResponse: isDouble,
          candidateCount: isDouble ? 2 : undefined
        });
      }

      parts.sort((a, b) => a.partNumber - b.partNumber);
      const { missingParts, duplicateParts, maxPart } = calculateMissingAndDuplicateParts(partNums, explicitTotal || undefined);
      const finalTotal = Math.max(maxPart, explicitTotal || 0, parts.length);

      for (let p = 1; p <= finalTotal; p++) {
        if (!parts.some((x) => x.partNumber === p)) {
          parts.push({
            partNumber: p,
            label: `V${primaryVideoNum} P${p}`,
            explicitMarker: `V${primaryVideoNum} P${p}`,
            videoNumber: primaryVideoNum,
            heading: generateIntelligentHeading(p, '', finalTotal),
            status: !isGenerating && p === parts.length + 1 ? 'ready' : 'waiting',
            content: '',
            downloaded: false,
            hasDoubleResponse: isDouble
          });
        }
      }
      parts.sort((a, b) => a.partNumber - b.partNumber);

      return {
        totalParts: finalTotal,
        parts,
        detectedPattern: 'Explicit Vx Py multi-part segmented markers',
        isMultiPartSingleResponse: true,
        outlineDetected: false,
        detectedHeadings,
        missingParts,
        duplicateParts,
        detectedVideoNumber: primaryVideoNum,
        hasDoubleResponse: isDouble
      };
    } else {
      // Exactly 1 explicit marker (e.g. V1 P1, or V1 P5)
      // CRITICAL: NEVER renumber explicit parts! V1 P5 is Part 5.
      const current = activeMatches[0];
      const cleaned = cleanScriptContent(textToProcess);
      const heading = current.heading ||
        extractHeadingFromPartText(textToProcess, current.partNumber) ||
        generateIntelligentHeading(current.partNumber, cleaned, Math.max(current.partNumber, expectedCurrentPart));
      detectedHeadings.set(current.partNumber, heading);

      const totalDetected = Math.max(current.partNumber, expectedCurrentPart, explicitTotal || 0);
      const parts: GeneratedPart[] = [];
      const partNums = [current.partNumber];

      for (let p = 1; p <= totalDetected; p++) {
        const h = p === current.partNumber ? heading : generateIntelligentHeading(p, '', totalDetected);
        const isPartComplete = p === current.partNumber && !isGenerating && Boolean(cleaned && cleaned.trim().length > 20);
        
        if (p === current.partNumber) {
          parts.push({
            partNumber: p,
            label: current.marker,
            explicitMarker: current.marker,
            videoNumber: current.videoNumber,
            heading: h,
            status: isGenerating ? 'generating' : (isPartComplete ? 'done' : 'ready'),
            content: cleaned,
            extractedAt: isPartComplete ? Date.now() : undefined,
            downloaded: false,
            hasDoubleResponse: isDouble || activeMatches.length > 1,
            candidateCount: isDouble || activeMatches.length > 1 ? Math.max(2, activeMatches.length) : undefined
          });
        } else if (p < current.partNumber) {
          parts.push({
            partNumber: p,
            label: `V${current.videoNumber} P${p}`,
            explicitMarker: `V${current.videoNumber} P${p}`,
            videoNumber: current.videoNumber,
            heading: h,
            status: 'error',
            content: '',
            downloaded: false,
            hasDoubleResponse: isDouble
          });
        } else {
          parts.push({
            partNumber: p,
            label: `V${current.videoNumber} P${p}`,
            explicitMarker: `V${current.videoNumber} P${p}`,
            videoNumber: current.videoNumber,
            heading: h,
            status: p === current.partNumber + 1 && !isGenerating ? 'ready' : 'waiting',
            content: '',
            downloaded: false,
            hasDoubleResponse: isDouble
          });
        }
      }

      const { missingParts, duplicateParts } = calculateMissingAndDuplicateParts(partNums, totalDetected);

      return {
        totalParts: totalDetected,
        parts,
        detectedPattern: `Explicit marker ${current.marker}`,
        isMultiPartSingleResponse: false,
        outlineDetected: false,
        detectedHeadings,
        missingParts,
        duplicateParts,
        detectedVideoNumber: current.videoNumber,
        hasDoubleResponse: isDouble || activeMatches.length > 1
      };
    }
  }

  // PRIORITY 2: Standard Part header regex
  const headerMatches = Array.from(textToProcess.matchAll(PART_HEADER_REGEX));
  if (headerMatches.length > 1) {
    const parts: GeneratedPart[] = [];
    const partNums: number[] = [];
    const vPrefix = targetVideoNumber ? `V${targetVideoNumber} ` : '';

    for (let i = 0; i < headerMatches.length; i++) {
      const match = headerMatches[i];
      const partNum = parseInt(match[1], 10);
      partNums.push(partNum);

      const startIndex = match.index!;
      const nextIndex = i + 1 < headerMatches.length ? headerMatches[i + 1].index! : textToProcess.length;
      const rawContent = textToProcess.slice(startIndex, nextIndex).trim();
      const cleaned = cleanScriptContent(rawContent);

      const heading = extractHeadingFromPartText(rawContent, partNum) || generateIntelligentHeading(partNum, cleaned, headerMatches.length);
      detectedHeadings.set(partNum, heading);

      const isLast = i === headerMatches.length - 1;
      const partStatus = isLast && isGenerating ? 'generating' : (cleaned && cleaned.trim().length > 20 ? 'done' : 'ready');

      parts.push({
        partNumber: partNum,
        label: `${vPrefix}P${partNum}`,
        explicitMarker: `${vPrefix}P${partNum}`,
        videoNumber: targetVideoNumber,
        heading,
        status: partStatus,
        content: cleaned,
        extractedAt: partStatus === 'done' ? Date.now() : undefined,
        downloaded: false,
        hasDoubleResponse: isDouble
      });
    }

    parts.sort((a, b) => a.partNumber - b.partNumber);
    const { missingParts, duplicateParts, maxPart } = calculateMissingAndDuplicateParts(partNums, explicitTotal || undefined);
    const finalTotal = Math.max(maxPart, explicitTotal || 0, parts.length);

    for (let p = 1; p <= finalTotal; p++) {
      if (!parts.some((x) => x.partNumber === p)) {
        parts.push({
          partNumber: p,
          label: `${vPrefix}P${p}`,
          explicitMarker: `${vPrefix}P${p}`,
          videoNumber: targetVideoNumber,
          heading: generateIntelligentHeading(p, '', finalTotal),
          status: !isGenerating && p === parts.length + 1 ? 'ready' : 'waiting',
          content: '',
          downloaded: false
        });
      }
    }
    parts.sort((a, b) => a.partNumber - b.partNumber);

    return {
      totalParts: finalTotal,
      parts,
      detectedPattern: 'Standard part headers (segmented)',
      isMultiPartSingleResponse: true,
      outlineDetected: false,
      detectedHeadings,
      missingParts,
      duplicateParts,
      detectedVideoNumber: targetVideoNumber,
      hasDoubleResponse: isDouble
    };
  }

  // PRIORITY 3: Single part response with explicit total declared
  if (explicitTotal && explicitTotal > 1) {
    const totalParts = explicitTotal;
    const parts: GeneratedPart[] = [];
    const cleaned = cleanScriptContent(textToProcess);
    const heading = extractHeadingFromPartText(textToProcess, expectedCurrentPart) || generateIntelligentHeading(expectedCurrentPart, cleaned, totalParts);
    detectedHeadings.set(expectedCurrentPart, heading);
    const vPrefix = targetVideoNumber ? `V${targetVideoNumber} ` : '';

    for (let p = 1; p <= totalParts; p++) {
      const h = p === expectedCurrentPart ? heading : generateIntelligentHeading(p, '', totalParts);
      const isPartComplete = p === expectedCurrentPart && !isGenerating && Boolean(cleaned && cleaned.trim().length > 20);
      
      if (p === expectedCurrentPart) {
        parts.push({
          partNumber: p,
          label: `${vPrefix}P${p}`,
          explicitMarker: `${vPrefix}P${p}`,
          videoNumber: targetVideoNumber,
          heading: h,
          status: isGenerating ? 'generating' : (isPartComplete ? 'done' : 'ready'),
          content: cleaned,
          extractedAt: isPartComplete ? Date.now() : undefined,
          downloaded: false,
          hasDoubleResponse: isDouble
        });
      } else if (p < expectedCurrentPart) {
        parts.push({
          partNumber: p,
          label: `${vPrefix}P${p}`,
          explicitMarker: `${vPrefix}P${p}`,
          videoNumber: targetVideoNumber,
          heading: h,
          status: 'error',
          content: '',
          downloaded: false
        });
      } else {
        parts.push({
          partNumber: p,
          label: `${vPrefix}P${p}`,
          explicitMarker: `${vPrefix}P${p}`,
          videoNumber: targetVideoNumber,
          heading: h,
          status: p === expectedCurrentPart + 1 && !isGenerating ? 'ready' : 'waiting',
          content: '',
          downloaded: false
        });
      }
    }

    const { missingParts, duplicateParts } = calculateMissingAndDuplicateParts([expectedCurrentPart], totalParts);

    return {
      totalParts,
      parts,
      detectedPattern: `Turn-based part with Total Parts: ${totalParts}`,
      isMultiPartSingleResponse: false,
      outlineDetected: false,
      detectedHeadings,
      missingParts,
      duplicateParts,
      detectedVideoNumber: targetVideoNumber,
      hasDoubleResponse: isDouble
    };
  }

  // FALLBACK: Default single part
  const cleaned = cleanScriptContent(textToProcess);
  const heading = extractHeadingFromPartText(textToProcess, expectedCurrentPart) || generateIntelligentHeading(expectedCurrentPart, cleaned, 1);
  detectedHeadings.set(expectedCurrentPart, heading);
  const vPrefix = targetVideoNumber ? `V${targetVideoNumber} ` : '';
  const isPartComplete = !isGenerating && Boolean(cleaned && cleaned.trim().length > 20);

  return {
    totalParts: Math.max(expectedCurrentPart, 1),
    parts: [
      {
        partNumber: expectedCurrentPart,
        label: `${vPrefix}P${expectedCurrentPart}`,
        explicitMarker: `${vPrefix}P${expectedCurrentPart}`,
        videoNumber: targetVideoNumber,
        heading,
        status: isGenerating ? 'generating' : (isPartComplete ? 'done' : 'ready'),
        content: cleaned,
        extractedAt: isPartComplete ? Date.now() : undefined,
        downloaded: false,
        hasDoubleResponse: isDouble
      }
    ],
    detectedPattern: 'Single part fallback',
    isMultiPartSingleResponse: false,
    outlineDetected: false,
    detectedHeadings,
    detectedVideoNumber: targetVideoNumber,
    hasDoubleResponse: isDouble
  };
}

/**
 * Scans all assistant messages in a multi-turn chat to accurately preserve and combine every part.
 * Guarantees Outline is recognized and NEVER confused with Part 1.
 * Guarantees explicit Vx Py markers take priority, never renumbers parts, detects missing and duplicate parts.
 * Guarantees duplicate/candidate responses (Response 1 / Response 2) are not treated as new parts.
 */
export function detectPartsFromMessages(
  messages: string[],
  expectedCurrentPart = 1,
  isGenerating = false,
  targetVideoNumber?: number,
  hasCompetitorScript = false
): PartDetectionResult {
  if (messages.length === 0) {
    const vPrefix = targetVideoNumber ? `V${targetVideoNumber} ` : '';
    return {
      totalParts: 1,
      parts: [
        {
          partNumber: expectedCurrentPart,
          label: `${vPrefix}P${expectedCurrentPart}`,
          explicitMarker: `${vPrefix}P${expectedCurrentPart}`,
          videoNumber: targetVideoNumber,
          heading: generateIntelligentHeading(expectedCurrentPart, '', 1),
          status: isGenerating ? 'generating' : 'ready',
          content: '',
          downloaded: false
        }
      ],
      detectedPattern: 'None',
      isMultiPartSingleResponse: false,
      outlineDetected: false,
      detectedHeadings: new Map()
    };
  }

  let outlineDetected = false;
  let outlineContent: string | undefined = undefined;
  let outlineIsComplete = false;
  let outlinePartInstructions = new Map<number, string>();
  const outlineHeadings = new Map<number, string>();
  let explicitTotal: number | null = null;
  let outlineMsgCount = 0;
  const detectedVideoNumbers = new Set<number>();

  // 1. Scan leading messages for Outline (Section 6)
  if (!hasCompetitorScript && messages.length > 0) {
    const firstCheck = detectOutlineInText(messages[0], hasCompetitorScript);
    if (firstCheck.isOutline) {
      outlineDetected = true;
      outlineContent = firstCheck.outlineText;
      outlineIsComplete = Boolean(firstCheck.isComplete);
      if (firstCheck.partInstructions) {
        outlinePartInstructions = firstCheck.partInstructions;
      }
      if (firstCheck.totalParts) {
        explicitTotal = firstCheck.totalParts;
      }
      if (firstCheck.detectedVideoNumber) {
        detectedVideoNumbers.add(firstCheck.detectedVideoNumber);
      }
      firstCheck.partHeadings.forEach((val, key) => {
        outlineHeadings.set(key, val);
      });
      outlineMsgCount = 1;

      // Group candidate duplicate responses for outline (e.g. Response 1 and Response 2 of outline)
      while (outlineMsgCount < messages.length) {
        const nextMsg = messages[outlineMsgCount];
        const nextCheck = detectOutlineInText(nextMsg, hasCompetitorScript);
        if (nextCheck.isOutline || isCandidateDuplicateResponse(nextMsg)) {
          outlineMsgCount++;
          if (nextCheck.isComplete) outlineIsComplete = true;
          if (nextCheck.partInstructions) {
            nextCheck.partInstructions.forEach((v, k) => {
              if (!outlinePartInstructions.has(k)) outlinePartInstructions.set(k, v);
            });
          }
          if (nextCheck.partHeadings) {
            nextCheck.partHeadings.forEach((v, k) => {
              if (!outlineHeadings.has(k)) outlineHeadings.set(k, v);
            });
          }
          if (nextCheck.totalParts && !explicitTotal) {
            explicitTotal = nextCheck.totalParts;
          }
          if (nextCheck.detectedVideoNumber) {
            detectedVideoNumbers.add(nextCheck.detectedVideoNumber);
          }
        } else {
          break;
        }
      }
    }
  }

  // 2. Scan all messages for explicit total parts declared anywhere (only if not already locked by outline)
  if (!explicitTotal) {
    for (const msg of messages) {
      const t = extractTotalPartsFromText(msg);
      if (t && t > 0) {
        explicitTotal = t;
        break;
      }
    }
  }

  // 3. Scan script messages (strictly messages AFTER outline)
  const detectedPartsMap = new Map<number, GeneratedPart>();
  const markerCounts = new Map<string, number>();
  const allDetectedPartNumbers: number[] = [];

  const scriptMessages = messages.slice(outlineMsgCount);
  let expectedP = 1;
  let lastSeenPartNum: number | null = null;

  scriptMessages.forEach((msg, idx) => {
    const isLatest = idx === scriptMessages.length - 1;
    const msgGenerating = isLatest && isGenerating;
    const isDouble = isDoubleResponseBlock(msg);
    const { primary, candidate2 } = isDouble ? splitDoubleResponseBlock(msg) : { primary: msg, candidate2: undefined };

    // Check if this message is an explicit candidate duplicate of the previous message
    const isCandidateDup = isCandidateDuplicateResponse(msg);

    // PRIORITY 1: Check for explicit TOP marker declaring the part at the top of the response
    const topMarker = extractTopExplicitMarker(primary);

    if (topMarker) {
      const pNum = topMarker.partNumber;
      const vNum = topMarker.videoNumber;
      detectedVideoNumbers.add(vNum);

      const existing = detectedPartsMap.get(pNum);
      if (existing && isCandidateDup) {
        existing.hasDoubleResponse = true;
        existing.candidateCount = (existing.candidateCount || 1) + 1;
        return;
      }

      allDetectedPartNumbers.push(pNum);
      lastSeenPartNum = pNum;

      const markerKey = topMarker.marker;
      const count = (markerCounts.get(markerKey) || 0) + 1;
      markerCounts.set(markerKey, count);

      const cleaned = cleanScriptContent(primary);
      const heading = topMarker.heading || outlineHeadings.get(pNum) ||
        extractHeadingFromPartText(primary, pNum) ||
        generateIntelligentHeading(pNum, cleaned);

      const hasCompletion = hasPartCompletionMarker(primary, vNum, pNum);
      const isPartComplete = hasCompletion && Boolean(cleaned && cleaned.trim().length > 20);
      const partStatus: PartStatus = isPartComplete ? 'done' : 'generating';

      if (!existing) {
        detectedPartsMap.set(pNum, {
          partNumber: pNum,
          label: topMarker.marker,
          explicitMarker: topMarker.marker,
          videoNumber: vNum,
          heading,
          status: partStatus,
          content: cleaned,
          extractedAt: isPartComplete ? Date.now() : undefined,
          downloaded: false,
          hasDoubleResponse: isDouble || Boolean(candidate2),
          candidateCount: isDouble || candidate2 ? 2 : undefined
        });
      } else {
        if (cleaned && cleaned.trim()) {
          existing.content = cleaned;
        }
        if (heading) existing.heading = heading;
        if (isPartComplete) {
          existing.status = 'done';
          existing.extractedAt = existing.extractedAt || Date.now();
        } else if (!existing.status || existing.status === 'ready' || existing.status === 'waiting') {
          existing.status = 'generating';
        }
        if (isDouble || candidate2) {
          existing.hasDoubleResponse = true;
          existing.candidateCount = 2;
        }
      }
      expectedP = Math.max(...Array.from(detectedPartsMap.keys())) + 1;
      return;
    }

    // PRIORITY 2: Check for explicit markers in body
    const explicitMarkers = findExplicitMarkersInText(primary);
    if (explicitMarkers.length > 0) {
      const m = explicitMarkers[0];
      detectedVideoNumbers.add(m.videoNumber);

      const existing = detectedPartsMap.get(m.partNumber);
      if (existing && isCandidateDup) {
        existing.hasDoubleResponse = true;
        existing.candidateCount = (existing.candidateCount || 1) + 1;
        return;
      }

      allDetectedPartNumbers.push(m.partNumber);
      lastSeenPartNum = m.partNumber;

      const markerKey = m.marker;
      const count = (markerCounts.get(markerKey) || 0) + 1;
      markerCounts.set(markerKey, count);

      const cleaned = cleanScriptContent(primary);
      const heading = m.heading || outlineHeadings.get(m.partNumber) ||
        extractHeadingFromPartText(primary, m.partNumber) ||
        generateIntelligentHeading(m.partNumber, cleaned);

      const hasCompletion = hasPartCompletionMarker(primary, m.videoNumber, m.partNumber);
      const isPartComplete = hasCompletion && Boolean(cleaned && cleaned.trim().length > 20);
      const partStatus: PartStatus = isPartComplete ? 'done' : 'generating';

      if (!existing) {
        detectedPartsMap.set(m.partNumber, {
          partNumber: m.partNumber,
          label: m.marker,
          explicitMarker: m.marker,
          videoNumber: m.videoNumber,
          heading,
          status: partStatus,
          content: cleaned,
          extractedAt: isPartComplete ? Date.now() : undefined,
          downloaded: false,
          hasDoubleResponse: isDouble || Boolean(candidate2),
          candidateCount: isDouble || candidate2 ? 2 : undefined
        });
      } else {
        if (cleaned && cleaned.trim()) existing.content = cleaned;
        if (heading) existing.heading = heading;
        if (isPartComplete) {
          existing.status = 'done';
          existing.extractedAt = Date.now();
        } else if (!existing.status || existing.status === 'ready' || existing.status === 'waiting') {
          existing.status = 'generating';
        }
        if (isDouble || candidate2) {
          existing.hasDoubleResponse = true;
          existing.candidateCount = 2;
        }
      }
      expectedP = Math.max(...Array.from(detectedPartsMap.keys())) + 1;
      return;
    }

    // Fallback if no explicit marker found
    if (isCandidateDup && lastSeenPartNum && detectedPartsMap.has(lastSeenPartNum)) {
      const existing = detectedPartsMap.get(lastSeenPartNum)!;
      existing.hasDoubleResponse = true;
      existing.candidateCount = (existing.candidateCount || 1) + 1;
    } else {
      const cleaned = cleanScriptContent(primary);
      const hasCompletion = hasPartCompletionMarker(primary, targetVideoNumber, expectedP);
      const isPartComplete = hasCompletion && Boolean(cleaned && cleaned.trim().length > 20);
      const vPrefix = targetVideoNumber ? `V${targetVideoNumber} ` : '';
      const existing = detectedPartsMap.get(expectedP);

      if (!existing) {
        detectedPartsMap.set(expectedP, {
          partNumber: expectedP,
          label: `${vPrefix}P${expectedP}`,
          explicitMarker: `${vPrefix}P${expectedP}`,
          videoNumber: targetVideoNumber,
          heading: outlineHeadings.get(expectedP) || generateIntelligentHeading(expectedP, '', expectedP),
          status: isPartComplete ? 'done' : 'generating',
          content: cleaned,
          extractedAt: isPartComplete ? Date.now() : undefined,
          downloaded: false,
          hasDoubleResponse: isDouble,
          candidateCount: isDouble ? 2 : undefined
        });
      } else {
        if (cleaned && cleaned.trim()) existing.content = cleaned;
        if (isPartComplete) {
          existing.status = 'done';
          existing.extractedAt = Date.now();
        } else if (!existing.status || existing.status === 'ready' || existing.status === 'waiting') {
          existing.status = 'generating';
        }
      }
      expectedP++;
    }
  });

  const primaryVideoNum = (detectedVideoNumbers.size > 0 ? Array.from(detectedVideoNumbers)[0] : targetVideoNumber) || 1;

  // Calculate duplicates
  const duplicateParts: number[] = [];
  for (const [key, count] of markerCounts.entries()) {
    if (count > 1) {
      const pNumMatch = key.match(/P(\d+)/i);
      if (pNumMatch) {
        const pNum = parseInt(pNumMatch[1], 10);
        if (!duplicateParts.includes(pNum)) duplicateParts.push(pNum);
      }
    }
  }
  duplicateParts.sort((a, b) => a - b);

  const presentPartNumbers = Array.from(detectedPartsMap.keys());
  const highestPartNum = presentPartNumbers.length > 0 ? Math.max(...presentPartNumbers) : 0;
  const highestDonePartNum = Array.from(detectedPartsMap.values())
    .filter((p) => p.status === 'done' && p.content && p.content.trim())
    .map((p) => p.partNumber);
  const maxDonePart = highestDonePartNum.length > 0 ? Math.max(...highestDonePartNum) : 0;

  // If explicitTotal was declared by AI (e.g. Total Parts = 4), lock maxPart to explicitTotal!
  // Only expand beyond explicitTotal if completed script parts with actual content exist beyond it.
  const maxPart = explicitTotal && explicitTotal > 0
    ? Math.max(explicitTotal, maxDonePart)
    : Math.max(
        highestPartNum,
        outlineDetected ? outlineHeadings.size || 4 : expectedCurrentPart,
        1
      );

  const missingParts: number[] = [];
  for (let p = 1; p <= maxPart; p++) {
    const existing = detectedPartsMap.get(p);
    if (!existing) {
      const heading = outlineHeadings.get(p) || generateIntelligentHeading(p, '', maxPart);
      let partStatus: PartStatus = 'waiting';

      const isSkippedInSequence = highestPartNum > 0 && p < highestPartNum;
      if (isSkippedInSequence) {
        missingParts.push(p);
        partStatus = 'error';
      } else if (!outlineDetected && p === expectedCurrentPart && isGenerating) {
        partStatus = 'generating';
      }

      detectedPartsMap.set(p, {
        partNumber: p,
        label: `V${primaryVideoNum} P${p}`,
        explicitMarker: `V${primaryVideoNum} P${p}`,
        videoNumber: primaryVideoNum,
        heading,
        status: partStatus,
        content: '',
        downloaded: false
      });
    }
  }

  // Filter out any phantom parts beyond maxPart (unless they have genuine completed content)
  const parts = Array.from(detectedPartsMap.values())
    .filter((p) => p.partNumber <= maxPart || (p.status === 'done' && p.content && p.content.trim()))
    .sort((a, b) => a.partNumber - b.partNumber);

  const doneParts = parts.filter((p) => p.status === 'done');
  const generatingPart = parts.find((p) => p.status === 'generating');
  const maxDonePartNum = doneParts.length > 0 ? Math.max(...doneParts.map((p) => p.partNumber)) : 0;
  
  let lifecycleStage: ScriptLifecycleStage = 'WAITING';
  let liveDebugStatus = '';

  if (!hasCompetitorScript) {
    if (outlineDetected) {
      if (!outlineIsComplete) {
        lifecycleStage = 'OUTLINE_GENERATING';
        liveDebugStatus = 'Generating Outline / Incomplete | Waiting for Qwen';
      } else if (doneParts.length === maxPart && maxPart > 0) {
        lifecycleStage = 'FINAL_PART_GENERATED';
        liveDebugStatus = `All ${maxPart} Parts Completed ✓ | Merging Ready`;
      } else if (generatingPart) {
        lifecycleStage = 'PART_GENERATING';
        liveDebugStatus = `V${primaryVideoNum}, P${generatingPart.partNumber} Generating / Incomplete | Waiting for completion marker...`;
      } else if (doneParts.length > 0) {
        lifecycleStage = 'PART_GENERATED';
        const nextP = maxDonePartNum + 1;
        liveDebugStatus = `V${primaryVideoNum}, P${maxDonePartNum} Completed ✓ | Waiting for V${primaryVideoNum}, P${nextP}...`;
      } else {
        lifecycleStage = 'OUTLINE_GENERATED';
        liveDebugStatus = `OUTLINE GENERATED ✓ | Total Parts: ${maxPart} ✓ | Ready for V${primaryVideoNum}, P1...`;
      }
    } else {
      if (isGenerating) {
        lifecycleStage = 'OUTLINE_GENERATING';
        liveDebugStatus = `Outline generating... | Waiting for Qwen`;
      } else {
        lifecycleStage = 'WAITING';
        liveDebugStatus = `Waiting for run...`;
      }
    }
  } else {
    // With competitor script: outline skipped
    if (doneParts.length === maxPart && maxPart > 0) {
      lifecycleStage = 'FINAL_PART_GENERATED';
      liveDebugStatus = `All ${maxPart} Parts Completed ✓ | Merging Ready`;
    } else if (generatingPart) {
      lifecycleStage = 'PART_GENERATING';
      liveDebugStatus = `V${primaryVideoNum}, P${generatingPart.partNumber} Generating / Incomplete | Waiting for completion marker...`;
    } else if (doneParts.length > 0) {
      lifecycleStage = 'PART_GENERATED';
      const nextP = maxDonePartNum + 1;
      liveDebugStatus = `V${primaryVideoNum}, P${maxDonePartNum} Completed ✓ | Waiting for V${primaryVideoNum}, P${nextP}...`;
    } else if (isGenerating) {
      lifecycleStage = 'PART_GENERATING';
      liveDebugStatus = `V${primaryVideoNum}, P1 Generating / Incomplete | Waiting for completion marker...`;
    } else {
      lifecycleStage = 'WAITING';
      liveDebugStatus = `Ref Script Loaded ✓ | Waiting for V${primaryVideoNum}, P1...`;
    }
  }

  return {
    totalParts: maxPart,
    parts,
    detectedPattern: outlineDetected ? 'Multi-turn with Outline detected' : 'Multi-turn message scanner',
    isMultiPartSingleResponse: scriptMessages.length === 1 && parts.filter((p) => p.content).length > 1,
    outlineDetected,
    outlineContent,
    outlineStatus: outlineDetected ? (outlineIsComplete ? 'completed' : 'generating') : 'not_started',
    outlinePartInstructions,
    detectedHeadings: outlineHeadings,
    missingParts,
    duplicateParts,
    detectedVideoNumber: primaryVideoNum,
    lifecycleStage,
    liveDebugStatus
  };
}

/**
 * Cleans UI artifacts, markdown noise, copy buttons, and assistant meta-talk.
 * Preserves paragraphs, formatting, dialogue, and line breaks.
 */
export function cleanScriptContent(raw: string): string {
  if (!raw) return '';

  let cleaned = raw;

  // 1. Remove thinking / reasoning tags or blocks (e.g. <think>...</think>)
  cleaned = cleaned.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');

  // 2. Remove thinking indicator lines from UI or assistant output
  cleaned = cleaned.replace(/^(?:💡\s*)?(?:Thinking completed|Crafting a narrative|Thinking process)[^\n]*\n*/gim, '');

  // 3. Remove metadata or status markers (e.g. "[Status: ...]", "[Progress: ...]")
  cleaned = cleaned.replace(/^(?:\[|\()(?:Status|Progress|Generation|Metadata|Turn):[^\n]*?(?:\]|\))\s*\n*/gim, '');

  // 4. Strip duplicate response header badges (e.g. "Response 1", "Response 2", "Ответ 1", "Ответ 2", "回答 1", "回答 2")
  cleaned = cleaned.replace(/^[#*_\s\[\(`]*(?:Response|Ответ|回答)\s*[12]\b[:\s-]*/i, '');

  // 5. Strip RLHF preference button artifacts (e.g. "I prefer this response", "Мне больше нравится этот ответ", etc.)
  cleaned = cleaned.replace(/(?:^|\n)\s*(?:I prefer this response|Мне больше нравится этот ответ|我更喜欢这个回答|Prefer this response|Select this response)\s*$/gim, '');
  cleaned = cleaned.replace(/^(?:I prefer this response|Мне больше нравится этот ответ|我更喜欢这个回答|Prefer this response|Select this response)[^\n]*\n*/gim, '');

  // 6. Remove common AI preambles like "Sure, here is the script:" or "Certainly!"
  cleaned = cleaned.replace(
    /^(?:Sure!|Certainly!|Here is (?:the|your) script:?|Here's (?:the|your) script:?|Below is the script:?|Of course!)[^\n]*\n+/i,
    ''
  );

  // 5. Remove common AI postambles like "Let me know if you need any edits!"
  cleaned = cleaned.replace(
    /\n+(?:Let me know if you (?:need|want) (?:any|more) edits|Hope this helps!|Feel free to ask for part)[^\n]*$/i,
    ''
  );

  // 6. Strip UI artifacts like "Copy code", "Regenerate", markdown ``` delimiters if they wrap the entire text
  cleaned = cleaned.replace(/^```(?:markdown|text)?\r?\n([\s\S]*?)\r?\n```$/i, '$1');

  // 7. Strip trailing whitespace per line
  cleaned = cleaned
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();

  return cleaned;
}
