import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import * as tf from '@tensorflow/tfjs';
import { ModelService } from '../services/ModelService';

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
        <ActivityIndicator size="large" color="#2196F3" />
        <Text style={styles.loadingText}>Initializing Models...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
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
    backgroundColor: '#f5f5f5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  header: {
    backgroundColor: '#2196F3',
    padding: 20,
    paddingTop: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  linkText: {
    fontSize: 14,
    color: '#fff',
    textDecorationLine: 'underline',
  },
  errorContainer: {
    margin: 16,
    padding: 16,
    backgroundColor: '#ffebee',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#f44336',
  },
  errorText: {
    color: '#c62828',
    fontSize: 16,
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: '#f44336',
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  successContainer: {
    margin: 16,
    padding: 16,
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#4caf50',
  },
  successText: {
    color: '#2e7d32',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  section: {
    margin: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  modelCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  modelName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2196F3',
    marginBottom: 6,
  },
  label: {
    fontSize: 13,
    color: '#666',
    fontStyle: 'italic',
    marginBottom: 8,
  },
  detail: {
    fontSize: 13,
    color: '#555',
    marginVertical: 4,
    fontFamily: 'monospace',
  },
  testButton: {
    backgroundColor: '#4caf50',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  validationButton: {
    backgroundColor: '#ff9800',
  },
  testButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  resultContainer: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#e3f2fd',
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#2196F3',
  },
  resultText: {
    color: '#1565c0',
    fontSize: 14,
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
});
