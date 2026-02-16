import * as tf from '@tensorflow/tfjs';
import { decodeJpeg } from '@tensorflow/tfjs-react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { ModelService } from './ModelService';
import { ImageProcessor } from '../utils/ImageProcessor';

/**
 * Optical Music Recognition Pipeline
 *
 * Steps:
 *  1.  Load, deskew & enhance image
 *  2.  Detect staff lines (horizontal run-length analysis)
 *  3.  Group lines into staves (groups of 5)
 *  4.  Pair staves into systems (grand-staff)
 *  5.  Detect clefs (treble / bass / alto / soprano / tenor)
 *  6.  Detect key signature via ML models
 *  7.  Detect time signatures
 *  8.  Detect bar lines → group into measures
 *  9.  Detect ledger lines
 *  10. Detect note heads (refined: must sit on/near staff)
 *  11. Detect inline accidentals (♯ ♭ ♮)
 *  12. Classify durations (stem / beam / flag analysis)
 *  13. Detect dotted notes
 *  14. Map positions → pitches (clef-aware, accidental-aware)
 *  15. Detect ties
 *  16. Assign voices & sort
 *  17. Detect rests
 */
/**
 * OCR model class → symbol type mapping.
 * Built from running the verified OCR model on 1500+ session.dat samples.
 * category: 'note' | 'rest' | 'unknown'
 * subtype:  duration hint — 'eighth','quarter','half','whole','16th','32nd',
 *           'rest_quarter','rest_eighth','rest_half','rest_whole', or 'unknown'
 */
const OCR_CLASS_LABELS = {
   0: { category: 'unknown', subtype: 'unknown' },
   1: { category: 'unknown', subtype: 'unknown' },
   2: { category: 'rest',    subtype: 'rest_eighth' },
   3: { category: 'unknown', subtype: 'unknown' },
   4: { category: 'note',    subtype: 'eighth' },
   5: { category: 'unknown', subtype: 'unknown' },
   6: { category: 'unknown', subtype: 'unknown' },
   7: { category: 'note',    subtype: 'quarter' },
   8: { category: 'note',    subtype: 'eighth' },
   9: { category: 'unknown', subtype: 'unknown' },
  10: { category: 'rest',    subtype: 'rest_quarter' },
  11: { category: 'unknown', subtype: 'unknown' },
  12: { category: 'unknown', subtype: 'unknown' },
  13: { category: 'rest',    subtype: 'rest_half' },
  14: { category: 'unknown', subtype: 'unknown' },
  15: { category: 'unknown', subtype: 'unknown' },
  16: { category: 'rest',    subtype: 'rest_quarter' },
  17: { category: 'rest',    subtype: 'rest_eighth' },
  18: { category: 'rest',    subtype: 'rest_quarter' },
  19: { category: 'note',    subtype: 'quarter' },
  20: { category: 'note',    subtype: 'eighth' },
  21: { category: 'note',    subtype: 'eighth' },
  22: { category: 'note',    subtype: 'quarter' },
  23: { category: 'rest',    subtype: 'rest_half' },
  24: { category: 'note',    subtype: 'eighth' },
  25: { category: 'unknown', subtype: 'unknown' },
  26: { category: 'unknown', subtype: 'unknown' },
  27: { category: 'unknown', subtype: 'unknown' },
  28: { category: 'rest',    subtype: 'rest_quarter' },
  29: { category: 'unknown', subtype: 'unknown' },
  30: { category: 'unknown', subtype: 'unknown' },
  31: { category: 'note',    subtype: 'eighth' },
  32: { category: 'unknown', subtype: 'unknown' },
  33: { category: 'unknown', subtype: 'unknown' },
  34: { category: 'unknown', subtype: 'unknown' },
  35: { category: 'unknown', subtype: 'unknown' },
  36: { category: 'unknown', subtype: 'unknown' },
  37: { category: 'unknown', subtype: 'unknown' },
  38: { category: 'note',    subtype: 'quarter' },
  39: { category: 'rest',    subtype: 'rest_eighth' },
  40: { category: 'unknown', subtype: 'unknown' },
  41: { category: 'unknown', subtype: 'unknown' },
  42: { category: 'rest',    subtype: 'rest_quarter' },
  43: { category: 'unknown', subtype: 'unknown' },
  44: { category: 'rest',    subtype: 'rest_half' },
  45: { category: 'note',    subtype: 'half' },
  46: { category: 'unknown', subtype: 'unknown' },
  47: { category: 'note',    subtype: 'quarter' },
  48: { category: 'note',    subtype: 'eighth' },
  49: { category: 'note',    subtype: 'quarter' },
  50: { category: 'note',    subtype: 'eighth' },
  51: { category: 'note',    subtype: 'quarter' },
  52: { category: 'unknown', subtype: 'unknown' },
  53: { category: 'note',    subtype: 'quarter' },
  54: { category: 'note',    subtype: 'eighth' },
  55: { category: 'note',    subtype: 'half' },
  56: { category: 'note',    subtype: 'quarter' },
  57: { category: 'unknown', subtype: 'unknown' },
  58: { category: 'unknown', subtype: 'unknown' },
  59: { category: 'note',    subtype: 'quarter' },
  60: { category: 'unknown', subtype: 'unknown' },
  61: { category: 'rest',    subtype: 'rest_quarter' },
  62: { category: 'rest',    subtype: 'rest_eighth' },
  63: { category: 'unknown', subtype: 'unknown' },
  64: { category: 'rest',    subtype: 'rest_half' },
  65: { category: 'note',    subtype: 'unknown' },      // catch-all class, 715 samples
  66: { category: 'note',    subtype: 'quarter' },
  67: { category: 'note',    subtype: 'quarter' },
  68: { category: 'unknown', subtype: 'unknown' },
  69: { category: 'unknown', subtype: 'unknown' },
  70: { category: 'note',    subtype: 'unknown' },      // catch-all class, 292 samples
};

export class MusicSheetProcessor {

  /* ───────────── PUBLIC API ───────────── */

  static async processSheet(imageUri) {
    console.log('🎼 Starting OMR Pipeline...');

    // 1. Load & enhance image (deskew + contrast)
    const { tensor, width, height } = await this._loadImage(imageUri);
    console.log(`✅ Image loaded (${width}×${height})`);

    // 2. Detect staff lines
    const staffLines = this._detectStaffLines(tensor, width, height);
    console.log(`✅ Detected ${staffLines.length} staff lines`);

    // 3. Group into staves (5 lines each)
    const staves = this._groupIntoStaves(staffLines);
    console.log(`✅ ${staves.length} staves`);

    // 4. Pair into systems (grand-staff pairs)
    const systems = this._pairIntoSystems(staves, tensor, width, height);
    console.log(`✅ ${systems.length} systems`);
    for (const sys of systems) {
      console.log(`   System: staves [${sys.staffIndices.join(',')}] top=${sys.top} bottom=${sys.bottom}`);
    }

    // 5. Detect clefs per staff
    const clefs = this._detectClefs(tensor, width, height, staves, systems);
    console.log(`✅ Clefs: ${clefs.map(c => c).join(', ')}`);

    // 6. Detect key signature using ML models
    const keySignature = await this._detectKeySignature(imageUri, staves);
    console.log(`✅ Key signature: ${keySignature.type} ${keySignature.count}`);

    // 7. Detect time signatures
    const timeSignature = this._detectTimeSignature(tensor, width, height, staves);
    console.log(`✅ Time signature: ${timeSignature.beats}/${timeSignature.beatType}`);

    // 8. Detect bar lines → group into measures
    let barLines = this._detectBarLines(tensor, width, height, staves);
    {
      const btypes = {};
      for (const b of barLines) btypes[b.type] = (btypes[b.type] || 0) + 1;
      console.log(`✅ ${barLines.length} raw bar line candidates: ${Object.entries(btypes).map(([t,c]) => `${t}:${c}`).join(' ')}`);
    }

    // 9. Detect ledger lines
    const ledgerLines = this._detectLedgerLines(tensor, width, height, staves);
    console.log(`✅ ${ledgerLines.length} ledger lines detected`);

    // 10. Detect note heads — refined to sit near staves
    const rawNoteHeads = this._detectNoteHeads(tensor, width, height, staves, systems, timeSignature);
    console.log(`✅ ${rawNoteHeads.length} raw note head candidates`);

    // 10a. OCR confidence gate — use the NN model to reject non-symbol blobs
    const noteHeads = await this._ocrConfidenceGate(tensor, width, height, rawNoteHeads, staves);
    console.log(`✅ ${noteHeads.length} note heads (after OCR gate, rejected ${rawNoteHeads.length - noteHeads.length})`);

    // 10b. Filter barlines: remove stems that overlap detected noteheads,
    //      enforce cross-staff consensus & minimum measure width
    barLines = this._filterBarLines(barLines, noteHeads, staves, systems);
    console.log(`✅ ${barLines.length} bar lines (after filtering)`);

    // 11. Detect inline accidentals (♯ ♭ ♮) next to note heads
    const notesWithAccidentals = this._detectInlineAccidentals(tensor, width, height, noteHeads, staves);
    {
      const accCounts = { sharp: 0, flat: 0, natural: 0 };
      for (const n of notesWithAccidentals) {
        if (n.accidental) accCounts[n.accidental] = (accCounts[n.accidental] || 0) + 1;
      }
      const total = accCounts.sharp + accCounts.flat + accCounts.natural;
      console.log(`✅ Accidentals: ${total} found (♯${accCounts.sharp} ♭${accCounts.flat} ♮${accCounts.natural})`);
    }

    // 12. Classify durations (stem + beam + flag analysis)
    const notesWithDuration = this._classifyDurations(tensor, width, height, notesWithAccidentals, staves);
    {
      const durBreakdown = {};
      for (const n of notesWithDuration) durBreakdown[n.duration] = (durBreakdown[n.duration] || 0) + 1;
      console.log(`✅ Durations classified: ${Object.entries(durBreakdown).map(([d,c]) => `${d}:${c}`).join(' ')}`);
    }

    // 13. Detect dotted notes (augmentation dots next to noteheads)
    const notesWithDots = this._detectDottedNotes(tensor, width, height, notesWithDuration, staves);
    console.log(`✅ Dotted notes checked`);

    // 14. Map to pitches (clef-aware, accidental-aware)
    const notesWithPitch = this._mapToPitches(notesWithDots, staves, systems, keySignature, clefs, barLines);
    console.log(`✅ Pitches mapped`);

    // ── Diagnostic: dump first notes per staff for ground-truth comparison ──
    {
      const byStaff = {};
      for (const n of notesWithPitch) {
        const si = n.staffIndex ?? '?';
        if (!byStaff[si]) byStaff[si] = [];
        if (byStaff[si].length < 20) byStaff[si].push(n);
      }
      for (const [si, notes] of Object.entries(byStaff)) {
        const clef = clefs[si] || '?';
        console.log(`📋 Staff ${si} (${clef}) — first ${notes.length} notes:`);
        for (const n of notes) {
          const dur = n.duration || '?';
          const dot = n.dotted ? '.' : '';
          console.log(`   x=${Math.round(n.x)} pos=${n.staffPosition} ${n.pitch}${dot} MIDI=${n.midiNote} dur=${dur}${dot}`);
        }
      }
    }

    // 15. Detect ties between same-pitch notes and merge durations
    const notesAfterTies = this._detectTies(tensor, width, height, notesWithPitch, staves);
    console.log(`✅ Ties resolved`);

    // 16. Assign voices
    const voicedNotes = this._assignVoices(notesAfterTies, staves);
    console.log(`✅ ${voicedNotes.length} voiced notes`);

    // 17. Detect rests in gaps between notes
    const rests = this._detectRests(tensor, width, height, voicedNotes, staves);
    console.log(`✅ ${rests.length} rests detected`);

    tensor.dispose();
    // Group notes into measures using detected bar lines
    const measures = this._groupIntoMeasures(voicedNotes, rests, barLines, staves);
    console.log(`✅ ${measures.length} measures`);

    // 18. Quantize rhythms: adjust durations within each measure to fit the time signature
    this._quantizeRhythms(measures, timeSignature);
    console.log(`✅ Rhythms quantized to ${timeSignature.beats}/${timeSignature.beatType}`);

    // 19. Expand repeats: duplicate measures within repeat barlines
    const expandedEvents = this._expandRepeats(voicedNotes, rests, barLines, staves);
    console.log(`✅ Repeats expanded (${expandedEvents.notes.length} notes, ${expandedEvents.rests.length} rests)`);

    // Merge notes + rests and sort by staffIndex then x
    const allEvents = [...expandedEvents.notes, ...expandedEvents.rests].sort((a, b) => {
      const sa = Number.isFinite(a.staffIndex) ? a.staffIndex : 999;
      const sb = Number.isFinite(b.staffIndex) ? b.staffIndex : 999;
      if (sa !== sb) return sa - sb;
      return (a.x || 0) - (b.x || 0);
    });

    // Build staff groups for visualization (raw staff line arrays)
    const staffGroups = staves.map((s) => [...s]);

    return {
      notes: allEvents,
      staves: staves.length,
      measures,
      metadata: {
        imageWidth: width,
        imageHeight: height,
        staffGroups,
        keySignature,
        timeSignature,
        clefs,
        barLines,
        ledgerLines: ledgerLines.length,
        systems: systems.map((sys) => ({
          top: sys.top,
          bottom: sys.bottom,
          staffIndices: sys.staffIndices,
        })),
        timestamp: new Date().toISOString(),
        totalNotes: voicedNotes.length,
        totalRests: rests.length,
      },
    };
  }

  /* ───────────── 1. LOAD, DESKEW & ENHANCE IMAGE ───────────── */

  static async _loadImage(imageUri) {
    // Resize to max 1400px wide for accurate staff/note detection
    // (800px was too low — half-space of 4-5px caused constant pitch errors)
    const resized = await manipulateAsync(imageUri, [{ resize: { width: 1400 } }], {
      compress: 0.90,
      format: SaveFormat.JPEG,
    });

    const response = await fetch(resized.uri);
    const arrayBuffer = await response.arrayBuffer();
    const imageTensor = decodeJpeg(new Uint8Array(arrayBuffer), 3);

    const bw = tf.tidy(() => {
      const gray = tf.image.rgbToGrayscale(imageTensor);

      // Auto-contrast: stretch histogram to [0, 255]
      const minVal = gray.min();
      const maxVal = gray.max();
      const range = maxVal.sub(minVal);
      // Avoid division by zero; if range is tiny the image is blank
      const safeRange = tf.maximum(range, tf.scalar(1));
      const enhanced = gray.sub(minVal).div(safeRange).mul(tf.scalar(255));

      return enhanced;
    });
    imageTensor.dispose();

    const shape = bw.shape; // [height, width, 1]
    const width = shape[1];
    const height = shape[0];
    const data = bw.dataSync();

    // ── Deskew: estimate rotation from staff-like rows ──
    const skewAngle = this._estimateSkew(data, width, height);
    if (Math.abs(skewAngle) > 0.15) {
      console.log(`🔄 Deskewing by ${skewAngle.toFixed(2)}°`);
      // Re-process with rotation
      bw.dispose();
      const rotated = await manipulateAsync(
        resized.uri,
        [{ resize: { width: 1400 } }, { rotate: -skewAngle }],
        { compress: 0.90, format: SaveFormat.JPEG }
      );
      const resp2 = await fetch(rotated.uri);
      const ab2 = await resp2.arrayBuffer();
      const img2 = decodeJpeg(new Uint8Array(ab2), 3);
      const bw2 = tf.tidy(() => {
        const g = tf.image.rgbToGrayscale(img2);
        const mn = g.min();
        const mx = g.max();
        const rng = tf.maximum(mx.sub(mn), tf.scalar(1));
        return g.sub(mn).div(rng).mul(tf.scalar(255));
      });
      img2.dispose();
      const s2 = bw2.shape;
      return { tensor: bw2, width: s2[1], height: s2[0] };
    }

    return { tensor: bw, width, height };
  }

  /**
   * Estimate skew angle by analysing the dominant angle of dark horizontal runs.
   * Uses a simplified Hough-like approach on a few sampled rows.
   */
  static _estimateSkew(data, width, height) {
    // Sample ~20 rows spread across the image
    const sampleCount = 20;
    const darkThreshold = 120;
    const minRunFraction = 0.25;
    const angles = [];

    for (let s = 0; s < sampleCount; s++) {
      const y = Math.floor((s + 0.5) * height / sampleCount);
      // Count dark pixels in this row
      let darkCount = 0;
      for (let x = 0; x < width; x++) {
        if (data[y * width + x] < darkThreshold) darkCount++;
      }
      if (darkCount / width < minRunFraction) continue;

      // This row looks like a staff line. Find the leftmost and rightmost dark pixel.
      let leftX = -1, rightX = -1;
      for (let x = 0; x < width; x++) {
        if (data[y * width + x] < darkThreshold) { leftX = x; break; }
      }
      for (let x = width - 1; x >= 0; x--) {
        if (data[y * width + x] < darkThreshold) { rightX = x; break; }
      }
      if (leftX < 0 || rightX <= leftX) continue;

      // Check a few rows above/below to find the best-matching row for the endpoints
      for (const dy of [-2, -1, 1, 2]) {
        const checkY = y + dy;
        if (checkY < 0 || checkY >= height) continue;
        // Find leftmost dark pixel at checkY near leftX
        let lx2 = -1, rx2 = -1;
        for (let x = Math.max(0, leftX - 10); x < Math.min(width, leftX + 10); x++) {
          if (data[checkY * width + x] < darkThreshold) { lx2 = x; break; }
        }
        for (let x = Math.min(width - 1, rightX + 10); x > Math.max(0, rightX - 10); x--) {
          if (data[checkY * width + x] < darkThreshold) { rx2 = x; break; }
        }
        if (lx2 >= 0 && rx2 > lx2) {
          const runWidth = rightX - leftX;
          if (runWidth > width * 0.2) {
            const angleRad = Math.atan2(dy, runWidth);
            angles.push(angleRad * 180 / Math.PI);
          }
        }
      }
    }

    if (angles.length === 0) return 0;

    // Median angle
    angles.sort((a, b) => a - b);
    return angles[Math.floor(angles.length / 2)];
  }

  /* ───────────── 2. DETECT STAFF LINES ───────────── */

  static _detectStaffLines(tensor, width, height) {
    const data = tensor.dataSync();

    // For each row compute: percentage of pixels darker than threshold
    const threshold = 120;
    const minRunFraction = 0.3; // at least 30% of row must be dark (staff line)
    const staffLines = [];

    let inLine = false;
    let lineStart = 0;

    for (let y = 0; y < height; y++) {
      let darkCount = 0;
      for (let x = 0; x < width; x++) {
        if (data[y * width + x] < threshold) darkCount++;
      }
      const fraction = darkCount / width;
      const isDark = fraction >= minRunFraction;

      if (isDark && !inLine) {
        lineStart = y;
        inLine = true;
      } else if (!isDark && inLine) {
        // Staff lines are thin (1-4 px). Reject thick blobs.
        const thickness = y - lineStart;
        if (thickness <= 6) {
          staffLines.push(Math.round((lineStart + y - 1) / 2));
        }
        inLine = false;
      }
    }

    return staffLines;
  }

  /* ───────────── 3. GROUP INTO STAVES ───────────── */

  static _groupIntoStaves(staffLines) {
    if (staffLines.length < 5) return [];

    // Estimate typical spacing: median of consecutive gaps
    const gaps = [];
    for (let i = 1; i < staffLines.length; i++) gaps.push(staffLines[i] - staffLines[i - 1]);
    gaps.sort((a, b) => a - b);
    const medianGap = gaps[Math.floor(gaps.length / 2)] || 10;

    const staves = [];
    let current = [staffLines[0]];

    for (let i = 1; i < staffLines.length; i++) {
      const gap = staffLines[i] - staffLines[i - 1];
      // Lines within 2× median spacing belong to same staff
      if (gap < medianGap * 2.2) {
        current.push(staffLines[i]);
        if (current.length === 5) {
          staves.push(current);
          current = [];
        }
      } else {
        // Big gap → new staff
        current = [staffLines[i]];
      }
    }

    return staves;
  }

  /* ───────────── 4. PAIR INTO SYSTEMS ───────────── */

  static _pairIntoSystems(staves, tensor, width, height) {
    const data = tensor ? tensor.dataSync() : null;
    const systems = [];
    let i = 0;
    while (i < staves.length) {
      const staffA = staves[i];
      const staffB = staves[i + 1];

      const topA = staffA[0];
      const bottomA = staffA[4];
      const heightA = bottomA - topA;

      if (staffB) {
        const topB = staffB[0];
        const bottomB = staffB[4];
        const gapAB = topB - bottomA;

        // ── Check 1: Left-margin connection (brace, bracket, or systemic barline) ──
        // In engraved music, staves within the same system are ALWAYS connected
        // by a barline or brace at the very left edge.  Hymns/chorales have lyrics
        // between the staves that create a very large gap (3+ lines of text),
        // but the systemic barline (1-3px wide) still spans the entire gap.
        //
        // Strategy: scan leftmost 8% of image for ANY thin column that has a
        // continuous dark run spanning most of the gap.  Use a gap-tolerant scan
        // (small white gaps from lyrics text intersecting the barline are OK).
        let hasLeftConnection = false;
        if (data) {
          const checkLeft = 0;
          const checkRight = Math.min(Math.floor(width * 0.08), width);
          const gapTop = bottomA + 1;
          const gapBottom = topB - 1;
          const gapHeight = gapBottom - gapTop + 1;

          if (gapHeight > 2) {
            for (let x = checkLeft; x < checkRight; x++) {
              // Method A: simple dark ratio (but lower threshold for tall gaps)
              let dark = 0;
              for (let y = gapTop; y <= gapBottom; y++) {
                if (y >= 0 && y < height && data[y * width + x] < 130) dark++;
              }
              // For tall lyrics gaps, the barline is thin (1-2px) and the gap
              // could be 100+px.  Lower the threshold for taller gaps.
              const threshold = gapHeight > heightA * 3 ? 0.20 : 0.35;
              if (dark / gapHeight > threshold) {
                hasLeftConnection = true;
                break;
              }

              // Method B: gap-tolerant continuous run check.
              // A real systemic barline is a continuous vertical dark line,
              // but lyrics characters may interrupt it with white gaps.
              // Look for a mostly-continuous dark column with small gaps.
              let maxDarkRun = 0;
              let currentRun = 0;
              let gapRun = 0;
              const maxGap = Math.max(4, Math.floor(gapHeight * 0.15));
              for (let y = gapTop; y <= gapBottom; y++) {
                if (y >= 0 && y < height && data[y * width + x] < 130) {
                  currentRun += gapRun + 1; // bridge the gap
                  gapRun = 0;
                  maxDarkRun = Math.max(maxDarkRun, currentRun);
                } else {
                  gapRun++;
                  if (gapRun > maxGap) {
                    currentRun = 0;
                    gapRun = 0;
                  }
                }
              }
              // If we found a dark run spanning ≥60% of the gap, it's a barline/brace
              if (maxDarkRun > gapHeight * 0.60) {
                hasLeftConnection = true;
                break;
              }
            }
          }

          // Method C: Check if BOTH staves have their left barline at the same x
          // (within the leftmost 8%). A systemic barline that extends continuously
          // from staff A through the gap to staff B proves they're in the same system.
          if (!hasLeftConnection) {
            const scanRight = Math.min(Math.floor(width * 0.08), width);
            for (let x = 0; x < scanRight; x++) {
              // Check if this column is dark on BOTH staves
              let darkA = 0, totalA = 0;
              for (let y = topA; y <= bottomA; y++) {
                if (y >= 0 && y < height) {
                  totalA++;
                  if (data[y * width + x] < 120) darkA++;
                }
              }
              let darkB = 0, totalB = 0;
              for (let y = topB; y <= bottomB; y++) {
                if (y >= 0 && y < height) {
                  totalB++;
                  if (data[y * width + x] < 120) darkB++;
                }
              }
              // Both staves have a barline at this x → same system
              if (totalA > 0 && darkA / totalA > 0.70 &&
                  totalB > 0 && darkB / totalB > 0.70) {
                hasLeftConnection = true;
                console.log(`  🔗 Staves ${i},${i+1} connected via barline at x=${x}`);
                break;
              }
            }
          }
        }

        // ── Check 2: Gap-based (increased threshold for hymns with lyrics) ──
        // Hymns typically have 2-3 lines of lyrics between treble and bass staves.
        // This gap can be 5-6x the staff height. Original threshold of 2.5 was
        // too restrictive — increased to 6 to handle standard hymn layouts.
        const gapBased = gapAB < heightA * 6;

        if (hasLeftConnection || gapBased) {
          console.log(`  🔗 Paired staves ${i}+${i+1} into system (gap=${gapAB.toFixed(0)}, staffH=${heightA.toFixed(0)}, leftConn=${hasLeftConnection})`);
          systems.push({
            top: topA,
            bottom: bottomB,
            staffIndices: [i, i + 1],
            staves: [staffA, staffB],
          });
          i += 2;
          continue;
        }
      }

      // Single-staff system
      systems.push({
        top: topA,
        bottom: bottomA,
        staffIndices: [i],
        staves: [staffA],
      });
      i += 1;
    }
    return systems;
  }

  /* ───────────── 5. DETECT CLEFS ───────────── */

  /**
   * Detect clef type for each staff by analyzing the left region of the staff.
   * Returns an array (one per staff): 'treble' | 'bass' | 'alto' | 'soprano' | 'tenor'
   *
   * Heuristics:
   * - G clef (treble): tall, curvy shape extending ABOVE line 1 and BELOW line 5.
   *   Distinctive descending tail below the staff and spiral above.
   * - F clef (bass): curve with two dots to the right, centered in upper half.
   *   Dots sit in spaces adjacent to line 4.
   * - C clef (soprano / alto / tenor): two thick vertical bars joined by a
   *   center bulge. The line the bulge sits on determines the variant:
   *     soprano → line 1 (top),  alto → line 3 (middle),  tenor → line 4.
   *
   * Fallback: in a 2-staff system, top → treble, bottom → bass.
   *           In a 4-staff system (SATB): staves 0-1 → treble, staff 3 → bass.
   *           Single-staff → treble.
   */
  static _detectClefs(tensor, width, height, staves, systems) {
    const data = tensor.dataSync();
    const clefs = [];

    for (let staffIdx = 0; staffIdx < staves.length; staffIdx++) {
      const staff = staves[staffIdx];
      const spacing = (staff[4] - staff[0]) / 4;

      // Scan the leftmost 14% of the image (clef region)
      const clefLeft = 2;
      const clefRight = Math.min(width - 1, Math.floor(width * 0.14));
      const scanW = clefRight - clefLeft + 1;
      const clefTop = Math.max(0, staff[0] - Math.floor(spacing * 2.5));
      const clefBottom = Math.min(height - 1, staff[4] + Math.floor(spacing * 2.5));
      const staffMidY = (staff[0] + staff[4]) / 2;

      // ── Gather dark pixel statistics ──
      let upperDark = 0, lowerDark = 0;
      let totalDark = 0, totalPixels = 0;
      let darkAboveStaff = 0, darkBelowStaff = 0;
      // Per-row dark counts (for C-clef center-of-mass)
      const rowDark = {};

      for (let y = clefTop; y <= clefBottom; y++) {
        let rowCount = 0;
        for (let x = clefLeft; x <= clefRight; x++) {
          totalPixels++;
          if (data[y * width + x] < 120) {
            totalDark++;
            rowCount++;
            if (y < staffMidY) upperDark++;
            else lowerDark++;
            if (y < staff[0]) darkAboveStaff++;
            if (y > staff[4]) darkBelowStaff++;
          }
        }
        rowDark[y] = rowCount;
      }

      const density = totalPixels > 0 ? totalDark / totalPixels : 0;

      // ── Vertical extent of the dark blob (scan multiple x columns) ──
      let minDarkY = height, maxDarkY = 0;
      const xSamples = [
        Math.floor(clefLeft + scanW * 0.3),
        Math.floor(clefLeft + scanW * 0.5),
        Math.floor(clefLeft + scanW * 0.7),
      ];
      for (const sx of xSamples) {
        if (sx >= width) continue;
        for (let y = clefTop; y <= clefBottom; y++) {
          if (data[y * width + sx] < 120) {
            minDarkY = Math.min(minDarkY, y);
            maxDarkY = Math.max(maxDarkY, y);
          }
        }
      }
      const darkExtent = maxDarkY - minDarkY;

      // ── G-clef (treble) test ──
      // Treble clef extends well above and below the staff with a large vertical extent
      const extendsAbove = darkAboveStaff > spacing * 1.0;
      const extendsBelow = darkBelowStaff > spacing * 0.5;
      const isTall = darkExtent > spacing * 3.8;

      if (isTall && extendsAbove && extendsBelow) {
        clefs.push('treble');
        continue;
      }
      // Secondary treble check: requires BOTH above and below extension
      // and must NOT be upper-biased (which indicates bass clef)
      const isUpperBiased = totalDark > 0 && upperDark / totalDark > 0.55;
      if (darkExtent > spacing * 3.0 && extendsAbove && extendsBelow && !isUpperBiased && density > 0.15 && density < 0.50) {
        clefs.push('treble');
        continue;
      }

      // ── F-clef (bass) test ──
      // Bass clef: dark mass weighted toward upper half, look for two-dot pattern
      if (isUpperBiased && darkExtent < spacing * 5.5) {
        // Check for two-dot pattern: dots sit in the spaces flanking line 3
        // (space between lines 2-3 and space between lines 3-4)
        // Dots are to the right of the main clef body
        let hasDots = false;
        // Scan several x positions in the right 40% of the clef region
        for (let xFrac = 0.6; xFrac <= 0.95; xFrac += 0.1) {
          const dotX = Math.floor(clefLeft + scanW * xFrac);
          const dotY1 = Math.round((staff[1] + staff[2]) / 2); // space lines 2-3
          const dotY2 = Math.round((staff[2] + staff[3]) / 2); // space lines 3-4
          const dotR = Math.max(2, Math.floor(spacing * 0.3));
          let d1 = 0, d2 = 0, dTotal = 0;
          for (let dy = -dotR; dy <= dotR; dy++) {
            for (let dx = -dotR; dx <= dotR; dx++) {
              const px = dotX + dx;
              if (px < 0 || px >= width) continue;
              dTotal++;
              const py1 = dotY1 + dy;
              const py2 = dotY2 + dy;
              if (py1 >= 0 && py1 < height && data[py1 * width + px] < 120) d1++;
              if (py2 >= 0 && py2 < height && data[py2 * width + px] < 120) d2++;
            }
          }
          if (dTotal > 0 && d1 / dTotal > 0.25 && d2 / dTotal > 0.25) {
            hasDots = true;
            break;
          }
        }
        if (hasDots) {
          clefs.push('bass');
          continue;
        }
        // Upper-biased but no dots — still likely bass (dots may be faint)
        if (upperDark > lowerDark * 1.5) {
          clefs.push('bass');
          continue;
        }
      }

      // ── C-clef test (soprano / alto / tenor) ──
      // C clefs have roughly symmetric dark distribution and two thick vertical bars.
      // Identify which staff line the densest horizontal band (center of mass) aligns with.
      // IMPORTANT: C clefs are compact — they do NOT extend significantly beyond the staff.
      const isSymmetric = totalDark > 0 && Math.abs(upperDark - lowerDark) / totalDark < 0.25;
      const compactVertical = darkExtent <= spacing * 4.5 && darkExtent > spacing * 2.0;
      if (density > 0.15 && isSymmetric && compactVertical) {
        // Find the row with maximum dark pixels inside the staff region
        // (the C-clef "notch" or "bulge" sits exactly on the line that represents middle C)
        // Compute weighted center-of-mass of dark pixels within the staff
        let weightedSum = 0;
        let darkSum = 0;
        for (let y = staff[0]; y <= staff[4]; y++) {
          const rd = rowDark[y] || 0;
          weightedSum += y * rd;
          darkSum += rd;
        }

        if (darkSum > 0) {
          const centerY = weightedSum / darkSum;

          // Find which staff line is closest to the center-of-mass
          let bestLine = 2; // default to line 3 (alto)
          let bestLineDist = Infinity;
          for (let li = 0; li < 5; li++) {
            const dist = Math.abs(staff[li] - centerY);
            if (dist < bestLineDist) {
              bestLineDist = dist;
              bestLine = li;
            }
          }

          // Also check: does the region around this line have the highest density?
          // This validates that the center-of-mass truly corresponds to the clef center
          const bandHalf = Math.floor(spacing * 0.6);
          let bandDark = 0, bandTotal = 0;
          for (let y = staff[bestLine] - bandHalf; y <= staff[bestLine] + bandHalf; y++) {
            if (y < 0 || y >= height) continue;
            bandTotal++;
            bandDark += (rowDark[y] || 0);
          }
          const bandDensity = bandTotal > 0 ? bandDark / (bandTotal * scanW) : 0;

          // C clef typically has high density at the center line (> 35%)
          if (bandDensity > 0.30) {
            // staff[0] = line 1, staff[1] = line 2, staff[2] = line 3, staff[3] = line 4, staff[4] = line 5
            if (bestLine === 0) {
              clefs.push('soprano');  // C clef on line 1
            } else if (bestLine === 3) {
              clefs.push('tenor');    // C clef on line 4
            } else {
              clefs.push('alto');     // C clef on line 3 (most common; also covers line 2)
            }
            continue;
          }
        }
      }

      // ── Fallback ──
      clefs.push(this._clefFallback(staffIdx, systems, staves));
    }

    return clefs;
  }

  /**
   * Fallback clef assignment based on system position.
   * - 2-staff system: top = treble, bottom = bass
   * - 4-staff SATB: staves 0,1 = treble; staff 2 = treble (or tenor); staff 3 = bass
   * - Single staff: treble
   */
  static _clefFallback(staffIdx, systems, staves) {
    for (const sys of systems) {
      const idx = sys.staffIndices.indexOf(staffIdx);
      if (idx === -1) continue;
      const count = sys.staffIndices.length;

      if (count === 2) {
        // Grand staff or SA/TB pair: top = treble, bottom = bass
        return idx === 0 ? 'treble' : 'bass';
      }
      if (count === 4) {
        // SATB: soprano(treble), alto(treble), tenor(treble/tenor), bass(bass)
        if (idx <= 1) return 'treble';
        if (idx === 2) return 'treble'; // tenor voice typically in treble-8 or treble
        return 'bass';
      }
      if (count === 3) {
        // SAT+B or S+A+TB
        if (idx <= 1) return 'treble';
        return 'bass';
      }
    }
    return 'treble';
  }

  /* ───────────── 5. KEY SIGNATURE (ML) ───────────── */

  static async _detectKeySignature(imageUri, staves) {
    const result = { type: 'None', count: 0, semitoneShift: 0 };
    if (staves.length === 0) return result;

    try {
      const service = ModelService.getInstance();
      if (!service.isInitialized) {
        console.warn('Models not loaded — skipping key signature detection');
        return result;
      }

      // Use the key signature C model on the full image thumbnail
      const keyCInput = await ImageProcessor.preprocessForKeySignatureC(imageUri);
      const keyCPred = await service.predictKeySignature(keyCInput);
      const keyCArr = Array.from(keyCPred);
      keyCInput.dispose();

      const keyCIdx = keyCArr.indexOf(Math.max(...keyCArr));
      const typeNames = ['None', 'Sharps', 'Flats'];
      result.type = typeNames[keyCIdx] || 'None';

      if (result.type !== 'None') {
        const keyDInput = await ImageProcessor.preprocessForKeySignatureDigit(imageUri);
        const keyDPred = await service.predictDigitCount(keyDInput);
        const keyDArr = Array.from(keyDPred);
        keyDInput.dispose();

        result.count = keyDArr.indexOf(Math.max(...keyDArr));
      }

      // Calculate semitone shift for pitch adjustment
      if (result.type === 'Sharps') {
        // Circle of fifths: 1→G(+1 sharp), 2→D, 3→A, 4→E, 5→B, 6→F#, 7→C#
        result.semitoneShift = 0; // We'll adjust individual notes based on sharps
      } else if (result.type === 'Flats') {
        result.semitoneShift = 0; // Same — adjust individual notes
      }
    } catch (e) {
      console.warn('Key signature detection failed:', e.message);
    }

    return result;
  }

  /* ───────────── 7. DETECT TIME SIGNATURE ───────────── */

  /**
   * Detect time signature by scanning the region just after the clef/key signature area.
   * Time signatures are two stacked numbers (e.g., 4/4, 3/4, 6/8).
   * We look for two vertically-separated dark clusters in the expected region.
   */
  static _detectTimeSignature(tensor, width, height, staves) {
    const result = { beats: 4, beatType: 4 }; // Default: 4/4
    if (staves.length === 0) return result;

    const data = tensor.dataSync();
    const staff = staves[0]; // Time sig is the same for all staves
    const spacing = (staff[4] - staff[0]) / 4;

    // Time signature sits after clef + key signature, typically 8-20% from left
    const tsLeft = Math.floor(width * 0.06);
    const tsRight = Math.floor(width * 0.22);
    const staffMidY = Math.round((staff[0] + staff[4]) / 2);

    // Scan for two dense regions: upper half and lower half of the staff
    const upperRegion = { top: staff[0], bottom: staffMidY };
    const lowerRegion = { top: staffMidY, bottom: staff[4] };

    // Find the x position where we see two vertically-stacked dark blobs
    let bestTsX = -1;
    let bestTsScore = 0;
    const windowW = Math.max(4, Math.floor(spacing * 1.5));

    for (let x = tsLeft; x < tsRight - windowW; x += 2) {
      let upperDark = 0, lowerDark = 0;
      let upperTotal = 0, lowerTotal = 0;

      for (let wx = x; wx < x + windowW; wx++) {
        for (let y = upperRegion.top; y <= upperRegion.bottom; y++) {
          if (y < 0 || y >= height || wx >= width) continue;
          upperTotal++;
          if (data[y * width + wx] < 120) upperDark++;
        }
        for (let y = lowerRegion.top; y <= lowerRegion.bottom; y++) {
          if (y < 0 || y >= height || wx >= width) continue;
          lowerTotal++;
          if (data[y * width + wx] < 120) lowerDark++;
        }
      }

      const upperDensity = upperTotal > 0 ? upperDark / upperTotal : 0;
      const lowerDensity = lowerTotal > 0 ? lowerDark / lowerTotal : 0;

      // Both top and bottom should have digit-like density (15-55%)
      if (upperDensity > 0.15 && upperDensity < 0.55 &&
          lowerDensity > 0.15 && lowerDensity < 0.55) {
        const score = upperDensity + lowerDensity;
        if (score > bestTsScore) {
          bestTsScore = score;
          bestTsX = x;
        }
      }
    }

    if (bestTsX < 0) return result;

    // Classify the digits by analyzing their shape.
    // For compound meters like 12/8, the top region may contain two digits
    // side by side. We check by splitting the region in half and seeing if
    // both halves have significant density (= two-digit number).
    const topDigit = this._classifyTimeSigRegion(data, width, height,
      bestTsX, upperRegion.top, windowW, staffMidY - upperRegion.top, spacing);
    const bottomDigit = this._classifyTimeSigRegion(data, width, height,
      bestTsX, lowerRegion.top, windowW, lowerRegion.bottom - lowerRegion.top, spacing);

    if (topDigit > 0 && bottomDigit > 0) {
      result.beats = topDigit;
      result.beatType = bottomDigit;
    }

    // ── Validate / snap to musically legal values ──
    // Beat type (denominator) MUST be a power of 2: 1, 2, 4, 8, 16
    const legalBeatTypes = [1, 2, 4, 8, 16];
    if (!legalBeatTypes.includes(result.beatType)) {
      // Snap to nearest legal beat type
      let best = 4, bestDist = Infinity;
      for (const bt of legalBeatTypes) {
        const d = Math.abs(result.beatType - bt);
        if (d < bestDist) { bestDist = d; best = bt; }
      }
      console.log(`⚠️ Time sig denominator ${result.beatType} invalid, snapped to ${best}`);
      result.beatType = best;
    }
    // Numerator (beats): must be 1-16 and > 0
    if (result.beats < 1 || result.beats > 16) {
      console.log(`⚠️ Time sig numerator ${result.beats} invalid, defaulted to 4`);
      result.beats = 4;
    }

    // Detect compound meter: top number divisible by 3 (but not 3 itself) with beat type 8
    // Common compound meters: 6/8 (2 dotted-quarter beats), 9/8 (3), 12/8 (4)
    if (result.beats > 3 && result.beats % 3 === 0 && result.beatType === 8) {
      result.compound = true;
      result.compoundBeats = result.beats / 3; // actual felt beats per measure
    } else {
      result.compound = false;
    }

    // Record where the time signature region ends so noteheads can skip past it
    if (bestTsX >= 0) {
      result.endX = bestTsX + windowW + Math.floor(spacing * 0.5);
    }

    return result;
  }

  /**
   * Classify a time signature digit based on pixel density patterns.
   * Returns the most likely digit (1-12) or 4 as default.
   */
  static _classifyTimeSigDigit(data, imgW, imgH, x, y, w, h, spacing) {
    if (w <= 0 || h <= 0) return 4;

    // Count dark pixels in quadrants
    const midX = x + Math.floor(w / 2);
    const midY = y + Math.floor(h / 2);
    let topLeft = 0, topRight = 0, bottomLeft = 0, bottomRight = 0;
    let totalDark = 0, totalPixels = 0;

    for (let py = y; py < y + h && py < imgH; py++) {
      for (let px = x; px < x + w && px < imgW; px++) {
        if (px < 0 || py < 0) continue;
        totalPixels++;
        if (data[py * imgW + px] < 120) {
          totalDark++;
          if (py < midY) {
            if (px < midX) topLeft++; else topRight++;
          } else {
            if (px < midX) bottomLeft++; else bottomRight++;
          }
        }
      }
    }

    if (totalPixels === 0 || totalDark < 3) return 4;
    const density = totalDark / totalPixels;

    // Count horizontal segments (simplified shape analysis)
    let centerRowDark = 0;
    const centerRow = midY;
    if (centerRow >= 0 && centerRow < imgH) {
      for (let px = x; px < x + w && px < imgW; px++) {
        if (data[centerRow * imgW + px] < 120) centerRowDark++;
      }
    }
    const centerFill = w > 0 ? centerRowDark / w : 0;

    // Heuristic digit recognition based on density distribution:
    // "2" has more density in top-right + bottom-left
    // "3" has more density on the right side
    // "4" has top-left + center-right + bottom-right
    // "6" has a dense bottom and hollow top-right
    // "8" has balanced density, high overall

    const rightHeavy = (topRight + bottomRight) / Math.max(1, totalDark);
    const leftHeavy = (topLeft + bottomLeft) / Math.max(1, totalDark);
    const topHeavy = (topLeft + topRight) / Math.max(1, totalDark);
    const bottomHeavy = (bottomLeft + bottomRight) / Math.max(1, totalDark);

    // ── Multi-digit detection (12 = "1" followed by "2") ──
    // If the region is wider than expected for a single digit, check for compound digits.
    // (handled by the caller — this function only detects single digits)

    // Very high density + balanced = "8" (two loops, symmetric)
    // Widened thresholds: density 0.22+ (small digits can be sparse),
    // balance ±0.22 (real "8" glyphs are often slightly asymmetric)
    if (density > 0.22 && Math.abs(topHeavy - bottomHeavy) < 0.22) return 8;
    // "9": high density, strongly top-heavy (round head at top, tail going down)
    if (density > 0.25 && topHeavy > 0.58) return 9;
    // High density, strongly bottom heavy = "6"
    if (density > 0.25 && bottomHeavy > 0.58) return 6;
    // "7": top row is dense (horizontal stroke), rest is diagonal/sparse
    // Check if the very top rows are much denser than the bottom
    const topRowDark = topLeft + topRight;
    const bottomRowDark = bottomLeft + bottomRight;
    if (density > 0.15 && density < 0.28 && topRowDark > bottomRowDark * 2.0 && rightHeavy > 0.45) return 7;
    // "5": top heavy + left heavy body, horizontal stroke at top + curve below
    if (density > 0.20 && topHeavy > 0.48 && leftHeavy > 0.50 && centerFill > 0.3) return 5;
    // Medium density, center fill high, right-heavy = "3"
    if (density > 0.18 && rightHeavy > 0.55 && centerFill > 0.4) return 3;
    // Diagonal pattern (top-right + bottom-left) = "2"
    if (topRight > topLeft * 1.3 && bottomLeft > bottomRight * 1.3) return 2;
    // Narrow shape = could be "1"
    if (density < 0.15) return 1;
    // Default
    return 4;
  }

  /**
   * Classify a time signature region that may contain 1 or 2 digits.
   * For compound meters (12/8, 9/8), the numerator or denominator may be >9.
   * Returns the number (1-16).
   */
  static _classifyTimeSigRegion(data, imgW, imgH, x, y, w, h, spacing) {
    if (w <= 0 || h <= 0) return 4;

    // Check if this could be a two-digit number by splitting left/right
    const halfW = Math.floor(w / 2);
    const leftThird = Math.floor(w * 0.4);

    // Count dark pixels in left portion and right portion
    let leftDark = 0, rightDark = 0, leftTotal = 0, rightTotal = 0;
    for (let py = y; py < y + h && py < imgH; py++) {
      for (let px = x; px < x + w && px < imgW; px++) {
        if (px < 0 || py < 0) continue;
        if (data[py * imgW + px] < 120) {
          if (px < x + leftThird) leftDark++;
          else rightDark++;
        }
        if (px < x + leftThird) leftTotal++;
        else rightTotal++;
      }
    }

    const leftDensity = leftTotal > 0 ? leftDark / leftTotal : 0;
    const rightDensity = rightTotal > 0 ? rightDark / rightTotal : 0;

    // If both halves have significant density, it's likely two digits
    if (leftDensity > 0.10 && rightDensity > 0.12 && w > spacing * 1.2) {
      const d1 = this._classifyTimeSigDigit(data, imgW, imgH, x, y, leftThird, h, spacing);
      const d2 = this._classifyTimeSigDigit(data, imgW, imgH, x + leftThird, y, w - leftThird, h, spacing);
      const combined = d1 * 10 + d2;
      // Only accept reasonable compound values
      if ([10, 11, 12, 13, 14, 15, 16].includes(combined)) return combined;
    }

    // Single digit
    return this._classifyTimeSigDigit(data, imgW, imgH, x, y, w, h, spacing);
  }

  /* ───────────── 8. DETECT BAR LINES ───────────── */

  /**
   * Detect bar lines — thin vertical dark lines spanning the full staff height.
   * Returns array of { x, staffIndex, type } where type = 'single' | 'double' | 'final'
   */
  static _detectBarLines(tensor, width, height, staves) {
    const data = tensor.dataSync();
    const barLines = [];

    if (staves.length === 0) return barLines;

    for (let staffIdx = 0; staffIdx < staves.length; staffIdx++) {
      const staff = staves[staffIdx];
      const spacing = (staff[4] - staff[0]) / 4;
      const staffTop = staff[0];
      const staffBottom = staff[4];
      const staffHeight = staffBottom - staffTop;

      // Skip the clef/key/time sig area (must match _detectNoteHeads margin)
      const scanStart = Math.floor(width * 0.16);

      for (let x = scanStart; x < width - 2; x++) {
        // Count dark pixels in a thin vertical column spanning the staff
        let darkRun = 0;
        let totalScanned = 0;
        for (let y = staffTop - 2; y <= staffBottom + 2; y++) {
          if (y < 0 || y >= height) continue;
          totalScanned++;
          if (data[y * width + x] < 120) darkRun++;
        }

        if (totalScanned === 0) continue;
        const vertDensity = darkRun / totalScanned;

        // Bar line: very high vertical density (>80%) in a thin column
        if (vertDensity < 0.80) continue;

        // Confirm it's thin: check the columns 3px to left and right are NOT dark
        let leftDark = 0, rightDark = 0, sideTotal = 0;
        for (let y = staffTop; y <= staffBottom; y++) {
          if (y < 0 || y >= height) continue;
          sideTotal++;
          const lx = x - 3;
          const rx = x + 3;
          if (lx >= 0 && data[y * width + lx] < 120) leftDark++;
          if (rx < width && data[y * width + rx] < 120) rightDark++;
        }
        const leftDensity = sideTotal > 0 ? leftDark / sideTotal : 0;
        const rightDensity = sideTotal > 0 ? rightDark / sideTotal : 0;

        // At least one side should be mostly clear to confirm it's a bar line, not a stem
        if (leftDensity > 0.5 && rightDensity > 0.5) continue;

        // ── Stem rejection ──
        // Note stems are thin vertical lines, but they have a notehead blob
        // (dense ~circular region) attached at one end.  Check just above
        // and just below the staff for a dark blob that could be a notehead.
        let likelyNoteHead = false;
        const nhR = Math.max(3, Math.floor(spacing * 0.5));  // notehead radius
        for (const checkY of [staffTop - nhR * 2, staffBottom + nhR * 2]) {
          if (checkY < 0 || checkY >= height) continue;
          let nhDark = 0, nhTotal = 0;
          for (let dy = -nhR; dy <= nhR; dy++) {
            for (let dx = -nhR; dx <= nhR; dx++) {
              const py = checkY + dy;
              const px = x + dx;
              if (py < 0 || py >= height || px < 0 || px >= width) continue;
              nhTotal++;
              if (data[py * width + px] < 120) nhDark++;
            }
          }
          if (nhTotal > 0 && nhDark / nhTotal > 0.35) {
            likelyNoteHead = true;
            break;
          }
        }
        // Also check within the staff: a notehead attached to a stem that
        // spans the staff.  Look 1 spacing to left and right for a dense blob.
        if (!likelyNoteHead) {
          for (const dx of [-spacing, spacing]) {
            const checkX = Math.round(x + dx);
            if (checkX < 2 || checkX >= width - 2) continue;
            for (let cy = staffTop; cy <= staffBottom; cy += Math.floor(spacing * 0.5)) {
              let nhDark = 0, nhTotal = 0;
              for (let ddy = -nhR; ddy <= nhR; ddy++) {
                for (let ddx = -nhR; ddx <= nhR; ddx++) {
                  const py = cy + ddy;
                  const px = checkX + ddx;
                  if (py < 0 || py >= height || px < 0 || px >= width) continue;
                  nhTotal++;
                  if (data[py * width + px] < 120) nhDark++;
                }
              }
              if (nhTotal > 0 && nhDark / nhTotal > 0.45) {
                likelyNoteHead = true;
                break;
              }
            }
            if (likelyNoteHead) break;
          }
        }
        if (likelyNoteHead) continue;  // skip — this is a note stem, not a barline

        // Check for double/final bar (adjacent dark column within 4px)
        let type = 'single';
        let rightBarX = -1;
        for (let dx = 2; dx <= 6; dx++) {
          const nx = x + dx;
          if (nx >= width) break;
          let nDark = 0, nTotal = 0;
          for (let y = staffTop; y <= staffBottom; y++) {
            if (y < 0 || y >= height) continue;
            nTotal++;
            if (data[y * width + nx] < 120) nDark++;
          }
          if (nTotal > 0 && nDark / nTotal > 0.75) {
            rightBarX = nx;
            break;
          }
        }

        if (rightBarX > 0) {
          // Check if the right bar is thicker (final bar)
          let thickCount = 0;
          for (let dx = 1; dx <= 3; dx++) {
            const tx = rightBarX + dx;
            if (tx >= width) break;
            let tDark = 0, tTotal = 0;
            for (let y = staffTop; y <= staffBottom; y++) {
              if (y < 0 || y >= height) continue;
              tTotal++;
              if (data[y * width + tx] < 120) tDark++;
            }
            if (tTotal > 0 && tDark / tTotal > 0.6) thickCount++;
          }
          type = thickCount >= 2 ? 'final' : 'double';
        }

        // ── Repeat barline detection ──
        // Repeat signs have two dots in spaces adjacent to the middle line (line 3).
        // Forward repeat: dots on the RIGHT of the barline(s)
        // Backward repeat: dots on the LEFT
        // We check both sides for small dense circles near lines 2-3 and 3-4.
        //
        // IMPORTANT: strict validation to avoid false positives from nearby
        // noteheads and augmentation dots. Real repeat dots are:
        // 1. Very close to the barline (within ~half spacing)
        // 2. Small and isolated (not part of a notehead)
        // 3. Both dots present (one above and one below middle line)
        const dotR = Math.max(2, Math.floor(spacing * 0.2));
        const dot1Y = Math.round((staff[1] + staff[2]) / 2); // space between lines 2-3
        const dot2Y = Math.round((staff[2] + staff[3]) / 2); // space between lines 3-4

        const checkDots = (dotSide) => {
          const scanDir = dotSide === 'right' ? 1 : -1;
          const barEdge = dotSide === 'right'
            ? (rightBarX > 0 ? rightBarX + (type === 'final' ? 3 : 1) : x + 1)
            : x - 1;
          // Only search very close to the barline (2 to half-spacing pixels)
          const maxOffset = Math.max(4, Math.floor(spacing * 0.5));
          for (let offset = 2; offset <= maxOffset; offset++) {
            const dotX = barEdge + scanDir * offset;
            if (dotX < 0 || dotX >= width) continue;
            let d1 = 0, d2 = 0, dt = 0;
            for (let dy = -dotR; dy <= dotR; dy++) {
              for (let dx = -dotR; dx <= dotR; dx++) {
                const px = dotX + dx;
                if (px < 0 || px >= width) continue;
                dt++;
                const py1 = dot1Y + dy;
                const py2 = dot2Y + dy;
                if (py1 >= 0 && py1 < height && data[py1 * width + px] < 120) d1++;
                if (py2 >= 0 && py2 < height && data[py2 * width + px] < 120) d2++;
              }
            }
            // Require high fill for BOTH dots (>45%) — real dots are dense circles
            if (dt > 0 && d1 / dt > 0.45 && d2 / dt > 0.45) {
              // Isolation check: verify the dot is NOT part of a larger dark structure
              // (e.g., a notehead). Check an annular ring around each dot — it should
              // be mostly clear.
              const outerR = dotR + Math.max(2, Math.floor(spacing * 0.2));
              let ring1Dark = 0, ring2Dark = 0, ringTotal = 0;
              for (let dy = -outerR; dy <= outerR; dy++) {
                for (let dx = -outerR; dx <= outerR; dx++) {
                  // Skip the inner dot area
                  if (Math.abs(dy) <= dotR && Math.abs(dx) <= dotR) continue;
                  const px = dotX + dx;
                  if (px < 0 || px >= width) continue;
                  ringTotal++;
                  const py1 = dot1Y + dy;
                  const py2 = dot2Y + dy;
                  if (py1 >= 0 && py1 < height && data[py1 * width + px] < 120) ring1Dark++;
                  if (py2 >= 0 && py2 < height && data[py2 * width + px] < 120) ring2Dark++;
                }
              }
              // If the annular ring is too dark (>30%), it's likely a notehead, not a dot
              if (ringTotal > 0 && (ring1Dark / ringTotal > 0.30 || ring2Dark / ringTotal > 0.30)) {
                continue; // not isolated — skip
              }
              return true;
            }
          }
          return false;
        };

        const dotsRight = checkDots('right');
        const dotsLeft = checkDots('left');

        if (dotsLeft && dotsRight) {
          type = 'repeat_both';  // end-start repeat ||: ... :||:
        } else if (dotsLeft) {
          type = 'repeat_end';   // backward repeat :||
        } else if (dotsRight) {
          type = 'repeat_start'; // forward repeat ||:
        }

        // Don't duplicate — must be >1.5 spacing from the last bar line on this staff
        const tooClose = barLines.some(
          (b) => b.staffIndex === staffIdx && Math.abs(b.x - x) < spacing * 1.5
        );
        if (tooClose) continue;

        barLines.push({ x, staffIndex: staffIdx, type });

        // Skip past this bar line to avoid re-detecting the same line
        x += Math.max(4, Math.floor(spacing * 0.8));
      }
    }

    // Sort by staff then x
    barLines.sort((a, b) => {
      if (a.staffIndex !== b.staffIndex) return a.staffIndex - b.staffIndex;
      return a.x - b.x;
    });

    return barLines;
  }

  /**
   * Post-filter barline candidates using detected noteheads and
   * cross-staff consensus within each system.
   *
   * 1. **Notehead proximity**: A barline candidate is rejected if ANY
   *    detected notehead on the same staff sits within spacing×0.5 of it
   *    (this means it's actually a note stem, not a barline).
   *
   * 2. **Cross-staff consensus** (multi-stave systems only): Real barlines
   *    appear at the same x-position on ALL staves in a system.  Candidates
   *    that only appear on one stave of a 2-stave system are rejected.
   *
   * 3. **Minimum measure width**: Enforce a minimum horizontal distance
   *    of spacing×6 between consecutive barlines on the same staff to
   *    prevent micro-measures.
   */
  static _filterBarLines(barLines, noteHeads, staves, systems) {
    if (staves.length === 0 || barLines.length === 0) return barLines;
    const spacing = (staves[0][4] - staves[0][0]) / 4;

    // ── Step 1: Remove barline candidates that overlap noteheads ──
    const afterNH = barLines.filter(bar => {
      const closest = noteHeads
        .filter(nh => nh.staffIndex === bar.staffIndex)
        .reduce((best, nh) => {
          const d = Math.abs((nh.x || 0) - bar.x);
          return d < best ? d : best;
        }, Infinity);
      return closest > spacing * 0.5;
    });

    // ── Step 2: Cross-staff consensus ──
    const consensus = [];
    for (const sys of systems) {
      const sysStaves = sys.staffIndices;
      const sysBars = afterNH.filter(b => sysStaves.includes(b.staffIndex));

      if (sysStaves.length <= 1) {
        // Single-stave system — keep what we have
        consensus.push(...sysBars);
        continue;
      }

      // Multi-stave system: for each candidate on the first staff,
      // check if ALL other staves have a candidate within ±spacing pixels
      const primaryIdx = sysStaves[0];
      const primaryBars = sysBars.filter(b => b.staffIndex === primaryIdx);

      for (const pBar of primaryBars) {
        let allMatch = true;
        const matches = [pBar];
        for (const si of sysStaves) {
          if (si === primaryIdx) continue;
          const match = sysBars.find(
            b => b.staffIndex === si && Math.abs(b.x - pBar.x) < spacing
          );
          if (!match) { allMatch = false; break; }
          matches.push(match);
        }
        if (allMatch) consensus.push(...matches);
      }
    }

    // ── Step 3: Minimum measure width (spacing × 6) ──
    const minWidth = spacing * 6;
    const perStaff = new Map();
    for (const b of consensus) {
      if (!perStaff.has(b.staffIndex)) perStaff.set(b.staffIndex, []);
      perStaff.get(b.staffIndex).push(b);
    }

    const final = [];
    for (const [, bars] of perStaff) {
      bars.sort((a, b) => a.x - b.x);
      let lastX = -Infinity;
      for (const bar of bars) {
        if (bar.x - lastX >= minWidth) {
          final.push(bar);
          lastX = bar.x;
        }
      }
    }

    final.sort((a, b) => {
      if (a.staffIndex !== b.staffIndex) return a.staffIndex - b.staffIndex;
      return a.x - b.x;
    });

    return final;
  }

  /**
   * Group notes and rests into measures using detected bar lines.
   */
  static _groupIntoMeasures(notes, rests, barLines, staves) {
    const measures = [];
    if (staves.length === 0) return measures;

    const allEvents = [...notes, ...rests].sort((a, b) => {
      const sa = Number.isFinite(a.staffIndex) ? a.staffIndex : 999;
      const sb = Number.isFinite(b.staffIndex) ? b.staffIndex : 999;
      if (sa !== sb) return sa - sb;
      return (a.x || 0) - (b.x || 0);
    });

    for (let staffIdx = 0; staffIdx < staves.length; staffIdx++) {
      const staffBarLines = barLines
        .filter((b) => b.staffIndex === staffIdx)
        .map((b) => b.x)
        .sort((a, b) => a - b);

      const staffEvents = allEvents.filter((e) => e.staffIndex === staffIdx);
      if (staffEvents.length === 0) continue;

      // Add implicit boundaries at start and end
      const boundaries = [0, ...staffBarLines, Infinity];

      for (let i = 0; i < boundaries.length - 1; i++) {
        const left = boundaries[i];
        const right = boundaries[i + 1];
        const measureEvents = staffEvents.filter(
          (e) => (e.x || 0) >= left && (e.x || 0) < right
        );

        if (measureEvents.length > 0) {
          measures.push({
            measureIndex: i,
            staffIndex: staffIdx,
            events: measureEvents,
            left,
            right: right === Infinity ? undefined : right,
          });
        }
      }
    }

    return measures;
  }

  /* ───────────── 18. RHYTHM QUANTIZATION ───────────── */

  /**
   * Adjust note durations within each measure so they sum to the time signature.
   * This corrects duration classification errors that would otherwise cause
   * the music to drift out of time.
   *
   * Strategy:
   * - Calculate the expected beats per measure from the time signature.
   * - For each measure, sum the detected beat values.
   * - If the total is wrong, adjust individual note durations to fit.
   * - Prefer changing the shortest notes (most likely to be misclassified).
   */
  static _quantizeRhythms(measures, timeSignature) {
    const beatsPerMeasure = timeSignature.beats * (4 / timeSignature.beatType);

    const durationBeats = {
      whole: 4, dotted_whole: 6, half: 2, dotted_half: 3,
      quarter: 1, dotted_quarter: 1.5, eighth: 0.5, dotted_eighth: 0.75,
      sixteenth: 0.25, dotted_sixteenth: 0.375,
      '32nd': 0.125, dotted_32nd: 0.1875,
    };

    // Allowed durations sorted by beat value (for quantization)
    const allowedDurations = [
      { name: '32nd', beats: 0.125 },
      { name: 'dotted_32nd', beats: 0.1875 },
      { name: 'sixteenth', beats: 0.25 },
      { name: 'dotted_sixteenth', beats: 0.375 },
      { name: 'eighth', beats: 0.5 },
      { name: 'dotted_eighth', beats: 0.75 },
      { name: 'quarter', beats: 1 },
      { name: 'dotted_quarter', beats: 1.5 },
      { name: 'half', beats: 2 },
      { name: 'dotted_half', beats: 3 },
      { name: 'whole', beats: 4 },
      { name: 'dotted_whole', beats: 6 },
    ];

    const findClosestDuration = (targetBeats) => {
      let best = allowedDurations[0];
      let bestDist = Infinity;
      for (const d of allowedDurations) {
        const dist = Math.abs(d.beats - targetBeats);
        if (dist < bestDist) {
          bestDist = dist;
          best = d;
        }
      }
      return best;
    };

    let adjustedCount = 0;

    // Helper: group events into beat columns by x-proximity.
    // Chord notes (same x within half-spacing) are simultaneous, not sequential.
    // Returns array of columns: [{ events: [...], advance: number }]
    const buildBeatColumns = (events) => {
      const sorted = [...events].sort((a, b) => (a.x || 0) - (b.x || 0));
      const columns = [];
      let col = [sorted[0]];
      // Use a generous threshold — chord notes can be offset by a few pixels
      const threshold = 10;
      for (let i = 1; i < sorted.length; i++) {
        if (Math.abs((sorted[i].x || 0) - (col[0].x || 0)) < threshold) {
          col.push(sorted[i]);
        } else {
          columns.push(col);
          col = [sorted[i]];
        }
      }
      columns.push(col);
      return columns;
    };

    // Find the highest measureIndex per staff to detect last measures
    const maxMeasureIdx = new Map();
    for (const m of measures) {
      const prev = maxMeasureIdx.get(m.staffIndex) || 0;
      if (m.measureIndex > prev) maxMeasureIdx.set(m.staffIndex, m.measureIndex);
    }

    for (const measure of measures) {
      const events = measure.events;
      if (!events || events.length === 0) continue;

      // ── Chord-aware total: group into beat columns ──
      // Each beat column is a set of simultaneous notes (chords / multi-voice).
      // The column "advance" = the MINIMUM duration in the column (matches
      // AudioPlaybackService's beat-column approach).
      // The measure's total = sum of column advances.
      const columns = buildBeatColumns(events);

      let totalBeats = 0;
      for (const col of columns) {
        const colBeats = col.map(e => e.tiedBeats || durationBeats[e.duration] || 1);
        totalBeats += Math.min(...colBeats);
      }

      // If already correct (within small tolerance), skip
      if (Math.abs(totalBeats - beatsPerMeasure) < 0.1) continue;

      // ── Pickup / final measure: don't stretch a short first or last measure ──
      // Pickup measures (anacrusis) have fewer beats than a full measure.
      // The final measure often completes the pickup. Leave both as-is.
      const isFirst = measure.measureIndex === 0;
      const isLast = measure.measureIndex === (maxMeasureIdx.get(measure.staffIndex) || 0);
      if ((isFirst || isLast) && totalBeats < beatsPerMeasure) continue;

      if (columns.length === 1) {
        // Single beat column: set all non-tied events to fill the measure
        for (const evt of events) {
          if (evt.tiedBeats) continue;
          const closest = findClosestDuration(beatsPerMeasure);
          if (evt.duration !== closest.name) {
            evt.duration = closest.name;
            adjustedCount++;
          }
        }
        continue;
      }

      // Multiple columns: scale each column's advance proportionally
      const scale = beatsPerMeasure / totalBeats;

      for (const col of columns) {
        for (const evt of col) {
          if (evt.tiedBeats) continue; // tied notes are already precise
          const currentBeats = durationBeats[evt.duration] || 1;
          const targetBeats = currentBeats * scale;
          const closest = findClosestDuration(targetBeats);
          if (evt.duration !== closest.name) {
            evt.duration = closest.name;
            adjustedCount++;
          }
        }
      }

      // After proportional scaling, re-check with beat columns
      let newTotal = 0;
      const newColumns = buildBeatColumns(events);
      for (const col of newColumns) {
        const colBeats = col.map(e => e.tiedBeats || durationBeats[e.duration] || 1);
        newTotal += Math.min(...colBeats);
      }
      const remainder = beatsPerMeasure - newTotal;
      if (Math.abs(remainder) > 0.05) {
        // Find the last non-tied event in the last column to adjust
        const lastCol = newColumns[newColumns.length - 1];
        for (let i = lastCol.length - 1; i >= 0; i--) {
          if (!lastCol[i].tiedBeats) {
            const currentBeats = durationBeats[lastCol[i].duration] || 1;
            const closest = findClosestDuration(currentBeats + remainder);
            if (closest.beats > 0) {
              lastCol[i].duration = closest.name;
              adjustedCount++;
            }
            break;
          }
        }
      }
    }

    if (adjustedCount > 0) {
      console.log(`🎵 Quantized ${adjustedCount} note durations to fit ${beatsPerMeasure} beats/measure (chord-aware)`);
    } else {
      console.log(`🎵 Quantizer: all measures already correct (chord-aware columns)`);
    }
  }

  /* ───────────── 19. EXPAND REPEATS ───────────── */

  /**
   * Duplicate notes/rests within repeat barlines so the audio plays repeated sections.
   *
   * Supported patterns:
   *   repeat_start ... repeat_end  →  play section twice
   *   repeat_both (at the same barline) → end one repeat, start the next
   *   repeat_end with no preceding repeat_start → repeat from the beginning
   *
   * Volta brackets (1st/2nd endings) are NOT yet supported.
   */
  static _expandRepeats(notes, rests, barLines, staves) {
    if (!barLines || barLines.length === 0) {
      return { notes, rests };
    }

    // Check if any repeat barlines exist
    const hasRepeats = barLines.some(
      (b) => b.type === 'repeat_start' || b.type === 'repeat_end' || b.type === 'repeat_both'
    );
    if (!hasRepeats) return { notes, rests };

    // Collect unique repeat regions across all staves (repeats span the full system)
    // Use the first staff's barlines to define regions, then apply to all staves.
    const staffIndices = [...new Set(barLines.map((b) => b.staffIndex))].sort((a, b) => a - b);
    if (staffIndices.length === 0) return { notes, rests };

    // Find repeat regions from barlines on any staff (they should be at the same x)
    const allBars = barLines.filter(
      b => b.type === 'repeat_start' || b.type === 'repeat_end' || b.type === 'repeat_both'
    ).sort((a, b) => a.x - b.x);

    // Deduplicate by x position (repeats span all staves at the same x)
    const uniqueXBars = [];
    for (const bar of allBars) {
      const existing = uniqueXBars.find(b => Math.abs(b.x - bar.x) < 10);
      if (!existing) uniqueXBars.push({ x: bar.x, type: bar.type });
      else if (bar.type === 'repeat_both') existing.type = 'repeat_both';
    }

    // Build repeat regions
    const repeatRegions = [];
    let repeatStartX = null;

    for (const bar of uniqueXBars) {
      if (bar.type === 'repeat_start') {
        repeatStartX = bar.x;
      } else if (bar.type === 'repeat_end' || bar.type === 'repeat_both') {
        const leftX = repeatStartX ?? 0;
        const rightX = bar.x;
        if (rightX > leftX) {
          repeatRegions.push({ leftX, rightX });
        }
        repeatStartX = bar.type === 'repeat_both' ? bar.x : null;
      }
    }

    if (repeatRegions.length === 0) return { notes, rests };

    // Clone all events so we can modify x positions
    let expandedNotes = notes.map(n => ({ ...n }));
    let expandedRests = rests.map(r => ({ ...r }));

    // Process each repeat region from right to left (so x-shifting doesn't
    // affect earlier repeat regions)
    repeatRegions.sort((a, b) => b.leftX - a.leftX);

    for (const region of repeatRegions) {
      const { leftX, rightX } = region;
      const regionWidth = rightX - leftX;

      // Duplicate events in the region (from ALL staves)
      const regionNotes = expandedNotes.filter(
        n => (n.x || 0) >= leftX && (n.x || 0) <= rightX
      );
      const regionRests = expandedRests.filter(
        r => (r.x || 0) >= leftX && (r.x || 0) <= rightX
      );

      // Shift ALL post-repeat events forward to make room for the repeated section
      const xShift = regionWidth + 1;
      for (const n of expandedNotes) {
        if ((n.x || 0) > rightX) n.x = (n.x || 0) + xShift;
      }
      for (const r of expandedRests) {
        if ((r.x || 0) > rightX) r.x = (r.x || 0) + xShift;
      }

      // Insert duplicated notes/rests right after the original repeat region
      for (const n of regionNotes) {
        expandedNotes.push({
          ...n,
          x: (n.x || 0) + xShift,
          _repeated: true,
        });
      }
      for (const r of regionRests) {
        expandedRests.push({
          ...r,
          x: (r.x || 0) + xShift,
          _repeated: true,
        });
      }

      console.log(`🔄 Repeat expanded: x=${leftX}-${rightX}, ${regionNotes.length} notes + ${regionRests.length} rests duplicated`);
    }

    return {
      notes: expandedNotes,
      rests: expandedRests,
    };
  }

  /* ───────────── 9. DETECT LEDGER LINES ───────────── */

  /**
   * Detect short horizontal dark lines above/below each staff (ledger lines).
   * Returns an array of { x, y, staffIndex, position (above/below) }.
   * Also marks nearby note heads to improve pitch accuracy.
   */
  static _detectLedgerLines(tensor, width, height, staves) {
    const data = tensor.dataSync();
    const ledgerLines = [];

    for (let staffIdx = 0; staffIdx < staves.length; staffIdx++) {
      const staff = staves[staffIdx];
      const spacing = (staff[4] - staff[0]) / 4;

      // Scan above and below the staff
      const regionsToScan = [
        { // Above staff
          top: Math.max(0, staff[0] - Math.floor(spacing * 5)),
          bottom: staff[0] - Math.floor(spacing * 0.5),
          position: 'above',
        },
        { // Below staff
          top: staff[4] + Math.floor(spacing * 0.5),
          bottom: Math.min(height - 1, staff[4] + Math.floor(spacing * 5)),
          position: 'below',
        },
      ];

      for (const region of regionsToScan) {
        // Look for short horizontal dark runs on half-space intervals
        for (let y = region.top; y <= region.bottom; y++) {
          // Check if this row has a short dark run (ledger line = ~2-4× spacing wide)
          let bestRunStart = -1, bestRunLen = 0;
          let runStart = -1, runLen = 0;

          for (let x = 0; x < width; x++) {
            if (data[y * width + x] < 120) {
              if (runStart < 0) runStart = x;
              runLen++;
            } else {
              if (runLen > bestRunLen && runLen >= spacing * 0.8 && runLen <= spacing * 4) {
                bestRunLen = runLen;
                bestRunStart = runStart;
              }
              runStart = -1;
              runLen = 0;
            }
          }
          // Final check
          if (runLen > bestRunLen && runLen >= spacing * 0.8 && runLen <= spacing * 4) {
            bestRunLen = runLen;
            bestRunStart = runStart;
          }

          if (bestRunStart < 0) continue;

          // Reject if the dark run is too long (it's a staff line, not a ledger line)
          if (bestRunLen > width * 0.3) continue;

          // Verify it's thin (1-3px thick)
          let thickness = 0;
          const midX = bestRunStart + Math.floor(bestRunLen / 2);
          for (let dy = -3; dy <= 3; dy++) {
            const py = y + dy;
            if (py >= 0 && py < height && data[py * width + midX] < 120) thickness++;
          }
          if (thickness > 5) continue;

          // Check it's on a half-space interval from the nearest staff line
          const distToNearestLine = region.position === 'above'
            ? staff[0] - y
            : y - staff[4];

          const halfSpaces = distToNearestLine / (spacing / 2);
          const isOnInterval = Math.abs(halfSpaces - Math.round(halfSpaces)) < 0.4
            && Math.round(halfSpaces) % 2 === 0; // Even intervals = line positions

          if (!isOnInterval) continue;

          // Avoid duplicates
          const tooClose = ledgerLines.some(
            (l) => l.staffIndex === staffIdx && Math.abs(l.y - y) < spacing * 0.3
              && Math.abs(l.x - (bestRunStart + bestRunLen / 2)) < spacing * 2
          );
          if (tooClose) continue;

          ledgerLines.push({
            x: bestRunStart + Math.floor(bestRunLen / 2),
            y,
            staffIndex: staffIdx,
            position: region.position,
            width: bestRunLen,
          });
        }
      }
    }

    return ledgerLines;
  }

  /* ───────────── 10. DETECT NOTE HEADS ───────────── */

  static _detectNoteHeads(tensor, width, height, staves, systems = [], timeSignature = null) {
    const data = tensor.dataSync();
    const noteHeads = [];

    if (staves.length === 0) return noteHeads;

    // ── Build staff-line mask so we can ignore staff-line pixels ──
    // Use adaptive masking: for small staves (spacing < 20px), noteheads are only
    // ~10px tall — masking ±2 rows (5 rows) per line destroys 50% of the notehead.
    // Use ±1 for small staves to preserve fill ratio accuracy.
    const avgSpacing = staves.length > 0 ? (staves[0][4] - staves[0][0]) / 4 : 20;
    const maskRadius = avgSpacing >= 20 ? 2 : 1;
    const isStaffLineRow = new Uint8Array(height);
    for (const staff of staves) {
      for (const lineY of staff) {
        for (let dy = -maskRadius; dy <= maskRadius; dy++) {
          const ry = lineY + dy;
          if (ry >= 0 && ry < height) isStaffLineRow[ry] = 1;
        }
      }
    }

    // Pre-compute staff ranges
    // Default ±3×spacing covers 2-3 ledger lines.  For outermost staves
    // use ±2×spacing to avoid scanning title text above / footer below.
    const scanRegions = staves.map((staff, idx) => {
      const spacing = (staff[4] - staff[0]) / 4;
      const topExtend  = (idx === 0)                  ? spacing * 2 : spacing * 3;
      const botExtend  = (idx === staves.length - 1)   ? spacing * 2 : spacing * 3;
      return {
        top: Math.max(0, Math.floor(staff[0] - topExtend)),
        bottom: Math.min(height - 1, Math.ceil(staff[4] + botExtend)),
        spacing,
        staffTop: staff[0],
        staffBottom: staff[4],
        lines: staff,
      };
    });

    // ── Restrict scan regions for paired staves to exclude lyrics/text zone ──
    // In hymns, lyrics sit in the gap between treble and bass staves.
    // Text characters ('o','a','e', periods) look like noteheads to the blob detector.
    // Limit each staff to extending at most 2.5×spacing OR 25% of the gap.
    for (const system of systems) {
      const indices = system.staffIndices;
      for (let i = 0; i < indices.length - 1; i++) {
        const upperIdx = indices[i];
        const lowerIdx = indices[i + 1];
        const upperRegion = scanRegions[upperIdx];
        const lowerRegion = scanRegions[lowerIdx];
        if (!upperRegion || !lowerRegion) continue;

        const gap = lowerRegion.staffTop - upperRegion.staffBottom;
        if (gap > upperRegion.spacing * 3) {
          // Large gap → lyrics present — restrict heavily
          // Allow up to 2×spacing outward (covers 1 ledger line + some margin),
          // but cap at 20% of the gap to stay out of lyrics text
          const maxExtend = Math.min(upperRegion.spacing * 2.0, gap * 0.20);
          upperRegion.bottom = Math.min(
            upperRegion.bottom,
            Math.floor(upperRegion.staffBottom + maxExtend)
          );
          lowerRegion.top = Math.max(
            lowerRegion.top,
            Math.ceil(lowerRegion.staffTop - maxExtend)
          );
          console.log(`  🎼 Lyrics gap detected between staves ${upperIdx}-${lowerIdx}: gap=${gap.toFixed(0)}px, maxExtend=${maxExtend.toFixed(0)}px`);
        }
      }
    }

    const darkThreshold = 110;

    for (let staffIdx = 0; staffIdx < scanRegions.length; staffIdx++) {
      const region = scanRegions[staffIdx];
      const spacing = region.spacing;

      // Note head approximate dimensions — slightly wider than tall (elliptical)
      const halfW = Math.max(4, Math.floor(spacing * 0.55));
      const halfH = Math.max(3, Math.floor(spacing * 0.40));
      const minNoteGap = Math.max(8, Math.floor(spacing * 1.0));

      // Skip clef + key sig + time sig area — use detected endX if available,
      // otherwise fall back to 12% of width (conservative to catch pickup notes)
      const scanStartX = (timeSignature && timeSignature.endX > 0)
        ? timeSignature.endX
        : Math.floor(width * 0.12);
      const stepX = Math.max(1, Math.floor(spacing / 4));
      const stepY = Math.max(1, Math.floor(spacing / 4));

      for (let y = region.top; y <= region.bottom; y += stepY) {
        for (let x = scanStartX; x < width - halfW; x += stepX) {
          if (data[y * width + x] >= darkThreshold) continue;

          // Quick duplicate check
          const tooClose = noteHeads.some(
            (n) =>
              n.staffIndex === staffIdx &&
              Math.abs(n.x - x) < minNoteGap &&
              Math.abs(n.y - y) < minNoteGap
          );
          if (tooClose) continue;

          // ── Ellipse fill test ──
          let darkInEllipse = 0;
          let totalInEllipse = 0;
          let sumDarkX = 0;
          let sumDarkY = 0;
          let darkPixelCount = 0;
          let minDarkX = width, maxDarkX = 0;
          let minDarkY = height, maxDarkY = 0;

          for (let dy = -halfH; dy <= halfH; dy++) {
            for (let dx = -halfW; dx <= halfW; dx++) {
              const px = x + dx;
              const py = y + dy;
              if (px < 0 || px >= width || py < 0 || py >= height) continue;
              const ex = dx / halfW;
              const ey = dy / halfH;
              if (ex * ex + ey * ey > 1) continue;

              const pixVal = data[py * width + px];
              const onStaffLine = isStaffLineRow[py];

              if (!onStaffLine) {
                totalInEllipse++;
                if (pixVal < darkThreshold) {
                  darkInEllipse++;
                  sumDarkX += px;
                  sumDarkY += py;
                  darkPixelCount++;
                  minDarkX = Math.min(minDarkX, px);
                  maxDarkX = Math.max(maxDarkX, px);
                  minDarkY = Math.min(minDarkY, py);
                  maxDarkY = Math.max(maxDarkY, py);
                }
              } else {
                if (pixVal < darkThreshold) {
                  darkPixelCount++;
                  sumDarkX += px;
                  sumDarkY += py;
                  minDarkX = Math.min(minDarkX, px);
                  maxDarkX = Math.max(maxDarkX, px);
                  minDarkY = Math.min(minDarkY, py);
                  maxDarkY = Math.max(maxDarkY, py);
                }
              }
            }
          }

          if (totalInEllipse < 8) continue;
          const fillRatio = darkInEllipse / totalInEllipse;
          if (fillRatio < 0.48) continue; // solid noteheads need strong fill

          // ── Shape validation: noteheads should be roughly elliptical ──
          const blobW = maxDarkX - minDarkX + 1;
          const blobH = maxDarkY - minDarkY + 1;

          // Reject if too tall and narrow (likely a stem, barline, or accidental stroke)
          if (blobH > 0 && blobW > 0) {
            const aspectRatio = blobW / blobH;
            if (aspectRatio < 0.55) continue;  // too narrow/tall → not a notehead
            if (aspectRatio > 2.5) continue;   // too wide/flat → not a notehead
          }

          // Reject if too few dark pixels (text chars are thinner than real noteheads)
          if (darkPixelCount < Math.max(10, halfW * halfH * 0.4)) continue;

          // ── Compute centroid ──
          let centroidX = x;
          let centroidY = y;
          if (darkPixelCount > 0) {
            centroidX = Math.round(sumDarkX / darkPixelCount);
            centroidY = Math.round(sumDarkY / darkPixelCount);
          }

          // ── Reject bar lines: tall thin vertical dark columns ──
          let verticalRun = 0;
          for (let vy = centroidY - spacing * 3; vy < centroidY + spacing * 3; vy++) {
            const vyf = Math.floor(vy);
            if (vyf < 0 || vyf >= height) continue;
            if (data[vyf * width + centroidX] < darkThreshold) verticalRun++;
          }
          if (verticalRun > spacing * 3.0) continue;

          // ── Reject isolated thin marks (not enough substance for a notehead) ──
          if (fillRatio < 0.50 && darkPixelCount < halfW * 2.5) continue;

          // ── Symmetry check: noteheads have roughly balanced left/right dark ──
          let leftDark = 0, rightDark = 0;
          for (let dy = -halfH; dy <= halfH; dy++) {
            for (let dx = -halfW; dx <= halfW; dx++) {
              const px = centroidX + dx;
              const py = centroidY + dy;
              if (px < 0 || px >= width || py < 0 || py >= height) continue;
              if (isStaffLineRow[py]) continue;
              if (data[py * width + px] < darkThreshold) {
                if (dx < 0) leftDark++;
                else rightDark++;
              }
            }
          }
          const totalSym = leftDark + rightDark;
          if (totalSym > 4) {
            const symRatio = Math.min(leftDark, rightDark) / Math.max(leftDark, rightDark);
            if (symRatio < 0.30) continue; // asymmetric → likely text or artifact
          }

          // ── Staff-position proximity filter ──
          // Real noteheads sit ON staff lines, IN spaces, or on/between
          // ledger lines at regular half-space intervals.  Reject blobs at
          // random y-positions (text characters in titles / lyrics).
          const halfSpace = spacing / 2;
          const rawPos = (region.staffBottom - centroidY) / halfSpace;
          const roundedPos = Math.round(rawPos);
          const snapErr = Math.abs(rawPos - roundedPos);
          if (snapErr > 0.38) continue; // >38% off from nearest valid position
          // Reject if too far above/below staff (beyond reasonable ledger range)
          if (roundedPos < -5 || roundedPos > 13) continue;

          // Re-check: is this centroid already too close to an existing note?
          const dupCheck = noteHeads.some(
            (n) =>
              n.staffIndex === staffIdx &&
              Math.abs(n.x - centroidX) < minNoteGap &&
              Math.abs(n.y - centroidY) < minNoteGap
          );
          if (dupCheck) continue;

          noteHeads.push({
            x: centroidX,
            y: centroidY,
            radius: halfW,
            staffIndex: staffIdx,
            fillRatio,
          });

          // Skip ahead to avoid re-scanning the same blob
          x += halfW;
        }
      }
    }

    // Sort by staffIndex then x
    noteHeads.sort((a, b) => {
      if (a.staffIndex !== b.staffIndex) return a.staffIndex - b.staffIndex;
      return a.x - b.x;
    });

    if (noteHeads.length > 400) {
      console.warn(`⚠️ Too many note heads (${noteHeads.length}), trimming to 400`);
      return noteHeads.slice(0, 400);
    }

    return noteHeads;
  }

  /* ───────────── 10a. OCR CONFIDENCE GATE ───────────── */

  /**
   * Use the OCR neural network model as a confidence gate to reject false-positive
   * notehead candidates (text characters, noise, artifacts).
   *
   * Strategy: crop a 24×24 grayscale patch around each candidate, run through the
   * OCR model, and check if max(softmax) exceeds a threshold.  High-confidence
   * predictions indicate "this looks like a real music symbol" regardless of which
   * class it maps to.  Low-confidence → likely noise/text → reject.
   *
   * This is Label-Free — we don't need to know which class index is which symbol.
   */
  static async _ocrConfidenceGate(tensor, width, height, noteHeads, staves) {
    const modelService = ModelService.getInstance();
    if (!modelService.ocrModel) {
      console.log('  ⚠️ OCR model not available, skipping confidence gate');
      return noteHeads;
    }

    const data = tensor.dataSync();
    const accepted = [];
    let rejected = 0;

    // Process in batches to avoid excessive tensor creation
    const BATCH = 32;
    for (let b = 0; b < noteHeads.length; b += BATCH) {
      const batch = noteHeads.slice(b, b + BATCH);
      const tensors = [];

      for (const head of batch) {
        const staff = staves[head.staffIndex];
        if (!staff) {
          accepted.push(head);
          continue;
        }
        const spacing = (staff[4] - staff[0]) / 4;

        // Crop a region around the notehead, size ~spacing×spacing,
        // then resample to 24×24 for the model.
        // Use 2× spacing crop to capture stem/flag context (matches training data)
        const cropSize = Math.max(12, Math.round(spacing * 2.0));
        const halfCrop = Math.floor(cropSize / 2);
        const cx = head.x;
        const cy = head.y;

        // Extract and resample to 24×24 grayscale
        const patch = new Float32Array(24 * 24);
        for (let py = 0; py < 24; py++) {
          for (let px = 0; px < 24; px++) {
            const srcX = cx - halfCrop + (px / 23) * cropSize;
            const srcY = cy - halfCrop + (py / 23) * cropSize;
            const sx = Math.round(srcX);
            const sy = Math.round(srcY);
            if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
              // Normalize to [0,1] — model trained with dark=high (inverted)
              patch[py * 24 + px] = (255 - data[sy * width + sx]) / 255.0;
            }
          }
        }

        // Standardize: zero-mean, unit variance
        let mean = 0, std = 0;
        for (let i = 0; i < patch.length; i++) mean += patch[i];
        mean /= patch.length;
        for (let i = 0; i < patch.length; i++) std += (patch[i] - mean) ** 2;
        std = Math.sqrt(std / patch.length) || 1;
        for (let i = 0; i < patch.length; i++) patch[i] = (patch[i] - mean) / std;

        tensors.push({ head, patch });
      }

      // Run model predictions
      for (const { head, patch } of tensors) {
        try {
          const inputTensor = tf.tensor4d(Array.from(patch), [1, 24, 24, 1]);
          const prediction = modelService.ocrModel.predict(inputTensor);
          const probs = await prediction.data();
          inputTensor.dispose();
          prediction.dispose();

          // Find top class and probability
          let maxProb = 0, topClass = 0;
          for (let i = 0; i < probs.length; i++) {
            if (probs[i] > maxProb) { maxProb = probs[i]; topClass = i; }
          }

          // Compute normalized entropy (0 = certain, 1 = uniform)
          let entropy = 0;
          for (let i = 0; i < probs.length; i++) {
            if (probs[i] > 1e-8) entropy -= probs[i] * Math.log(probs[i]);
          }
          const maxEntropy = Math.log(probs.length); // ~4.26 for 71 classes
          const normalizedEntropy = entropy / maxEntropy;

          // Look up class label info
          const label = OCR_CLASS_LABELS[topClass] || { category: 'unknown', subtype: 'unknown' };

          // Attach OCR results to the head for downstream use
          head.ocrConfidence = maxProb;
          head.ocrEntropy = normalizedEntropy;
          head.ocrClass = topClass;
          head.ocrCategory = label.category;
          head.ocrSubtype = label.subtype;

          // ── Gate: reject if model sees this as a REST, not a note ──
          // Only reject with high confidence rest classification
          if (label.category === 'rest' && maxProb > 0.30 && normalizedEntropy < 0.80) {
            rejected++;
            continue;
          }

          // ── Gate: reject pure noise (near-uniform distribution) ──
          // maxProb > 0.15 AND normalizedEntropy < 0.92
          if (maxProb > 0.15 && normalizedEntropy < 0.92) {
            accepted.push(head);
          } else if (maxProb > 0.10) {
            // Borderline — keep but flag as low confidence
            head.ocrLowConf = true;
            accepted.push(head);
          } else {
            rejected++;
          }
        } catch (err) {
          accepted.push(head);
        }
      }
    }

    if (rejected > 0) {
      console.log(`  🔍 OCR gate rejected ${rejected} candidates (rest/noise)`);
    }
    return accepted;
  }

  /* ───────────── 11. DETECT INLINE ACCIDENTALS ───────────── */

  /**
   * Detect inline accidentals (♯ ♭ ♮) immediately to the left of each note head.
   * Accidentals are small dark clusters in the ~1.5 spacing region left of the notehead.
   * 
   * Sharp (♯): Two vertical strokes + two horizontal = high density, taller than wide
   * Flat (♭): Vertical stroke + lower right bulge = top-heavy density
   * Natural (♮): Vertical stroke + two short horizontal = moderate density, tall
   */
  static _detectInlineAccidentals(tensor, width, height, noteHeads, staves) {
    const data = tensor.dataSync();

    return noteHeads.map((head) => {
      if (!Number.isFinite(head.staffIndex) || head.staffIndex >= staves.length) {
        return { ...head, accidental: null };
      }

      const staff = staves[head.staffIndex];
      const spacing = (staff[4] - staff[0]) / 4;
      const thresh = 120;

      // Region to scan: 0.8–2.5 spacing to the left of the note head center.
      // Must start OUTSIDE the notehead (radius ≈ 0.55×spacing = ~8px) to avoid
      // reading the notehead itself, its stem, or beam fragments as accidentals.
      const noteRadius = Math.max(4, Math.floor(spacing * 0.6));
      const scanLeft = Math.max(0, Math.floor(head.x - spacing * 2.5));
      const scanRight = Math.max(0, Math.floor(head.x - noteRadius - 1));
      const scanTop = Math.max(0, Math.floor(head.y - spacing * 1.2));
      const scanBottom = Math.min(height - 1, Math.floor(head.y + spacing * 1.2));

      if (scanRight <= scanLeft || scanBottom <= scanTop) {
        return { ...head, accidental: null };
      }

      const regionW = scanRight - scanLeft + 1;
      const regionH = scanBottom - scanTop + 1;

      // ── Build dark pixel map and compute basic stats ──
      let totalPixels = 0, darkPixels = 0;
      let upperDark = 0, lowerDark = 0;
      let leftDark = 0, rightDark = 0;
      const midY = Math.floor((scanTop + scanBottom) / 2);
      const midX = Math.floor((scanLeft + scanRight) / 2);
      // Per-row and per-column dark pixel counts (RLE-inspired)
      const rowCounts = new Int32Array(regionH);
      const colCounts = new Int32Array(regionW);

      for (let y = scanTop; y <= scanBottom; y++) {
        for (let x = scanLeft; x <= scanRight; x++) {
          if (x >= width || y >= height) continue;
          totalPixels++;
          if (data[y * width + x] < thresh) {
            darkPixels++;
            rowCounts[y - scanTop]++;
            colCounts[x - scanLeft]++;
            if (y < midY) upperDark++; else lowerDark++;
            if (x < midX) leftDark++; else rightDark++;
          }
        }
      }

      if (totalPixels === 0) return { ...head, accidental: null };
      const density = darkPixels / totalPixels;
      if (density < 0.10) return { ...head, accidental: null };

      // ── Count vertical runs (long continuous dark columns) ──
      // Original app: isSharp/isNatural both look for vertical strokes
      let verticalRuns = 0;
      const vertRunPositions = [];
      for (let x = scanLeft; x <= scanRight; x += 1) {
        let runLen = 0;
        let maxRun = 0;
        for (let y = scanTop; y <= scanBottom; y++) {
          if (y >= height || x >= width) continue;
          if (data[y * width + x] < thresh) {
            runLen++;
            maxRun = Math.max(maxRun, runLen);
          } else {
            runLen = 0;
          }
        }
        if (maxRun > spacing * 0.8) {
          // Only count if far enough from previous vertical run
          if (vertRunPositions.length === 0 ||
              x - vertRunPositions[vertRunPositions.length - 1] > spacing * 0.25) {
            verticalRuns++;
            vertRunPositions.push(x);
          }
        }
      }

      // ── Count horizontal runs (crossing strokes) ──
      let horizontalRuns = 0;
      for (let y = scanTop; y <= scanBottom; y += 1) {
        let runLen = 0;
        let maxRun = 0;
        for (let x = scanLeft; x <= scanRight; x++) {
          if (x >= width || y >= height) continue;
          if (data[y * width + x] < thresh) {
            runLen++;
            maxRun = Math.max(maxRun, runLen);
          } else {
            runLen = 0;
          }
        }
        if (maxRun > spacing * 0.5) {
          horizontalRuns++;
        }
      }

      // ── Compute dark bounding box for tighter shape analysis ──
      let minDarkX = width, maxDarkX = 0, minDarkY = height, maxDarkY = 0;
      for (let y = scanTop; y <= scanBottom; y++) {
        for (let x = scanLeft; x <= scanRight; x++) {
          if (x >= width || y >= height) continue;
          if (data[y * width + x] < thresh) {
            minDarkX = Math.min(minDarkX, x);
            maxDarkX = Math.max(maxDarkX, x);
            minDarkY = Math.min(minDarkY, y);
            maxDarkY = Math.max(maxDarkY, y);
          }
        }
      }
      const darkW = maxDarkX - minDarkX + 1;
      const darkH = maxDarkY - minDarkY + 1;
      const darkAspect = darkW > 0 ? darkH / darkW : 1;

      // ── Analyze lower-half density for flat's bulge ──
      const thirdH = Math.floor(regionH / 3);
      let topThirdDark = 0, midThirdDark = 0, botThirdDark = 0;
      for (let i = 0; i < regionH; i++) {
        if (i < thirdH) topThirdDark += rowCounts[i];
        else if (i < thirdH * 2) midThirdDark += rowCounts[i];
        else botThirdDark += rowCounts[i];
      }

      let accidental = null;

      // ── Sharp (♯): two vertical strokes + two horizontal strokes ──
      // Characteristics: high density (grid pattern), multiple vertical runs,
      // aspect ratio roughly square to slightly tall, horizontal crossings.
      // Require BOTH multiple vertical AND horizontal runs to avoid false positives
      // from stems (single vertical run) or beams (horizontal only).
      if (verticalRuns >= 2 && horizontalRuns >= Math.floor(spacing * 0.5) && density > 0.22) {
        // Sharp: grid-like → should have substantial dark in both top and bottom
        const vertBalance = Math.min(upperDark, lowerDark) / Math.max(upperDark, lowerDark, 1);
        if (vertBalance > 0.35) {
          accidental = 'sharp';
        }
      }

      // ── Flat (♭): vertical stroke + lower-right bulge ──
      // Characteristics: tall (stem extends above), bottom half denser than top,
      // right side has more dark pixels in lower half.
      // Tighter thresholds to avoid confusing stems with flats.
      if (!accidental && density > 0.15 && darkAspect > 1.5) {
        // Flat has a vertical stroke (at least 1 long vertical run)
        // and the bottom 2/3 has a bulge (denser than top 1/3)
        const bottomDenser = (midThirdDark + botThirdDark) > topThirdDark * 1.0;
        // Right half of lower portion should have the bulge
        let lowerRightDark = 0, lowerLeftDark = 0;
        const bulgeTop = Math.floor(midY);
        for (let y = bulgeTop; y <= scanBottom; y++) {
          for (let x = scanLeft; x <= scanRight; x++) {
            if (x >= width || y >= height) continue;
            if (data[y * width + x] < thresh) {
              if (x > midX) lowerRightDark++; else lowerLeftDark++;
            }
          }
        }
        const hasBulge = lowerRightDark > lowerLeftDark * 0.7;
        if (verticalRuns >= 1 && bottomDenser && hasBulge && lowerDark > upperDark * 0.9) {
          accidental = 'flat';
        }
      }

      // ── Natural (♮): vertical stroke + two short horizontal bars ──
      // Characteristics: moderate density, tall but narrower than sharp,
      // exactly 1-2 vertical runs, fewer horizontal strokes than sharp.
      // Require higher density to avoid false positives from random dark areas.
      if (!accidental && density > 0.16 && darkAspect > 1.3) {
        if (verticalRuns >= 1 && verticalRuns <= 2 &&
            horizontalRuns >= Math.floor(spacing * 0.3) &&
            horizontalRuns < spacing * 1.2) {
          // Natural is more balanced than flat (no bulge)
          const vertBalance = Math.min(upperDark, lowerDark) / Math.max(upperDark, lowerDark, 1);
          if (vertBalance > 0.35) {
            accidental = 'natural';
          }
        }
      }

      return { ...head, accidental };
    });
  }

  /* ───────────── 12. CLASSIFY DURATIONS ───────────── */

  static _classifyDurations(tensor, width, height, noteHeads, staves) {
    const data = tensor.dataSync();

    return noteHeads.map((head) => {
      const staff = staves[head.staffIndex];
      if (!staff) return { ...head, duration: 'quarter' };

      const spacing = (staff[4] - staff[0]) / 4;

      // --- Build staff-line row set for masking ---
      const staffLineRows = new Set();
      for (const lineY of staff) {
        for (let dy = -1; dy <= 1; dy++) staffLineRows.add(lineY + dy);
      }

      // ═══════════════════════════════════════════════════
      // A) STEM DETECTION — multi-offset scan both sides
      // ═══════════════════════════════════════════════════
      let bestStemUp = 0;
      let bestStemDown = 0;
      const offsets = [];
      for (let frac = 0.4; frac <= 1.0; frac += 0.2) {
        offsets.push(Math.floor(head.radius * frac));
        offsets.push(-Math.floor(head.radius * frac));
      }
      const stemThreshold = 140;
      const startDy = Math.max(1, Math.floor(head.radius * 0.6));

      for (const off of offsets) {
        const sx = head.x + off;
        if (sx < 0 || sx >= width) continue;

        let up = 0, gap = 0;
        for (let dy = startDy; dy < spacing * 5; dy++) {
          const py = head.y - dy;
          if (py < 0) break;
          if (data[py * width + sx] < stemThreshold) { up = dy; gap = 0; }
          else { gap++; if (gap > 4) break; }
        }

        let down = 0; gap = 0;
        for (let dy = startDy; dy < spacing * 5; dy++) {
          const py = head.y + dy;
          if (py >= height) break;
          if (data[py * width + sx] < stemThreshold) { down = dy; gap = 0; }
          else { gap++; if (gap > 4) break; }
        }

        if (up > bestStemUp) bestStemUp = up;
        if (down > bestStemDown) bestStemDown = down;
      }

      const stemLength = Math.max(bestStemUp, bestStemDown);
      const hasStem = stemLength > spacing * 1.5;

      // ═══════════════════════════════════════════════════
      // B) BEAM & FLAG DETECTION — beams FIRST, then flags
      // ═══════════════════════════════════════════════════
      // Beams are more reliable (continuous horizontal dark bands connecting
      // two stems) whereas flags can be confused with music symbols or text.
      // We check beams first; only if no beams found, we look for flags.
      let beamFlagCount = 0; // final: 0=none, 1=eighth, 2=sixteenth, 3=32nd
      let detectionSource = 'none'; // 'beam', 'flag', or 'none'

      if (hasStem) {
        const stemDir = bestStemUp >= bestStemDown ? -1 : 1;
        const tipY = head.y + stemDir * stemLength;
        const stemX = stemDir === -1
          ? head.x + Math.floor(head.radius * 0.8)
          : head.x - Math.floor(head.radius * 0.8);

        // ── B1: BEAM scan (horizontal bands connecting stems) ──
        const beamScanRadius = Math.max(3, Math.floor(spacing * 0.25));
        const beamMinLen = Math.floor(spacing * 0.5);
        const beamCounts = { UL: 0, UR: 0, DL: 0, DR: 0 };

        for (const beamDirX of [-1, 1]) {
          for (let level = 0; level < 3; level++) {
            // Each beam level is ~0.45 spacing inward from tip
            const levelY = Math.round(tipY) - stemDir * Math.floor(level * spacing * 0.45);
            let bestLen = 0;

            for (let rowOff = -beamScanRadius; rowOff <= beamScanRadius; rowOff++) {
              const checkY = levelY + rowOff;
              if (checkY < 0 || checkY >= height) continue;
              let beamLen = 0, gapRun = 0;
              for (let dx = 1; dx <= spacing * 3.5; dx++) {
                const px = stemX + beamDirX * dx;
                if (px < 0 || px >= width) break;
                if (data[checkY * width + px] < stemThreshold) {
                  beamLen++; gapRun = 0;
                } else {
                  gapRun++;
                  if (gapRun > 4) break;
                }
              }
              bestLen = Math.max(bestLen, beamLen);
            }

            if (bestLen > beamMinLen) {
              const dirKey = (stemDir === -1 ? 'U' : 'D') + (beamDirX === -1 ? 'L' : 'R');
              beamCounts[dirKey] = Math.max(beamCounts[dirKey], level + 1);
            } else {
              break;
            }
          }
        }

        const maxBeams = Math.max(beamCounts.UL, beamCounts.UR, beamCounts.DL, beamCounts.DR);

        // Check for beam hooks (partial beams at deeper levels)
        let hookExtra = 0;
        if (maxBeams > 0) {
          for (let level = maxBeams; level < 3; level++) {
            const hookY = Math.round(tipY) - stemDir * Math.floor(level * spacing * 0.45);
            let hasHook = false;
            for (const hDir of [-1, 1]) {
              for (let rowOff = -1; rowOff <= 1; rowOff++) {
                const checkY = hookY + rowOff;
                if (checkY < 0 || checkY >= height) continue;
                let hookLen = 0;
                for (let dx = 1; dx <= spacing * 1.2; dx++) {
                  const px = stemX + hDir * dx;
                  if (px < 0 || px >= width) break;
                  if (data[checkY * width + px] < stemThreshold) hookLen++;
                }
                if (hookLen > spacing * 0.3 && hookLen < spacing * 1.5) {
                  hasHook = true; break;
                }
              }
              if (hasHook) break;
            }
            if (hasHook) hookExtra = level + 1 - maxBeams;
            else break;
          }
        }

        if (maxBeams > 0) {
          beamFlagCount = maxBeams + hookExtra;
          detectionSource = 'beam';
        }

        // ── B2: FLAG scan (only if no beams found) ──
        if (beamFlagCount === 0) {
          const flagDirX = stemDir === -1 ? 1 : -1;
          const fh = Math.max(4, Math.floor(spacing * 0.7));
          const fw = Math.max(5, Math.floor(spacing * 1.2));

          // Scan flag zones inward from stem tip toward notehead
          for (let fi = 0; fi < 3; fi++) {
            const zoneStart = tipY - stemDir * (fi * fh);
            const zoneEnd = tipY - stemDir * ((fi + 1) * fh);
            const y0 = Math.min(zoneStart, zoneEnd);
            const y1 = Math.max(zoneStart, zoneEnd);

            let flagDark = 0, flagTotal = 0;
            for (let dy = y0; dy <= y1; dy++) {
              for (let dx = 1; dx <= fw; dx++) {
                const px = stemX + flagDirX * dx;
                if (px >= 0 && px < width && dy >= 0 && dy < height) {
                  flagTotal++;
                  if (data[dy * width + px] < stemThreshold) flagDark++;
                }
              }
            }
            // Require ≥25% dark (slightly stricter than old 20% to reduce false positives)
            if (flagTotal > 0 && flagDark / flagTotal > 0.25) {
              beamFlagCount++;
            } else {
              break;
            }
          }
          if (beamFlagCount > 0) detectionSource = 'flag';
        }
      }

      // ═══════════════════════════════════════════════════
      // C) MULTI-STRATEGY FILL DETECTION — 3-strategy vote
      // ═══════════════════════════════════════════════════
      // Strategy 1: Inner rectangle density (avoids circular outline)
      // Strategy 2: Cross-pattern scan (horizontal + vertical center lines)
      // Strategy 3: Center cluster (small NxN patch at center)
      // 2-of-3 voting decides filled vs hollow.

      const r = head.radius;
      let fillVotes = 0; // count of strategies that say "filled"
      let rectFill = 0, crossFill = 0, centerFill = 0;

      // Strategy 1: Rectangle — sample the inner 50% bounding box
      {
        const halfR = Math.max(2, Math.floor(r * 0.5));
        let dark1 = 0, total1 = 0;
        for (let dy = -halfR; dy <= halfR; dy++) {
          for (let dx = -halfR; dx <= halfR; dx++) {
            const px = head.x + dx, py = head.y + dy;
            if (px < 0 || px >= width || py < 0 || py >= height) continue;
            if (staffLineRows.has(py)) continue;
            total1++;
            if (data[py * width + px] < 130) dark1++;
          }
        }
        rectFill = total1 > 0 ? dark1 / total1 : 0;
        if (rectFill > 0.35) fillVotes++;
      }

      // Strategy 2: Cross — horizontal + vertical lines through center
      {
        let dark2 = 0, total2 = 0;
        const scanR = Math.max(2, Math.floor(r * 0.7));
        // Horizontal line
        for (let dx = -scanR; dx <= scanR; dx++) {
          const px = head.x + dx, py = head.y;
          if (px < 0 || px >= width || py < 0 || py >= height) continue;
          if (staffLineRows.has(py)) continue;
          total2++;
          if (data[py * width + px] < 130) dark2++;
        }
        // Vertical line
        for (let dy = -scanR; dy <= scanR; dy++) {
          if (dy === 0) continue; // avoid double-counting center
          const px = head.x, py = head.y + dy;
          if (px < 0 || px >= width || py < 0 || py >= height) continue;
          if (staffLineRows.has(py)) continue;
          total2++;
          if (data[py * width + px] < 130) dark2++;
        }
        crossFill = total2 > 0 ? dark2 / total2 : 0;
        if (crossFill > 0.40) fillVotes++;
      }

      // Strategy 3: Center cluster — 3×3 or 5×5 patch at dead center
      {
        const patchR = Math.max(1, Math.min(2, Math.floor(r * 0.3)));
        let dark3 = 0, total3 = 0;
        for (let dy = -patchR; dy <= patchR; dy++) {
          for (let dx = -patchR; dx <= patchR; dx++) {
            const px = head.x + dx, py = head.y + dy;
            if (px < 0 || px >= width || py < 0 || py >= height) continue;
            if (staffLineRows.has(py)) continue;
            total3++;
            if (data[py * width + px] < 130) dark3++;
          }
        }
        centerFill = total3 > 0 ? dark3 / total3 : 0;
        if (centerFill > 0.30) fillVotes++;
      }

      // 2-of-3 voting
      let isFilled = fillVotes >= 2;

      // Beamed/flagged notes are ALWAYS filled in standard notation
      if (beamFlagCount > 0) isFilled = true;

      // ═══════════════════════════════════════════════════
      // D) OCR-INFORMED DISAMBIGUATION
      // ═══════════════════════════════════════════════════
      // If _ocrConfidenceGate attached ocrCategory + ocrSubtype, use it
      // to resolve ambiguity or override heuristic errors.
      const ocrCat = head.ocrCategory;  // 'note', 'rest', 'unknown', or undefined
      const ocrSub = head.ocrSubtype;   // 'quarter', 'eighth', 'half', 'whole', 'sixteenth', '32nd', or undefined

      // OCR can override fill detection when the image-based vote is split (1-of-3 or 2-of-3)
      if (ocrCat === 'note' && ocrSub) {
        const ocrWantsFilled = (ocrSub === 'quarter' || ocrSub === 'eighth' ||
                                ocrSub === 'sixteenth' || ocrSub === '32nd');
        const ocrWantsHollow = (ocrSub === 'half' || ocrSub === 'whole');
        const fillAmbiguous = (fillVotes === 1 || fillVotes === 2);

        if (fillAmbiguous) {
          // Trust OCR when fill voting is borderline
          if (ocrWantsFilled) isFilled = true;
          if (ocrWantsHollow && beamFlagCount === 0) isFilled = false;
        }

        // OCR can also suggest beam/flag count if heuristic found none
        if (beamFlagCount === 0 && hasStem && isFilled) {
          if (ocrSub === 'eighth') beamFlagCount = 1;
          else if (ocrSub === 'sixteenth') beamFlagCount = 2;
          else if (ocrSub === '32nd') beamFlagCount = 3;
        }
      }

      // ═══════════════════════════════════════════════════
      // E) DURATION DECISION TREE
      // ═══════════════════════════════════════════════════
      //
      // Session.dat type mappings for reference:
      //   10=Quarter(1000), 11=Whole(4000), 13=Half(2000),
      //   15=Eighth(500), 16=Sixteenth(250), 17=32nd(125)
      //
      // ┌─────────────┬───────┬────────────┬──────────┐
      // │ has stem?    │ fill? │ beams/flags │ duration │
      // ├─────────────┼───────┼────────────┼──────────┤
      // │ NO           │ open  │ —          │ whole    │
      // │ NO           │ fill  │ —          │ quarter* │
      // │ YES          │ open  │ 0          │ half     │
      // │ YES          │ fill  │ 0          │ quarter  │
      // │ YES          │ fill  │ 1          │ eighth   │
      // │ YES          │ fill  │ 2          │ sixteenth│
      // │ YES          │ fill  │ ≥3         │ 32nd     │
      // └─────────────┴───────┴────────────┴──────────┘
      // * stemless filled → likely a cue or grace note, treat as quarter

      let duration;
      if (!hasStem) {
        duration = isFilled ? 'quarter' : 'whole';
      } else if (!isFilled) {
        duration = 'half';
      } else if (beamFlagCount >= 3) {
        duration = '32nd';
      } else if (beamFlagCount === 2) {
        duration = 'sixteenth';
      } else if (beamFlagCount === 1) {
        duration = 'eighth';
      } else {
        duration = 'quarter';
      }

      // stemDir: -1 = stem up (upper voice), 1 = stem down (lower voice), 0 = no stem
      const stemDirection = hasStem ? (bestStemUp >= bestStemDown ? -1 : 1) : 0;
      return {
        ...head,
        duration,
        stemLength,
        stemDir: stemDirection,
        _fillDebug: { rectFill: rectFill.toFixed(2), crossFill: crossFill.toFixed(2),
                      centerFill: centerFill.toFixed(2), votes: fillVotes,
                      beamFlagCount, detectionSource,
                      ocrSub: ocrSub || '—' },
      };
    });
  }

  /* ───────────── 8. MAP TO PITCHES ───────────── */

  /**
   * Direct lookup tables: staffPosition → { name, midi }
   *
   * Staff position 0 = bottom line (line 5), each +1 = one half-space up.
   * Even positions sit ON lines: 0=line5, 2=line4, 4=line3, 6=line2, 8=line1
   * Odd positions sit IN spaces: 1=space4-5, 3=space3-4, …
   *
   * Treble (G2):          Bass (F4):           Alto (C3):        Soprano (C1):      Tenor (C4):
   *   pos note MIDI        pos note MIDI        pos note MIDI     pos note MIDI      pos note MIDI
   *    0  E4   64           0  G2   43           0  F3   53        0  B2   47          0  A3   57
   *    4  B4   71           4  D3   50           4  C4   60        4  F3   53          4  E4   64
   *    8  F5   77           8  A3   57           8  G4   67        8  C4   60          8  B4   71
   */

  static _TREBLE_TABLE = [
    /* -4 */ { name: 'A', midi: 57 },
    /* -3 */ { name: 'B', midi: 59 },
    /* -2 */ { name: 'C', midi: 60 },
    /* -1 */ { name: 'D', midi: 62 },
    /*  0 */ { name: 'E', midi: 64 },
    /*  1 */ { name: 'F', midi: 65 },
    /*  2 */ { name: 'G', midi: 67 },
    /*  3 */ { name: 'A', midi: 69 },
    /*  4 */ { name: 'B', midi: 71 },
    /*  5 */ { name: 'C', midi: 72 },
    /*  6 */ { name: 'D', midi: 74 },
    /*  7 */ { name: 'E', midi: 76 },
    /*  8 */ { name: 'F', midi: 77 },
    /*  9 */ { name: 'G', midi: 79 },
    /* 10 */ { name: 'A', midi: 81 },
    /* 11 */ { name: 'B', midi: 83 },
    /* 12 */ { name: 'C', midi: 84 },
    /* 13 */ { name: 'D', midi: 86 },
  ];

  static _BASS_TABLE = [
    /* -4 */ { name: 'C', midi: 36 },
    /* -3 */ { name: 'D', midi: 38 },
    /* -2 */ { name: 'E', midi: 40 },
    /* -1 */ { name: 'F', midi: 41 },
    /*  0 */ { name: 'G', midi: 43 },
    /*  1 */ { name: 'A', midi: 45 },
    /*  2 */ { name: 'B', midi: 47 },
    /*  3 */ { name: 'C', midi: 48 },
    /*  4 */ { name: 'D', midi: 50 },
    /*  5 */ { name: 'E', midi: 52 },
    /*  6 */ { name: 'F', midi: 53 },
    /*  7 */ { name: 'G', midi: 55 },
    /*  8 */ { name: 'A', midi: 57 },
    /*  9 */ { name: 'B', midi: 59 },
    /* 10 */ { name: 'C', midi: 60 },
    /* 11 */ { name: 'D', midi: 62 },
    /* 12 */ { name: 'E', midi: 64 },
    /* 13 */ { name: 'F', midi: 65 },
  ];

  // Alto clef: middle C is on line 3 (middle line), position 4
  static _ALTO_TABLE = [
    /* -4 */ { name: 'B', midi: 47 },
    /* -3 */ { name: 'C', midi: 48 },
    /* -2 */ { name: 'D', midi: 50 },
    /* -1 */ { name: 'E', midi: 52 },
    /*  0 */ { name: 'F', midi: 53 },
    /*  1 */ { name: 'G', midi: 55 },
    /*  2 */ { name: 'A', midi: 57 },
    /*  3 */ { name: 'B', midi: 59 },
    /*  4 */ { name: 'C', midi: 60 },
    /*  5 */ { name: 'D', midi: 62 },
    /*  6 */ { name: 'E', midi: 64 },
    /*  7 */ { name: 'F', midi: 65 },
    /*  8 */ { name: 'G', midi: 67 },
    /*  9 */ { name: 'A', midi: 69 },
    /* 10 */ { name: 'B', midi: 71 },
    /* 11 */ { name: 'C', midi: 72 },
    /* 12 */ { name: 'D', midi: 74 },
    /* 13 */ { name: 'E', midi: 76 },
  ];

  // Soprano clef: middle C is on line 1 (top line), position 8
  static _SOPRANO_TABLE = [
    /* -4 */ { name: 'E', midi: 40 },
    /* -3 */ { name: 'F', midi: 41 },
    /* -2 */ { name: 'G', midi: 43 },
    /* -1 */ { name: 'A', midi: 45 },
    /*  0 */ { name: 'B', midi: 47 },
    /*  1 */ { name: 'C', midi: 48 },
    /*  2 */ { name: 'D', midi: 50 },
    /*  3 */ { name: 'E', midi: 52 },
    /*  4 */ { name: 'F', midi: 53 },
    /*  5 */ { name: 'G', midi: 55 },
    /*  6 */ { name: 'A', midi: 57 },
    /*  7 */ { name: 'B', midi: 59 },
    /*  8 */ { name: 'C', midi: 60 },
    /*  9 */ { name: 'D', midi: 62 },
    /* 10 */ { name: 'E', midi: 64 },
    /* 11 */ { name: 'F', midi: 65 },
    /* 12 */ { name: 'G', midi: 67 },
    /* 13 */ { name: 'A', midi: 69 },
  ];

  // Tenor clef: middle C is on line 4 (second from top), position 2
  static _TENOR_TABLE = [
    /* -4 */ { name: 'D', midi: 50 },
    /* -3 */ { name: 'E', midi: 52 },
    /* -2 */ { name: 'F', midi: 53 },
    /* -1 */ { name: 'G', midi: 55 },
    /*  0 */ { name: 'A', midi: 57 },
    /*  1 */ { name: 'B', midi: 59 },
    /*  2 */ { name: 'C', midi: 60 },
    /*  3 */ { name: 'D', midi: 62 },
    /*  4 */ { name: 'E', midi: 64 },
    /*  5 */ { name: 'F', midi: 65 },
    /*  6 */ { name: 'G', midi: 67 },
    /*  7 */ { name: 'A', midi: 69 },
    /*  8 */ { name: 'B', midi: 71 },
    /*  9 */ { name: 'C', midi: 72 },
    /* 10 */ { name: 'D', midi: 74 },
    /* 11 */ { name: 'E', midi: 76 },
    /* 12 */ { name: 'F', midi: 77 },
    /* 13 */ { name: 'G', midi: 79 },
  ];

  // Offset: table index 0 corresponds to staffPosition -4
  static _TABLE_OFFSET = 4;

  static _mapToPitches(noteHeads, staves, systems, keySignature, clefs = null, barLines = []) {
    // Sharps order: F C G D A E B  (circle of fifths)
    // Flats order:  B E A D G C F
    const sharpNotes = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
    const flatNotes  = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

    const keySigNotes = new Set();
    if (keySignature.type === 'Sharps') {
      for (let i = 0; i < Math.min(keySignature.count, sharpNotes.length); i++) {
        keySigNotes.add(sharpNotes[i]);
      }
    } else if (keySignature.type === 'Flats') {
      for (let i = 0; i < Math.min(keySignature.count, flatNotes.length); i++) {
        keySigNotes.add(flatNotes[i]);
      }
    }

    // Build barline boundaries per staff for measure-aware accidental persistence.
    // Key: staffIndex → sorted array of barline x positions.
    const barBoundaries = new Map();
    for (const bl of barLines) {
      if (!barBoundaries.has(bl.staffIndex)) barBoundaries.set(bl.staffIndex, []);
      barBoundaries.get(bl.staffIndex).push(bl.x);
    }
    for (const [, arr] of barBoundaries) arr.sort((a, b) => a - b);

    // Helper: given a staff index and an x position, return a measure id
    // so we know when to reset accidental state.
    const getMeasureId = (staffIdx, x) => {
      const bounds = barBoundaries.get(staffIdx);
      if (!bounds || bounds.length === 0) return 0;
      let id = 0;
      for (const bx of bounds) {
        if (x >= bx) id++;
        else break;
      }
      return id;
    };

    // Sort notes left-to-right within each staff so accidental persistence works
    const sortedHeads = [...noteHeads].sort((a, b) => {
      if (a.staffIndex !== b.staffIndex) return a.staffIndex - b.staffIndex;
      return (a.x || 0) - (b.x || 0);
    });

    // Per-staff, per-measure accidental state.
    // Key: `${staffIndex}:${measureId}:${staffPosition}` → 'sharp' | 'flat' | 'natural'
    const accidentalState = new Map();

    const results = sortedHeads.map((head) => {
      const staff = staves[head.staffIndex];
      if (!staff) {
        return { ...head, pitch: 'C', midiNote: 60, octave: 4, staffPosition: 0 };
      }

      const spacing = (staff[4] - staff[0]) / 4;
      const halfSpace = spacing / 2;

      // ── Improved pitch snapping: use actual staff line Y positions ──
      const knownPositions = [];
      for (let li = 0; li < 5; li++) {
        const linePos = li * 2;
        const lineY = staff[4 - li];
        knownPositions.push({ y: lineY, staffPos: linePos });
      }
      for (let li = 0; li < 4; li++) {
        const spacePos = li * 2 + 1;
        const spaceY = (staff[4 - li] + staff[4 - li - 1]) / 2;
        knownPositions.push({ y: spaceY, staffPos: spacePos });
      }
      for (let ext = 1; ext <= 4; ext++) {
        knownPositions.push({ y: staff[4] + halfSpace * ext, staffPos: -ext });
        knownPositions.push({ y: staff[0] - halfSpace * ext, staffPos: 8 + ext });
      }

      let bestDist = Infinity;
      let staffPosition = 0;
      for (const kp of knownPositions) {
        const dist = Math.abs(head.y - kp.y);
        if (dist < bestDist) {
          bestDist = dist;
          staffPosition = kp.staffPos;
        }
      }

      if (bestDist > halfSpace * 0.6) {
        const rawPos = (staff[4] - head.y) / halfSpace;
        staffPosition = Math.round(rawPos);
      }

      // Determine clef
      let clefType = 'treble';
      if (clefs && clefs[head.staffIndex]) {
        clefType = clefs[head.staffIndex];
      } else {
        for (const system of systems) {
          if (system.staffIndices.length === 2 && system.staffIndices[1] === head.staffIndex) {
            clefType = 'bass';
            break;
          }
        }
      }

      const isBassClef = clefType === 'bass';

      let table;
      if (clefType === 'soprano') table = this._SOPRANO_TABLE;
      else if (clefType === 'tenor') table = this._TENOR_TABLE;
      else if (clefType === 'alto') table = this._ALTO_TABLE;
      else if (isBassClef) table = this._BASS_TABLE;
      else table = this._TREBLE_TABLE;

      // Clamp position to table range
      const minPos = -this._TABLE_OFFSET;
      const maxPos = table.length - 1 - this._TABLE_OFFSET;
      const clampedPos = Math.max(minPos, Math.min(maxPos, staffPosition));
      const tableIdx = clampedPos + this._TABLE_OFFSET;

      const entry = table[tableIdx];
      let pitchName = entry.name;
      let midiNote = entry.midi;

      // Extrapolate outside table range
      if (staffPosition < minPos) {
        const stepsBelow = minPos - staffPosition;
        midiNote -= Math.ceil(stepsBelow / 7) * 12;
      } else if (staffPosition > maxPos) {
        const stepsAbove = staffPosition - maxPos;
        midiNote += Math.ceil(stepsAbove / 7) * 12;
      }

      // ── Accidental logic (with measure-level persistence) ──
      // In standard music theory:
      //   1. Key signature applies to all notes of that pitch name (all octaves).
      //   2. An inline accidental overrides the key signature for that specific
      //      staff position for the rest of the measure.
      //   3. All state resets at each barline.
      const measureId = getMeasureId(head.staffIndex, head.x || 0);
      const stateKey = `${head.staffIndex}:${measureId}:${staffPosition}`;

      // Step 1: Apply key signature
      if (keySigNotes.has(pitchName)) {
        if (keySignature.type === 'Sharps') midiNote += 1;
        else if (keySignature.type === 'Flats') midiNote -= 1;
      }

      // Step 2: Check if this note has an explicit inline accidental
      if (head.accidental === 'sharp' || head.accidental === 'flat' || head.accidental === 'natural') {
        // Record it in the measure accidental state
        accidentalState.set(stateKey, head.accidental);
      }

      // Step 3: Apply the active accidental for this position in this measure
      const activeAcc = accidentalState.get(stateKey);
      if (activeAcc === 'sharp') {
        // Undo key sig first (if any), then apply sharp
        if (keySigNotes.has(pitchName)) {
          if (keySignature.type === 'Sharps') {
            // Key sig already sharped — no change needed (sharp on sharp = same)
          } else if (keySignature.type === 'Flats') {
            midiNote += 1; // undo flat
            midiNote += 1; // apply sharp
          }
        } else {
          midiNote += 1; // no key sig on this note, just sharp it
        }
      } else if (activeAcc === 'flat') {
        if (keySigNotes.has(pitchName)) {
          if (keySignature.type === 'Flats') {
            // Key sig already flatted — no change needed
          } else if (keySignature.type === 'Sharps') {
            midiNote -= 1; // undo sharp
            midiNote -= 1; // apply flat
          }
        } else {
          midiNote -= 1;
        }
      } else if (activeAcc === 'natural') {
        // Natural cancels key signature accidental
        if (keySigNotes.has(pitchName)) {
          if (keySignature.type === 'Sharps') midiNote -= 1;
          else if (keySignature.type === 'Flats') midiNote += 1;
        }
      }
      // If no explicit accidental and no persisted state, key sig stands (already applied)

      // Clamp to piano range
      midiNote = Math.max(21, Math.min(108, midiNote));

      return {
        ...head,
        pitch: pitchName,
        midiNote,
        staffPosition,
        isBassClef,
        clefType,
      };
    });

    // Return in original order (preserve noteHeads order)
    const headToResult = new Map();
    for (let i = 0; i < sortedHeads.length; i++) {
      headToResult.set(sortedHeads[i], results[i]);
    }
    return noteHeads.map((h) => headToResult.get(h) || { ...h, pitch: 'C', midiNote: 60, staffPosition: 0 });
  }

  /* ───────────── 9. ASSIGN VOICES ───────────── */

  static _assignVoices(notesWithPitch, staves) {
    const voicedNotes = [];
    let noteId = 0;

    // Deduplicate: remove notes at nearly the same position
    const deduped = [];
    const seen = new Set();
    for (const note of notesWithPitch) {
      const key = `${Math.round(note.x / 3)}-${Math.round(note.y / 3)}-${note.midiNote}`;
      if (!seen.has(key)) {
        deduped.push(note);
        seen.add(key);
      }
    }

    // Sort: staffIndex asc, x asc, then pitch desc (higher notes first)
    deduped.sort((a, b) => {
      if (a.staffIndex !== b.staffIndex) return a.staffIndex - b.staffIndex;
      if (Math.abs(a.x - b.x) > 5) return a.x - b.x;
      return (b.midiNote || 0) - (a.midiNote || 0);
    });

    // SATB voice assignment using stem direction (the proper way):
    //   Treble clef staff: stem up (-1) → Soprano,  stem down (1) → Alto
    //   Bass   clef staff: stem up (-1) → Tenor,    stem down (1) → Bass
    // When stem direction is unknown (whole notes, etc.), fall back to
    // pitch comparison: within the same staff at the same x, higher pitch = upper voice.
    //
    // For staves with only a single voice (no opposing stems), everything
    // on a treble staff defaults to Soprano, bass staff to Bass.
    for (const note of deduped) {
      const isLowerClef = note.isBassClef || note.clefType === 'tenor';

      let voice;
      if (note.stemDir === -1) {
        // Stem up → upper voice
        voice = isLowerClef ? 'Tenor' : 'Soprano';
      } else if (note.stemDir === 1) {
        // Stem down → lower voice
        voice = isLowerClef ? 'Bass' : 'Alto';
      } else {
        // No stem (whole note) — check if there are other notes at the same
        // x on this staff to decide; otherwise default to upper voice
        const hasOtherAtSameX = deduped.some(
          n => n !== note &&
               n.staffIndex === note.staffIndex &&
               Math.abs(n.x - note.x) < 8 &&
               n.midiNote !== note.midiNote
        );
        if (hasOtherAtSameX) {
          // Multiple notes at same x → higher pitch = upper voice
          const isHigher = !deduped.some(
            n => n !== note &&
                 n.staffIndex === note.staffIndex &&
                 Math.abs(n.x - note.x) < 8 &&
                 (n.midiNote || 0) > (note.midiNote || 0)
          );
          if (isHigher) {
            voice = isLowerClef ? 'Tenor' : 'Soprano';
          } else {
            voice = isLowerClef ? 'Bass' : 'Alto';
          }
        } else {
          // Single note at this x — default to upper voice
          voice = isLowerClef ? 'Tenor' : 'Soprano';
        }
      }

      voicedNotes.push({
        id: noteId++,
        pitch: note.pitch,
        midiNote: note.midiNote,
        duration: note.duration || 'quarter',
        dotted: note.dotted || false,
        tiedBeats: note.tiedBeats,
        x: note.x,
        y: note.y,
        staffIndex: note.staffIndex,
        staffPosition: note.staffPosition,
        stemDir: note.stemDir || 0,
        isBassClef: note.isBassClef,
        clefType: note.clefType || 'treble',
        voice,
      });
    }

    const voiceCounts = {};
    for (const n of voicedNotes) voiceCounts[n.voice] = (voiceCounts[n.voice] || 0) + 1;
    console.log(`🎵 Total voiced notes: ${voicedNotes.length}`,
      Object.entries(voiceCounts).map(([v, c]) => `${v}:${c}`).join(' '));
    return voicedNotes;
  }

  /* ───────────── 7b. DETECT DOTTED NOTES ───────────── */

  /**
   * Scan for augmentation dots to the right of each notehead.
   * A dot adds 50% to the note's duration.
   */
  static _detectDottedNotes(tensor, width, height, notes, staves) {
    const data = tensor.dataSync();

    return notes.map((note) => {
      const staff = staves[note.staffIndex];
      if (!staff) return note;

      const spacing = (staff[4] - staff[0]) / 4;
      // The dot sits to the right of the notehead, in the nearest space
      // Search a small region: 1-3 spacing units right, ~half-space tall
      const dotSearchLeft = note.x + Math.max(3, Math.floor(spacing * 0.7));
      const dotSearchRight = Math.min(width - 1, note.x + Math.floor(spacing * 2.2));
      const dotHalfH = Math.max(2, Math.floor(spacing * 0.35));

      // Snap y to the nearest space (between two lines) so dot detection is on-space
      let dotCenterY = note.y;
      const halfSpace = spacing / 2;
      // Snap: if note is on a line, the dot is in the space just above/below
      const relToTop = (note.y - staff[0]) / halfSpace;
      const rounded = Math.round(relToTop);
      // Even rounded = on a line, odd = in a space
      if (rounded % 2 === 0) {
        // On a line: dot goes to the space above (lower y)
        dotCenterY = staff[0] + (rounded - 1) * halfSpace;
      }

      let dotDarkPixels = 0;
      let dotTotalPixels = 0;
      const dotRadius = Math.max(2, Math.floor(spacing * 0.22));

      for (let x = dotSearchLeft; x <= dotSearchRight; x++) {
        for (let y = Math.round(dotCenterY) - dotHalfH; y <= Math.round(dotCenterY) + dotHalfH; y++) {
          if (y < 0 || y >= height || x < 0 || x >= width) continue;
          dotTotalPixels++;
          if (data[y * width + x] < 120) dotDarkPixels++;
        }
      }

      // Also do a focused circular scan for the dot itself
      let bestDotScore = 0;
      for (let cx = dotSearchLeft; cx <= dotSearchRight; cx++) {
        let circDark = 0;
        let circTotal = 0;
        for (let dy = -dotRadius; dy <= dotRadius; dy++) {
          for (let dx = -dotRadius; dx <= dotRadius; dx++) {
            if (dx * dx + dy * dy > dotRadius * dotRadius) continue;
            const px = cx + dx;
            const py = Math.round(dotCenterY) + dy;
            if (px < 0 || px >= width || py < 0 || py >= height) continue;
            circTotal++;
            if (data[py * width + px] < 110) circDark++;
          }
        }
        if (circTotal > 0) {
          bestDotScore = Math.max(bestDotScore, circDark / circTotal);
        }
      }

      // A dot is a small, dense dark circle (>60% fill in a tiny radius)
      const isDotted = bestDotScore > 0.55;

      if (isDotted) {
        // Apply dot: whole→dotted whole (6 beats), half→3, quarter→1.5, eighth→0.75
        const dottedDurationMap = {
          whole: 'dotted_whole',
          half: 'dotted_half',
          quarter: 'dotted_quarter',
          eighth: 'dotted_eighth',
          sixteenth: 'dotted_sixteenth',
          '32nd': 'dotted_32nd',
        };
        return {
          ...note,
          dotted: true,
          duration: dottedDurationMap[note.duration] || note.duration,
        };
      }

      return note;
    });
  }

  /* ───────────── 8b. DETECT TIES ───────────── */

  /**
   * Detect tie curves between consecutive notes of the same pitch on the same staff.
   * A tie merges notes into one sustained note (durations summed).
   *
   * Supports chains of 3+ tied notes (A─B─C merges into total duration A+B+C).
   * Stores the exact beat count as `tiedBeats` so playback doesn't lose precision
   * from snapping to a named duration.
   */
  static _detectTies(tensor, width, height, notes, staves) {
    if (notes.length < 2) return notes;
    const data = tensor.dataSync();

    const durationBeats = {
      whole: 4, dotted_whole: 6, half: 2, dotted_half: 3,
      quarter: 1, dotted_quarter: 1.5, eighth: 0.5, dotted_eighth: 0.75,
      sixteenth: 0.25, dotted_sixteenth: 0.375,
      '32nd': 0.125, dotted_32nd: 0.1875,
    };

    // Group notes by staffIndex for scanning
    const byStaff = new Map();
    for (const note of notes) {
      const si = note.staffIndex;
      if (!byStaff.has(si)) byStaff.set(si, []);
      byStaff.get(si).push(note);
    }

    const tiedSet = new Set(); // notes to remove (merged into predecessor)

    for (const [staffIdx, staffNotes] of byStaff) {
      staffNotes.sort((a, b) => (a.x || 0) - (b.x || 0));
      const staff = staves[staffIdx];
      if (!staff) continue;
      const spacing = (staff[4] - staff[0]) / 4;

      // Build chains: walk forward, linking consecutive same-pitch notes with arcs.
      // e.g. [A, B, C, D] where A-B tied, B-C tied → chain [A, B, C]
      let i = 0;
      while (i < staffNotes.length - 1) {
        const chainStart = staffNotes[i];
        let chainHead = chainStart;
        const chainRemove = []; // notes to consume into chainHead

        // Try extending the chain forward
        let j = i + 1;
        while (j < staffNotes.length) {
          const noteB = staffNotes[j];
          if (chainHead.midiNote !== noteB.midiNote) break;

          const dx = (noteB.x || 0) - (chainHead.x || 0);
          if (dx <= 0 || dx > spacing * 8) break;

          // Scan for tie arc between chainHead and noteB
          if (!this._hasTieArc(data, width, height, chainHead, noteB, spacing)) break;

          chainRemove.push(noteB);
          chainHead = noteB;
          j++;
        }

        if (chainRemove.length > 0) {
          // Sum all durations in the chain
          let totalBeats = durationBeats[chainStart.duration] || 1;
          for (const cr of chainRemove) {
            totalBeats += durationBeats[cr.duration] || 1;
            tiedSet.add(cr);
          }

          // Store exact beat count + closest named duration
          chainStart.tiedBeats = totalBeats;
          chainStart.duration = this._beatsToDuration(totalBeats);
          chainStart.tied = true;

          i = j; // skip past consumed notes
        } else {
          i++;
        }
      }
    }

    if (tiedSet.size > 0) {
      console.log(`🔗 Merged ${tiedSet.size} tied notes`);
      return notes.filter((n) => !tiedSet.has(n));
    }

    return notes;
  }

  /** Scan for a tie/slur arc between two notes. */
  static _hasTieArc(data, width, height, noteA, noteB, spacing) {
    const midY = Math.round(((noteA.y || 0) + (noteB.y || 0)) / 2);
    const bandH = Math.max(2, Math.floor(spacing * 0.3));

    for (const yOffset of [spacing * 0.8, -spacing * 0.8, spacing * 1.2, -spacing * 1.2]) {
      const scanY = Math.round(midY + yOffset);
      if (scanY < 0 || scanY >= height) continue;

      let darkCount = 0;
      let totalCount = 0;

      for (let x = Math.round(noteA.x || 0) + 2; x < Math.round(noteB.x || 0) - 2; x++) {
        for (let dy = -bandH; dy <= bandH; dy++) {
          const py = scanY + dy;
          if (py < 0 || py >= height || x < 0 || x >= width) continue;
          totalCount++;
          if (data[py * width + x] < 120) darkCount++;
        }
      }

      if (totalCount > 0) {
        const density = darkCount / totalCount;
        if (density > 0.12 && density < 0.55) return true;
      }
    }
    return false;
  }

  /** Map a beat count to the closest standard duration name. */
  static _beatsToDuration(beats) {
    if (beats >= 5.5) return 'dotted_whole';
    if (beats >= 3.5) return 'whole';
    if (beats >= 2.5) return 'dotted_half';
    if (beats >= 1.75) return 'half';
    if (beats >= 1.25) return 'dotted_quarter';
    if (beats >= 0.875) return 'quarter';
    if (beats >= 0.625) return 'dotted_eighth';
    if (beats >= 0.375) return 'eighth';
    if (beats >= 0.3) return 'dotted_sixteenth';
    return 'sixteenth';
  }

  /* ───────────── 10. DETECT RESTS ───────────── */

  /**
   * Detect musical rests (silences) in the gaps between notes on each staff.
   * Looks for characteristic rest symbols: whole, half, quarter, eighth rest shapes.
   */
  static _detectRests(tensor, width, height, notes, staves) {
    const data = tensor.dataSync();
    const rests = [];

    if (staves.length === 0) return rests;

    // Group notes by staffIndex
    const notesByStaff = new Map();
    for (const note of notes) {
      const si = note.staffIndex;
      if (!notesByStaff.has(si)) notesByStaff.set(si, []);
      notesByStaff.get(si).push(note);
    }

    for (let staffIdx = 0; staffIdx < staves.length; staffIdx++) {
      const staff = staves[staffIdx];
      const spacing = (staff[4] - staff[0]) / 4;
      const staffNotes = (notesByStaff.get(staffIdx) || []).sort((a, b) => (a.x || 0) - (b.x || 0));

      // Define search zones: gaps between consecutive notes that are wide enough
      // to contain a rest symbol (at least ~2 spacing units wide)
      const zones = [];
      const marginX = Math.floor(spacing * 1.5);
      const scanStartX = Math.floor(width * 0.15); // skip clef/key/time sig area
      const minGapWidth = Math.floor(spacing * 2.5); // rest symbols need meaningful space

      if (staffNotes.length === 0) {
        // Entire staff may be rests, but only if wide enough
        if (width - scanStartX > minGapWidth) {
          zones.push({ left: scanStartX, right: width - marginX });
        }
      } else {
        // Gap before first note
        if ((staffNotes[0].x || 0) - scanStartX > minGapWidth) {
          zones.push({ left: scanStartX, right: (staffNotes[0].x || 0) - marginX });
        }
        // Gaps between notes
        for (let i = 0; i < staffNotes.length - 1; i++) {
          const left = (staffNotes[i].x || 0) + marginX;
          const right = (staffNotes[i + 1].x || 0) - marginX;
          if (right - left > minGapWidth) {
            zones.push({ left, right });
          }
        }
        // Gap after last note
        const lastX = staffNotes[staffNotes.length - 1].x || 0;
        if (width - marginX - (lastX + marginX) > minGapWidth) {
          zones.push({ left: lastX + marginX, right: width - marginX });
        }
      }

      // Scan each gap zone for rest-like shapes
      const middleY = Math.round((staff[1] + staff[3]) / 2); // between lines 2 and 4
      const scanH = Math.floor(spacing * 3);

      for (const zone of zones) {
        if (zone.right - zone.left < spacing * 1.5) continue;

        // Slide a window across the zone looking for rest-like shapes
        const windowW = Math.max(4, Math.floor(spacing * 1.2));
        const stepX = Math.max(2, Math.floor(spacing * 0.5));

        for (let wx = zone.left; wx < zone.right - windowW; wx += stepX) {
          let darkPixels = 0;
          let totalPixels = 0;

          for (let y = middleY - scanH; y <= middleY + scanH; y++) {
            for (let x = wx; x < wx + windowW; x++) {
              if (x < 0 || x >= width || y < 0 || y >= height) continue;
              totalPixels++;
              if (data[y * width + x] < 120) darkPixels++;
            }
          }

          if (totalPixels === 0) continue;
          const density = darkPixels / totalPixels;

          // A rest symbol has moderate density — more than whitespace, less than a notehead
          // Increased minimum threshold to reduce false positives
          if (density < 0.12 || density > 0.45) continue;

          // Check that this isn't a barline (very tall thin vertical structure)
          let vertRun = 0;
          const testX = wx + Math.floor(windowW / 2);
          for (let vy = staff[0] - spacing; vy < staff[4] + spacing; vy++) {
            if (vy < 0 || vy >= height) continue;
            if (data[vy * width + testX] < 120) vertRun++;
          }
          const staffH = staff[4] - staff[0] + spacing * 2;
          if (vertRun > staffH * 0.6) continue; // barline — skip

          // Classify rest type by shape analysis
          const restType = this._classifyRestShape(data, width, height, wx, middleY, windowW, scanH, spacing, staff);
          if (!restType) continue;

          // Don't add a rest too close to an existing rest or note
          const tooCloseToRest = rests.some(
            (r) => r.staffIndex === staffIdx && Math.abs(r.x - (wx + windowW / 2)) < spacing * 2
          );
          if (tooCloseToRest) continue;

          const tooCloseToNote = staffNotes.some(
            (n) => Math.abs((n.x || 0) - (wx + windowW / 2)) < spacing * 1.5
          );
          if (tooCloseToNote) continue;

          // Determine voice from staff position (not always Soprano)
          const isLowerStaff = staffIdx % 2 === 1;
          const restVoice = isLowerStaff ? 'Bass' : 'Soprano';

          // ── Dotted rest detection ──
          // Scan for an augmentation dot to the right of the rest symbol.
          // The dot sits in a space near the middle of the staff.
          let isDottedRest = false;
          const restRightEdge = wx + windowW;
          const dotSearchEnd = Math.min(width - 1, restRightEdge + Math.floor(spacing * 2));
          const dotCheckR = Math.max(2, Math.floor(spacing * 0.22));
          const dotCheckY = Math.round((staff[2] + staff[3]) / 2); // space between lines 3-4

          for (let cx = restRightEdge + 1; cx <= dotSearchEnd; cx++) {
            let circDark = 0;
            let circTotal = 0;
            for (let dy = -dotCheckR; dy <= dotCheckR; dy++) {
              for (let dx = -dotCheckR; dx <= dotCheckR; dx++) {
                if (dx * dx + dy * dy > dotCheckR * dotCheckR) continue;
                const px = cx + dx;
                const py = dotCheckY + dy;
                if (px < 0 || px >= width || py < 0 || py >= height) continue;
                circTotal++;
                if (data[py * width + px] < 110) circDark++;
              }
            }
            if (circTotal > 0 && circDark / circTotal > 0.55) {
              isDottedRest = true;
              break;
            }
          }

          const dottedRestMap = {
            whole: 'dotted_whole',
            half: 'dotted_half',
            quarter: 'dotted_quarter',
            eighth: 'dotted_eighth',
            sixteenth: 'dotted_sixteenth',
          };

          const finalDuration = isDottedRest
            ? (dottedRestMap[restType.duration] || restType.duration)
            : restType.duration;

          rests.push({
            type: 'rest',
            restType: restType.name,
            duration: finalDuration,
            dotted: isDottedRest,
            x: wx + Math.floor(windowW / 2),
            y: middleY,
            staffIndex: staffIdx,
            voice: restVoice,
          });

          // Skip past this rest
          wx += windowW;
        }
      }
    }

    return rests;
  }

  /**
   * Classify a rest shape using multi-band density analysis and contour profiling.
   * Inspired by the original app's findShortRest() and RLE contour functions.
   *
   * Reference from session.dat confirmed type values:
   *   31 = Measure rest (length=4000, adapts to time sig)
   *   32 = Half rest    (length=2000)
   *   33 = Quarter rest (length=1000) — zigzag, template 33_00.png
   *   34 = Eighth rest  (length=500)
   *   35 = 16th rest    (length=250)
   */
  static _classifyRestShape(data, imgW, imgH, x, midY, w, h, spacing, staff) {
    const thresh = 120;
    const line2 = staff[1]; // second line from top
    const line3 = staff[2]; // middle line
    const line4 = staff[3]; // fourth line from top

    // ── Scan wider region for shape analysis ──
    const scanW = Math.max(w, Math.floor(spacing * 1.5));
    const scanLeft = Math.max(0, x);
    const scanRight = Math.min(imgW - 1, x + scanW);
    const scanTop = Math.max(0, Math.floor(staff[0] - spacing * 0.5));
    const scanBot = Math.min(imgH - 1, Math.floor(staff[4] + spacing * 0.5));

    // ── Compute per-row dark pixel counts (RLE-inspired profile) ──
    const rows = scanBot - scanTop + 1;
    const rowDark = new Int32Array(rows);
    let minDarkY = imgH, maxDarkY = 0;
    let totalDark = 0, totalPixels = 0;

    for (let y = scanTop; y <= scanBot; y++) {
      for (let dx = 0; dx <= scanRight - scanLeft; dx++) {
        const px = scanLeft + dx;
        if (px >= imgW) continue;
        totalPixels++;
        if (data[y * imgW + px] < thresh) {
          rowDark[y - scanTop]++;
          totalDark++;
          if (y < minDarkY) minDarkY = y;
          if (y > maxDarkY) maxDarkY = y;
        }
      }
    }

    if (totalPixels === 0 || totalDark < 4) return null;
    const darkHeight = maxDarkY - minDarkY + 1;
    const overallDensity = totalDark / totalPixels;
    if (overallDensity < 0.05) return null;

    // ── Find dark bounding box width ──
    let minDarkX = imgW, maxDarkX = 0;
    for (let y = scanTop; y <= scanBot; y++) {
      for (let dx = 0; dx <= scanRight - scanLeft; dx++) {
        const px = scanLeft + dx;
        if (px >= imgW) continue;
        if (data[y * imgW + px] < thresh) {
          if (px < minDarkX) minDarkX = px;
          if (px > maxDarkX) maxDarkX = px;
        }
      }
    }
    const darkWidth = maxDarkX - minDarkX + 1;

    // ── Band density: divide region into 5 horizontal bands ──
    const bandH = Math.max(1, Math.floor(rows / 5));
    const bandDensity = [];
    for (let b = 0; b < 5; b++) {
      let dark = 0, total = 0;
      const yStart = b * bandH;
      const yEnd = Math.min(rows, (b + 1) * bandH);
      for (let i = yStart; i < yEnd; i++) {
        dark += rowDark[i];
        total += (scanRight - scanLeft + 1);
      }
      bandDensity.push(total > 0 ? dark / total : 0);
    }

    // ── Horizontal contour: check row-to-row variation (zigzag detection) ──
    let contourChanges = 0;
    let prevRowCenter = -1;
    for (let i = 0; i < rows; i++) {
      if (rowDark[i] < 2) continue;
      // Find center-of-mass for this row
      let sumX = 0, cnt = 0;
      for (let dx = 0; dx <= scanRight - scanLeft; dx++) {
        const px = scanLeft + dx;
        if (px >= imgW) continue;
        if (data[(scanTop + i) * imgW + px] < thresh) {
          sumX += px;
          cnt++;
        }
      }
      if (cnt === 0) continue;
      const rowCenter = Math.round(sumX / cnt);
      if (prevRowCenter >= 0) {
        const shift = Math.abs(rowCenter - prevRowCenter);
        if (shift > spacing * 0.15) contourChanges++;
      }
      prevRowCenter = rowCenter;
    }

    // ── Classification decision tree ──

    // Whole rest: small filled rectangle hanging below staff line 4
    // (or line 3 depending on staff position). Short height, wide.
    // Confirmed: isRest=1, type=31, length=4000
    if (darkHeight < spacing * 0.9 && darkWidth > spacing * 0.5 && darkHeight > 0) {
      const aspect = darkWidth / darkHeight;
      if (aspect > 1.2) {
        // Check position: hangs from a staff line (dark below a line)
        if (maxDarkY > line3 - spacing * 0.3 && minDarkY < line4 + spacing * 0.3) {
          return { name: 'whole', duration: 'whole' };
        }
      }
    }

    // Half rest: small filled rectangle sitting ON a staff line.
    // Confirmed: isRest=1, type=32, length=2000
    if (darkHeight < spacing * 0.9 && darkWidth > spacing * 0.5 && darkHeight > 0) {
      const aspect = darkWidth / darkHeight;
      if (aspect > 1.2) {
        // Sits on line 3 (dark above the line)
        if (minDarkY > line2 - spacing * 0.3 && maxDarkY < line3 + spacing * 0.3) {
          return { name: 'half', duration: 'half' };
        }
      }
    }

    // Measure rest: same visual as whole rest but can be at various positions
    // (we classify positionally ambiguous wide short rests as whole/measure)
    if (darkHeight < spacing * 1.0 && darkWidth > spacing * 0.5) {
      const aspect = darkWidth / darkHeight;
      if (aspect > 1.2 && overallDensity > 0.10) {
        // Between lines 2 and 4 — likely a whole/measure rest
        if (minDarkY > line2 - spacing * 0.5 && maxDarkY < line4 + spacing * 0.5) {
          // Distinguish: hanging from line = whole, sitting on line = half
          const centerLine3 = Math.abs((minDarkY + maxDarkY) / 2 - line3);
          if (centerLine3 < spacing * 0.4) {
            // Near line 3 center — look at whether top or bottom edge is on the line
            if (minDarkY < line3 && maxDarkY >= line3) {
              return { name: 'half', duration: 'half' };
            }
            return { name: 'whole', duration: 'whole' };
          }
          return { name: 'whole', duration: 'whole' };
        }
      }
    }

    // Quarter rest (crotchet): tall zigzag shape spanning ~2.5-4 spaces.
    // Confirmed: isRest=1, type=33, length=1000, template 33_00.png shows zigzag
    // Key signature: significant horizontal contour changes (zigzag)
    if (darkHeight >= spacing * 1.8 && darkHeight <= spacing * 4.5) {
      if (contourChanges >= 3 && overallDensity > 0.08) {
        return { name: 'quarter', duration: 'quarter' };
      }
      // Also accept based on density profile: quarter rests have
      // variable density across bands (not uniform)
      const maxBand = Math.max(...bandDensity);
      const minBand = Math.min(...bandDensity);
      if (maxBand - minBand > 0.08 && overallDensity > 0.10 && darkWidth < spacing * 1.5) {
        return { name: 'quarter', duration: 'quarter' };
      }
    }

    // Eighth rest: shorter than quarter, blob with a flag-like dot on top
    // Confirmed: isRest=1, type=34, length=500
    // Spans ~1-2 spaces, has a dot/blob in upper portion + a diagonal stroke
    if (darkHeight >= spacing * 0.7 && darkHeight < spacing * 2.2) {
      // Eighth rest: top-heavy or has density peak in upper bands
      const topHalfDensity = (bandDensity[0] + bandDensity[1]) / 2;
      const botHalfDensity = (bandDensity[3] + bandDensity[4]) / 2;
      if (overallDensity > 0.10 && darkWidth < spacing * 1.5) {
        if (topHalfDensity > botHalfDensity * 0.5 || contourChanges >= 1) {
          return { name: 'eighth', duration: 'eighth' };
        }
      }
    }

    // Sixteenth rest: similar to eighth but with two dots/flags
    // Confirmed: isRest=1, type=35, length=250
    // Denser than eighth, spans ~1-2.5 spaces
    if (darkHeight >= spacing * 0.8 && darkHeight < spacing * 2.8) {
      if (overallDensity > 0.15 && darkWidth < spacing * 1.5) {
        // Check for two density peaks (double flag)
        let peaks = 0;
        for (let b = 1; b < bandDensity.length; b++) {
          if (bandDensity[b] > bandDensity[b - 1] * 1.3 && bandDensity[b] > 0.12) peaks++;
        }
        if (peaks >= 2) {
          return { name: 'sixteenth', duration: 'sixteenth' };
        }
      }
    }

    // No catch-all fallback — if we can't clearly identify the rest type, reject it
    return null;
  }
}
