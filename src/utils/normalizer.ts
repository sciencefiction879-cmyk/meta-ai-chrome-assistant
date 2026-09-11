/**
 * Normalizes title strings while preserving V1, V2, V3 prefixes intact.
 */
export function normalizeTitle(rawTitle: string): string {
  if (!rawTitle) return '';
  let cleaned = rawTitle.trim();

  // If the string starts and ends with quotes, strip them
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Preserve "V1. ", "V2. ", "V1 - " intact as requested by user!
  return cleaned || rawTitle.trim();
}

/**
 * Parses raw text (from file or textarea) into an array of normalized titles.
 */
export function parseTitlesFromRawText(text: string): { original: string; normalized: string; index: number }[] {
  if (!text) return [];
  
  const lines = text.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  return lines.map((line, idx) => ({
    original: line,
    normalized: normalizeTitle(line),
    index: idx + 1
  }));
}

/**
 * Parses range string (e.g., "V1-V10", "1-10", "21-30") into 1-based start and end indices.
 */
export function parseRange(rangeStr: string, maxLimit = 100): { start: number; end: number } | null {
  if (!rangeStr) return null;
  const match = rangeStr.trim().match(/^[vV]?(\d+)\s*[-–—:]\s*[vV]?(\d+)$/);
  if (!match) return null;

  const start = parseInt(match[1], 10);
  const end = parseInt(match[2], 10);

  if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
    return null;
  }

  return {
    start,
    end: Math.min(end, maxLimit)
  };
}

/**
 * Parses custom video IDs from user input (e.g. "V3, V4, V7, V9, V10", "3, 4, 7, 9, 10", "V3 V4 V7").
 * Returns a sorted, unique array of positive integer video numbers.
 */
export function parseCustomVideoIds(input: string): number[] {
  if (!input || !input.trim()) return [];

  // Match all numbers optionally prefixed with V/v
  const matches = input.matchAll(/(?:[vV]\s*)?([1-9]\d*)\b/g);
  const ids = new Set<number>();

  for (const m of matches) {
    const num = parseInt(m[1], 10);
    if (!isNaN(num) && num > 0) {
      ids.add(num);
    }
  }

  return Array.from(ids).sort((a, b) => a - b);
}

/**
 * Injects or formats the title into the master prompt.
 * Ensures the title is accompanied by its V-prefix (V1, V2, etc.).
 * If the master prompt contains phrases like "My Version of Title:", "My Title:", or "[TITLE]",
 * it places the title directly there. Otherwise, it prepends "My Version of Title: {title}\n\n{masterPrompt}".
 */
export function formatPromptWithTitle(title: string, masterPrompt: string, vNumber?: string): string {
  let cleanTitle = (title || '').trim();
  const prompt = (masterPrompt || '').trim();

  // If vNumber is provided (e.g. 'V1'), and title doesn't already start with V1, V2, etc., prepend it
  const hasExistingVPrefix = /^[vV]\s*0*\d+[\s.:\-_–—]*/i.test(cleanTitle);
  if (vNumber && !hasExistingVPrefix) {
    cleanTitle = `${vNumber} - ${cleanTitle}`;
  }

  if (!prompt) {
    return `My Version of Title: ${cleanTitle}`;
  }

  // 1. Explicit placeholder tags
  if (prompt.includes('[TITLE]')) {
    return prompt.replaceAll('[TITLE]', cleanTitle);
  }
  if (prompt.includes('{TITLE}')) {
    return prompt.replaceAll('{TITLE}', cleanTitle);
  }
  if (prompt.includes('<TITLE>')) {
    return prompt.replaceAll('<TITLE>', cleanTitle);
  }

  // 2. Pattern matching for "My Version of Title" or "My Title" (case-insensitive)
  const markerRegex = /(?:My\s*Version\s*of\s*Title|My\s*Title|Version\s*of\s*Title)\s*[:\-–—]?/i;
  if (markerRegex.test(prompt)) {
    return prompt.replace(markerRegex, (matched) => {
      const separator = matched.endsWith(':') || matched.endsWith('-') ? '' : ':';
      return `${matched}${separator} ${cleanTitle}`;
    });
  }

  // 3. Fallback: Prepend "My Version of Title: {title}"
  return `My Version of Title: ${cleanTitle}\n\n${prompt}`;
}

/**
 * Extracts explicit Video number from title string if present (e.g. "V1", "V10 - ", "[V15]", "Video 20").
 */
export function extractVideoNumberFromTitle(title: string): number | null {
  if (!title) return null;
  const match = title.trim().match(/^(?:\[?\s*[vV](\d+)\s*\]?|Video\s*(\d+))[\s.:\-_–—]*/i);
  if (match) {
    const num = parseInt(match[1] || match[2], 10);
    if (!isNaN(num) && num > 0) return num;
  }
  return null;
}

/**
 * Slices and filters titles strictly to the selected range [startIndex .. endIndex].
 * The selected range is the ALLOWED RANGE (START <= Video ID <= END).
 * Everything outside that range is automatically removed/cut:
 * - Titles below START (e.g. V1..V9 when range is V10..V15) are cut/removed.
 * - Titles above END (e.g. V16..V50 when range is V10..V15) are cut/removed.
 * 
 * Supports:
 * 1. Titles with explicit V-number markers (e.g. V1, V2, V10, V25).
 * 2. Sequential plain titles (where line 1 is V1, line 10 is V10, etc.).
 * 3. Exact batch pastes (where user pasted only the exact subset for the range).
 */
export function sliceTitlesForRange(
  titles: string[],
  startIndex: number,
  endIndex: number,
  explicitVideoIds?: number[]
): {
  assigned: string[];
  excessCount: number;
  cutBelowCount: number;
  cutAboveCount: number;
} {
  if (!titles || titles.length === 0) {
    return { assigned: [], excessCount: 0, cutBelowCount: 0, cutAboveCount: 0 };
  }

  // If explicit discontinuous Video IDs are provided
  if (explicitVideoIds && explicitVideoIds.length > 0) {
    const validIdSet = new Set(explicitVideoIds);
    const minId = Math.min(...explicitVideoIds);
    const maxId = Math.max(...explicitVideoIds);
    const maxAllowed = explicitVideoIds.length;

    const hasExplicitVMarkers = titles.some((t) => extractVideoNumberFromTitle(t) !== null);

    if (hasExplicitVMarkers) {
      const kept: string[] = [];
      let cutBelow = 0;
      let cutAbove = 0;

      for (const title of titles) {
        const vNum = extractVideoNumberFromTitle(title);
        if (vNum !== null) {
          if (validIdSet.has(vNum)) {
            kept.push(title);
          } else if (vNum < minId) {
            cutBelow++;
          } else {
            cutAbove++;
          }
        } else {
          if (kept.length < maxAllowed) {
            kept.push(title);
          } else {
            cutAbove++;
          }
        }
      }

      return {
        assigned: kept,
        excessCount: cutBelow + cutAbove,
        cutBelowCount: cutBelow,
        cutAboveCount: cutAbove
      };
    } else {
      const assigned = titles.slice(0, maxAllowed);
      const excess = Math.max(0, titles.length - maxAllowed);
      return {
        assigned,
        excessCount: excess,
        cutBelowCount: 0,
        cutAboveCount: excess
      };
    }
  }

  const start = Math.max(1, startIndex);
  const end = Math.max(start, endIndex);
  const maxAllowed = end - start + 1;

  // Check if any title explicitly declares a V-number (e.g. "V1", "V10", "V20 - ")
  const hasExplicitVMarkers = titles.some((t) => extractVideoNumberFromTitle(t) !== null);

  if (hasExplicitVMarkers) {
    const kept: string[] = [];
    let cutBelow = 0;
    let cutAbove = 0;

    for (const title of titles) {
      const vNum = extractVideoNumberFromTitle(title);
      if (vNum !== null) {
        if (vNum < start) {
          cutBelow++;
        } else if (vNum > end) {
          cutAbove++;
        } else {
          kept.push(title);
        }
      } else {
        // Line without explicit marker: keep if room within allowed count
        if (kept.length < maxAllowed) {
          kept.push(title);
        } else {
          cutAbove++;
        }
      }
    }

    return {
      assigned: kept,
      excessCount: cutBelow + cutAbove,
      cutBelowCount: cutBelow,
      cutAboveCount: cutAbove
    };
  }

  // Plain sequential titles without explicit markers (e.g., 50 lines: Line 1 = V1 ... Line 50 = V50)
  if (titles.length >= start) {
    const cutBelow = Math.max(0, start - 1);
    const inRange = titles.slice(start - 1, end);
    const cutAbove = Math.max(0, titles.length - end);

    return {
      assigned: inRange,
      excessCount: cutBelow + cutAbove,
      cutBelowCount: cutBelow,
      cutAboveCount: cutAbove
    };
  }

  // If user pasted a small batch meant directly for the range (fewer lines than start index):
  const assigned = titles.slice(0, maxAllowed);
  const excessCount = Math.max(0, titles.length - maxAllowed);

  return {
    assigned,
    excessCount,
    cutBelowCount: 0,
    cutAboveCount: excessCount
  };
}

/**
 * Generates the prompt for writing a specific part of a script.
 * 
 * Simple prompt for both Original Script Mode and Competitor Script Mode:
 * Sends ONLY: "Write Part X"
 * 
 * Does NOT add word-count instructions, outline instructions,
 * previous-part instructions, final-part instructions, part descriptions,
 * extra text, or additional rules/explanations.
 * 
 * @param partNumber The part number to generate the prompt for (e.g. 1, 2, 3, 4, etc.)
 * @param _totalParts Optional/unused
 * @param _wordCount Optional/unused
 * @param _outlineInstruction Optional/unused
 */
export function generateWritePartPrompt(
  partNumber: number,
  _totalParts?: number,
  _wordCount?: number,
  _outlineInstruction?: string
): string {
  return `Write Part ${partNumber}`;
}


