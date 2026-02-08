import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';

/**
 * Real-time visualization component for music playback
 * Shows notes being played, measure progress, and tempo indicator
 */
export const PlaybackVisualization = ({
  scoreData,
  isPlaying,
  currentTime,
  totalDuration,
  selectedVoices,
  tempo,
}) => {
  const [animatedValue] = useState(new Animated.Value(0));
  const screenWidth = Dimensions.get('window').width;
  const noteGridWidth = screenWidth - 32;

  // Get notes ordered by time
  const filteredNotes = scoreData.notes.filter((note) => selectedVoices[note.voice]);

  // Calculate timing for each note
  const notesWithTiming = filteredNotes.map((note) => {
    const beatDuration = {
      whole: 4,
      half: 2,
      quarter: 1,
      eighth: 0.5,
    }[note.duration] || 1;

    const secondsPerBeat = 60 / tempo;
    const noteDuration = beatDuration * secondsPerBeat;

    return {
      ...note,
      duration: noteDuration,
    };
  });

  // Sort by measure and position
  const sortedNotes = notesWithTiming.sort((a, b) => {
    if (a.measure !== b.measure) return a.measure - b.measure;
    return a.midiNote - b.midiNote;
  });

  // Find current playing notes
  const currentNotes = sortedNotes.filter((note) => {
    const noteTime = note.measure * 4 * (60 / tempo); // Approximate timing
    return Math.abs(currentTime - noteTime) < 0.5;
  });

  // Get current measure
  const currentMeasure = Math.floor(currentTime / (4 * (60 / tempo)));

  // Calculate progress
  const progressPercent = (currentTime / totalDuration) * 100;

  // Tempo indicator animation
  useEffect(() => {
    if (isPlaying) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(animatedValue, {
            toValue: 1,
            duration: (60 / tempo) * 1000, // Duration of one beat
            useNativeDriver: false,
          }),
          Animated.timing(animatedValue, {
            toValue: 0,
            duration: 0,
            useNativeDriver: false,
          }),
        ])
      ).start();
    }
  }, [isPlaying, tempo]);

  const beatScale = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.5],
  });

  const beatOpacity = animatedValue.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 0.6, 0],
  });

  return (
    <View style={styles.container}>
      {/* Tempo Indicator */}
      <View style={styles.tempoIndicatorContainer}>
        <Text style={styles.tempoLabel}>♩ {String(tempo)} BPM</Text>
        {isPlaying && (
          <Animated.View
            style={[
              styles.tempoIndicator,
              {
                transform: [{ scale: isPlaying ? beatScale : 1 }],
                opacity: isPlaying ? beatOpacity : 1,
              },
            ]}
          >
            <View style={styles.tempoPulse} />
          </Animated.View>
        )}
      </View>

      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              { width: `${progressPercent}%` },
            ]}
          />
        </View>
        <Text style={styles.progressText}>
          M{String(currentMeasure + 1)}
        </Text>
      </View>

      {/* Notes Visualization Grid */}
      <View style={styles.notesVisualization}>
        <Text style={styles.vizTitle}>🎵 Notes</Text>

        {/* Measure Sections */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={true}
          scrollEventThrottle={16}
        >
          <View style={styles.measuresContainer}>
            {scoreData.measures.map((measure, measureIdx) => {
              const measureNotes = sortedNotes.filter(
                (n) => n.measure === measureIdx
              );
              const isCurrentMeasure = measureIdx === currentMeasure;

              return (
                <View
                  key={measureIdx}
                  style={[
                    styles.measureBox,
                    isCurrentMeasure && styles.measureBoxActive,
                  ]}
                >
                  <Text style={styles.measureNumber}>
                    M{String(measureIdx + 1)}
                  </Text>

                  {/* Notes in this measure */}
                  <View style={styles.notesInMeasure}>
                    {measureNotes.map((note, noteIdx) => {
                      const isPlaying =
                        currentNotes.some((n) => n.midiNote === note.midiNote);

                      return (
                        <View
                          key={noteIdx}
                          style={[
                            styles.noteItem,
                            isPlaying && styles.noteItemPlaying,
                          ]}
                        >
                          <Text
                            style={[
                              styles.noteItemPitch,
                              isPlaying && styles.noteItemPitchPlaying,
                            ]}
                          >
                            {String(note.pitch)}
                          </Text>
                          <Text style={styles.noteItemVoice}>
                            {String(note.voice.charAt(0))}
                          </Text>
                          <Text style={styles.noteItemDuration}>
                            {String(
                              note.duration.charAt(0).toUpperCase()
                            )}
                          </Text>
                        </View>
                      );
                    })}

                    {measureNotes.length === 0 && (
                      <Text style={styles.emptyMeasure}>-</Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* Voice Status */}
      <View style={styles.voiceStatusContainer}>
        <Text style={styles.voiceStatusTitle}>Active Voices</Text>
        <View style={styles.voiceStatusRow}>
          {['Soprano', 'Alto', 'Tenor', 'Bass'].map((voice) => (
            <View
              key={voice}
              style={[
                styles.voiceStatusBadge,
                selectedVoices[voice]
                  ? styles.voiceStatusBadgeActive
                  : styles.voiceStatusBadgeInactive,
              ]}
            >
              <Text
                style={[
                  styles.voiceStatusBadgeText,
                  selectedVoices[voice]
                    ? styles.voiceStatusBadgeTextActive
                    : styles.voiceStatusBadgeTextInactive,
                ]}
              >
                {String(voice.charAt(0))}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Performance Stats */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Measures</Text>
          <Text style={styles.statValue}>
            {String(currentMeasure + 1)} / {String(scoreData.measures.length)}
          </Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Notes Left</Text>
          <Text style={styles.statValue}>
            {String(Math.max(0, filteredNotes.length - currentNotes.length))}
          </Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Completion</Text>
          <Text style={styles.statValue}>
            {String(Math.round(progressPercent))}%
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fafafa',
    padding: 16,
    marginBottom: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  tempoIndicatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tempoLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2196F3',
  },
  tempoIndicator: {
    marginLeft: 'auto',
  },
  tempoPulse: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FF9800',
  },
  progressContainer: {
    marginBottom: 16,
  },
  progressBar: {
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#2196F3',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  notesVisualization: {
    marginBottom: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
  },
  vizTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  measuresContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  measureBox: {
    minWidth: 80,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 2,
    borderColor: '#ddd',
    borderRadius: 6,
    backgroundColor: '#fafafa',
    alignItems: 'center',
  },
  measureBoxActive: {
    borderColor: '#2196F3',
    backgroundColor: '#E3F2FD',
  },
  measureNumber: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#666',
    marginBottom: 8,
  },
  notesInMeasure: {
    alignItems: 'center',
    gap: 4,
  },
  noteItem: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  noteItemPlaying: {
    backgroundColor: '#FFE082',
    borderColor: '#FF9800',
    shadowColor: '#FF9800',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  noteItemPitch: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#333',
  },
  noteItemPitchPlaying: {
    color: '#E65100',
  },
  noteItemVoice: {
    fontSize: 10,
    color: '#999',
    marginTop: 2,
  },
  noteItemDuration: {
    fontSize: 9,
    color: '#bbb',
  },
  emptyMeasure: {
    fontSize: 14,
    color: '#ddd',
    fontWeight: 'bold',
  },
  voiceStatusContainer: {
    marginBottom: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  voiceStatusTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  voiceStatusRow: {
    flexDirection: 'row',
    gap: 8,
  },
  voiceStatusBadge: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
  },
  voiceStatusBadgeActive: {
    backgroundColor: '#E3F2FD',
    borderColor: '#2196F3',
  },
  voiceStatusBadgeInactive: {
    backgroundColor: '#f5f5f5',
    borderColor: '#ddd',
  },
  voiceStatusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  voiceStatusBadgeTextActive: {
    color: '#2196F3',
  },
  voiceStatusBadgeTextInactive: {
    color: '#999',
  },
  statsContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  statLabel: {
    fontSize: 11,
    color: '#999',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2196F3',
  },
});
