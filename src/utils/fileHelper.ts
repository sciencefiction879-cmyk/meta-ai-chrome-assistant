import JSZip from 'jszip';
import { cleanScriptContent, detectOutlineInText } from './partDetector';

export function formatBytes(bytes: number, decimals = 1): string {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function createTxtBlob(content: string): Blob {
  return new Blob([content], { type: 'text/plain;charset=utf-8' });
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Formats a single part for the merged TXT script file.
 * Preserves the exact part identification at the beginning of every section:
 *
 * V1 P1
 * [Part 1 script]
 *
 * (or "V1 P1 — Heading" if a meaningful heading is present)
 * Strictly strips thinking/reasoning blocks, status messages, and metadata.
 * Eliminates duplicate raw marker lines (e.g. "V10/P1", "v10p1").
 * Rejects outlines (returns empty string).
 */
export function formatMergedScriptPart(
  vId: string,
  partNumber: number,
  heading: string | undefined,
  content: string
): string {
  if (!content) return '';

  // 1. Clean thinking/reasoning tags, status messages, metadata, AI preambles
  const cleaned = cleanScriptContent(content);
  if (!cleaned || !cleaned.trim()) return '';

  // 2. Strict check: if content is an outline, NEVER merge it!
  const outlineCheck = detectOutlineInText(cleaned);
  if (outlineCheck.isOutline) {
    return '';
  }

  // 3. Check if body starts with an explicit marker line (e.g. "V10/P1", "v10p1", "V10 P1", "### V10 P1 — Heading")
  const firstLineEnd = cleaned.indexOf('\n');
  const firstLine = firstLineEnd !== -1 ? cleaned.substring(0, firstLineEnd).trim() : cleaned;
  
  let cleanExtractedHeading = '';
  let bodyWithoutFirstLine = cleaned;

  if (/^[#*_\s\[\(`]*(?:V|VIDEO)\s*0*\d*\s*[,/\\._\-–—:|~\s]*\s*(?:P|PART)\s*0*\d*(?=[^\d]|$)/i.test(firstLine)) {
    // Extract any existing heading on that first line
    const extracted = firstLine.replace(/^[#*_\s\[\(`]*(?:V|VIDEO)\s*0*\d*\s*[,/\\._\-–—:|~\s]*\s*(?:P|PART)\s*0*\d*(?=[^\d]|$)[^:\-—–\n]*[:\-—–]?\s*/i, '').trim();
    cleanExtractedHeading = extracted.replace(/^[*_#`~\[\(\]]+|[*_#`~\[\(\)]+$/g, '').trim();
    bodyWithoutFirstLine = firstLineEnd !== -1 ? cleaned.substring(firstLineEnd).trim() : '';
  }

  const finalHeading = cleanExtractedHeading && cleanExtractedHeading.length > 2 && !/^part\s*\d+$/i.test(cleanExtractedHeading)
    ? cleanExtractedHeading
    : (heading && heading.trim() && !/^part\s*\d+$/i.test(heading.trim()) && heading.trim().toLowerCase() !== 'scene' ? heading.trim() : '');

  const marker = `${vId} P${partNumber}`;
  const headerLine = finalHeading ? `${marker} — ${finalHeading}` : marker;
  const scriptBody = (bodyWithoutFirstLine || cleaned).trim();

  return `${headerLine}\n\n${scriptBody}`;
}

export async function createZipBundle(
  files: { filename: string; content: string }[]
): Promise<Blob> {
  const zip = new JSZip();

  for (const item of files) {
    zip.file(item.filename, item.content);
  }

  return await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
}

/**
 * Maps multiple uploaded files (e.g. "Thumbnail 1", "V20", "script_21.txt") sequentially or by name.
 * Supports custom availableVNumbers (e.g. ['V20', 'V21', 'V22']).
 */
export function mapFilesToVNumbers<T extends { name: string }>(
  files: T[],
  vCount: number,
  availableVNumbers?: string[]
): { vNumber: string; file: T }[] {
  const result: { vNumber: string; file: T }[] = [];
  const assignedV = new Set<string>();

  const validVList = availableVNumbers && availableVNumbers.length > 0
    ? availableVNumbers
    : Array.from({ length: vCount }, (_, i) => `V${i + 1}`);
  const validVSet = new Set(validVList);

  // 1. First pass: Check if file name explicitly includes a V number (e.g. "V20", "V021", "V 25")
  for (const file of files) {
    const match = file.name.match(/[vV]\s*0*([1-9]\d*)\b/);
    if (match) {
      const vNum = parseInt(match[1], 10);
      const vStr = `V${vNum}`;
      if (validVSet.has(vStr) && !assignedV.has(vStr)) {
        result.push({ vNumber: vStr, file });
        assignedV.add(vStr);
      }
    }
  }

  // 2. Second pass: For remaining files, check if file name has a raw number (e.g. "Thumbnail 20", "Script 21")
  for (const file of files) {
    if (result.some(r => r.file === file)) continue;

    const match = file.name.match(/(?:thumbnail|script|image|part)?\s*#?\s*0*([1-9]\d*)\b/i);
    if (match) {
      const vNum = parseInt(match[1], 10);
      const vStr = `V${vNum}`;
      if (validVSet.has(vStr) && !assignedV.has(vStr)) {
        result.push({ vNumber: vStr, file });
        assignedV.add(vStr);
      }
    }
  }

  // 3. Third pass: For any remaining unassigned files, assign sequentially to unassigned V slots
  let targetIdx = 0;
  for (const file of files) {
    if (result.some(r => r.file === file)) continue;

    while (targetIdx < validVList.length && assignedV.has(validVList[targetIdx])) {
      targetIdx++;
    }

    if (targetIdx < validVList.length) {
      const vStr = validVList[targetIdx];
      result.push({ vNumber: vStr, file });
      assignedV.add(vStr);
      targetIdx++;
    }
  }

  // Sort result by V number
  result.sort((a, b) => {
    const numA = parseInt(a.vNumber.replace('V', ''), 10);
    const numB = parseInt(b.vNumber.replace('V', ''), 10);
    return numA - numB;
  });

  return result;
}

/**
 * Generates dynamic filename for the final merged script output based on the Video ID range.
 * 
 * Examples:
 * - ['V1', 'V2', 'V3', 'V4', 'V5'] -> "V1 to V5 Script.txt"
 * - ['V1', 'V2', ..., 'V10']        -> "V1 to V10 Script.txt"
 * - ['V40', ..., 'V50']             -> "V40 to V50 Script.txt"
 * - ['V1']                          -> "V1 Script.txt"
 */
export function getMergedFilename(videoIds: string[]): string {
  if (!videoIds || videoIds.length === 0) return 'Merged Script.txt';

  const validIds = videoIds.filter((v) => /^V\d+$/i.test(v.trim()));
  if (validIds.length === 0) {
    return videoIds[0] ? `${videoIds[0]} Script.txt` : 'Merged Script.txt';
  }

  const sorted = [...validIds].sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
    const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
    return numA - numB;
  });

  const firstV = sorted[0].toUpperCase();
  const lastV = sorted[sorted.length - 1].toUpperCase();

  if (firstV === lastV) {
    return `${firstV} Script.txt`;
  }
  return `${firstV} to ${lastV} Script.txt`;
}
