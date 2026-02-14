import * as tf from '@tensorflow/tfjs';
import { decodeJpeg } from '@tensorflow/tfjs-react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { ModelService } from './ModelService';
import { ImageProcessor } from '../utils/ImageProcessor';

/**
 * Optical Music Recognition Pipeline
 *
 * Steps:
 *  1. Load & binarize image
 *  2. Detect staff lines (horizontal run-length analysis)
 *  3. Group lines into staves (groups of 5)
 *  4. Pair staves into systems (grand-staff)
 *  5. Detect key signature via ML models
 *  6. Detect note heads (refined: must sit on/near staff)
 *  7. Classify durations (stem/beam analysis)
 *  8. Map positions → pitches (treble + bass clef aware)
 *  9. Assign voices & sort
 */
export class MusicSheetProcessor {

  /* ───────────── PUBLIC API ───────────── */

  static async processSheet(imageUri) {
    console.log('🎼 Starting OMR Pipeline...');

    // 1. Load image
    const { tensor, width, height } = await this._loadImage(imageUri);
    console.log(`✅ Image loaded (${width}×${height})`);

    // 2. Detect staff lines
    const staffLines = this._detectStaffLines(tensor, width, height);
    console.log(`✅ Detected ${staffLines.length} staff lines`);

    // 3. Group into staves (5 lines each)
    const staves = this._groupIntoStaves(staffLines);
    console.log(`✅ ${staves.length} staves`);

    // 4. Pair into systems (grand-staff pairs)
    const systems = this._pairIntoSystems(staves);
    console.log(`✅ ${systems.length} systems`);

    // 5. Detect key signature using ML models
    const keySignature = await this._detectKeySignature(imageUri, staves);
    console.log(`✅ Key signature: ${keySignature.type} ${keySignature.count}`);

    // 6. Detect note heads — refined to sit near staves
    const noteHeads = this._detectNoteHeads(tensor, width, height, staves);
    console.log(`✅ ${noteHeads.length} note heads`);

    // 7. Classify durations
    const notesWithDuration = this._classifyDurations(tensor, width, height, noteHeads, staves);
    console.log(`✅ Durations classified`);

    // 8. Map to pitches (treble/bass aware)
    const notesWithPitch = this._mapToPitches(notesWithDuration, staves, systems, keySignature);
    console.log(`✅ Pitches mapped`);

    // 9. Assign voices
    const voicedNotes = this._assignVoices(notesWithPitch, staves);
    console.log(`✅ ${voicedNotes.length} voiced notes`);

    tensor.dispose();

    // Build staff groups for visualization (raw staff line arrays)
    const staffGroups = staves.map((s) => [...s]);

    return {
      notes: voicedNotes,
      staves: staves.length,
      measures: [],
      metadata: {
        imageWidth: width,
        imageHeight: height,
        staffGroups,
        keySignature,
        systems: systems.map((sys) => ({
          top: sys.top,
          bottom: sys.bottom,
          staffIndices: sys.staffIndices,
        })),
        timestamp: new Date().toISOString(),
        totalNotes: voicedNotes.length,
      },
    };
  }

  /* ───────────── 1. LOAD IMAGE ───────────── */

  static async _loadImage(imageUri) {
    // Resize to max 800px wide for speed
    const resized = await manipulateAsync(imageUri, [{ resize: { width: 800 } }], {
      compress: 0.85,
      format: SaveFormat.JPEG,
    });

    const response = await fetch(resized.uri);
    const arrayBuffer = await response.arrayBuffer();
    const imageTensor = decodeJpeg(new Uint8Array(arrayBuffer), 3);

    const bw = tf.tidy(() => {
      const gray = tf.image.rgbToGrayscale(imageTensor);
      return gray;
    });
    imageTensor.dispose();

    const shape = bw.shape; // [height, width, 1]
    const width = shape[1];
    const height = shape[0];

    return { tensor: bw, width, height };
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

  static _pairIntoSystems(staves) {
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

        // If the gap between the two staves is less than the staff height → same system
        if (gapAB < heightA * 2.5) {
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

  /* ───────────── 6. DETECT NOTE HEADS ───────────── */

  static _detectNoteHeads(tensor, width, height, staves) {
    const data = tensor.dataSync();
    const noteHeads = [];

    if (staves.length === 0) return noteHeads;

    // Pre-compute staff ranges: where to scan for notes
    // Notes sit on/near staff lines, extending ~1 staff-height above/below
    const scanRegions = staves.map((staff) => {
      const spacing = (staff[4] - staff[0]) / 4; // spacing between consecutive lines
      return {
        top: Math.max(0, Math.floor(staff[0] - spacing * 3)),
        bottom: Math.min(height - 1, Math.ceil(staff[4] + spacing * 3)),
        spacing,
        staffTop: staff[0],
        staffBottom: staff[4],
        lines: staff,
      };
    });

    const darkThreshold = 100;
    const minNoteDistance = 10; // minimum separation between note centers
    const noteRadius = 4; // approximate half-width of a note head

    // For each staff region, scan for note-head-like dark spots
    for (let staffIdx = 0; staffIdx < scanRegions.length; staffIdx++) {
      const region = scanRegions[staffIdx];
      const spacing = region.spacing;

      // Skip the clef area (roughly first 12% of width) for note detection
      const scanStartX = Math.floor(width * 0.08);
      const step = Math.max(2, Math.floor(spacing / 3));

      for (let y = region.top; y <= region.bottom; y += step) {
        for (let x = scanStartX; x < width - noteRadius; x += step) {
          const idx = y * width + x;
          if (data[idx] >= darkThreshold) continue;

          // Check for existing nearby note
          const tooClose = noteHeads.some(
            (n) => Math.abs(n.x - x) < minNoteDistance && Math.abs(n.y - y) < minNoteDistance
          );
          if (tooClose) continue;

          // Verify it's roughly elliptical: check a small horizontal band
          // Note heads are wider than tall (~1.3:1 aspect)
          const halfW = Math.max(2, Math.floor(spacing * 0.6));
          const halfH = Math.max(2, Math.floor(spacing * 0.45));

          let darkInEllipse = 0;
          let totalInEllipse = 0;

          for (let dy = -halfH; dy <= halfH; dy++) {
            for (let dx = -halfW; dx <= halfW; dx++) {
              const px = x + dx;
              const py = y + dy;
              if (px < 0 || px >= width || py < 0 || py >= height) continue;

              // Check if inside ellipse
              const ex = dx / halfW;
              const ey = dy / halfH;
              if (ex * ex + ey * ey > 1) continue;

              totalInEllipse++;
              if (data[py * width + px] < darkThreshold) darkInEllipse++;
            }
          }

          if (totalInEllipse < 8) continue;
          const fillRatio = darkInEllipse / totalInEllipse;

          // A note head should be mostly filled (>55%) but not a bar line
          if (fillRatio < 0.5) continue;

          // Reject if it looks like a vertical bar line (extend checking above/below)
          let verticalRun = 0;
          for (let vy = y - spacing * 2; vy < y + spacing * 2; vy++) {
            if (vy < 0 || vy >= height) continue;
            if (data[Math.floor(vy) * width + x] < darkThreshold) verticalRun++;
          }
          const maxVertForNote = spacing * 2.5;
          if (verticalRun > maxVertForNote) continue; // likely a bar line

          // Reject if it looks like part of a horizontal staff line
          let horizontalRun = 0;
          for (let hx = x - spacing * 3; hx < x + spacing * 3; hx++) {
            if (hx < 0 || hx >= width) continue;
            if (data[y * width + Math.floor(hx)] < darkThreshold) horizontalRun++;
          }
          if (horizontalRun > spacing * 5) continue; // likely a staff line segment

          noteHeads.push({
            x,
            y,
            radius: halfW,
            staffIndex: staffIdx,
            fillRatio,
          });

          // Skip ahead
          x += halfW * 2;
        }
      }
    }

    // Sort by staffIndex then x
    noteHeads.sort((a, b) => {
      if (a.staffIndex !== b.staffIndex) return a.staffIndex - b.staffIndex;
      return a.x - b.x;
    });

    // Limit reasonable count
    if (noteHeads.length > 300) {
      console.warn(`⚠️ Too many note heads (${noteHeads.length}), trimming to 300`);
      return noteHeads.slice(0, 300);
    }

    return noteHeads;
  }

  /* ───────────── 7. CLASSIFY DURATIONS ───────────── */

  static _classifyDurations(tensor, width, height, noteHeads, staves) {
    const data = tensor.dataSync();

    return noteHeads.map((head) => {
      const staff = staves[head.staffIndex];
      if (!staff) return { ...head, duration: 'quarter' };

      const spacing = (staff[4] - staff[0]) / 4;

      // Check for stem: vertical dark line extending above or below the note head
      let stemUp = 0;
      let stemDown = 0;
      const stemX = head.x + Math.floor(head.radius * 0.8);

      // Scan upward
      for (let dy = 1; dy < spacing * 5; dy++) {
        const py = head.y - dy;
        if (py < 0) break;
        if (data[py * width + stemX] < 130) stemUp++;
        else break;
      }

      // Scan downward
      for (let dy = 1; dy < spacing * 5; dy++) {
        const py = head.y + dy;
        if (py >= height) break;
        if (data[py * width + stemX] < 130) stemDown++;
        else break;
      }

      const stemLength = Math.max(stemUp, stemDown);

      // Check fill density (filled vs hollow notehead)
      let darkInside = 0;
      let totalInside = 0;
      const r = Math.max(2, Math.floor(spacing * 0.35));
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const px = head.x + dx;
          const py = head.y + dy;
          if (px < 0 || px >= width || py < 0 || py >= height) continue;
          totalInside++;
          if (data[py * width + px] < 120) darkInside++;
        }
      }
      const isFilled = totalInside > 0 && darkInside / totalInside > 0.65;

      let duration = 'quarter';
      if (stemLength < spacing * 0.5) {
        // No stem → whole note
        duration = isFilled ? 'quarter' : 'whole';
      } else if (stemLength < spacing * 2.5) {
        duration = isFilled ? 'quarter' : 'half';
      } else {
        // Long stem with possible beaming → eighth
        duration = isFilled ? 'eighth' : 'half';
      }

      return { ...head, duration, stemLength };
    });
  }

  /* ───────────── 8. MAP TO PITCHES ───────────── */

  static _mapToPitches(noteHeads, staves, systems, keySignature) {
    // Sharps order: F C G D A E B  (in circle-of-fifths order)
    // Flats order: B E A D G C F
    const sharpNotes = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
    const flatNotes = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

    // Build set of accidental notes from key signature
    const accidentalNotes = new Set();
    if (keySignature.type === 'Sharps') {
      for (let i = 0; i < Math.min(keySignature.count, sharpNotes.length); i++) {
        accidentalNotes.add(sharpNotes[i]);
      }
    } else if (keySignature.type === 'Flats') {
      for (let i = 0; i < Math.min(keySignature.count, flatNotes.length); i++) {
        accidentalNotes.add(flatNotes[i]);
      }
    }

    return noteHeads.map((head) => {
      const staff = staves[head.staffIndex];
      if (!staff) {
        return { ...head, pitch: 'C', midiNote: 60, octave: 4, staffPosition: 0 };
      }

      const spacing = (staff[4] - staff[0]) / 4;
      const halfSpace = spacing / 2;

      // Calculate position relative to staff lines.
      // Position 0 = bottom line (staff[4]), each half-space increments by 1.
      const relativeToBottom = (staff[4] - head.y) / halfSpace;
      const staffPosition = Math.round(relativeToBottom);

      // Determine if this staff is treble or bass
      // In a system with 2 staves, the first is treble, second is bass.
      let isBassClef = false;
      for (const system of systems) {
        if (system.staffIndices.length === 2 && system.staffIndices[1] === head.staffIndex) {
          isBassClef = true;
          break;
        }
      }

      // Treble clef: bottom line = E4 (MIDI 64)
      // Line positions from bottom: E4(0), F4(1), G4(2), A4(3), B4(4), C5(5), D5(6), E5(7), F5(8)
      // Bass clef: bottom line = G2 (MIDI 43)
      // Line positions from bottom: G2(0), A2(1), B2(2), C3(3), D3(4), E3(5), F3(6), G3(7), A3(8)

      const trebleBase = 64; // E4
      const bassBase = 43;   // G2

      // Note names in chromatic staff order (diatonic: each position = one step)
      const trebleNames = ['E', 'F', 'G', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'A', 'B', 'C', 'D'];
      const bassNames = ['G', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'A', 'B', 'C', 'D', 'E', 'F'];

      // Diatonic intervals (semitones) from each step to the next
      const trebleIntervals = [1, 2, 2, 1, 2, 2, 2, 1, 2, 2, 1, 2, 2]; // E→F=1, F→G=2, G→A=2, ...
      const bassIntervals = [2, 2, 1, 2, 2, 1, 2, 2, 2, 1, 2, 2, 1]; // G→A=2, A→B=2, B→C=1, ...

      const names = isBassClef ? bassNames : trebleNames;
      const intervals = isBassClef ? bassIntervals : trebleIntervals;
      const baseMidi = isBassClef ? bassBase : trebleBase;

      // Clamp position to reasonable range
      const clampedPosition = Math.max(-4, Math.min(13, staffPosition));
      const nameIdx = Math.max(0, Math.min(names.length - 1, clampedPosition));
      const pitchName = names[nameIdx];

      // Calculate MIDI note from intervals
      let midiNote = baseMidi;
      if (clampedPosition > 0) {
        for (let i = 0; i < clampedPosition && i < intervals.length; i++) {
          midiNote += intervals[i];
        }
      } else if (clampedPosition < 0) {
        // Below bottom line: go backwards
        const revIntervals = isBassClef
          ? [2, 2, 1, 2] // F→G reverse intervals below bass
          : [2, 1, 2, 2]; // C→D→E reverse intervals below treble
        for (let i = 0; i < -clampedPosition && i < revIntervals.length; i++) {
          midiNote -= revIntervals[i];
        }
      }

      // Apply key signature accidentals
      if (accidentalNotes.has(pitchName)) {
        if (keySignature.type === 'Sharps') midiNote += 1;
        else if (keySignature.type === 'Flats') midiNote -= 1;
      }

      // Ensure MIDI is in playable range
      midiNote = Math.max(21, Math.min(108, midiNote));

      return {
        ...head,
        pitch: pitchName,
        midiNote,
        staffPosition,
        isBassClef,
      };
    });
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

    // Assign voices: top staff → Soprano/Alto, bottom staff → Tenor/Bass
    for (const note of deduped) {
      let voice = 'Soprano';
      if (note.isBassClef) {
        voice = note.staffPosition >= 4 ? 'Tenor' : 'Bass';
      } else {
        voice = note.staffPosition >= 4 ? 'Soprano' : 'Alto';
      }

      voicedNotes.push({
        id: noteId++,
        pitch: note.pitch,
        midiNote: note.midiNote,
        duration: note.duration || 'quarter',
        x: note.x,
        y: note.y,
        staffIndex: note.staffIndex,
        staffPosition: note.staffPosition,
        isBassClef: note.isBassClef,
        voice,
      });
    }

    console.log(`🎵 Total voiced notes: ${voicedNotes.length}`);
    return voicedNotes;
  }
}
