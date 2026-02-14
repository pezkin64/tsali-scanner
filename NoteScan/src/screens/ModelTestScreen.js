import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  StatusBar,
} from 'react-native';
import * as tf from '@tensorflow/tfjs';
import { ModelService } from '../services/ModelService';

const palette = {
  background: '#F9F7F1',
  surface: '#FBFAF5',
  surfaceStrong: '#F1EEE4',
  border: '#D6D0C4',
  ink: '#3E3C37',
  inkMuted: '#6E675E',
  success: '#2E6F4E',
  error: '#8C3A3A',
};

export const ModelTestScreen = ({ onNavigateToCamera, onNavigateToValidation, onNavigateBack }) => {
  const [loading, setLoading] = useState(true);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelDetails, setModelDetails] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('🔄 Starting model initialization...');
      const service = ModelService.getInstance();
      const loaded = await service.initialize();
      
      if (loaded) {
        console.log('✅ All models loaded successfully!');
        setModelsLoaded(true);
        
        // Get model shapes
        const details = {
          ocrModel: {
            input: service.ocrModel?.inputs?.[0]?.shape || 'Unknown',
            output: service.ocrModel?.outputs?.[0]?.shape || '71 classes',
          },
          keySignaturesC: {
            input: service.keySignaturesCModel?.inputs?.[0]?.shape || 'Unknown',
            output: service.keySignaturesCModel?.outputs?.[0]?.shape || '3 classes',
          },
          keySignaturesDigit: {
            input: service.keySignaturesDigitModel?.inputs?.[0]?.shape || 'Unknown',
            output: service.keySignaturesDigitModel?.outputs?.[0]?.shape || '11 classes',
          },
        };
        setModelDetails(details);
      }
    } catch (err) {
      console.error('❌ Error loading models:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTestModels = async () => {
    try {
      setTestResult('Testing models...');
      const service = ModelService.getInstance();
      
      const testOCRInput = tf.randomUniform([1, 24, 24, 1]);
      const ocrResult = await service.predictSymbol(testOCRInput);
      console.log('✅ OCR prediction:', ocrResult);
      
      // Test Key Signature C model (30x15)
      const testKeyCSInput = tf.randomUniform([1, 30, 15, 1]);
      const keyCSResult = await service.predictKeySignature(testKeyCSInput);
      console.log('✅ Key Signature C prediction:', keyCSResult);
      
      // Test Key Signature Digit model (30x27)
      const testKeyDigitInput = tf.randomUniform([1, 30, 27, 1]);
      const keyDigitResult = await service.predictDigitCount(testKeyDigitInput);
      console.log('✅ Key Signature Digit prediction:', keyDigitResult);

      testOCRInput.dispose();
      testKeyCSInput.dispose();
      testKeyDigitInput.dispose();
      
      setTestResult('✅ All models tested successfully!');
      Alert.alert('Success', 'Models are working correctly!');
    } catch (err) {
      console.error('❌ Error testing models:', err);
      setTestResult('❌ Test failed: ' + err.message);
      Alert.alert('Error', 'Failed to test models: ' + err.message);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <StatusBar barStyle="dark-content" backgroundColor={palette.background} />
        <ActivityIndicator size="large" color={palette.ink} />
        <Text style={styles.loadingText}>Initializing Models...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={palette.background} />
      <View style={styles.header}>
        <TouchableOpacity onPress={onNavigateBack}>
          <Text style={styles.linkText}>← Home</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Model Status</Text>
        {onNavigateToCamera && (
          <TouchableOpacity onPress={onNavigateToCamera}>
            <Text style={styles.linkText}>Camera →</Text>
          </TouchableOpacity>
        )}
      </View>

      {error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>❌ Error: {error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadModels}>
            <Text style={styles.retryButtonText}>Retry Loading</Text>
          </TouchableOpacity>
        </View>
      ) : modelsLoaded ? (
        <View>
          <View style={styles.successContainer}>
            <Text style={styles.successText}>✅ Models Loaded Successfully!</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Model Details</Text>

            <View style={styles.modelCard}>
              <Text style={styles.modelName}>OCR Model</Text>
              <Text style={styles.label}>Purpose: Musical symbol recognition</Text>
              <Text style={styles.detail}>Input Shape: {JSON.stringify(modelDetails?.ocrModel?.input)}</Text>
              <Text style={styles.detail}>Output: 71 symbol classes</Text>
            </View>

            <View style={styles.modelCard}>
              <Text style={styles.modelName}>Key Signature C Model</Text>
              <Text style={styles.label}>Purpose: Detect sharps/flats/naturals</Text>
              <Text style={styles.detail}>Input Shape: {JSON.stringify(modelDetails?.keySignaturesC?.input)}</Text>
              <Text style={styles.detail}>Output: 3 classes (none, sharps, flats)</Text>
            </View>

            <View style={styles.modelCard}>
              <Text style={styles.modelName}>Key Signature Digit Model</Text>
              <Text style={styles.label}>Purpose: Count sharp/flat symbols</Text>
              <Text style={styles.detail}>Input Shape: {JSON.stringify(modelDetails?.keySignaturesDigit?.input)}</Text>
              <Text style={styles.detail}>Output: 11 classes (0-10 symbols)</Text>
            </View>
          </View>

          <View style={styles.section}>
            <TouchableOpacity style={styles.testButton} onPress={handleTestModels}>
              <Text style={styles.testButtonText}>Test Models with Random Data</Text>
            </TouchableOpacity>

            {onNavigateToValidation && (
              <TouchableOpacity
                style={[styles.testButton, styles.validationButton]}
                onPress={onNavigateToValidation}
              >
                <Text style={styles.testButtonText}>Validate on Test Set</Text>
              </TouchableOpacity>
            )}

            {testResult && (
              <View style={styles.resultContainer}>
                <Text style={styles.resultText}>{testResult}</Text>
              </View>
            )}
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Ready to scan music sheets! 🎵</Text>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.background,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: palette.background,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: palette.inkMuted,
    fontWeight: '500',
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
    fontSize: 30,
    fontWeight: '800',
    color: palette.ink,
    letterSpacing: -0.4,
  },
  linkText: {
    fontSize: 14,
    color: palette.inkMuted,
    fontWeight: '600',
  },
  errorContainer: {
    margin: 16,
    padding: 16,
    backgroundColor: '#F3E6E3',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: palette.border,
  },
  errorText: {
    color: palette.error,
    fontSize: 16,
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: palette.surface,
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: palette.border,
    alignItems: 'center',
  },
  retryButtonText: {
    color: palette.ink,
    fontWeight: '700',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  successContainer: {
    margin: 16,
    padding: 16,
    backgroundColor: '#E7EFE8',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: palette.border,
  },
  successText: {
    color: palette.success,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  section: {
    margin: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: palette.ink,
    marginBottom: 12,
  },
  modelCard: {
    backgroundColor: palette.surface,
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: palette.border,
  },
  modelName: {
    fontSize: 16,
    fontWeight: '700',
    color: palette.ink,
    marginBottom: 6,
  },
  label: {
    fontSize: 13,
    color: palette.inkMuted,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  detail: {
    fontSize: 13,
    color: palette.inkMuted,
    marginVertical: 4,
    fontFamily: 'monospace',
  },
  testButton: {
    backgroundColor: palette.surface,
    padding: 14,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: palette.border,
    alignItems: 'center',
    marginTop: 8,
  },
  validationButton: {
    backgroundColor: palette.surface,
  },
  testButtonText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  resultContainer: {
    marginTop: 12,
    padding: 12,
    backgroundColor: palette.surfaceStrong,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: palette.border,
  },
  resultText: {
    color: palette.ink,
    fontSize: 14,
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 16,
    color: palette.inkMuted,
    fontWeight: '500',
  },
});
