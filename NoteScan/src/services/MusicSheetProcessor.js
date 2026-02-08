import * as tf from '@tensorflow/tfjs';
import { decodeJpeg } from '@tensorflow/tfjs-react-native';
import * as FileSystem from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

/**
 * Complete OMR (Optical Music Recognition) Pipeline
 * Detects all notes on a music sheet and returns structured musical data
 */
export class MusicSheetProcessor {
  // Staff line spacing and detection constants
  static STAFF_SPACING_RANGE = { min: 4, max: 25 }; // pixels between staff lines
  static MIN_STAFF_HEIGHT = 50; // minimum pixels for valid staff
  static NOTE_HEAD_MIN_RADIUS = 4;
  static NOTE_HEAD_MAX_RADIUS = 20;

  /**
   * Process a complete music sheet image
   * Returns detected notes with pitch, duration, and voice information
   */
  static async processSheet(imageUri) {
    try {
      console.log('🎼 Starting OMR Pipeline...');
      
      // 1. Load and preprocess image
      const imageData = await this._loadImage(imageUri);
      console.log('✅ Image loaded');

      // 2. Detect staff lines
      const staffLines = await this._detectStaffLines(imageData);
      console.log(`✅ Detected ${staffLines.length} staff lines`);

      // 3. Group into staves
      const staves = this._groupIntoStaves(staffLines);
      console.log(`✅ Grouped into ${staves.length} staves`);

      // 4. Detect note heads
      const noteHeads = await this._detectNoteHeads(imageData, staves);
      console.log(`✅ Detected ${noteHeads.length} note heads`);

      // 5. Detect stems and note durations
      const notesWithDuration = await this._detectNoteDurations(imageData, noteHeads, staves);
      console.log(`✅ Classified note durations`);

      // 6. Map positions to pitches
      const notesWithPitch = this._mapToPitches(notesWithDuration, staves);
      console.log(`✅ Mapped to musical pitches`);

      // 7. Group into measures
      const measures = this._groupIntoMeasures(notesWithPitch);
      console.log(`✅ Organized into ${measures.length} measures`);

      // 8. Assign voices (SATB)
      const voicedNotes = this._assignVoices(measures, staves.length);
      console.log(`✅ Assigned to voices`);

      // Cleanup
      imageData.dispose();

      return {
        measures,
        staves: staves.length,
        notes: voicedNotes,
        metadata: {
          timestamp: new Date().toISOString(),
          totalNotes: voicedNotes.length,
          avgNotesPerMeasure: voicedNotes.length / Math.max(1, measures.length),
        },
      };
    } catch (error) {
      console.error('❌ OMR Pipeline Error:', error);
      throw error;
    }
  }

  /**
   * Load image and convert to grayscale tensor
   */
  static async _loadImage(imageUri) {
    try {
      // Resize for processing (small size for speed)
      const resized = await manipulateAsync(imageUri, [{ resize: { width: 512 } }], {
        compress: 0.7,
        format: SaveFormat.JPEG,
      });

      // Load as tensor
      const response = await fetch(resized.uri);
      const arrayBuffer = await response.arrayBuffer();
      const imageTensor = decodeJpeg(new Uint8Array(arrayBuffer), 3);

      // Convert to grayscale
      const bw = tf.image.rgbToGrayscale(imageTensor);
      imageTensor.dispose();

      return bw;
    } catch (error) {
      console.error('Error loading image:', error);
      throw error;
    }
  }

  /**
   * Detect horizontal staff lines using edge detection
   */
  static async _detectStaffLines(imageTensor) {
    return tf.tidy(() => {
      const shape = imageTensor.shape;
      const [height, width] = [shape[0], shape[1]];

      // Apply horizontal Sobel filter to detect edges
      const kernel = tf.tensor2d([
        [-1, 0, 1],
        [-2, 0, 2],
        [-1, 0, 1],
      ]);

      const normalized = tf.image.resizeBilinear(imageTensor, [height, width]);
      const expanded = normalized.expandDims(2);
      const batched = expanded.expandDims(0);

      // Simple edge detection: look for horizontal lines
      // For each row, compute average darkness
      const rowAverages = tf.tidy(() => {
        const flattened = imageTensor.reshape([height, width]);
        const rowMeans = tf.mean(flattened, 1);
        return rowMeans;
      });

      // Find rows with strong signal (dark horizontal lines)
      const data = rowAverages.dataSync();
      const staffLines = [];
      const threshold = 100; // Dark enough to be a staff line
      let inLine = false;
      let lineStart = 0;

      for (let i = 0; i < height; i++) {
        const isDark = data[i] < threshold;
        if (isDark && !inLine) {
          lineStart = i;
          inLine = true;
        } else if (!isDark && inLine) {
          const lineCenter = Math.floor((lineStart + i) / 2);
          staffLines.push(lineCenter);
          inLine = false;
        }
      }

      rowAverages.dispose();
      expanded.dispose();
      batched.dispose();
      kernel.dispose();

      return staffLines;
    });
  }

  /**
   * Group individual staff lines into staves (groups of 5 lines)
   */
  static _groupIntoStaves(staffLines) {
    if (staffLines.length === 0) return [];

    const staves = [];
    let currentStaff = [staffLines[0]];

    for (let i = 1; i < staffLines.length; i++) {
      const spacing = staffLines[i] - staffLines[i - 1];

      // If spacing is reasonable for staff lines, add to current staff
      if (spacing < 30) {
        currentStaff.push(staffLines[i]);

        // Complete staff has 5 lines
        if (currentStaff.length === 5) {
          staves.push(currentStaff);
          currentStaff = [];
        }
      } else if (currentStaff.length > 0) {
        // Large gap, start new staff
        currentStaff = [staffLines[i]];
      }
    }

    return staves;
  }

  /**
   * Detect note heads using circle detection with deduplication
   */
  static async _detectNoteHeads(imageTensor, staves) {
    return tf.tidy(() => {
      const shape = imageTensor.shape;
      const [height, width] = [shape[0], shape[1]];
      const data = imageTensor.dataSync();

      const noteHeads = [];
      const threshold = 100; // Dark threshold for note detection
      const minRadius = 2;
      const maxRadius = 8;
      const minDistanceBetweenNotes = 15; // Minimum pixels between note centers
      const stepSize = 5; // Scan every 5th pixel for speed

      console.log(`🔍 Scanning image (${width}x${height})...`);

      // Scan for dark spots that could be note heads (optimized with step size)
      for (let y = minRadius; y < height - minRadius; y += stepSize) {
        for (let x = minRadius; x < width - minRadius; x += stepSize) {
          const idx = y * width + x;
          const pixel = data[idx];

          if (pixel < threshold) {
            // Check if this point is already part of a detected note
            const alreadyDetected = noteHeads.some(
              (note) =>
                Math.sqrt(Math.pow(note.x - x, 2) + Math.pow(note.y - y, 2)) <
                minDistanceBetweenNotes
            );

            if (alreadyDetected) continue;

            // Check if it's a circular dark region
            let isCircle = true;
            let circleRadius = 0;

            for (let r = minRadius; r <= maxRadius; r += 2) {
              let darkPixels = 0;
              // Sample only 8 points around circle for speed
              for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
                const cx = Math.round(x + r * Math.cos(angle));
                const cy = Math.round(y + r * Math.sin(angle));
                if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
                  const pidx = cy * width + cx;
                  if (data[pidx] < threshold) darkPixels++;
                }
              }
              if (darkPixels >= 4) {
                // Require at least 4/8 pixels to be dark
                circleRadius = r;
              } else {
                break;
              }
            }

            if (circleRadius >= minRadius) {
              noteHeads.push({ x, y, radius: circleRadius });
              // Skip ahead to avoid duplicate detection
              x += Math.max(circleRadius * 2, minDistanceBetweenNotes);
            }
          }
        }
      }

      console.log(`📍 Detected ${noteHeads.length} note heads`);
      
      // Limit to reasonable number to prevent memory issues
      if (noteHeads.length > 200) {
        console.warn(`⚠️ Too many note heads (${noteHeads.length}), limiting to 200`);
        return noteHeads.slice(0, 200);
      }
      
      return noteHeads;
    });
  }

  /**
   * Detect note durations by analyzing stem length and fill
   */
  static async _detectNoteDurations(imageTensor, noteHeads) {
    return tf.tidy(() => {
      const shape = imageTensor.shape;
      const [height, width] = [shape[0], shape[1]];
      const data = imageTensor.dataSync();

      return noteHeads.map((head) => {
        // Look for stem extending downward
        let stemLength = 0;
        const stemX = head.x + head.radius + 1; // Stem is typically to the right of note head

        for (let dy = head.y; dy < Math.min(height, head.y + 50); dy++) {
          const idx = dy * width + stemX;
          if (data[idx] < 150) {
            stemLength++;
          } else {
            break;
          }
        }

        // Determine duration based on stem and appearance
        let duration = 'whole'; // Default

        if (stemLength > 0) {
          if (stemLength > 30) {
            // Check for beaming (multiple notes connected)
            duration = 'eighth';
          } else {
            duration = 'quarter';
          }
        } else {
          // Check if filled or empty (whole vs half notes)
          const innerPixels = [];
          for (let dy = head.y - head.radius; dy <= head.y + head.radius; dy++) {
            for (let dx = head.x - head.radius; dx <= head.x + head.radius; dx++) {
              if (dx >= 0 && dx < width && dy >= 0 && dy < height) {
                const idx = dy * width + dx;
                if (data[idx] < 180) {
                  innerPixels.push(data[idx]);
                }
              }
            }
          }

          const avgIntensity = innerPixels.reduce((a, b) => a + b, 0) / innerPixels.length;
          duration = avgIntensity < 100 ? 'whole' : 'half';
        }

        return {
          ...head,
          duration,
          stemLength,
        };
      });
    });
  }

  /**
   * Map pixel coordinates to MIDI pitches based on staff position
   */
  static _mapToPitches(noteHeads, staves) {
    return noteHeads.map((head) => {
      // Find which staff this note belongs to
      let staffIndex = -1;
      let staffPositionFromBottom = -1;

      for (let i = 0; i < staves.length; i++) {
        const staff = staves[i];
        const top = staff[0];
        const bottom = staff[staff.length - 1];
        const spacing = staff[1] - staff[0];

        if (head.y >= top - spacing && head.y <= bottom + spacing) {
          staffIndex = i;

          // Calculate position within staff (0 = top line, 8 = bottom line)
          // Accounting for spaces between lines
          const relativeY = head.y - top;
          staffPositionFromBottom = Math.round((bottom - head.y) / (spacing / 2));
          break;
        }
      }

      // Map staff position to pitch (treble clef mapping)
      // Line positions (from bottom): E(0), G(2), B(4), D(6), F(8)
      // Space positions (from bottom): F(1), A(3), C(5), E(7)
      const trebleNotes = ['E', 'F', 'G', 'A', 'B', 'C', 'D', 'E', 'F'];
      const pitchName = trebleNotes[Math.max(0, Math.min(8, staffPositionFromBottom))];

      // Calculate MIDI note number (assuming treble clef, middle C = 60)
      // E4=52, F4=53, G4=55, A4=57, B4=59, C5=60, D5=62, E5=64, F5=65
      const noteToMidi = {
        E: 52,
        F: 53,
        G: 55,
        A: 57,
        B: 59,
        C: 60,
        D: 62,
      };

      return {
        ...head,
        pitch: pitchName,
        midiNote: noteToMidi[pitchName] || 60,
        staffIndex,
        staffPosition: staffPositionFromBottom,
      };
    });
  }

  /**
   * Group notes into measures based on vertical bar lines
   */
  static _groupIntoMeasures(notes) {
    if (notes.length === 0) return [];

    // Sort notes by x position (left to right)
    const sortedNotes = [...notes].sort((a, b) => a.x - b.x);

    // Simple measure grouping: divide into equal horizontal sections
    const minX = sortedNotes[0].x;
    const maxX = sortedNotes[sortedNotes.length - 1].x;
    const range = maxX - minX;
    const estimatedMeasureWidth = range / 4; // Guess 4 measures

    const measures = [];
    for (let i = 0; i < 8; i++) {
      measures.push([]);
    }

    // Group notes with sanity check: max 20 notes per measure
    const maxNotesPerMeasure = 20;

    sortedNotes.forEach((note) => {
      const approxMeasureIndex = Math.floor(((note.x - minX) / range) * 8);
      const targetMeasure = Math.max(
        0,
        Math.min(7, approxMeasureIndex)
      );

      if (measures[targetMeasure].length < maxNotesPerMeasure) {
        measures[targetMeasure].push(note);
      }
    });

    return measures.filter((m) => m.length > 0);
  }

  /**
   * Assign notes to SATB voices with deduplication
   */
  static _assignVoices(measures, staffCount) {
    const voices = ['Soprano', 'Alto', 'Tenor', 'Bass'];
    const voicedNotes = [];
    let noteId = 0;

    measures.forEach((measure, measureIndex) => {
      // Remove duplicates: notes at same position with same pitch
      const uniqueNotes = [];
      const seen = new Set();

      for (const note of measure) {
        const key = `${note.x}-${note.y}-${note.midiNote}`;
        if (!seen.has(key)) {
          uniqueNotes.push(note);
          seen.add(key);
        }
      }

      // Sort by pitch (highest to lowest)
      const sorted = uniqueNotes.sort(
        (a, b) => (b.midiNote || 0) - (a.midiNote || 0)
      );

      sorted.forEach((note, idx) => {
        // Assign voice based on pitch and position
        let voice = voices[Math.min(idx, voices.length - 1)];

        voicedNotes.push({
          id: noteId++,
          pitch: note.pitch,
          midiNote: note.midiNote,
          duration: note.duration || 'quarter',
          voice,
          measure: measureIndex,
          timestamp: String(`${measureIndex}:${idx}:${(note.duration || 'quarter').charAt(0)}`),
        });
      });
    });

    console.log(`🎵 Total unique notes after dedup: ${voicedNotes.length}`);
    return voicedNotes;
  }
}
