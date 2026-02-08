import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Audio } from 'expo-av';
import { AudioPlaybackService } from '../services/AudioPlaybackService';
import { PlaybackVisualization } from '../components/PlaybackVisualization';

/**
 * Music playback screen with SATB voice selection and real-time visualization
 */
export const PlaybackScreen = ({ scoreData, imageUri, onNavigateBack }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [tempo, setTempo] = useState(120);
  const [currentNote, setCurrentNote] = useState(null);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [preparing, setPreparing] = useState(false);
  
  console.log('PlaybackScreen received imageUri:', imageUri);
  
  const playbackIntervalRef = useRef(null);
  const shouldStopRef = useRef(false);

  const voices = {
    Soprano: true,
    Alto: true,
    Tenor: true,
    Bass: true,
  };

  const [voiceSelection, setVoiceSelection] = useState(voices);
  const [audioSequence, setAudioSequence] = useState(null);

  // Initialize audio on mount
  useEffect(() => {
    AudioPlaybackService.initAudio();
    prepareAudioSequence();

    return () => {
      cleanup();
    };
  }, [scoreData, tempo]);

  const prepareAudioSequence = async () => {
    setPreparing(true);
    try {
      // Filter notes by selected voices
      const filteredNotes = scoreData.notes.filter(
        (note) => voiceSelection[note.voice]
      );

      if (filteredNotes.length === 0) {
        Alert.alert('No Notes', 'Please select at least one voice');
        setPreparing(false);
        return;
      }

      console.log('🎵 Preparing audio sequence with', filteredNotes.length, 'notes');
      const sequence = await AudioPlaybackService.createAudioSequence(
        filteredNotes,
        tempo
      );

      setAudioSequence(sequence);
      setTotalDuration(sequence.totalDuration);
      setPlaybackPosition(0);
      console.log('✅ Audio sequence ready');
    } catch (error) {
      console.error('Error preparing audio:', error);
      Alert.alert('Error', 'Failed to prepare audio: ' + error.message);
    } finally {
      setPreparing(false);
    }
  };

  const cleanup = async () => {
    shouldStopRef.current = true;
    setIsPlaying(false);
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = null;
    }
    await AudioPlaybackService.stopPlayback();
  };

  const handlePlay = async () => {
    if (!audioSequence) {
      Alert.alert('Not Ready', 'Audio sequence is not prepared');
      return;
    }

    try {
      setIsPlaying(true);
      shouldStopRef.current = false;
      
      const startTime = Date.now();
      const startPosition = playbackPosition;

      // Track playback position with interval
      playbackIntervalRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const newPosition = startPosition + elapsed;

        if (newPosition >= totalDuration) {
          setPlaybackPosition(totalDuration);
          cleanup();
          return;
        }

        setPlaybackPosition(newPosition);

        // Find current note
        let currentNoteData = null;
        for (const segment of audioSequence.segments) {
          if (
            newPosition >= segment.time &&
            newPosition < segment.time + segment.duration
          ) {
            currentNoteData = segment;
            break;
          }
        }
        setCurrentNote(currentNoteData);
      }, 50); // Update every 50ms

      // Play audio segments sequentially
      for (let i = 0; i < audioSequence.segments.length; i++) {
        if (shouldStopRef.current) break;
        
        const segment = audioSequence.segments[i];

        // Wait until it's time to play this segment
        const delay = Math.max(0, (segment.time - startPosition) * 1000 - (Date.now() - startTime));
        
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        if (shouldStopRef.current) break;

        // Play the note
        try {
          const { sound } = await Audio.Sound.createAsync({
            uri: AudioPlaybackService.audioDataToDataURL(segment.audio),
          });
          
          await sound.playAsync();
          
          // Clean up after playing
          setTimeout(() => {
            sound.unloadAsync().catch(() => {});
          }, segment.duration * 1000);
          
        } catch (e) {
          console.warn('Could not play segment:', e);
        }
      }
      
      // Wait for the last segment to finish
      if (!shouldStopRef.current) {
        const remainingTime = (totalDuration - (Date.now() - startTime) / 1000) * 1000;
        if (remainingTime > 0) {
          await new Promise((resolve) => setTimeout(resolve, remainingTime));
        }
      }
      
      if (!shouldStopRef.current) {
        cleanup();
      }
      
    } catch (error) {
      console.error('Playback error:', error);
      Alert.alert('Playback Error', error.message);
      cleanup();
    }
  };

  const handlePause = async () => {
    cleanup();
  };

  const handleStop = async () => {
    await cleanup();
    setPlaybackPosition(0);
    setCurrentNote(null);
  };

  const toggleVoice = (voice) => {
    const updated = { ...voiceSelection, [voice]: !voiceSelection[voice] };
    setVoiceSelection(updated);

    // Re-prepare audio with new voice selection
    const anySelected = Object.values(updated).some((v) => v);
    if (!anySelected) {
      Alert.alert('Select Voice', 'Please select at least one voice');
      return;
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const voiceNotes = Object.keys(voiceSelection).reduce(
    (acc, voice) => {
      acc[voice] = scoreData.notes.filter((n) => n.voice === voice).length;
      return acc;
    },
    {}
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onNavigateBack}>
          <Text style={styles.linkText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Playback</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.content}>
        {/* Playback Controls */}
        <View style={styles.playerCard}>
          <View style={styles.timeDisplay}>
            <Text style={styles.timeText}>{String(formatTime(playbackPosition))}</Text>
            <Text style={styles.durationText}>{String(formatTime(totalDuration))}</Text>
          </View>

          {/* Progress Bar */}
          <View style={styles.progressBarContainer}>
            <Slider
              style={styles.progressBar}
              minimumValue={0}
              maximumValue={totalDuration}
              value={playbackPosition}
              onValueChange={setPlaybackPosition}
              disabled={isPlaying}
            />
          </View>

          {/* Control Buttons */}
          <View style={styles.controlButtonsRow}>
            <TouchableOpacity
              style={[styles.controlButton, styles.playButton]}
              onPress={handlePlay}
              disabled={isPlaying || preparing}
            >
              <Text style={styles.controlButtonText}>▶ Play</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.controlButton, styles.pauseButton]}
              onPress={handlePause}
              disabled={!isPlaying}
            >
              <Text style={styles.controlButtonText}>⏸ Pause</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.controlButton, styles.stopButton]}
              onPress={handleStop}
            >
              <Text style={styles.controlButtonText}>⏹ Stop</Text>
            </TouchableOpacity>
          </View>

          {isPlaying && (
            <View style={styles.playingIndicator}>
              <Text style={styles.playingText}>🎵 Playing...</Text>
            </View>
          )}

          {preparing && (
            <View style={styles.preparingIndicator}>
              <ActivityIndicator size="small" color="#2196F3" />
              <Text style={styles.preparingText}>Preparing audio...</Text>
            </View>
          )}
        </View>

        {/* Tempo Control */}
        <View style={styles.tempoCard}>
          <Text style={styles.sectionTitle}>Tempo: {String(tempo)} BPM</Text>
          <Slider
            style={styles.tempoSlider}
            minimumValue={60}
            maximumValue={200}
            step={5}
            value={tempo}
            onValueChange={setTempo}
            disabled={isPlaying}
          />
          <View style={styles.tempoLabels}>
            <Text style={styles.tempoLabel}>60</Text>
            <Text style={styles.tempoLabel}>130</Text>
            <Text style={styles.tempoLabel}>200</Text>
          </View>
        </View>

        {/* Voice Selection */}
        <View style={styles.voicesCard}>
          <Text style={styles.sectionTitle}>🎼 Select Voices to Play</Text>
          <View style={styles.voiceButtonsRow}>
            {Object.keys(voiceSelection).map((voice) => (
              <TouchableOpacity
                key={voice}
                style={[
                  styles.voiceSelectButton,
                  voiceSelection[voice]
                    ? styles.voiceSelectButtonActive
                    : styles.voiceSelectButtonInactive,
                ]}
                onPress={() => toggleVoice(voice)}
                disabled={isPlaying}
              >
                <Text
                  style={[
                    styles.voiceSelectButtonText,
                    voiceSelection[voice]
                      ? styles.voiceSelectButtonTextActive
                      : styles.voiceSelectButtonTextInactive,
                  ]}
                >
                  {String(voice.charAt(0))}
                </Text>
                <Text style={styles.voiceSelectButtonSubtext}>
                  {String(voice)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Voice Notes Count */}
          <View style={styles.voiceStatsRow}>
            {Object.keys(voiceSelection).map((voice) => (
              <View key={voice} style={styles.voiceStat}>
                <Text style={styles.voiceStatVoice}>{String(voice)}</Text>
                <Text style={styles.voiceStatCount}>
                  {String(voiceNotes[voice])}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Visualization */}
        {audioSequence && (
          <>
            {console.log('🎬 PlaybackScreen rendering PlaybackVisualization with imageUri:', imageUri)}
            <PlaybackVisualization
              scoreData={scoreData}
              imageUri={imageUri}
              isPlaying={isPlaying}
              currentTime={playbackPosition}
              totalDuration={totalDuration}
              selectedVoices={voiceSelection}
              tempo={tempo}
              audioSequence={audioSequence}
            />
          </>
        )}

        {/* Score Summary */}
        <View style={styles.summaryCard}>
          <Text style={styles.sectionTitle}>Score Summary</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Notes:</Text>
            <Text style={styles.summaryValue}>{String(scoreData.notes.length)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Measures:</Text>
            <Text style={styles.summaryValue}>{String(scoreData.measures.length)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Duration (at tempo):</Text>
            <Text style={styles.summaryValue}>{String(formatTime(totalDuration))}</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#2196F3',
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  linkText: {
    fontSize: 14,
    color: '#fff',
    textDecorationLine: 'underline',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  playerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  timeDisplay: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  timeText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2196F3',
  },
  durationText: {
    fontSize: 16,
    color: '#999',
  },
  progressBarContainer: {
    marginBottom: 16,
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
  },
  controlButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  controlButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  playButton: {
    backgroundColor: '#4CAF50',
  },
  pauseButton: {
    backgroundColor: '#FF9800',
  },
  stopButton: {
    backgroundColor: '#f44336',
  },
  controlButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  playingIndicator: {
    backgroundColor: '#E8F5E9',
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  playingText: {
    color: '#2E7D32',
    fontWeight: '600',
  },
  preparingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  preparingText: {
    fontSize: 14,
    color: '#666',
  },
  tempoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  tempoSlider: {
    height: 40,
    marginBottom: 8,
  },
  tempoLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tempoLabel: {
    fontSize: 12,
    color: '#999',
  },
  voicesCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  voiceButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  voiceSelectButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 2,
  },
  voiceSelectButtonActive: {
    backgroundColor: '#E3F2FD',
    borderColor: '#2196F3',
  },
  voiceSelectButtonInactive: {
    backgroundColor: '#f5f5f5',
    borderColor: '#ddd',
  },
  voiceSelectButtonText: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  voiceSelectButtonTextActive: {
    color: '#2196F3',
  },
  voiceSelectButtonTextInactive: {
    color: '#999',
  },
  voiceSelectButtonSubtext: {
    fontSize: 11,
    fontWeight: '500',
  },
  voiceStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  voiceStat: {
    alignItems: 'center',
  },
  voiceStatVoice: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  voiceStatCount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2196F3',
  },
  currentNoteCard: {
    backgroundColor: '#FFF3E0',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
  },
  currentNoteTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E65100',
    marginBottom: 8,
  },
  currentNotePitch: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FF9800',
  },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  summaryLabel: {
    fontSize: 14,
    color: '#666',
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2196F3',
  },
});
