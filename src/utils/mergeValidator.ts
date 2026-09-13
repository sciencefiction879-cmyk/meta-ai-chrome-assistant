import { VTab, GeneratedPart } from '../types';

export interface ValidationCheck {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
}

export interface MergeValidationResult {
  valid: boolean;
  videoNumber: string;
  totalParts: number;
  completedPartsCount: number;
  missingParts: number[];
  checks: ValidationCheck[];
  errors: string[];
  warnings: string[];
  statusLabel: string;
}

/**
 * Validates a video's parts before merging according to strict 10-point rules:
 * 1. Correct video number
 * 2. Correct total number of parts
 * 3. Correct part numbering
 * 4. No missing parts
 * 5. No duplicated parts
 * 6. Correct sequential ordering
 * 7. Correct headings
 * 8. Correct script content assigned to each part
 * 9. Outline is NOT included as a script part
 * 10. No part from another video/chat included
 */
export function validateVideoMerge(tab: VTab): MergeValidationResult {
  const vNumber = tab.id || 'V1';
  const totalParts = tab.totalParts || 0;
  const parts = tab.parts || [];
  const checks: ValidationCheck[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  // Filter completed parts that have content
  const doneParts = parts.filter((p) => p.status === 'done' && p.content && p.content.trim().length > 0);

  // 1. Correct video number
  const hasValidVideoNumber = /^V\d+$/i.test(vNumber);
  checks.push({
    id: 'check-vnum',
    name: 'Correct Video Number',
    passed: hasValidVideoNumber,
    detail: hasValidVideoNumber ? `Video ID is verified as ${vNumber}` : `Invalid Video ID: ${vNumber}`
  });
  if (!hasValidVideoNumber) errors.push(`Invalid video ID: "${vNumber}". Expected format: V1, V2, etc.`);

  // 2. Correct total number of parts
  const hasTotal = totalParts > 0;
  checks.push({
    id: 'check-total',
    name: 'Total Parts Defined',
    passed: hasTotal,
    detail: hasTotal ? `Total parts detected/specified: ${totalParts}` : 'Total parts is undefined or 0'
  });
  if (!hasTotal) errors.push(`${vNumber}: Total parts count has not been detected or set.`);

  // 3 & 4. No missing parts (1..totalParts)
  const partNumbers = doneParts.map((p) => p.partNumber);
  const missingParts: number[] = [];
  if (totalParts > 0) {
    for (let i = 1; i <= totalParts; i++) {
      if (!partNumbers.includes(i)) {
        missingParts.push(i);
      }
    }
  } else {
    for (let i = 1; i <= doneParts.length; i++) {
      if (!partNumbers.includes(i)) {
        missingParts.push(i);
      }
    }
  }
  const noMissing = missingParts.length === 0 && doneParts.length > 0 && totalParts > 0;
  checks.push({
    id: 'check-missing',
    name: 'No Missing Parts',
    passed: noMissing,
    detail: noMissing ? `All ${totalParts} parts are present` : `MISSING: ${missingParts.map((n) => `${vNumber} P${n}`).join(', ')}`
  });
  if (!noMissing && missingParts.length > 0) {
    errors.push(`MISSING: ${missingParts.map((n) => `${vNumber} P${n}`).join(', ')}`);
  }

  // 5. No duplicated parts
  const duplicateNumbers = partNumbers.filter((item, index) => partNumbers.indexOf(item) !== index);
  const uniqueDuplicates = Array.from(new Set(duplicateNumbers));
  const noDuplicates = uniqueDuplicates.length === 0;
  checks.push({
    id: 'check-duplicates',
    name: 'No Duplicated Parts',
    passed: noDuplicates,
    detail: noDuplicates ? 'Zero duplicate parts' : `DUPLICATE: ${uniqueDuplicates.map((n) => `${vNumber} P${n}`).join(', ')}`
  });
  if (!noDuplicates) {
    errors.push(`DUPLICATE: ${uniqueDuplicates.map((n) => `${vNumber} P${n}`).join(', ')}`);
  }

  // 6. Correct sequential ordering
  const sortedCopy = [...doneParts].sort((a, b) => a.partNumber - b.partNumber);
  let isSequential = true;
  for (let i = 0; i < sortedCopy.length; i++) {
    if (sortedCopy[i].partNumber !== i + 1) {
      isSequential = false;
      break;
    }
  }
  checks.push({
    id: 'check-sequential',
    name: 'Sequential Ordering',
    passed: isSequential,
    detail: isSequential ? 'Strict 1..N numerical ordering confirmed' : 'Parts are out of order or contain gaps'
  });
  if (!isSequential) {
    errors.push(`${vNumber}: Parts sequence is non-contiguous or contains gaps.`);
  }

  // 7. Correct headings
  const missingHeadings = doneParts.filter((p) => !p.heading || p.heading.trim().length === 0 || /^part\s*\d+$/i.test(p.heading.trim()));
  const headingsOk = missingHeadings.length === 0;
  checks.push({
    id: 'check-headings',
    name: 'Content-Based Headings',
    passed: headingsOk,
    detail: headingsOk ? 'All parts have meaningful headings' : `${missingHeadings.length} part(s) using generic or empty heading`
  });
  if (!headingsOk) {
    warnings.push(`${vNumber}: Parts ${missingHeadings.map((p) => `P${p.partNumber}`).join(', ')} will be assigned intelligent content-based headings upon export.`);
  }

  // 8. Correct script content assigned
  const shortOrEmpty = doneParts.filter((p) => !p.content || p.content.trim().length < 25);
  const contentOk = shortOrEmpty.length === 0;
  checks.push({
    id: 'check-content',
    name: 'Complete Script Content',
    passed: contentOk,
    detail: contentOk ? 'All parts contain complete script prose' : `${shortOrEmpty.length} part(s) contain empty or partial content`
  });
  if (!contentOk) {
    errors.push(`${vNumber}: Part(s) ${shortOrEmpty.map((p) => `P${p.partNumber}`).join(', ')} have incomplete script content.`);
  }

  // 9. Outline is NOT included as a script part
  const outlineInParts = doneParts.some((p) => {
    const isP1 = p.partNumber === 1;
    const hasOutlineWord = /^(?:#+\s*)?(?:video\s+|script\s+)?outline\b/i.test(p.content.trim());
    return isP1 && hasOutlineWord && p.content.trim().length < 400;
  });
  checks.push({
    id: 'check-no-outline',
    name: 'Outline Isolated',
    passed: !outlineInParts,
    detail: !outlineInParts ? 'No outline is treated as a script part' : 'Part 1 appears to contain an outline instead of script prose'
  });
  if (outlineInParts) {
    errors.push(`${vNumber}: Part 1 appears to contain the Outline rather than actual script text. Wait for Part 1 generation.`);
  }

  // 10. No cross-video parts (Section 11)
  const currentVNum = parseInt(vNumber.replace(/\D/g, ''), 10) || 1;
  const crossVideoParts = doneParts.filter((p) => {
    if (p.videoNumber && p.videoNumber !== currentVNum) return true;
    if (p.explicitMarker) {
      const match = p.explicitMarker.match(/V(\d+)/i);
      if (match && parseInt(match[1], 10) !== currentVNum) return true;
    }
    return false;
  });
  const noCrossVideo = crossVideoParts.length === 0;
  checks.push({
    id: 'check-cross-video',
    name: 'Strict Video Isolation',
    passed: noCrossVideo,
    detail: noCrossVideo
      ? `All parts strictly isolated to ${vNumber}`
      : `Cross-video parts detected: ${crossVideoParts.map((p) => p.explicitMarker || `P${p.partNumber}`).join(', ')}`
  });
  if (!noCrossVideo) {
    errors.push(`${vNumber}: Foreign video parts detected: ${crossVideoParts.map((p) => p.explicitMarker || `P${p.partNumber}`).join(', ')}. Different videos must never be merged.`);
  }

  // Strict Validation: Expected Parts === Detected Completed Parts === Merged Parts
  const valid = totalParts > 0 &&
                doneParts.length === totalParts &&
                missingParts.length === 0 &&
                errors.length === 0;

  let statusLabel: string;
  if (valid) {
    statusLabel = 'TXT MERGE VERIFIED ✓';
  } else if (missingParts.length > 0) {
    statusLabel = `MERGE INCOMPLETE — ${missingParts.map((n) => `P${n}`).join(', ')} MISSING`;
  } else if (totalParts > 0 && doneParts.length < totalParts) {
    statusLabel = `MERGE INCOMPLETE — ${doneParts.length}/${totalParts} Parts (${totalParts - doneParts.length} Missing)`;
  } else if (errors.length > 0) {
    statusLabel = 'MERGE VALIDATION FAILED ✕';
  } else {
    statusLabel = 'IN PROGRESS ⏳';
  }

  return {
    valid,
    videoNumber: vNumber,
    totalParts,
    completedPartsCount: doneParts.length,
    missingParts,
    duplicateParts: uniqueDuplicates,
    checks,
    errors,
    warnings,
    statusLabel
  };
}
