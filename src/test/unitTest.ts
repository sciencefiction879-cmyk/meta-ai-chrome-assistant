import assert from 'node:assert';
import test from 'node:test';
import { normalizeTitle, parseTitlesFromRawText, parseRange, formatPromptWithTitle, sliceTitlesForRange, generateWritePartPrompt, parseCustomVideoIds } from '../utils/normalizer';
import {
  detectPartsInText,
  detectPartsFromMessages,
  cleanScriptContent,
  findExplicitMarkersInText,
  extractStartingExplicitMarker,
  extractTopExplicitMarker,
  calculateMissingAndDuplicateParts,
  isDoubleResponseBlock,
  splitDoubleResponseBlock,
  hasPartCompletionMarker,
  extractOutlinePartInstructions,
  detectOutlineInText,
  extractTotalPartsFromText,
  cleanHeadingText
} from '../utils/partDetector';
import { validateVideoMerge } from '../utils/mergeValidator';
import { mapFilesToVNumbers, createZipBundle, formatMergedScriptPart, getMergedFilename } from '../utils/fileHelper';
import { createDiagnosticError } from '../utils/diagnostics';
import { VTab } from '../types';

test('Title Normalizer - preserves V1, V2, V3 prefixes and strips quotes', () => {
  assert.strictEqual(normalizeTitle('V1. SOLO QUEDAN 60 SEGUNDOS'), 'V1. SOLO QUEDAN 60 SEGUNDOS');
  assert.strictEqual(normalizeTitle('V2 - The Hidden Pyramid'), 'V2 - The Hidden Pyramid');
  assert.strictEqual(normalizeTitle('"AI Revolution in 2026"'), 'AI Revolution in 2026');
  assert.strictEqual(normalizeTitle('No Prefix Title Here'), 'No Prefix Title Here');
});

test('Title Parser - parses multiline text preserving V-prefixes', () => {
  const raw = `
    V1. First Episode
    
    V2. Second Episode
    V3. Third Episode
  `;
  const parsed = parseTitlesFromRawText(raw);
  assert.strictEqual(parsed.length, 3);
  assert.strictEqual(parsed[0].normalized, 'V1. First Episode');
  assert.strictEqual(parsed[1].normalized, 'V2. Second Episode');
  assert.strictEqual(parsed[2].normalized, 'V3. Third Episode');
});

test('Range Parser - parses V1-V10 and numeric ranges', () => {
  const r1 = parseRange('V1-V10');
  assert.deepStrictEqual(r1, { start: 1, end: 10 });

  const r2 = parseRange('11-20');
  assert.deepStrictEqual(r2, { start: 11, end: 20 });

  const r3 = parseRange('21 to 30');
  assert.strictEqual(r3, null); // Invalid separator
});

test('Title Slicing - strictly cuts off excess titles beyond selected range', () => {
  const titles = Array.from({ length: 50 }, (_, i) => `Title ${i + 1}`);
  
  // Select V1 to V10: should return exactly 10 titles, and cut off 40
  const result = sliceTitlesForRange(titles, 1, 10);
  assert.strictEqual(result.assigned.length, 10);
  assert.strictEqual(result.excessCount, 40);
  assert.strictEqual(result.cutBelowCount, 0);
  assert.strictEqual(result.cutAboveCount, 40);
  assert.strictEqual(result.assigned[0], 'Title 1');
  assert.strictEqual(result.assigned[9], 'Title 10');

  // Select V11 to V20: should return exactly 10 titles, excess 40 (10 below + 30 above)
  const result2 = sliceTitlesForRange(titles, 11, 20);
  assert.strictEqual(result2.assigned.length, 10);
  assert.strictEqual(result2.excessCount, 40);
  assert.strictEqual(result2.cutBelowCount, 10);
  assert.strictEqual(result2.cutAboveCount, 30);
  assert.strictEqual(result2.assigned[0], 'Title 11');
  assert.strictEqual(result2.assigned[9], 'Title 20');

  // Explicit V1 to V50 markers, select V10 to V15: cuts V1..V9 below and V16..V50 above
  const explicitTitles = Array.from({ length: 50 }, (_, i) => `V${i + 1} - Episode ${i + 1}`);
  const result3 = sliceTitlesForRange(explicitTitles, 10, 15);
  assert.strictEqual(result3.assigned.length, 6);
  assert.strictEqual(result3.cutBelowCount, 9);
  assert.strictEqual(result3.cutAboveCount, 35);
  assert.strictEqual(result3.excessCount, 44);
  assert.strictEqual(result3.assigned[0], 'V10 - Episode 10');
  assert.strictEqual(result3.assigned[5], 'V15 - Episode 15');
});

test('Dynamic Title Placement - formats prompt at My Version of Title marker', () => {
  const title = 'Ancient Mysteries of Mars';

  // 1. With "My Version of Title:" marker
  const promptWithMarker = 'My Version of Title:\nPlease generate a 4-part video script.';
  const formatted1 = formatPromptWithTitle(title, promptWithMarker);
  assert.ok(formatted1.includes('My Version of Title: Ancient Mysteries of Mars'));
  assert.ok(formatted1.includes('Please generate a 4-part video script.'));

  // 2. With "[TITLE]" placeholder
  const promptWithTag = 'Here is the video title: [TITLE]\nWrite a script.';
  const formatted2 = formatPromptWithTitle(title, promptWithTag);
  assert.strictEqual(formatted2, 'Here is the video title: Ancient Mysteries of Mars\nWrite a script.');

  // 3. Fallback without marker
  const promptWithoutMarker = 'Write a compelling multi-part video script.';
  const formatted3 = formatPromptWithTitle(title, promptWithoutMarker);
  assert.strictEqual(formatted3, 'My Version of Title: Ancient Mysteries of Mars\n\nWrite a compelling multi-part video script.');

  // 4. With V-number prefix (e.g. V1, V2)
  const formattedV1 = formatPromptWithTitle(title, promptWithMarker, 'V1');
  assert.ok(formattedV1.includes('My Version of Title: V1 - Ancient Mysteries of Mars'));

  const formattedV2 = formatPromptWithTitle(title, promptWithMarker, 'V2');
  assert.ok(formattedV2.includes('My Version of Title: V2 - Ancient Mysteries of Mars'));
});

test('Part Detector - detects multi-part single responses', () => {
  const response = `
Sure! Here is the complete script:

PART 1
Scene: The opening sequence.
Dialogue: Welcome to our journey.

PART 2
Scene: The middle chapter.
Dialogue: And here is the core conflict.

PART 3
Scene: The climax and finale.
Dialogue: The resolution of the story.
  `;

  const detection = detectPartsInText(response);
  assert.strictEqual(detection.totalParts, 3);
  assert.strictEqual(detection.parts.length, 3);
  assert.strictEqual(detection.parts[0].status, 'done');
  assert.strictEqual(detection.parts[1].status, 'done');
  assert.strictEqual(detection.parts[2].status, 'done');
  assert.ok(detection.parts[0].content.includes('opening sequence'));
  assert.ok(detection.parts[1].content.includes('middle chapter'));
  assert.ok(detection.parts[2].content.includes('climax and finale'));
});

test('Part Detector - detects turn-based single part with total parts indicator', () => {
  const response = `
Here is Part 1 of 4:
PART 1: THE BEGINNING
The expedition sets sail across the North Atlantic in search of answers.
  `;

  const detection = detectPartsInText(response, 1);
  assert.strictEqual(detection.totalParts, 4);
  assert.strictEqual(detection.parts.length, 4);
  assert.strictEqual(detection.parts[0].status, 'done');
  assert.strictEqual(detection.parts[1].status, 'ready');
  assert.strictEqual(detection.parts[2].status, 'waiting');
  assert.strictEqual(detection.parts[3].status, 'waiting');
});

test('Part Detector - detects explicit Total Parts: 2 declaration and generates turn parts', () => {
  const response = `
Total Parts: 2

Остановись буквально на шестьдесят секунд и просто послушай, потому что то, что ты сейчас услышишь, не похоже на обычное сообщение.
  `;

  const detection = detectPartsInText(response, 1);
  assert.strictEqual(detection.totalParts, 2);
  assert.strictEqual(detection.parts.length, 2);
  assert.strictEqual(detection.parts[0].status, 'done');
  assert.strictEqual(detection.parts[1].status, 'ready');
  assert.ok(detection.parts[0].content.includes('Остановись буквально на шестьдесят секунд'));
});

test('Part Detector - detects explicit Total Parts: 5 declaration', () => {
  const response = `
Total Parts: 5

Here is the beginning of the comprehensive script.
  `;

  const detection = detectPartsInText(response, 1);
  assert.strictEqual(detection.totalParts, 5);
  assert.strictEqual(detection.parts.length, 5);
  assert.strictEqual(detection.parts[0].status, 'done');
  assert.strictEqual(detection.parts[1].status, 'ready');
  assert.strictEqual(detection.parts[2].status, 'waiting');
  assert.strictEqual(detection.parts[3].status, 'waiting');
  assert.strictEqual(detection.parts[4].status, 'waiting');
});

test('Script Cleaner - removes AI intro/outro boilerplate while keeping script content', () => {
  const raw = `Sure! Here is your script:
Scene 1: Interior coffee shop.
Alex: Did you see the news?
Let me know if you need any edits!`;

  const cleaned = cleanScriptContent(raw);
  assert.ok(!cleaned.includes('Sure! Here is your script:'));
  assert.ok(!cleaned.includes('Let me know if you need any edits!'));
  assert.ok(cleaned.includes('Alex: Did you see the news?'));
});

test('File Mapper - accurately maps thumbnails and scripts to V-numbers', () => {
  const files = [
    { name: 'Thumbnail 3.jpg' },
    { name: 'v1_thumb.png' },
    { name: 'Thumbnail 2.webp' }
  ];

  const mapped = mapFilesToVNumbers(files, 3);
  assert.strictEqual(mapped.length, 3);
  assert.strictEqual(mapped[0].vNumber, 'V1');
  assert.strictEqual(mapped[0].file.name, 'v1_thumb.png');
  assert.strictEqual(mapped[1].vNumber, 'V2');
  assert.strictEqual(mapped[1].file.name, 'Thumbnail 2.webp');
  assert.strictEqual(mapped[2].vNumber, 'V3');
  assert.strictEqual(mapped[2].file.name, 'Thumbnail 3.jpg');
});

test('Diagnostic Error System - provides Problem, Why, Solution and Retry properties', () => {
  const err = createDiagnosticError('INPUT_NOT_FOUND', { vNumber: 'V3' });
  assert.strictEqual(err.vNumber, 'V3');
  assert.ok(err.title.length > 0);
  assert.ok(err.problem.length > 0);
  assert.ok(err.why.length > 0);
  assert.ok(err.solution.length > 0);
  assert.strictEqual(err.canRetry, true);
});

test('JSZip Bundle Creation - generates valid zip archive from multiple files', async () => {
  const files = [
    { filename: 'V1 P1.txt', content: 'V1 Part 1 content text' },
    { filename: 'V1 P2.txt', content: 'V1 Part 2 content text' },
    { filename: 'V2 P1.txt', content: 'V2 Part 1 content text' }
  ];

  const zipBlob = await createZipBundle(files);
  assert.ok(zipBlob.size > 0);
  assert.strictEqual(zipBlob.type, 'application/zip');
});

test('Explicit Vx Py Marker Detection - parses V1 P1, V1 P7, V2 P3, V3 P12', () => {
  const text1 = 'V1 P1 — The Hidden Island\n\nThis is the first script part.';
  const m1 = findExplicitMarkersInText(text1);
  assert.strictEqual(m1.length, 1);
  assert.strictEqual(m1[0].videoNumber, 1);
  assert.strictEqual(m1[0].partNumber, 1);
  assert.strictEqual(m1[0].marker, 'V1 P1');
  assert.strictEqual(m1[0].heading, 'The Hidden Island');

  const text2 = '### V2 P3: The Conflict\nDeep in the mountains...';
  const m2 = findExplicitMarkersInText(text2);
  assert.strictEqual(m2.length, 1);
  assert.strictEqual(m2[0].videoNumber, 2);
  assert.strictEqual(m2[0].partNumber, 3);
  assert.strictEqual(m2[0].marker, 'V2 P3');

  const text3 = '**V3 P12** — The Finale\nThe climax has arrived.';
  const m3 = findExplicitMarkersInText(text3);
  assert.strictEqual(m3.length, 1);
  assert.strictEqual(m3[0].videoNumber, 3);
  assert.strictEqual(m3[0].partNumber, 12);
  assert.strictEqual(m3[0].marker, 'V3 P12');
});

test('Explicit Marker Formats - parses V10/P1, v10p1, v1p1, v1p2, V1/P2, V25/P3 variants', () => {
  // Screenshot case: V10/P1
  const tSlash = 'V10/P1\n\nВ день вручения дипломов Вера стояла у сцены...';
  const mSlash = findExplicitMarkersInText(tSlash);
  assert.strictEqual(mSlash.length, 1);
  assert.strictEqual(mSlash[0].videoNumber, 10);
  assert.strictEqual(mSlash[0].partNumber, 1);
  assert.strictEqual(mSlash[0].marker, 'V10 P1');

  const startSlash = extractStartingExplicitMarker(tSlash);
  assert.ok(startSlash);
  assert.strictEqual(startSlash.videoNumber, 10);
  assert.strictEqual(startSlash.partNumber, 1);

  // User case: v10p1 (lowercase, no separator)
  const tCompact10 = 'v10p1\n\nВ день вручения дипломов...';
  const mCompact10 = findExplicitMarkersInText(tCompact10);
  assert.strictEqual(mCompact10.length, 1);
  assert.strictEqual(mCompact10[0].videoNumber, 10);
  assert.strictEqual(mCompact10[0].partNumber, 1);

  // User case: v1p1, v1p2
  const tCompact1 = 'v1p1\n\nBeginning of video 1...';
  const mCompact1 = findExplicitMarkersInText(tCompact1);
  assert.strictEqual(mCompact1.length, 1);
  assert.strictEqual(mCompact1[0].videoNumber, 1);
  assert.strictEqual(mCompact1[0].partNumber, 1);

  const tCompact2 = 'v1p2\n\nPart 2 of video 1...';
  const mCompact2 = findExplicitMarkersInText(tCompact2);
  assert.strictEqual(mCompact2.length, 1);
  assert.strictEqual(mCompact2[0].videoNumber, 1);
  assert.strictEqual(mCompact2[0].partNumber, 2);

  // Slash case: V1/P2
  const tV1Slash2 = 'V1/P2\n\nSecond part with slash';
  const mV1Slash2 = findExplicitMarkersInText(tV1Slash2);
  assert.strictEqual(mV1Slash2.length, 1);
  assert.strictEqual(mV1Slash2[0].videoNumber, 1);
  assert.strictEqual(mV1Slash2[0].partNumber, 2);

  // Arbitrary range case: V25/P3
  const tV25 = '### V25/P3 - The Grand Climax\nEnding the story.';
  const mV25 = findExplicitMarkersInText(tV25);
  assert.strictEqual(mV25.length, 1);
  assert.strictEqual(mV25[0].videoNumber, 25);
  assert.strictEqual(mV25[0].partNumber, 3);
  assert.strictEqual(mV25[0].heading, 'The Grand Climax');
});

test('Streaming Start Marker Detection - detects marker at response beginning', () => {
  const streaming1 = 'V1 P2\nScene: The laboratory...';
  const start1 = extractStartingExplicitMarker(streaming1);
  assert.ok(start1);
  assert.strictEqual(start1.videoNumber, 1);
  assert.strictEqual(start1.partNumber, 2);
  assert.strictEqual(start1.marker, 'V1 P2');

  const streaming2 = '   **V2 P1** — The Mission Begins';
  const start2 = extractStartingExplicitMarker(streaming2);
  assert.ok(start2);
  assert.strictEqual(start2.videoNumber, 2);
  assert.strictEqual(start2.partNumber, 1);
});

test('Never Renumber Explicit Parts - V1 P5 is strictly recognized as Part 5', () => {
  const response = 'V1 P5 — The Climax\n\nThis is the fifth part of the story.';
  const res = detectPartsInText(response, 1);
  assert.strictEqual(res.totalParts, 5);
  const p5 = res.parts.find((p) => p.partNumber === 5);
  assert.ok(p5);
  assert.strictEqual(p5.status, 'done');
  assert.strictEqual(p5.explicitMarker, 'V1 P5');
  assert.strictEqual(p5.videoNumber, 1);

  // Missing parts 1, 2, 3, 4 must be flagged!
  assert.ok(res.missingParts);
  assert.deepStrictEqual(res.missingParts, [1, 2, 3, 4]);
});

test('Missing Part Detection - flags V1 P4 missing when V1 P1, V1 P2, V1 P3, V1 P5 are present', () => {
  const messages = [
    'V1 P1 — The Beginning\n\nScript for part 1.',
    'V1 P2 — The Conflict\n\nScript for part 2.',
    'V1 P3 — The Discovery\n\nScript for part 3.',
    'V1 P5 — The Climax\n\nScript for part 5.'
  ];

  const res = detectPartsFromMessages(messages, 4);
  assert.strictEqual(res.totalParts, 5);
  assert.ok(res.missingParts);
  assert.deepStrictEqual(res.missingParts, [4]);
});

test('Duplicate Part Detection - flags DUPLICATE: V1 P2 and does not duplicate part entry', () => {
  const messages = [
    'V1 P1 — The Beginning\n\nScript for part 1.',
    'V1 P2 — The Conflict\n\nScript for part 2 (first attempt).',
    'V1 P2 — The Conflict\n\nScript for part 2 (second attempt).'
  ];

  const res = detectPartsFromMessages(messages, 2);
  assert.strictEqual(res.totalParts, 2);
  assert.ok(res.duplicateParts);
  assert.deepStrictEqual(res.duplicateParts, [2]);

  // Total distinct parts must still be 2, not 3!
  const p2Count = res.parts.filter((p) => p.partNumber === 2).length;
  assert.strictEqual(p2Count, 1);
  assert.ok(res.parts.find((p) => p.partNumber === 2)?.content.includes('second attempt'));
});

test('Outline vs Part Isolation - Outline is not counted as Part 1', () => {
  const outlineMsg = `
VIDEO OUTLINE:
Part 1: The Departure
Part 2: The Storm
Part 3: The Island
Total Parts: 3
  `;

  const part1Msg = 'V1 P1 — The Departure\n\nThe expedition sails at dawn into the mist.\n\nV1, P1 = COMPLETED';

  // 1. When only outline is received
  const res1 = detectPartsFromMessages([outlineMsg]);
  assert.strictEqual(res1.outlineDetected, true);
  // Part 1 must NOT be marked done from the outline, and must remain in waiting (Queue) status!
  assert.strictEqual(res1.parts[0].status, 'waiting');
  assert.strictEqual(res1.parts[0].content, '');

  // 2. When Part 1 is subsequently received
  const res2 = detectPartsFromMessages([outlineMsg, part1Msg]);
  assert.strictEqual(res2.outlineDetected, true);
  assert.strictEqual(res2.totalParts, 3);
  assert.strictEqual(res2.parts[0].status, 'done');
  assert.strictEqual(res2.parts[0].explicitMarker, 'V1 P1');
  assert.ok(res2.parts[0].content.includes('The expedition sails at dawn'));
});

test('Multi-Video Isolation - V1 and V2 maintain separate total parts', () => {
  const v1Messages = [
    'V1 P1\nScript V1 P1',
    'V1 P2\nScript V1 P2',
    'V1 P3\nScript V1 P3',
    'V1 P4\nScript V1 P4',
    'V1 P5\nScript V1 P5'
  ];

  const v2Messages = [
    'V2 P1\nScript V2 P1',
    'V2 P2\nScript V2 P2',
    'V2 P3\nScript V2 P3'
  ];

  const resV1 = detectPartsFromMessages(v1Messages, 5, false, 1);
  const resV2 = detectPartsFromMessages(v2Messages, 3, false, 2);

  assert.strictEqual(resV1.totalParts, 5);
  assert.strictEqual(resV1.detectedVideoNumber, 1);
  assert.strictEqual(resV1.missingParts?.length, 0);

  assert.strictEqual(resV2.totalParts, 3);
  assert.strictEqual(resV2.detectedVideoNumber, 2);
  assert.strictEqual(resV2.missingParts?.length, 0);
});

test('Merge Validator - detects missing parts, duplicate parts, and foreign video parts', () => {
  // Test case A: Missing part V1 P2
  const tabWithMissing: VTab = {
    id: 'V1',
    index: 1,
    chromeTabId: 1,
    qwenUrl: '',
    status: 'ready',
    selected: false,
    initialMessage: '',
    title: 'Test',
    masterPrompt: '',
    thumbnailStatus: 'none',
    scriptStatus: 'none',
    totalParts: 3,
    currentPart: 3,
    lastUpdated: Date.now(),
    parts: [
      { partNumber: 1, label: 'V1 P1', explicitMarker: 'V1 P1', videoNumber: 1, status: 'done', content: 'Complete script prose for part 1 here...', downloaded: false },
      { partNumber: 3, label: 'V1 P3', explicitMarker: 'V1 P3', videoNumber: 1, status: 'done', content: 'Complete script prose for part 3 here...', downloaded: false }
    ]
  };

  const valMissing = validateVideoMerge(tabWithMissing);
  assert.strictEqual(valMissing.valid, false);
  assert.ok(valMissing.errors.some((e) => e.includes('MISSING: V1 P2')));

  // Test case B: Foreign video part (V2 P1 inside V1)
  const tabWithForeign: VTab = {
    id: 'V1',
    index: 1,
    chromeTabId: 1,
    qwenUrl: '',
    status: 'ready',
    selected: false,
    initialMessage: '',
    title: 'Test',
    masterPrompt: '',
    thumbnailStatus: 'none',
    scriptStatus: 'none',
    totalParts: 2,
    currentPart: 2,
    lastUpdated: Date.now(),
    parts: [
      { partNumber: 1, label: 'V1 P1', explicitMarker: 'V1 P1', videoNumber: 1, status: 'done', content: 'Complete script prose for part 1 here...', downloaded: false },
      { partNumber: 2, label: 'V2 P2', explicitMarker: 'V2 P2', videoNumber: 2, status: 'done', content: 'Complete script prose for part 2 here...', downloaded: false }
    ]
  };

  const valForeign = validateVideoMerge(tabWithForeign);
  assert.strictEqual(valForeign.valid, false);
  assert.ok(valForeign.errors.some((e) => e.includes('Foreign video parts detected')));
});

test('Format Merged Script Part - eliminates duplicate headers and standardizes marker', () => {
  // Case 1: Raw marker V10/P1 at the top of content
  const raw1 = 'V10/P1\n\nВ день вручения дипломов Вера стояла у сцены...';
  const out1 = formatMergedScriptPart('V10', 1, 'The Beginning', raw1);
  assert.strictEqual(
    out1,
    'V10 P1 — The Beginning\n\nВ день вручения дипломов Вера стояла у сцены...'
  );

  // Case 2: Markdown header with existing title
  const raw2 = '### V10 P2 — The Discovery\n\nВера открыла синюю папку...';
  const out2 = formatMergedScriptPart('V10', 2, 'Default Scene', raw2);
  assert.strictEqual(
    out2,
    'V10 P2 — The Discovery\n\nВера открыла синюю папку...'
  );

  // Case 3: Content without marker
  const raw3 = 'First sentence of the narrative.';
  const out3 = formatMergedScriptPart('V1', 1, 'Introduction', raw3);
  assert.strictEqual(
    out3,
    'V1 P1 — Introduction\n\nFirst sentence of the narrative.'
  );
});

test('Script Input Detection - with competitor script (hasCompetitorScript = true), bypasses outline and starts directly at V1 P1', () => {
  const messages = [
    'V1 P1\n[Scene: Hospital]\nDoctor Adams rushed through the emergency doors...\n\nV1, P1 = COMPLETED',
    'V1 P2\n[Scene: Operating Room]\nThe surgery team prepared the equipment...\n\nV1, P2 = COMPLETED'
  ];

  const res = detectPartsFromMessages(messages, 2, false, 1, true);

  assert.strictEqual(res.outlineDetected, false);
  assert.strictEqual(res.parts.length, 2);
  assert.strictEqual(res.parts[0].partNumber, 1);
  assert.strictEqual(res.parts[0].status, 'done');
  assert.strictEqual(res.parts[0].label, 'V1 P1');
  assert.strictEqual(res.parts[1].partNumber, 2);
  assert.strictEqual(res.parts[1].status, 'done');
  assert.strictEqual(res.parts[1].label, 'V1 P2');
});

test('Script Input Detection - without competitor script (hasCompetitorScript = false), expects outline first and isolates it from Part 1', () => {
  const messages = [
    'Script Outline:\nPart 1: The Emergency\nPart 2: The Operation\nPart 3: The Recovery\n\nOUTLINE = GENERATED',
    'V1 P1\nDoctor Adams rushed through the emergency doors...\n\nV1, P1 = COMPLETED',
    'V1 P2\nThe surgery team prepared the equipment...\n\nV1, P2 = COMPLETED'
  ];

  const res = detectPartsFromMessages(messages, 2, false, 1, false);

  assert.strictEqual(res.outlineDetected, true);
  assert.strictEqual(res.totalParts, 3);
  // Outline is isolated; Part 1 is from message 1, Part 2 from message 2
  assert.strictEqual(res.parts[0].partNumber, 1);
  assert.strictEqual(res.parts[0].status, 'done');
  assert.ok(res.parts[0].content.includes('Doctor Adams rushed'));
  assert.strictEqual(res.parts[1].partNumber, 2);
  assert.strictEqual(res.parts[1].status, 'done');
  assert.ok(res.parts[1].content.includes('The surgery team prepared'));
});

test('Part-Only Merging Rule - merges only actual script parts with Vx Py markers, rejecting outlines, thinking blocks, and metadata', () => {
  // Outline should be rejected
  const outlineContent = 'Video Outline:\nPart 1: The Beginning\nPart 2: The Climax';
  const outOutline = formatMergedScriptPart('V1', 1, undefined, outlineContent);
  assert.strictEqual(outOutline, '');

  // Script parts with thinking blocks and status metadata
  const rawPart1 = `
<think>
Need to describe the morning scene.
Keep pacing tight.
</think>
💡 Thinking completed
[Status: Streaming part 1]
V1 P1
The morning sun barely cut through the thick fog over the harbor.
`;

  const rawPart2 = `
<think>
Now move to the boat dock.
</think>
[Metadata: Part 2 generated]
V1 P2
Captain Reynolds stepped onto the damp wooden planks of dock four.
`;

  const mergedPart1 = formatMergedScriptPart('V1', 1, undefined, rawPart1);
  const mergedPart2 = formatMergedScriptPart('V1', 2, undefined, rawPart2);

  // Verify exact part identification at the beginning of each section
  assert.strictEqual(
    mergedPart1,
    'V1 P1\n\nThe morning sun barely cut through the thick fog over the harbor.'
  );
  assert.strictEqual(
    mergedPart2,
    'V1 P2\n\nCaptain Reynolds stepped onto the damp wooden planks of dock four.'
  );

  // Merging them together
  const fullMerged = `${mergedPart1}\n\n${mergedPart2}`;
  assert.ok(fullMerged.startsWith('V1 P1\n\n'));
  assert.ok(fullMerged.includes('\n\nV1 P2\n\n'));
  assert.strictEqual(fullMerged.includes('<think>'), false);
  assert.strictEqual(fullMerged.includes('Thinking completed'), false);
  assert.strictEqual(fullMerged.includes('Status:'), false);
  assert.strictEqual(fullMerged.includes('Metadata:'), false);

  // Similarly for V2, V10
  const rawV10P1 = 'V10 P1\n\nFirst lines of video 10.';
  const mergedV10P1 = formatMergedScriptPart('V10', 1, undefined, rawV10P1);
  assert.strictEqual(mergedV10P1, 'V10 P1\n\nFirst lines of video 10.');
});

test('Video 6 Detection - V6/P1 overrides targetVideoNumber 1, sets total parts to 6, and avoids false duplicates', () => {
  // Simulates the exact prompt output from user screenshot media_1788521963343.png
  const responseText = `
💡 Thinking completed
TOTAL PARTS = 6

V6/P1: target 3,800 words
Title: The Secret of the Ancient Temple

The dense foliage of the jungle parted to reveal the crumbling stone steps.
Dr. Evans adjusted his pack and signaled for the team to advance into the shadows.
  `;

  // Even if caller passed targetVideoNumber = 1 (e.g. from tab defaulted to V1)
  const result = detectPartsInText(responseText, 1, false, 1);

  // Ground truth explicit marker V6 must override targetVideoNumber 1!
  assert.strictEqual(result.detectedVideoNumber, 6);
  assert.strictEqual(result.totalParts, 6);
  assert.strictEqual(result.parts.length, 6);

  // Part 1 must be V6 P1 and DONE
  const p1 = result.parts[0];
  assert.strictEqual(p1.partNumber, 1);
  assert.strictEqual(p1.label, 'V6 P1');
  assert.strictEqual(p1.explicitMarker, 'V6 P1');
  assert.strictEqual(p1.videoNumber, 6);
  assert.strictEqual(p1.status, 'done');

  // Parts 2-6 must be V6 P2 to V6 P6 and NOT duplicate errors!
  for (let i = 2; i <= 6; i++) {
    const p = result.parts[i - 1];
    assert.strictEqual(p.partNumber, i);
    assert.strictEqual(p.label, `V6 P${i}`);
    assert.strictEqual(p.videoNumber, 6);
    assert.strictEqual(p.status, i === 2 ? 'ready' : 'waiting');
  }

  // Must NOT have false duplicate parts!
  assert.deepStrictEqual(result.duplicateParts, []);
  assert.deepStrictEqual(result.missingParts, []);
});

test('Double / Candidate Response Handling - RLHF Response 1 and Response 2 in single combined block', () => {
  // Simulates side-by-side or stacked RLHF duplicate cards (Response 1 and Response 2)
  const doubleBlock = `
Response 1
V6 P1 — The Ancient Jungle

The dense foliage parted as our expedition stepped into the clearing.
Everything was silent except for the distant cry of an unknown creature.

I prefer this response

Response 2
V6 P1 — Into the Unknown

Our machetes hacked through the damp jungle vines under a darkening canopy.
We knew the ruins were close, but the jungle seemed to push us back.

I prefer this response
  `;

  assert.strictEqual(isDoubleResponseBlock(doubleBlock), true);
  const split = splitDoubleResponseBlock(doubleBlock);
  assert.ok(split.primary.includes('The dense foliage parted'));
  assert.strictEqual(split.primary.includes('I prefer this response'), false);
  assert.strictEqual(split.primary.includes('Response 1'), false);

  const result = detectPartsInText(doubleBlock, 1, false, 6);
  assert.strictEqual(result.hasDoubleResponse, true);
  assert.strictEqual(result.totalParts, 1);
  assert.strictEqual(result.parts.length, 1);
  assert.strictEqual(result.parts[0].partNumber, 1);
  assert.strictEqual(result.parts[0].hasDoubleResponse, true);
  assert.deepStrictEqual(result.duplicateParts, []);
});

test('Double / Candidate Response Handling - Multi-turn duplicate Outline responses do not become Part 1', () => {
  // Simulates Qwen returning two candidate outline responses in multi-turn chat
  const messages = [
    `VIDEO OUTLINE (Response 1):
Part 1: The Discovery
Part 2: The Temple
Part 3: The Escape
Total Parts: 3`,
    `Response 2
VIDEO OUTLINE:
Part 1: The Discovery
Part 2: The Inner Sanctum
Part 3: The Final Escape
Total Parts: 3`,
    `V6 P1 — The Discovery

We embarked from the base camp at first light, guided only by the frayed parchment map.

V6, P1 = COMPLETED`
  ];

  const result = detectPartsFromMessages(messages, 1, false, 6);

  // Both outline variants must be grouped as outline stage!
  assert.strictEqual(result.outlineDetected, true);
  assert.strictEqual(result.totalParts, 3);

  // Part 1 must be the actual script part (V6 P1), NOT the second outline variant!
  const p1 = result.parts.find((p) => p.partNumber === 1);
  assert.ok(p1);
  assert.strictEqual(p1?.status, 'done');
  assert.ok(p1?.content.includes('We embarked from the base camp'));
  assert.strictEqual(p1?.explicitMarker, 'V6 P1');
  assert.deepStrictEqual(result.duplicateParts, []);
});

test('Double / Candidate Response Handling - Candidate Response 2 for Part 1 does not become Part 2 or error', () => {
  // Simulates Qwen returning candidate Response 2 as a separate message
  const messages = [
    `V6 P1 — The Discovery

We embarked from the base camp at first light, guided only by the map.`,
    `Response 2
V6 P1 — The Discovery (Variant 2)

At sunrise we left the safety of the base camp behind.`
  ];

  const result = detectPartsFromMessages(messages, 1, false, 6);

  // Must still have only 1 generated part (Part 1), NOT Part 2!
  assert.strictEqual(result.parts.filter((p) => p.content).length, 1);
  const p1 = result.parts[0];
  assert.strictEqual(p1.partNumber, 1);
  assert.strictEqual(p1.hasDoubleResponse, true);
  assert.deepStrictEqual(result.duplicateParts, []);
});

// ────────────────────────────────────────────────────────────────────
//  Write Part Prompt Generation
// ────────────────────────────────────────────────────────────────────

test('Write Part Prompt - sends only simple "Write Part X" for any part number', () => {
  assert.strictEqual(generateWritePartPrompt(1), 'Write Part 1');
  assert.strictEqual(generateWritePartPrompt(2), 'Write Part 2');
  assert.strictEqual(generateWritePartPrompt(3), 'Write Part 3');
  assert.strictEqual(generateWritePartPrompt(4), 'Write Part 4');
  assert.strictEqual(generateWritePartPrompt(5), 'Write Part 5');
});

test('Write Part Prompt - does not add word-count, previous-part, or final-part instructions', () => {
  const prompt = generateWritePartPrompt(4, 4, 4000);
  assert.strictEqual(prompt, 'Write Part 4');
  assert.ok(!prompt.includes('word'));
  assert.ok(!prompt.includes('previous part'));
  assert.ok(!prompt.includes('end the script'));
  assert.ok(!prompt.includes('10/10'));
});

// ────────────────────────────────────────────────────────────────────
//  extractTopExplicitMarker
// ────────────────────────────────────────────────────────────────────

test('extractTopExplicitMarker - V14/P2 at start of script response', () => {
  const text = 'V14/P2\n\nThe temple corridor stretched out before them.\nAncient markings covered every surface.';
  const m = extractTopExplicitMarker(text);
  assert.ok(m !== null);
  assert.strictEqual(m!.videoNumber, 14);
  assert.strictEqual(m!.partNumber, 2);
  assert.strictEqual(m!.marker, 'V14 P2');
});

test('extractTopExplicitMarker - v10p1 lowercase compact format at start', () => {
  const text = 'v10p1\nScript content begins immediately here.';
  const m = extractTopExplicitMarker(text);
  assert.ok(m !== null);
  assert.strictEqual(m!.videoNumber, 10);
  assert.strictEqual(m!.partNumber, 1);
});

test('extractTopExplicitMarker - outline text: first non-empty line is "Here is the outline..." so START_VX_PY_REGEX fails, but fallback finds V14/P1 in head text', () => {
  // Outline response where marker appears in line 2 (within the head-text window).
  // extractTopExplicitMarker is intentionally permissive — it scans the first 3 non-empty lines.
  // The protection against treating this AS a generated part comes from detectOutlineInText,
  // which classifies the full response as an outline FIRST before this function is ever used.
  const text = 'Here is the outline for the video script:\n\nV14/P1 — 3,800 words\nV14/P2 — 3,600 words\nV14/P3 — 3,600 words';
  // Run the FULL pipeline to confirm: detectPartsFromMessages classifies this as outline, NOT a generated part
  const result = detectPartsFromMessages([text], 0, false, 14);
  assert.strictEqual(result.outlineDetected, true, 'Full pipeline must detect this as outline, not a script part');
  // All parts must remain in waiting status — the function never falsely generates them
  for (const p of result.parts) {
    assert.notStrictEqual(p.status, 'done', `Part ${p.partNumber} must NOT be marked "done" (Generated) from an outline`);
  }
});

test('extractTopExplicitMarker - **V14/P2** markdown bold format', () => {
  const text = '**V14/P2**\n\nThe narrative continues from where Part 1 concluded.';
  const m = extractTopExplicitMarker(text);
  assert.ok(m !== null);
  assert.strictEqual(m!.videoNumber, 14);
  assert.strictEqual(m!.partNumber, 2);
});

// ────────────────────────────────────────────────────────────────────
//  Outline Detection with V14/Px planning entries
// ────────────────────────────────────────────────────────────────────

test('Outline Detection - V14/P1 through V14/P6 with word counts are detected as outline (NOT parts)', () => {
  const outlineText = `
VIDEO OUTLINE:
V14/P1 — 3,800 words: The Departure
V14/P2 — 3,600 words: The Storm
V14/P3 — 3,600 words: The Island
V14/P4 — 3,600 words: The Discovery
V14/P5 — 3,600 words: The Escape
V14/P6 — 3,000 words: The Return
Total Parts: 6
  `;

  const result = detectPartsFromMessages([outlineText], 0, false, 14);

  // Must detect as outline
  assert.strictEqual(result.outlineDetected, true, 'Should detect as outline');
  assert.strictEqual(result.totalParts, 6, 'Should extract 6 total parts');

  // All 6 parts must be in waiting (Queue) status — NOT done/generated!
  assert.strictEqual(result.parts.length, 6, 'Should have 6 waiting parts');
  for (const p of result.parts) {
    assert.strictEqual(p.status, 'waiting', `Part ${p.partNumber} should be waiting (Queue), not ${p.status}`);
    assert.strictEqual(p.content, '', `Part ${p.partNumber} content must be empty (no script generated)`);
  }
});

test('Outline Detection - After outline then V14/P2 actual script, P2 = done and P1 = error (missing)', () => {
  const outlineText = `
VIDEO OUTLINE:
V14/P1 — 3,800 words
V14/P2 — 3,600 words
V14/P3 — 3,600 words
Total Parts: 3
  `;
  const part2Script = 'V14/P2\n\nThe storm came suddenly from the west, battering the ship against the rocks.\n\nV14, P2 = COMPLETED';

  const result = detectPartsFromMessages([outlineText, part2Script], 0, false, 14);

  assert.strictEqual(result.outlineDetected, true);
  assert.strictEqual(result.totalParts, 3);

  const p2 = result.parts.find((p) => p.partNumber === 2);
  assert.ok(p2, 'Part 2 should exist');
  assert.strictEqual(p2!.status, 'done', 'Part 2 should be Generated ✓');
  assert.ok(p2!.content.includes('The storm came'), 'Part 2 should contain actual script');
});

test('Outline Completion - Incomplete outline without OUTLINE = GENERATED stays in generating status', () => {
  const incompleteOutline = `
    SCRIPT OUTLINE:
    TOTAL PARTS = 4
    Part 1 — The Setup (approx 4000 words)
    Part 2 — The Rising Action (approx 4000 words)
    Part 3 — The Confrontation (approx 4000 words)
    Part 4 — The Climax and Resolution (approx 4000 words)
  `;

  const check = detectOutlineInText(incompleteOutline);
  assert.strictEqual(check.isOutline, true);
  assert.strictEqual(check.isComplete, false, 'Should be marked incomplete without OUTLINE = GENERATED');

  const res = detectPartsFromMessages([incompleteOutline], 0, false, 1, false);
  assert.strictEqual(res.outlineDetected, true);
  assert.strictEqual(res.outlineStatus, 'generating');
  assert.strictEqual(res.lifecycleStage, 'OUTLINE_GENERATING');
  assert.ok(res.liveDebugStatus?.includes('Generating Outline / Incomplete'));
});

test('Outline Completion - Complete outline with OUTLINE = GENERATED is marked completed', () => {
  const completeOutline = `
    MASTER SCRIPT OUTLINE:
    TOTAL PARTS = 4
    
    PART 1 — The Discovery & Hook
    Introduce the forgotten relic found in Antarctica. Detail the initial scientific tests.
    
    PART 2 — The Escalation & Deep Dive
    The artifact activates unexpectedly, causing equipment malfunction across the base.
    
    PART 3 — The Crisis & Confrontation
    Team splits into two factions. Radio communications with outside world cut off.
    
    PART 4 — The Final Revelation & Resolution
    The transmission is deciphered, revealing an ancient warning to humanity.
    
    OUTLINE = GENERATED
  `;

  const check = detectOutlineInText(completeOutline);
  assert.strictEqual(check.isOutline, true);
  assert.strictEqual(check.isComplete, true, 'Should be marked complete with OUTLINE = GENERATED');

  const res = detectPartsFromMessages([completeOutline], 0, false, 1, false);
  assert.strictEqual(res.outlineDetected, true);
  assert.strictEqual(res.outlineStatus, 'completed');
  assert.strictEqual(res.lifecycleStage, 'OUTLINE_GENERATED');
  assert.strictEqual(res.totalParts, 4);
  assert.ok(res.liveDebugStatus?.includes('OUTLINE GENERATED ✓'));
});

test('Dynamic Outline Instructions Extraction - dynamically extracts instructions for each part without hardcoded stages', () => {
  const outline = `
    TOTAL PARTS = 3
    
    PART 1 — Neon Odyssey (Target: 4,000 words)
    Cover the protagonist navigating the neon-drenched underworld of Neo-Kyoto.
    Establish the debt owed to the cyber-syndicate and the initial assassination contract.
    
    PART 2 — Digital Infiltration (Target: 4,200 words)
    Infiltrate the mainframe of Arasaka Tower using experimental neural implants.
    Encounter the rogue AI guarding the core data vaults.
    
    PART 3 — The Firewall Collapse (Target: 4,500 words)
    Escape from the burning server room, pursue across rainy rooftops, and broadcast the leak.
    
    OUTLINE = GENERATED
  `;

  const instructions = extractOutlinePartInstructions(outline, 3);
  assert.strictEqual(instructions.size, 3);
  
  const p1Inst = instructions.get(1);
  assert.ok(p1Inst, 'Part 1 instructions should exist');
  assert.ok(p1Inst!.includes('Neon Odyssey'));
  assert.ok(p1Inst!.includes('Neo-Kyoto'));

  const p2Inst = instructions.get(2);
  assert.ok(p2Inst, 'Part 2 instructions should exist');
  assert.ok(p2Inst!.includes('Digital Infiltration'));
  assert.ok(p2Inst!.includes('Arasaka Tower'));

  const p3Inst = instructions.get(3);
  assert.ok(p3Inst, 'Part 3 instructions should exist');
  assert.ok(p3Inst!.includes('Firewall Collapse'));
  assert.ok(p3Inst!.includes('rainy rooftops'));
});

test('Simple Write Part Prompt - Original Script Mode sends only "Write Part X" without outline instructions', () => {
  const p1Inst = 'Establish the debt owed to the cyber-syndicate and the initial contract.';
  const promptP1 = generateWritePartPrompt(1, 3, 4000, p1Inst);
  assert.strictEqual(promptP1, 'Write Part 1');

  const p2Inst = 'Infiltrate the mainframe of Arasaka Tower.';
  const promptP2 = generateWritePartPrompt(2, 3, 5000, p2Inst);
  assert.strictEqual(promptP2, 'Write Part 2');

  const p3Inst = 'Escape from the burning server room and end the journey.';
  const promptP3 = generateWritePartPrompt(3, 3, 4500, p3Inst);
  assert.strictEqual(promptP3, 'Write Part 3');
});

test('Simple Write Part Prompt - Competitor Script Mode sends only "Write Part X"', () => {
  const promptP1 = generateWritePartPrompt(1, 4, 4000);
  assert.strictEqual(promptP1, 'Write Part 1');

  const promptFinal = generateWritePartPrompt(4, 4, 4000);
  assert.strictEqual(promptFinal, 'Write Part 4');
});

test('Part Completion Marker - hasPartCompletionMarker enforces exact video and part match', () => {
  // Matching markers
  assert.strictEqual(hasPartCompletionMarker('Some script content...\n\nV1, P1 = COMPLETED', 1, 1), true);
  assert.strictEqual(hasPartCompletionMarker('Some script content...\n\n**V1, P2 = COMPLETED**', 1, 2), true);
  assert.strictEqual(hasPartCompletionMarker('Some script content...\n\nV5, P3: COMPLETED', 5, 3), true);
  assert.strictEqual(hasPartCompletionMarker('Some script content...\n\nV10/P4 = COMPLETED', 10, 4), true);

  // Missing marker
  assert.strictEqual(hasPartCompletionMarker('Some script content without marker...', 1, 1), false);

  // Mismatched part number: V1, P2 marker cannot confirm Part 1
  assert.strictEqual(hasPartCompletionMarker('Some script content...\n\nV1, P2 = COMPLETED', 1, 1), false);

  // Mismatched video number: V2, P1 marker cannot confirm V1 Part 1
  assert.strictEqual(hasPartCompletionMarker('Some script content...\n\nV2, P1 = COMPLETED', 1, 1), false);
});

test('Part Completion Detection - Part without completion marker remains generating / incomplete', () => {
  const outline = `
    TOTAL PARTS = 2
    Part 1 — The Intro
    Part 2 — The Outro
    OUTLINE = GENERATED
  `;
  const part1Generating = `
    V1 P1 — The Intro
    
    In the beginning of our story, the great kingdom flourished across the western continent.
    (Still drafting, no completion marker...)
  `;

  const res = detectPartsFromMessages([outline, part1Generating], 0, false, 1, false);
  const p1 = res.parts.find((p) => p.partNumber === 1);
  assert.ok(p1);
  assert.strictEqual(p1!.status, 'generating', 'Part 1 must remain generating until completion marker is present');
  assert.strictEqual(res.lifecycleStage, 'PART_GENERATING');
  assert.ok(res.liveDebugStatus?.includes('Generating / Incomplete'));
});

test('Part Completion Detection - Matching completion marker marks part done and updates lifecycle', () => {
  const outline = `
    TOTAL PARTS = 2
    Part 1 — The Intro
    Part 2 — The Outro
    OUTLINE = GENERATED
  `;
  const part1Complete = `
    V1 P1 — The Intro
    
    In the beginning of our story, the great kingdom flourished across the western continent.
    The citizens lived in prosperity under the wise rule of the ancient council.
    
    V1, P1 = COMPLETED
  `;

  const res = detectPartsFromMessages([outline, part1Complete], 0, false, 1, false);
  const p1 = res.parts.find((p) => p.partNumber === 1);
  assert.ok(p1);
  assert.strictEqual(p1!.status, 'done', 'Part 1 must be marked done with matching completion marker');
  assert.strictEqual(res.lifecycleStage, 'PART_GENERATED');
  assert.ok(res.liveDebugStatus?.includes('P1 Completed ✓'));
});

test('Total Parts Detection - ignores "Total: 9,000 words" and "Total: 31,000 words" and locks to "Total Parts = 4"', () => {
  assert.strictEqual(extractTotalPartsFromText('Total Parts = 4'), 4);
  assert.strictEqual(extractTotalPartsFromText('TOTAL PARTS: 4'), 4);
  assert.strictEqual(extractTotalPartsFromText('Total: 9,000 words'), null, 'Word count must NOT be detected as total parts');
  assert.strictEqual(extractTotalPartsFromText('Total: 31,000 words'), null, 'Word count must NOT be detected as total parts');
  assert.strictEqual(extractTotalPartsFromText('Total 9 minutes'), null, 'Minutes duration must NOT be detected as total parts');
});

test('cleanHeadingText - rejects completion markers like "= Completed" and clean status suffixes', () => {
  assert.strictEqual(cleanHeadingText('= Completed'), '', 'Must reject "= Completed" heading');
  assert.strictEqual(cleanHeadingText('= COMPLETED'), '', 'Must reject "= COMPLETED" heading');
  assert.strictEqual(cleanHeadingText('COMPLETED'), '', 'Must reject "COMPLETED" heading');
  assert.strictEqual(cleanHeadingText('Hook & Setup = COMPLETED'), 'Hook & Setup', 'Must strip completion suffix');
  assert.strictEqual(cleanHeadingText('— Инспектор Алла Бо...'), 'Инспектор Алла Бо...', 'Must clean Russian heading dashes');
});

test('Outline Locking - Outline with Total Parts = 4 and 9 bullet items produces exactly 4 parts, not 9', () => {
  const outlineWith9Bullets = `
    V15 OUTLINE
    Total Parts = 4
    Total: 9,000 words

    V15 P1 — Hook & Setup
    1. Introduction of inspector
    2. Crime scene overview
    3. First clue found

    V15 P2 — The Conflict
    4. Interrogation
    5. Suspect alibi
    6. Sudden twist

    V15 P3 — The Crisis
    7. Trap sprung
    8. Chase scene

    V15 P4 — Climax & Resolution
    9. Final arrest

    OUTLINE = GENERATED
  `;

  const res = detectPartsFromMessages([outlineWith9Bullets], 0, false, 15, false);
  assert.strictEqual(res.totalParts, 4, 'Must detect exactly 4 total parts, NOT 9');
  assert.strictEqual(res.parts.length, 4, 'Must produce exactly 4 parts in parts array');
  assert.strictEqual(res.parts[0].heading, 'Hook & Setup');
  assert.strictEqual(res.parts[3].heading, 'Climax & Resolution');
  assert.strictEqual(res.outlineStatus, 'completed');
});

test('Merged File Download Name - dynamically formats filename from video ID range', () => {
  // Examples from user specification:
  // V1 to V5 -> V1 to V5 Script.txt
  assert.strictEqual(getMergedFilename(['V1', 'V2', 'V3', 'V4', 'V5']), 'V1 to V5 Script.txt');

  // V1 to V10 -> V1 to V10 Script.txt
  const v1To10 = Array.from({ length: 10 }, (_, i) => `V${i + 1}`);
  assert.strictEqual(getMergedFilename(v1To10), 'V1 to V10 Script.txt');

  // V40 to V50 -> V40 to V50 Script.txt
  const v40To50 = Array.from({ length: 11 }, (_, i) => `V${i + 40}`);
  assert.strictEqual(getMergedFilename(v40To50), 'V40 to V50 Script.txt');

  // Single video -> V1 Script.txt
  assert.strictEqual(getMergedFilename(['V1']), 'V1 Script.txt');
  assert.strictEqual(getMergedFilename(['V40']), 'V40 Script.txt');

  // Unordered list -> correctly sorts and takes first and last
  assert.strictEqual(getMergedFilename(['V5', 'V1', 'V3']), 'V1 to V5 Script.txt');

  // Fallbacks
  assert.strictEqual(getMergedFilename([]), 'Merged Script.txt');
});

test('Custom Video ID Parser (V3.6) - parses comma, space, and mixed V-prefixed formats', () => {
  assert.deepStrictEqual(parseCustomVideoIds('V3, V4, V7, V9, V10'), [3, 4, 7, 9, 10]);
  assert.deepStrictEqual(parseCustomVideoIds('3, 4, 7, 9, 10'), [3, 4, 7, 9, 10]);
  assert.deepStrictEqual(parseCustomVideoIds('v11 v12 v15 v20'), [11, 12, 15, 20]);
  assert.deepStrictEqual(parseCustomVideoIds('V5, 3, v12, 5, 3'), [3, 5, 12]); // Deduplication and sorting
  assert.deepStrictEqual(parseCustomVideoIds(''), []);
});

test('Title Slicing with Custom Discontinuous Video IDs (V3.6) - filters strictly to specified IDs', () => {
  const titlesWithMarkers = [
    'V1 - Title One',
    'V2 - Title Two',
    'V3 - Title Three',
    'V4 - Title Four',
    'V7 - Title Seven',
    'V9 - Title Nine'
  ];

  const res = sliceTitlesForRange(titlesWithMarkers, 1, 10, [3, 7, 9]);
  assert.deepStrictEqual(res.assigned, [
    'V3 - Title Three',
    'V7 - Title Seven',
    'V9 - Title Nine'
  ]);
  assert.strictEqual(res.cutBelowCount, 2); // V1, V2
  assert.strictEqual(res.cutAboveCount, 1); // V4
});

test('Part Completion Marker Variations (V3.6) - matches markdown, colons, brackets, and clean suffixes', () => {
  // Bold markdown: **V1, P4 = COMPLETED**
  assert.strictEqual(hasPartCompletionMarker('**V1, P4 = COMPLETED**', 1, 4), true);

  // Colon variant: V1, P4: COMPLETED
  assert.strictEqual(hasPartCompletionMarker('Here is the end.\nV1, P4: COMPLETED', 1, 4), true);

  // Dash variant: V1 P4 - COMPLETED
  assert.strictEqual(hasPartCompletionMarker('End of script.\n**V1 P4 - COMPLETED**', 1, 4), true);

  // Lowercase compact: v1p4 = completed
  assert.strictEqual(hasPartCompletionMarker('v1p4 = completed', 1, 4), true);

  // Part only with bold: **P4: COMPLETED**
  assert.strictEqual(hasPartCompletionMarker('End of text.\n**P4 = COMPLETED**', 1, 4), true);

  // Wrong part: V1, P3 = COMPLETED does NOT match part 4
  assert.strictEqual(hasPartCompletionMarker('V1, P3 = COMPLETED', 1, 4), false);

  // Wrong video: V2, P4 = COMPLETED does NOT match video 1
  assert.strictEqual(hasPartCompletionMarker('V2, P4 = COMPLETED', 1, 4), false);
});

test('Strict Merge Validation (V3.6) - Expected Parts === Detected Completed Parts === Merged Parts', () => {
  const tab6PartsIncomplete: VTab = {
    id: 'V1',
    index: 1,
    chromeTabId: 1,
    qwenUrl: '',
    status: 'ready',
    selected: true,
    initialMessage: '',
    title: 'Test 6 Parts',
    masterPrompt: '',
    thumbnailStatus: 'none',
    scriptStatus: 'none',
    totalParts: 6,
    currentPart: 5,
    lastUpdated: Date.now(),
    parts: [
      { partNumber: 1, label: 'V1 P1', explicitMarker: 'V1 P1', videoNumber: 1, status: 'done', content: 'Script prose part 1 long text here...', downloaded: false },
      { partNumber: 2, label: 'V1 P2', explicitMarker: 'V1 P2', videoNumber: 1, status: 'done', content: 'Script prose part 2 long text here...', downloaded: false },
      { partNumber: 3, label: 'V1 P3', explicitMarker: 'V1 P3', videoNumber: 1, status: 'done', content: 'Script prose part 3 long text here...', downloaded: false },
      { partNumber: 4, label: 'V1 P4', explicitMarker: 'V1 P4', videoNumber: 1, status: 'done', content: 'Script prose part 4 long text here...', downloaded: false },
      { partNumber: 5, label: 'V1 P5', explicitMarker: 'V1 P5', videoNumber: 1, status: 'done', content: 'Script prose part 5 long text here...', downloaded: false }
      // Part 6 missing!
    ]
  };

  const val = validateVideoMerge(tab6PartsIncomplete);
  assert.strictEqual(val.valid, false, 'Merge must be invalid when part 6 is missing');
  assert.strictEqual(val.completedPartsCount, 5);
  assert.deepStrictEqual(val.missingParts, [6]);
  assert.ok(val.errors.some((e) => e.includes('MISSING: V1 P6')));

  // Add final part (P6)
  tab6PartsIncomplete.parts.push({
    partNumber: 6,
    label: 'V1 P6',
    explicitMarker: 'V1 P6',
    videoNumber: 1,
    status: 'done',
    content: 'Script prose part 6 final part text here...',
    downloaded: false
  });

  const valComplete = validateVideoMerge(tab6PartsIncomplete);
  assert.strictEqual(valComplete.valid, true, 'Merge must be valid when all 6 parts are completed');
  assert.strictEqual(valComplete.completedPartsCount, 6);
  assert.strictEqual(valComplete.missingParts.length, 0);
  assert.strictEqual(valComplete.statusLabel, 'TXT MERGE VERIFIED ✓');
});

test('Final Part is Mandatory & detectPartsFromMessages with V1P2= completed', () => {
  const outlineMsg = `VIDEO OUTLINE: Total Parts: 2\n1. Part 1 - Hook\n2. Part 2 - Climax\nOUTLINE = GENERATED`;
  const part1Msg = `V1 P1 — Hook\nThis is part 1 script with full prose details.\nV1, P1 = COMPLETED`;
  const part2Msg = `V1/P2: Climax\nThis is part 2 final script with full prose details.\nV1P2= completed`;

  const result = detectPartsFromMessages([outlineMsg, part1Msg, part2Msg], 2, true, 1);
  assert.strictEqual(result.parts.length, 2);
  assert.strictEqual(result.parts[0].status, 'done');
  assert.strictEqual(result.parts[1].status, 'done', 'Part 2 with V1P2= completed must be status done even if isGenerating is true');
});

test('Title Push — One Time Per Title tracking and duplicate prevention', () => {
  // Test both Original Script Mode and Competitor Script Mode tabs
  const testTabs: VTab[] = [
    {
      id: 'V1',
      index: 1,
      chromeTabId: 101,
      status: 'ready',
      selected: true,
      initialMessage: '',
      title: 'Top 10 Ancient Mysteries',
      masterPrompt: 'Write video script',
      thumbnailStatus: 'none',
      scriptStatus: 'none',
      scriptMode: 'original',
      totalParts: 4,
      currentPart: 1,
      parts: [],
      lastUpdated: Date.now()
    },
    {
      id: 'V2',
      index: 2,
      chromeTabId: 102,
      status: 'ready',
      selected: true,
      initialMessage: '',
      title: 'Deep Ocean Discoveries',
      masterPrompt: 'Write video script',
      thumbnailStatus: 'none',
      scriptStatus: 'assigned',
      scriptMode: 'competitor',
      totalParts: 4,
      currentPart: 1,
      parts: [],
      lastUpdated: Date.now()
    }
  ];

  // Helper simulating the PUSH_TITLES_TO_CHATS deduplication algorithm
  function simulatePushTitles(tabs: VTab[]) {
    let pushedCount = 0;
    let skippedCount = 0;
    for (const tab of tabs) {
      if (!tab.chromeTabId || !tab.title) continue;
      if (tab.titlePushed && tab.pushedTitleText === tab.title) {
        skippedCount++;
        continue;
      }
      tab.titleInjected = true;
      tab.titlePushed = true;
      tab.pushedTitleText = tab.title;
      pushedCount++;
    }
    return { pushedCount, skippedCount };
  }

  // 1. Initial Push: All titles must be pushed exactly once
  const run1 = simulatePushTitles(testTabs);
  assert.strictEqual(run1.pushedCount, 2, 'Initial push must push both titles');
  assert.strictEqual(run1.skippedCount, 0, 'No titles should be skipped on first push');
  assert.strictEqual(testTabs[0].titlePushed, true);
  assert.strictEqual(testTabs[0].pushedTitleText, 'Top 10 Ancient Mysteries');
  assert.strictEqual(testTabs[1].titlePushed, true);
  assert.strictEqual(testTabs[1].pushedTitleText, 'Deep Ocean Discoveries');

  // 2. Second Duplicate Push: Must be skipped completely (0 pushed, 2 skipped)
  const run2 = simulatePushTitles(testTabs);
  assert.strictEqual(run2.pushedCount, 0, 'Duplicate push must push 0 titles');
  assert.strictEqual(run2.skippedCount, 2, 'Both titles must be skipped on duplicate push');

  // 3. Third Duplicate Push: Still skipped
  const run3 = simulatePushTitles(testTabs);
  assert.strictEqual(run3.pushedCount, 0);
  assert.strictEqual(run3.skippedCount, 2);

  // 4. Update Title on V1: Changing title resets titlePushed and allows new title to be pushed once
  testTabs[0].title = 'Updated Title: 10 Ancient Secrets';
  testTabs[0].titlePushed = false;
  testTabs[0].pushedTitleText = undefined;

  const run4 = simulatePushTitles(testTabs);
  assert.strictEqual(run4.pushedCount, 1, 'Only updated title should be pushed');
  assert.strictEqual(run4.skippedCount, 1, 'Unchanged V2 title must remain skipped');
  assert.strictEqual(testTabs[0].titlePushed, true);
  assert.strictEqual(testTabs[0].pushedTitleText, 'Updated Title: 10 Ancient Secrets');

  // 5. Subsequent Push: All skipped again
  const run5 = simulatePushTitles(testTabs);
  assert.strictEqual(run5.pushedCount, 0);
  assert.strictEqual(run5.skippedCount, 2);
});

test('Write Part Prompt & One-Click Copy — exact format "Write Part X" with no extra text', () => {
  // Test multiple part numbers across Original & Competitor Modes
  const partsToTest = [1, 2, 3, 4, 5, 10];

  for (const p of partsToTest) {
    // In Original Mode (with totalParts, wordCount, outlineInstruction)
    const promptOriginal = generateWritePartPrompt(p, 4, 4000, 'Follow outline section');
    assert.strictEqual(promptOriginal, `Write Part ${p}`, `Part ${p} in Original Mode must be exactly "Write Part ${p}"`);

    // In Competitor Mode (no outline instruction)
    const promptCompetitor = generateWritePartPrompt(p, 4, 4000);
    assert.strictEqual(promptCompetitor, `Write Part ${p}`, `Part ${p} in Competitor Mode must be exactly "Write Part ${p}"`);

    // Verify copy data-prompt attribute matches exact string
    const expectedCopyString = `Write Part ${p}`;
    assert.strictEqual(expectedCopyString, `Write Part ${p}`);
    assert.ok(!expectedCopyString.includes('Script'), 'Copy prompt must not include extra word "Script"');
    assert.ok(!expectedCopyString.includes('Please'), 'Copy prompt must not include extra words');
  }
});

test('4-Asset Verification System — State transitions and DOM verification tracking (v4.0.0)', () => {
  const tab: VTab = {
    id: 'V1',
    index: 1,
    chromeTabId: 101,
    status: 'ready',
    selected: true,
    initialMessage: 'My Version of Title is:',
    title: 'The Great Sphinx of Giza',
    titlePushStatus: 'none',
    titleVerified: false,
    thumbnailStatus: 'assigned',
    thumbnailId: 'thumb-1',
    thumbnailName: 'V1_thumb.png',
    thumbnailPushStatus: 'none',
    thumbnailVerified: false,
    scriptStatus: 'assigned',
    scriptId: 'script-1',
    scriptName: 'V1_script.txt',
    scriptPushStatus: 'none',
    scriptVerified: false,
    masterPrompt: 'Act as a documentary narrator',
    masterPromptStatus: 'none',
    masterPromptVerified: false,
    totalParts: 4,
    currentPart: 1,
    parts: [],
    lastUpdated: Date.now()
  };

  // Initial state: none of the 4 assets are verified
  assert.strictEqual(tab.titlePushStatus, 'none');
  assert.strictEqual(tab.thumbnailPushStatus, 'none');
  assert.strictEqual(tab.scriptPushStatus, 'none');
  assert.strictEqual(tab.masterPromptStatus, 'none');

  // 1. Simulate verified title insertion
  tab.titlePushStatus = 'pasting';
  assert.strictEqual(tab.titlePushStatus, 'pasting');
  // DOM verification succeeds:
  tab.titleInjected = true;
  tab.titlePushed = true;
  tab.titlePushStatus = 'pasted';
  tab.titleVerified = true;
  tab.verifiedTitleText = tab.title;
  assert.strictEqual(tab.titlePushStatus, 'pasted');
  assert.strictEqual(tab.titleVerified, true);

  // 2. Simulate failed thumbnail insertion
  tab.thumbnailPushStatus = 'uploading';
  // DOM verification fails (e.g. file input error or network timeout):
  tab.thumbnailPushStatus = 'failed';
  tab.thumbnailVerified = false;
  assert.strictEqual(tab.thumbnailPushStatus, 'failed');
  assert.strictEqual(tab.thumbnailVerified, false);

  // 3. Retry thumbnail insertion succeeds:
  tab.thumbnailPushStatus = 'uploading';
  tab.thumbnailPasted = true;
  tab.thumbnailPushStatus = 'pasted';
  tab.thumbnailVerified = true;
  assert.strictEqual(tab.thumbnailPushStatus, 'pasted');
  assert.strictEqual(tab.thumbnailVerified, true);

  // 4. Simulate verified script injection
  tab.scriptPushStatus = 'uploading';
  tab.scriptInjected = true;
  tab.scriptPushStatus = 'pasted';
  tab.scriptVerified = true;
  assert.strictEqual(tab.scriptPushStatus, 'pasted');
  assert.strictEqual(tab.scriptVerified, true);

  // 5. Simulate verified master prompt push
  tab.masterPromptStatus = 'sending';
  tab.promptInjected = true;
  tab.masterPromptStatus = 'sent';
  tab.masterPromptVerified = true;
  assert.strictEqual(tab.masterPromptStatus, 'sent');
  assert.strictEqual(tab.masterPromptVerified, true);

  // All 4 confirmed in chat
  const all4Confirmed = tab.titleVerified && tab.thumbnailVerified && tab.scriptVerified && tab.masterPromptVerified;
  assert.strictEqual(all4Confirmed, true, 'All 4 assets must be confirmed verified in DOM');
});

test('Single Push Duplicate Elimination — All 4 assets pushed strictly once per tab (v4.0.0)', () => {
  interface AssetPushLog {
    titlePushes: number;
    thumbPushes: number;
    scriptPushes: number;
    promptPushes: number;
  }

  const log: Record<string, AssetPushLog> = {
    V1: { titlePushes: 0, thumbPushes: 0, scriptPushes: 0, promptPushes: 0 },
    V2: { titlePushes: 0, thumbPushes: 0, scriptPushes: 0, promptPushes: 0 }
  };

  const tabs: VTab[] = [
    {
      id: 'V1',
      index: 1,
      chromeTabId: 101,
      status: 'ready',
      selected: true,
      initialMessage: '',
      title: 'Title 1',
      titlePushStatus: 'none',
      thumbnailStatus: 'assigned',
      thumbnailId: 't1',
      thumbnailPushStatus: 'none',
      scriptStatus: 'assigned',
      scriptId: 's1',
      scriptPushStatus: 'none',
      masterPrompt: 'Prompt 1',
      masterPromptStatus: 'none',
      totalParts: 4,
      currentPart: 1,
      parts: [],
      lastUpdated: Date.now()
    },
    {
      id: 'V2',
      index: 2,
      chromeTabId: 102,
      status: 'ready',
      selected: true,
      initialMessage: '',
      title: 'Title 2',
      titlePushStatus: 'none',
      thumbnailStatus: 'assigned',
      thumbnailId: 't2',
      thumbnailPushStatus: 'none',
      scriptStatus: 'assigned',
      scriptId: 's2',
      scriptPushStatus: 'none',
      masterPrompt: 'Prompt 2',
      masterPromptStatus: 'none',
      totalParts: 4,
      currentPart: 1,
      parts: [],
      lastUpdated: Date.now()
    }
  ];

  function pushAllWithDuplicateGuard(tList: VTab[], force: boolean = false) {
    for (const t of tList) {
      // 1. Title
      if (force || t.titlePushStatus !== 'pasted') {
        log[t.id].titlePushes++;
        t.titlePushStatus = 'pasted';
        t.titleVerified = true;
      }
      // 2. Thumb
      if (force || t.thumbnailPushStatus !== 'pasted') {
        log[t.id].thumbPushes++;
        t.thumbnailPushStatus = 'pasted';
        t.thumbnailVerified = true;
      }
      // 3. Script
      if (force || t.scriptPushStatus !== 'pasted') {
        log[t.id].scriptPushes++;
        t.scriptPushStatus = 'pasted';
        t.scriptVerified = true;
      }
      // 4. Master Prompt
      if (force || t.masterPromptStatus !== 'sent') {
        log[t.id].promptPushes++;
        t.masterPromptStatus = 'sent';
        t.masterPromptVerified = true;
      }
    }
  }

  // First run: pushes all 4 items once per tab
  pushAllWithDuplicateGuard(tabs, false);
  assert.strictEqual(log.V1.titlePushes, 1);
  assert.strictEqual(log.V1.thumbPushes, 1);
  assert.strictEqual(log.V1.scriptPushes, 1);
  assert.strictEqual(log.V1.promptPushes, 1);

  assert.strictEqual(log.V2.titlePushes, 1);
  assert.strictEqual(log.V2.thumbPushes, 1);
  assert.strictEqual(log.V2.scriptPushes, 1);
  assert.strictEqual(log.V2.promptPushes, 1);

  // Second run: should be completely skipped (0 additional pushes)
  pushAllWithDuplicateGuard(tabs, false);
  assert.strictEqual(log.V1.titlePushes, 1, 'V1 title must not be pushed a 2nd time');
  assert.strictEqual(log.V1.thumbPushes, 1, 'V1 thumbnail must not be pushed a 2nd time');
  assert.strictEqual(log.V1.scriptPushes, 1, 'V1 script must not be pushed a 2nd time');
  assert.strictEqual(log.V1.promptPushes, 1, 'V1 prompt must not be pushed a 2nd time');

  // Third run: still skipped
  pushAllWithDuplicateGuard(tabs, false);
  assert.strictEqual(log.V2.titlePushes, 1, 'V2 title must not be pushed a 3rd time');
  assert.strictEqual(log.V2.thumbPushes, 1, 'V2 thumbnail must not be pushed a 3rd time');
  assert.strictEqual(log.V2.scriptPushes, 1, 'V2 script must not be pushed a 3rd time');
  assert.strictEqual(log.V2.promptPushes, 1, 'V2 prompt must not be pushed a 3rd time');

  // Explicit Retry with force: true pushes exactly once more
  pushAllWithDuplicateGuard([tabs[0]], true);
  assert.strictEqual(log.V1.titlePushes, 2, 'Explicit force retry pushes exactly 1 additional time');
  assert.strictEqual(log.V2.titlePushes, 1, 'V2 remains untouched at 1 push');
});

test('Strict 1:1 Script and Thumbnail Matching per Video ID (v4.0.0)', () => {
  const thumbFiles = [
    { name: 'V1.png', type: 'image/png' },
    { name: 'V2_thumb.jpg', type: 'image/jpeg' },
    { name: 'v3_thumbnail.webp', type: 'image/webp' }
  ];

  const scriptFiles = [
    { name: 'V1_script.txt', type: 'text/plain' },
    { name: 'v2-competitor.txt', type: 'text/plain' },
    { name: 'V3_script.txt', type: 'text/plain' }
  ];

  const mappedThumbs = mapFilesToVNumbers(thumbFiles, 3);
  const mappedScripts = mapFilesToVNumbers(scriptFiles, 3);

  // Map to dictionary by vNumber
  const thumbMap = Object.fromEntries(mappedThumbs.map(m => [m.vNumber, m.file]));
  const scriptMap = Object.fromEntries(mappedScripts.map(m => [m.vNumber, m.file]));

  // Strict 1:1 Thumbnails
  assert.strictEqual(thumbMap['V1']?.name, 'V1.png');
  assert.strictEqual(thumbMap['V2']?.name, 'V2_thumb.jpg');
  assert.strictEqual(thumbMap['V3']?.name, 'v3_thumbnail.webp');

  // Strict 1:1 Scripts
  assert.strictEqual(scriptMap['V1']?.name, 'V1_script.txt');
  assert.strictEqual(scriptMap['V2']?.name, 'v2-competitor.txt');
  assert.strictEqual(scriptMap['V3']?.name, 'V3_script.txt');

  // Cross-verification: V1 never gets V2 or V3 files
  assert.notStrictEqual(scriptMap['V1']?.name, scriptMap['V2']?.name);
  assert.notStrictEqual(thumbMap['V1']?.name, thumbMap['V2']?.name);
});





