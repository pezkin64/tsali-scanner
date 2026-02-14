import { Audio } from 'expo-av';
import { File, Paths } from 'expo-file-system/next';

/**
 * Piano audio synthesis and playback engine.
 * Generates a single combined WAV written to a temp file (not a data URL).
 * Cursor tracking is driven by onPlaybackStatusUpdate — no manual timers.
 */
export class AudioPlaybackService {
  static sound = null;
  static isPlaying = false;
  static _tempFileUri = null;

  /* ─── Frequency helpers ─── */

  static midiToFrequency(midiNote) {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
  }

  /* ─── Waveform generation ─── */

  /**
   * Generate a piano-like note as Float32Array samples (mono 44100 Hz).
   */
  static generatePianoNote(midiNote, duration = 1.0, velocity = 100) {
    const frequency = this.midiToFrequency(midiNote);
    const sampleRate = 44100;
    const sampleCount = Math.floor(sampleRate * duration);
    const audioData = new Float32Array(sampleCount);
    const velocityFactor = velocity / 127;

    const attackTime = 0.008;
    const decayTime = 0.15;
    const sustainLevel = 0.6;
    const releaseTime = Math.min(0.2, duration * 0.15);

    const attackSamples = Math.floor(sampleRate * attackTime);
    const decaySamples = Math.floor(sampleRate * decayTime);
    const releaseSamples = Math.floor(sampleRate * releaseTime);
    const sustainSamples = Math.max(0, sampleCount - attackSamples - decaySamples - releaseSamples);

    for (let i = 0; i < sampleCount; i++) {
      let envelope = 0;

      if (i < attackSamples) {
        envelope = i / attackSamples;
      } else if (i < attackSamples + decaySamples) {
        const p = (i - attackSamples) / decaySamples;
        envelope = 1.0 - p * (1.0 - sustainLevel);
      } else if (i < attackSamples + decaySamples + sustainSamples) {
        const p = (i - attackSamples - decaySamples) / Math.max(1, sustainSamples);
        envelope = sustainLevel * (1.0 - p * 0.3);
      } else {
        const p = (i - attackSamples - decaySamples - sustainSamples) / Math.max(1, releaseSamples);
        envelope = sustainLevel * 0.7 * (1.0 - p);
      }

      const t = i / sampleRate;
      const fundamental = Math.sin(2 * Math.PI * frequency * t);
      const h2 = 0.35 * Math.sin(2 * Math.PI * frequency * 2 * t);
      const h3 = 0.15 * Math.sin(2 * Math.PI * frequency * 3 * t);
      const h4 = 0.06 * Math.sin(2 * Math.PI * frequency * 4 * t);

      const sample = (fundamental + h2 + h3 + h4) / 1.56;
      audioData[i] = sample * envelope * velocityFactor * 0.75;
    }
    return audioData;
  }

  /* ─── WAV encoding ─── */

  /**
   * Encode Float32Array samples into a WAV file and write to temp storage.
   * Returns the file URI (no huge base64 string in memory).
   */
  static async writeWavToFile(audioData) {
    const sampleRate = 44100;
    const bytesPerSample = 2;
    const subChunk2Size = audioData.length * bytesPerSample;
    const totalBytes = 44 + subChunk2Size;
    const wavBuffer = new ArrayBuffer(totalBytes);
    const view = new DataView(wavBuffer);

    const ws = (o, s) => {
      for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
    };
    ws(0, 'RIFF');
    view.setUint32(4, 36 + subChunk2Size, true);
    ws(8, 'WAVE');
    ws(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    ws(36, 'data');
    view.setUint32(40, subChunk2Size, true);

    let offset = 44;
    for (let i = 0; i < audioData.length; i++) {
      const s = Math.max(-1, Math.min(1, audioData[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }

    // Write raw WAV bytes directly to a temp file using the new File API
    const bytes = new Uint8Array(wavBuffer);
    const fileName = 'notescan_playback_' + Date.now() + '.wav';
    const file = new File(Paths.cache, fileName);
    file.write(bytes);

    return file.uri;
  }

  /* ─── Combined audio generation ─── */

  /**
   * Build a single WAV containing all notes with correct timestamps.
   *
   * @param {Array} notes - sorted voiced notes with midiNote, duration, x, y, staffIndex
   * @param {number} tempo - BPM
   * @returns {Promise<{ fileUri: string, timingMap: Array, totalDuration: number }>}
   *
   * timingMap entries: { time, x, y, staffIndex }
   */
  static async createCombinedAudio(notes, tempo = 120) {
    const sampleRate = 44100;
    const secondsPerBeat = 60 / tempo;
    const durationMap = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 };

    if (!notes || notes.length === 0) {
      return { fileUri: '', timingMap: [], totalDuration: 0 };
    }

    // Sort notes: first by staff system, then x position
    const sorted = [...notes].sort((a, b) => {
      const sa = Number.isFinite(a.staffIndex) ? a.staffIndex : 999;
      const sb = Number.isFinite(b.staffIndex) ? b.staffIndex : 999;
      if (sa !== sb) return sa - sb;
      return (a.x || 0) - (b.x || 0);
    });

    // Build system mapping: pair adjacent staves into grand-staff systems
    const staffIndices = [...new Set(sorted.map((n) => n.staffIndex).filter(Number.isFinite))].sort(
      (a, b) => a - b
    );
    const staffToSystem = new Map();
    let sysIdx = 0;
    for (let i = 0; i < staffIndices.length; i++) {
      if (staffToSystem.has(staffIndices[i])) continue;
      staffToSystem.set(staffIndices[i], sysIdx);
      if (i + 1 < staffIndices.length && staffIndices[i + 1] === staffIndices[i] + 1) {
        staffToSystem.set(staffIndices[i + 1], sysIdx);
        i++;
      }
      sysIdx++;
    }

    // Group notes by system
    const systemNotes = new Map();
    for (const note of sorted) {
      const sys = staffToSystem.get(note.staffIndex) ?? 0;
      if (!systemNotes.has(sys)) systemNotes.set(sys, []);
      systemNotes.get(sys).push(note);
    }

    // Lay out each system sequentially; within a system, group by x→chords
    const timingMap = [];
    const chordMeta = []; // lightweight metadata, not audio buffers
    let globalTime = 0;

    const systems = [...systemNotes.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, sysNotes] of systems) {
      sysNotes.sort((a, b) => (a.x || 0) - (b.x || 0));

      // Group into chords (notes within 8px of each other)
      const chords = [];
      let chord = [sysNotes[0]];
      for (let i = 1; i < sysNotes.length; i++) {
        if (Math.abs((sysNotes[i].x || 0) - (chord[0].x || 0)) < 8) {
          chord.push(sysNotes[i]);
        } else {
          chords.push(chord);
          chord = [sysNotes[i]];
        }
      }
      chords.push(chord);

      for (const ch of chords) {
        const beats = durationMap[ch[0].duration] || 1;
        const noteDuration = beats * secondsPerBeat;

        // Average position for cursor placement
        const avgX = ch.reduce((s, n) => s + (n.x || 0), 0) / ch.length;
        const avgY = ch.reduce((s, n) => s + (n.y || 0), 0) / ch.length;
        const si = ch[0].staffIndex;

        timingMap.push({ time: globalTime, x: avgX, y: avgY, staffIndex: si });

        chordMeta.push({
          offsetSamples: Math.floor(globalTime * sampleRate),
          notes: ch.map((n) => ({ midiNote: n.midiNote || 60 })),
          noteDuration,
        });

        globalTime += noteDuration;
      }
    }

    // Build master buffer — generate audio per chord and mix directly
    // (avoids keeping all intermediate Float32Arrays alive simultaneously)
    const tailSec = 0.3;
    const totalSamples = Math.floor((globalTime + tailSec) * sampleRate);
    const master = new Float32Array(totalSamples);

    for (const meta of chordMeta) {
      const sampleCount = Math.floor(sampleRate * meta.noteDuration);

      for (const n of meta.notes) {
        const noteAudio = this.generatePianoNote(n.midiNote, meta.noteDuration);
        const start = meta.offsetSamples;
        const len = Math.min(noteAudio.length, totalSamples - start);
        for (let i = 0; i < len; i++) master[start + i] += noteAudio[i];
        // noteAudio is GC-eligible immediately after this iteration
      }
    }

    // Final normalization
    let masterPeak = 0;
    for (let i = 0; i < master.length; i++) masterPeak = Math.max(masterPeak, Math.abs(master[i]));
    if (masterPeak > 1) for (let i = 0; i < master.length; i++) master[i] /= masterPeak;

    // Write to temp file instead of keeping a huge data URL string in memory
    const fileUri = await this.writeWavToFile(master);

    console.log(
      `🎹 Combined audio: ${globalTime.toFixed(1)}s, ${timingMap.length} timing points`
    );

    return { fileUri, timingMap, totalDuration: globalTime };
  }

  /* ─── Playback control ─── */

  static async initAudio() {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
      });
    } catch (e) {
      console.warn('Audio init warning:', e);
    }
  }

  /**
   * Play combined audio. Calls `onPositionUpdate(timeSec)` ~20×/sec.
   * Calls `onFinished()` when playback completes.
   */
  static async play(fileUri, onPositionUpdate, onFinished) {
    await this.stop();
    this._tempFileUri = fileUri;

    const { sound } = await Audio.Sound.createAsync(
      { uri: fileUri },
      { shouldPlay: true, progressUpdateIntervalMillis: 50 }
    );

    this.sound = sound;
    this.isPlaying = true;

    sound.setOnPlaybackStatusUpdate((status) => {
      if (!status.isLoaded) return;

      if (status.isPlaying && status.positionMillis != null) {
        if (onPositionUpdate) onPositionUpdate(status.positionMillis / 1000);
      }

      if (status.didJustFinish) {
        this.isPlaying = false;
        if (onFinished) onFinished();
      }
    });
  }

  static async pause() {
    if (this.sound) {
      try {
        const status = await this.sound.getStatusAsync();
        if (status.isLoaded && status.isPlaying) await this.sound.pauseAsync();
      } catch (e) {
        /* ignore */
      }
    }
    this.isPlaying = false;
  }

  static async resume() {
    if (this.sound) {
      try {
        const status = await this.sound.getStatusAsync();
        if (status.isLoaded && !status.isPlaying) {
          await this.sound.playAsync();
          this.isPlaying = true;
        }
      } catch (e) {
        /* ignore */
      }
    }
  }

  static async stop() {
    if (this.sound) {
      try {
        await this.sound.stopAsync();
        await this.sound.unloadAsync();
      } catch (e) {
        /* already unloaded */
      }
      this.sound = null;
    }
    // Clean up temp file
    if (this._tempFileUri) {
      try {
        const tmpFile = new File(this._tempFileUri);
        if (tmpFile.exists) tmpFile.delete();
      } catch (_) { /* already removed */ }
      this._tempFileUri = null;
    }
    this.isPlaying = false;
  }

  static async seekTo(timeSeconds) {
    if (this.sound) {
      try {
        await this.sound.setPositionAsync(Math.floor(timeSeconds * 1000));
      } catch (e) {
        /* ignore */
      }
    }
  }
}
