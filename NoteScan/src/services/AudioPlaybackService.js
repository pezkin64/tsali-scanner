import { Audio } from 'expo-av';

/**
 * Piano audio synthesis and playback engine
 * Generates piano-like sounds for detected notes and manages playback
 */
export class AudioPlaybackService {
  static instance = null;
  static sound = null;
  static isPlaying = false;
  static currentPosition = 0;

  static getInstance() {
    if (!AudioPlaybackService.instance) {
      AudioPlaybackService.instance = new AudioPlaybackService();
    }
    return AudioPlaybackService.instance;
  }

  /**
   * MIDI note to frequency mapping (Hz)
   * A0 (MIDI 21) = 27.5 Hz, up to C8 (MIDI 108) = 4186 Hz
   */
  static midiToFrequency(midiNote) {
    // Formula: f = 440 * 2^((n-69)/12)
    // MIDI note 69 is A4 (440 Hz)
    return 440 * Math.pow(2, (midiNote - 69) / 12);
  }

  /**
   * Generate a piano note as an audio buffer (WAV format)
   * Uses synthesis to create piano-like sound with envelope
   */
  static generatePianoNote(midiNote, duration = 1.0, velocity = 127) {
    const frequency = this.midiToFrequency(midiNote);
    const sampleRate = 44100; // Standard sample rate
    const sampleCount = Math.floor(sampleRate * duration);
    const audioData = new Float32Array(sampleCount);
    const velocityFactor = velocity / 127;

    // Envelope: Attack (10ms), Sustain (80%), Release (10%)
    const attackTime = 0.01;
    const releaseTime = 0.1;
    const sustainDuration = duration - attackTime - releaseTime;

    const attackSamples = Math.floor(sampleRate * attackTime);
    const releaseSamples = Math.floor(sampleRate * releaseTime);
    const sustainSamples = sampleCount - attackSamples - releaseSamples;

    for (let i = 0; i < sampleCount; i++) {
      let envelope = 0;
      let sample = 0;

      // Attack phase
      if (i < attackSamples) {
        envelope = i / attackSamples;
      }
      // Sustain phase
      else if (i < attackSamples + sustainSamples) {
        envelope = 1.0;
      }
      // Release phase
      else {
        const releaseProgress = (i - attackSamples - sustainSamples) / releaseSamples;
        envelope = 1.0 - releaseProgress;
      }

      // Generate waveform (piano: mix of sine and harmonics)
      const t = i / sampleRate;
      const fundamental = Math.sin(2 * Math.PI * frequency * t);
      const harmonic2 = 0.3 * Math.sin(2 * Math.PI * frequency * 2 * t);
      const harmonic3 = 0.1 * Math.sin(2 * Math.PI * frequency * 3 * t);

      // Combine waveforms
      sample = (fundamental + harmonic2 + harmonic3) / 1.4; // Normalize

      // Apply envelope and velocity
      audioData[i] = sample * envelope * velocityFactor * 0.8; // 0.8 to prevent clipping
    }

    return audioData;
  }

  /**
   * Convert WAV audio data to base64 data URL
   */
  static audioDataToDataURL(audioData) {
    const sampleRate = 44100;
    const numChannels = 1;
    const sampleBitDepth = 16;

    // WAV header
    const bytesPerSample = sampleBitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const subChunk2Size = audioData.length * bytesPerSample;
    const chunkSize = 36 + subChunk2Size;

    const wavBuffer = new ArrayBuffer(44 + subChunk2Size);
    const view = new DataView(wavBuffer);

    // Write WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, chunkSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // AudioFormat (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, sampleBitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, subChunk2Size, true);

    // Write audio data (16-bit PCM)
    let offset = 44;
    for (let i = 0; i < audioData.length; i++) {
      const sample = Math.max(-1, Math.min(1, audioData[i])); // Clamp to [-1, 1]
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }

    // Convert to base64 data URL
    const blob = new Uint8Array(wavBuffer);
    let binaryString = '';
    for (let i = 0; i < blob.length; i++) {
      binaryString += String.fromCharCode(blob[i]);
    }
    const base64 = globalThis.btoa(binaryString);
    return 'data:audio/wav;base64,' + base64;
  }

  /**
   * Create audio sequence from detected notes
   * Sequentially plays notes with timing based on duration
   */
  static async createAudioSequence(notes, tempo = 120) {
    try {
      console.log('🎹 Creating audio sequence from', notes.length, 'notes');

      // Group notes by timing
      const notesByTime = {};
      let currentTime = 0;

      // Create timing map
      notes.forEach((note) => {
        // Duration to beat duration
        const beatDuration = {
          whole: 4,
          half: 2,
          quarter: 1,
          eighth: 0.5,
        }[note.duration] || 1;

        const secondsPerBeat = 60 / tempo;
        const noteDuration = beatDuration * secondsPerBeat;

        if (!notesByTime[currentTime]) {
          notesByTime[currentTime] = [];
        }
        notesByTime[currentTime].push({ note, duration: noteDuration });

        currentTime += noteDuration;
      });

      // Generate audio for each timing slot
      const audioSegments = [];
      const times = Object.keys(notesByTime).map(Number).sort((a, b) => a - b);

      for (const time of times) {
        const notesAtTime = notesByTime[time];
        const maxDuration = Math.max(...notesAtTime.map((n) => n.duration));

        // Mix all notes at this time
        const mixedAudio = await this._mixNotes(notesAtTime, maxDuration);
        audioSegments.push({ time, audio: mixedAudio, duration: maxDuration });
      }

      return {
        segments: audioSegments,
        totalDuration: currentTime,
        tempo,
      };
    } catch (error) {
      console.error('Error creating audio sequence:', error);
      throw error;
    }
  }

  /**
   * Mix multiple notes (for simultaneous playback)
   */
  static async _mixNotes(notesAtTime, duration) {
    const sampleRate = 44100;
    const sampleCount = Math.floor(sampleRate * duration);
    const mixedAudio = new Float32Array(sampleCount);

    // Generate each note
    notesAtTime.forEach(({ note, duration: noteDuration }) => {
      const noteAudio = this.generatePianoNote(note.midiNote, noteDuration);
      const noteLength = Math.min(noteAudio.length, mixedAudio.length);

      // Add to mix
      for (let i = 0; i < noteLength; i++) {
        mixedAudio[i] += noteAudio[i];
      }
    });

    // Normalize if needed
    const maxAmplitude = Math.max(...mixedAudio.map(Math.abs));
    if (maxAmplitude > 1) {
      for (let i = 0; i < mixedAudio.length; i++) {
        mixedAudio[i] /= maxAmplitude;
      }
    }

    return mixedAudio;
  }

  /**
   * Play a single note
   */
  static async playNote(midiNote, duration = 1.0) {
    try {
      // Cleanup previous sound
      if (AudioPlaybackService.sound) {
        await AudioPlaybackService.sound.unloadAsync();
      }

      // Generate audio
      const audioData = this.generatePianoNote(midiNote, duration);
      const dataUrl = this.audioDataToDataURL(audioData);

      // Create and play sound
      const { Sound } = await Audio.Sound.create({ uri: dataUrl });
      AudioPlaybackService.sound = Sound;
      await Sound.playAsync();
    } catch (error) {
      console.error('Error playing note:', error);
      throw error;
    }
  }

  /**
   * Stop current playback
   */
  static async stopPlayback() {
    try {
      if (AudioPlaybackService.sound) {
        await AudioPlaybackService.sound.stopAsync();
        await AudioPlaybackService.sound.unloadAsync();
        AudioPlaybackService.sound = null;
      }
      AudioPlaybackService.isPlaying = false;
    } catch (error) {
      console.error('Error stopping playback:', error);
    }
  }

  /**
   * Initialize audio context
   */
  static async initAudio() {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });
      console.log('✅ Audio context initialized');
    } catch (error) {
      console.error('Error initializing audio:', error);
    }
  }
}
