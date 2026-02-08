import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MusicSheetProcessor } from '../services/MusicSheetProcessor';

export const MusicScoreScreen = ({ imageUri, onNavigateBack, onNavigateToPlayback }) => {
  const [processing, setProcessing] = useState(true);
  const [scoreData, setScoreData] = useState(null);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [error, setError] = useState(null);

  const voices = ['Soprano', 'Alto', 'Tenor', 'Bass'];

  useEffect(() => {
    if (imageUri) {
      processScore();
    }
  }, [imageUri]);

  const processScore = async () => {
    setProcessing(true);
    setError(null);

    try {
      console.log('🎼 Processing score from:', imageUri);
      const result = await MusicSheetProcessor.processSheet(imageUri);
      setScoreData(result);
      console.log('✅ Score processed:', result);
    } catch (err) {
      console.error('❌ Error processing score:', err);
      setError(err.message);
      Alert.alert('Error', 'Failed to process music sheet: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  if (processing) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onNavigateBack}>
            <Text style={styles.linkText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Processing Score</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.processingContainer}>
          <ActivityIndicator size="large" color="#2196F3" />
          <Text style={styles.processingText}>Analyzing music sheet...</Text>
        </View>
      </View>
    );
  }

  if (error || !scoreData) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onNavigateBack}>
            <Text style={styles.linkText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Processing Error</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>⚠️ Error Processing Sheet</Text>
          <Text style={styles.errorText}>{error || 'Unknown error'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={processScore}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const notesByVoice = {};
  voices.forEach((voice) => {
    notesByVoice[voice] = scoreData.notes.filter((n) => n.voice === voice);
  });

  const displayVoices = selectedVoice ? [selectedVoice] : voices;
  const visibleNotes = selectedVoice
    ? notesByVoice[selectedVoice]
    : scoreData.notes;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onNavigateBack}>
          <Text style={styles.linkText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Music Score</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.content}>
        {/* Statistics */}
        <View style={styles.statsCard}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Total Notes</Text>
            <Text style={styles.statValue}>{String(scoreData.notes.length)}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Measures</Text>
            <Text style={styles.statValue}>{String(scoreData.measures.length)}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Staves</Text>
            <Text style={styles.statValue}>{String(scoreData.staves)}</Text>
          </View>
        </View>

        {/* Voice Selection */}
        <View style={styles.voiceSelector}>
          <Text style={styles.voiceLabel}>Select Voice:</Text>
          <View style={styles.voiceButtons}>
            <TouchableOpacity
              style={[styles.voiceButton, !selectedVoice && styles.voiceButtonActive]}
              onPress={() => setSelectedVoice(null)}
            >
              <Text
                style={[
                  styles.voiceButtonText,
                  !selectedVoice && styles.voiceButtonTextActive,
                ]}
              >
                All
              </Text>
            </TouchableOpacity>
            {voices.map((voice) => (
              <TouchableOpacity
                key={voice}
                style={[
                  styles.voiceButton,
                  selectedVoice === voice && styles.voiceButtonActive,
                ]}
                onPress={() => setSelectedVoice(voice)}
              >
                <Text
                  style={[
                    styles.voiceButtonText,
                    selectedVoice === voice && styles.voiceButtonTextActive,
                  ]}
                >
                  {String(voice.charAt(0))}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Notes Display */}
        <View style={styles.notesContainer}>
          <Text style={styles.notesTitle}>
            {selectedVoice ? `${String(selectedVoice)} - ` : ''}Detected Notes
          </Text>

          {visibleNotes.length === 0 ? (
            <View style={styles.emptyNotes}>
              <Text style={styles.emptyNotesText}>No notes detected</Text>
            </View>
          ) : (
            <View style={styles.notesList}>
              {visibleNotes.map((note, idx) => (
                <View key={idx} style={styles.noteCard}>
                  <View style={styles.noteMainInfo}>
                    <Text style={styles.notePitch}>{String(note.pitch)}</Text>
                    <View style={styles.noteDetailsBox}>
                      <Text style={styles.noteDetail}>
                        Duration: {String(note.duration)}
                      </Text>
                      <Text style={styles.noteDetail}>
                        MIDI: {String(note.midiNote)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.noteSecondaryInfo}>
                    <Text style={styles.noteVoice}>{String(note.voice)}</Text>
                    <Text style={styles.noteMeasure}>M{String(note.measure + 1)}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Voice Summary */}
        <View style={styles.voiceSummary}>
          <Text style={styles.summaryTitle}>Voice Summary</Text>
          {voices.map((voice) => (
            <View key={voice} style={styles.voiceRow}>
              <Text style={styles.voiceName}>{String(voice)}</Text>
              <Text style={styles.voiceCount}>
                {String(notesByVoice[voice].length)} notes
              </Text>
            </View>
          ))}
        </View>

        {/* Playback Button */}
        <TouchableOpacity
          style={styles.playbackButton}
          onPress={() => onNavigateToPlayback(scoreData)}
        >
          <Text style={styles.playbackButtonText}>🎵 Play Music</Text>
        </TouchableOpacity>
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
  processingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  errorContainer: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#d32f2f',
    marginBottom: 12,
  },
  errorText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  statsCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2196F3',
  },
  voiceSelector: {
    marginBottom: 20,
  },
  voiceLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  voiceButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  voiceButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#e0e0e0',
    borderWidth: 1,
    borderColor: '#ccc',
  },
  voiceButtonActive: {
    backgroundColor: '#2196F3',
    borderColor: '#1976d2',
  },
  voiceButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  voiceButtonTextActive: {
    color: '#fff',
  },
  notesContainer: {
    marginBottom: 20,
  },
  notesTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  notesList: {
    gap: 8,
  },
  noteCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  noteMainInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  notePitch: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2196F3',
    minWidth: 40,
    textAlign: 'center',
  },
  noteDetailsBox: {
    flex: 1,
  },
  noteDetail: {
    fontSize: 12,
    color: '#666',
  },
  noteSecondaryInfo: {
    alignItems: 'flex-end',
  },
  noteVoice: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2196F3',
    marginBottom: 4,
  },
  noteMeasure: {
    fontSize: 11,
    color: '#999',
  },
  emptyNotes: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 32,
    alignItems: 'center',
  },
  emptyNotesText: {
    fontSize: 16,
    color: '#999',
  },
  voiceSummary: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  summaryTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  voiceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  voiceName: {
    fontSize: 14,
    color: '#333',
  },
  voiceCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2196F3',
  },
  playbackButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  playbackButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
