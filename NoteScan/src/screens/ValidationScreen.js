import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  FlatList,
  Alert,
  Platform,
  StatusBar,
} from 'react-native';
import { ValidationService } from '../services/ValidationService';

const palette = {
  background: '#F9F7F1',
  surface: '#FBFAF5',
  surfaceStrong: '#F1EEE4',
  border: '#D6D0C4',
  ink: '#3E3C37',
  inkMuted: '#6E675E',
};

export const ValidationScreen = ({ onNavigateBack }) => {
  const [mode, setMode] = useState('setSelection'); // 'setSelection', 'setDetails', 'sheetView'
  const [selectedSet, setSelectedSet] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [currentSheetIndex, setCurrentSheetIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);

  const availableSets = ValidationService.getAvailableSets();

  const handleSelectSet = async (set) => {
    try {
      setLoading(true);
      setSelectedSet(set);
      const loadedSheets = await ValidationService.loadValidationSet(set.id);
      setSheets(loadedSheets);
      setCurrentSheetIndex(0);
      setMode('setDetails');
    } catch (error) {
      console.error('Error loading set:', error);
      Alert.alert('Error', 'Failed to load validation set: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartValidation = () => {
    setMode('sheetView');
  };

  const processCurrentSheet = async () => {
    if (!sheets[currentSheetIndex]) return;

    const sheet = sheets[currentSheetIndex];
    setLoading(true);

    try {
      console.log(`Processing sheet ${currentSheetIndex + 1}/${sheets.length}...`);
      const predictions = await ValidationService.processSheet(sheet.backgroundUri);
      
      const updatedSheets = [...sheets];
      updatedSheets[currentSheetIndex] = {
        ...sheet,
        predictions,
        loaded: true,
      };
      setSheets(updatedSheets);

      // Calculate running stats
      const stats = ValidationService.calculateStats(updatedSheets);
      setStats(stats);
    } catch (error) {
      console.error('Error processing sheet:', error);
      Alert.alert('Error', 'Failed to process sheet: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const goToNextSheet = () => {
    if (currentSheetIndex < sheets.length - 1) {
      setCurrentSheetIndex(currentSheetIndex + 1);
    }
  };

  const goToPrevSheet = () => {
    if (currentSheetIndex > 0) {
      setCurrentSheetIndex(currentSheetIndex - 1);
    }
  };

  const processAllRemaining = async () => {
    setLoading(true);
    try {
      for (let i = currentSheetIndex; i < sheets.length; i++) {
        if (sheets[i].loaded) continue;
        
        const predictions = await ValidationService.processSheet(sheets[i].backgroundUri);
        const updatedSheets = [...sheets];
        updatedSheets[i] = {
          ...sheets[i],
          predictions,
          loaded: true,
        };
        setSheets(updatedSheets);

        // Update stats
        const stats = ValidationService.calculateStats(updatedSheets);
        setStats(stats);
      }
      Alert.alert('Success', 'All sheets processed!');
    } catch (error) {
      console.error('Error processing sheets:', error);
      Alert.alert('Error', 'Failed to process sheets: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Set Selection Mode
  if (mode === 'setSelection') {
    return (
      <ScrollView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={palette.background} />
        <View style={styles.header}>
          <Text style={styles.title}>Validation</Text>
          <TouchableOpacity onPress={onNavigateBack}>
            <Text style={styles.linkText}>← Back</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <Text style={styles.subtitle}>Select a validation set:</Text>
          
          {availableSets.map((set) => (
            <TouchableOpacity
              key={set.id}
              style={styles.setCard}
              onPress={() => handleSelectSet(set)}
            >
              <Text style={styles.setName}>{set.name}</Text>
              <Text style={styles.setCount}>{set.count} sheets</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    );
  }

  // Set Details Mode
  if (mode === 'setDetails') {
    return (
      <ScrollView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={palette.background} />
        <View style={styles.header}>
          <Text style={styles.title}>{selectedSet?.name}</Text>
          <TouchableOpacity onPress={() => setMode('setSelection')}>
            <Text style={styles.linkText}>← Back</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Total Sheets:</Text>
            <Text style={styles.infoValue}>{sheets.length}</Text>
          </View>

          {stats && (
            <View style={styles.statsCard}>
              <Text style={styles.statsTitle}>Progress Statistics</Text>
              <Text style={styles.statLine}>
                Processed: {String(stats.processed)}/{String(stats.total)}
              </Text>
              <Text style={styles.statLine}>
                Avg OCR Confidence: {String(stats.avgOcrConfidence)}%
              </Text>
              <Text style={styles.statLine}>
                Avg Key Signature Confidence: {String(stats.avgKeySignatureConfidence)}%
              </Text>
              <Text style={styles.statLine}>
                Avg Digit Confidence: {String(stats.avgDigitConfidence)}%
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.button}
            onPress={handleStartValidation}
            disabled={loading}
          >
            <Text style={styles.buttonText}>Start Validation</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={processAllRemaining}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Processing...' : 'Process All'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // Sheet View Mode
  const currentSheet = sheets[currentSheetIndex];

  return (
    <ScrollView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={palette.background} />
      <View style={styles.header}>
        <Text style={styles.title}>
          Sheet {String(currentSheetIndex + 1)}/{String(sheets.length)}
        </Text>
        <TouchableOpacity onPress={() => setMode('setDetails')}>
          <Text style={styles.linkText}>← Back</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sheetContainer}>
        {/* Background Image */}
        <View style={styles.imageSection}>
          <Text style={styles.sectionLabel}>Background</Text>
          <Image
            source={{ uri: currentSheet.backgroundUri }}
            style={styles.sheetImage}
            resizeMode="contain"
          />
        </View>

        {/* Overlay Image */}
        <View style={styles.imageSection}>
          <Text style={styles.sectionLabel}>Overlay (Ground Truth)</Text>
          <Image
            source={{ uri: currentSheet.overlayUri }}
            style={styles.sheetImage}
            resizeMode="contain"
          />
        </View>

        {/* Predictions */}
        {currentSheet.predictions && (
          <View style={styles.predictionsSection}>
            <Text style={styles.sectionLabel}>Predictions</Text>

            <View style={styles.predictionCard}>
              <Text style={styles.predictionTitle}>🎵 OCR Model</Text>
              <Text style={styles.predictionText}>
                Class: {String(currentSheet.predictions.ocr.classIndex)}
              </Text>
              <Text style={styles.predictionText}>
                Confidence: {String(currentSheet.predictions.ocr.confidence)}%
              </Text>
            </View>

            <View style={styles.predictionCard}>
              <Text style={styles.predictionTitle}>🎼 Key Signature</Text>
              <Text style={styles.predictionText}>
                Type: {String(currentSheet.predictions.keySignatureC.className)}
              </Text>
              <Text style={styles.predictionText}>
                Confidence: {String(currentSheet.predictions.keySignatureC.confidence)}%
              </Text>
            </View>

            <View style={styles.predictionCard}>
              <Text style={styles.predictionTitle}>🔢 Accidental Count</Text>
              <Text style={styles.predictionText}>
                Count: {String(currentSheet.predictions.keySignatureDigit.count)}
              </Text>
              <Text style={styles.predictionText}>
                Confidence: {String(currentSheet.predictions.keySignatureDigit.confidence)}%
              </Text>
            </View>
          </View>
        )}

        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={palette.ink} />
            <Text style={styles.loadingText}>Processing...</Text>
          </View>
        )}

        {!currentSheet.predictions && !loading && (
          <TouchableOpacity
            style={styles.processButton}
            onPress={processCurrentSheet}
          >
            <Text style={styles.buttonText}>Process This Sheet</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Navigation */}
      <View style={styles.navContainer}>
        <TouchableOpacity
          style={[styles.navButton, currentSheetIndex === 0 && styles.disabledButton]}
          onPress={goToPrevSheet}
          disabled={currentSheetIndex === 0}
        >
          <Text style={styles.navButtonText}>← Previous</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navButton, currentSheetIndex === sheets.length - 1 && styles.disabledButton]}
          onPress={goToNextSheet}
          disabled={currentSheetIndex === sheets.length - 1}
        >
          <Text style={styles.navButtonText}>Next →</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.background,
  },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 20,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 32 : 72,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: palette.background,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: palette.ink,
    letterSpacing: -0.4,
  },
  linkText: {
    fontSize: 14,
    color: palette.inkMuted,
    fontWeight: '600',
  },
  content: {
    padding: 20,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '700',
    color: palette.ink,
    marginBottom: 16,
  },
  setCard: {
    backgroundColor: palette.surface,
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: palette.border,
  },
  setName: {
    fontSize: 16,
    fontWeight: '700',
    color: palette.ink,
    marginBottom: 4,
  },
  setCount: {
    fontSize: 14,
    color: palette.inkMuted,
  },
  infoCard: {
    backgroundColor: palette.surfaceStrong,
    padding: 16,
    borderRadius: 14,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: palette.border,
  },
  infoLabel: {
    fontSize: 14,
    color: palette.inkMuted,
  },
  infoValue: {
    fontSize: 24,
    fontWeight: '800',
    color: palette.ink,
    marginTop: 8,
  },
  statsCard: {
    backgroundColor: palette.surface,
    padding: 16,
    borderRadius: 14,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: palette.border,
  },
  statsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: palette.ink,
    marginBottom: 12,
  },
  statLine: {
    fontSize: 14,
    color: palette.inkMuted,
    marginBottom: 6,
  },
  button: {
    backgroundColor: palette.surface,
    padding: 14,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: palette.border,
    alignItems: 'center',
    marginBottom: 12,
  },
  secondaryButton: {
    backgroundColor: palette.surface,
  },
  buttonText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sheetContainer: {
    padding: 20,
  },
  imageSection: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: palette.ink,
    marginBottom: 8,
  },
  sheetImage: {
    width: '100%',
    height: 300,
    backgroundColor: '#000',
    borderRadius: 12,
  },
  predictionsSection: {
    marginBottom: 24,
  },
  predictionCard: {
    backgroundColor: palette.surface,
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: palette.border,
  },
  predictionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: palette.ink,
    marginBottom: 6,
  },
  predictionText: {
    fontSize: 13,
    color: palette.inkMuted,
    marginBottom: 4,
  },
  processButton: {
    backgroundColor: palette.surface,
    padding: 14,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: palette.border,
    alignItems: 'center',
  },
  loadingContainer: {
    padding: 32,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: palette.inkMuted,
  },
  navContainer: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
  },
  navButton: {
    flex: 1,
    backgroundColor: palette.surface,
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: palette.border,
    alignItems: 'center',
  },
  disabledButton: {
    backgroundColor: palette.surface,
    opacity: 0.5,
  },
  navButtonText: {
    color: palette.ink,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
});
