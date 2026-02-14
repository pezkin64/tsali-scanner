import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  ScrollView,
  Platform,
  StatusBar,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ModelService } from '../services/ModelService';
import { ImageProcessor } from '../utils/ImageProcessor';

const palette = {
  background: '#F9F7F1',
  surface: '#FBFAF5',
  surfaceStrong: '#F1EEE4',
  border: '#D6D0C4',
  ink: '#3E3C37',
  inkMuted: '#6E675E',
};

export const CameraScreen = ({ onNavigateToScore, onNavigateToTest, onNavigateBack }) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [capturedImage, setCapturedImage] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const cameraRef = useRef(null);

  if (!permission) {
    return (
      <View style={styles.centerContainer}>
        <StatusBar barStyle="dark-content" backgroundColor={palette.background} />
        <ActivityIndicator size="large" color={palette.ink} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={palette.background} />
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionText}>
            We need camera permission to scan music sheets
          </Text>
          <TouchableOpacity style={styles.button} onPress={requestPermission}>
            <Text style={styles.buttonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const takePicture = async () => {
    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 1,
          base64: true,
        });
        setCapturedImage(photo);
        await processImage(photo);
      } catch (error) {
        console.error('Error taking picture:', error);
        Alert.alert('Error', 'Failed to capture image: ' + error.message);
      }
    }
  };

  const processImage = async (photo) => {
    setProcessing(true);
    setResults(null);

    try {
      console.log('📸 Processing captured image...');
      const service = ModelService.getInstance();
      
      // Process the image for OCR
      const ocrInput = await ImageProcessor.preprocessForOCR(photo.uri);
      const ocrPredictionsData = await service.predictSymbol(ocrInput);
      const ocrPredictions = Array.from(ocrPredictionsData);
      const ocrMaxValue = Math.max(...ocrPredictions);
      const ocrClassIndex = ocrPredictions.indexOf(ocrMaxValue);
      ocrInput.dispose();

      // Process for key signature C
      const keyCSInput = await ImageProcessor.preprocessForKeySignatureC(photo.uri);
      const keyCSPredictionsData = await service.predictKeySignature(keyCSInput);
      const keyCSPredictions = Array.from(keyCSPredictionsData);
      const keyCSMaxValue = Math.max(...keyCSPredictions);
      const keyCSClassIndex = keyCSPredictions.indexOf(keyCSMaxValue);
      keyCSInput.dispose();

      // Process for key signature digit
      const keyDigitInput = await ImageProcessor.preprocessForKeySignatureDigit(photo.uri);
      const keyDigitPredictionsData = await service.predictDigitCount(keyDigitInput);
      const keyDigitPredictions = Array.from(keyDigitPredictionsData);
      const keyDigitMaxValue = Math.max(...keyDigitPredictions);
      const keyDigitClassIndex = keyDigitPredictions.indexOf(keyDigitMaxValue);
      keyDigitInput.dispose();

      // Validate indices
      if (!Number.isInteger(ocrClassIndex) || !Number.isInteger(keyCSClassIndex) || !Number.isInteger(keyDigitClassIndex)) {
        throw new Error('Invalid prediction indices');
      }

      const predictions = {
        ocr: {
          classIndex: ocrClassIndex,
          confidence: String((ocrMaxValue * 100).toFixed(1)),
          topPredictions: getTopPredictions(ocrPredictions, 3),
        },
        keySignatureC: {
          classIndex: keyCSClassIndex,
          className: ['None', 'Sharps', 'Flats'][keyCSClassIndex] || 'Unknown',
          confidence: String((keyCSMaxValue * 100).toFixed(1)),
        },
        keySignatureDigit: {
          classIndex: keyDigitClassIndex,
          count: keyDigitClassIndex,
          confidence: String((keyDigitMaxValue * 100).toFixed(1)),
        },
      };

      setResults(predictions);
      console.log('✅ Processing complete:', predictions);
    } catch (error) {
      console.error('❌ Error processing image:', error);
      Alert.alert('Error', 'Failed to process image: ' + error.message);
    } finally {
      setProcessing(false);
    }
  };

  const getTopPredictions = (predictions, topN) => {
    const indexed = predictions.map((prob, index) => ({ index, prob }));
    indexed.sort((a, b) => b.prob - a.prob);
    return indexed.slice(0, topN).map(item => ({
      class: Number.isInteger(item.index) ? item.index : 'N/A',
      confidence: item.prob != null ? String((item.prob * 100).toFixed(1)) : 'N/A',
    }));
  };

  const retakePicture = () => {
    setCapturedImage(null);
    setResults(null);
  };

  if (capturedImage) {
    return (
      <ScrollView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={palette.background} />
        <View style={styles.header}>
          <Text style={styles.title}>Scan Results</Text>
        </View>

        <Image source={{ uri: capturedImage.uri }} style={styles.previewImage} />

        {processing ? (
          <View style={styles.processingContainer}>
            <ActivityIndicator size="large" color={palette.ink} />
            <Text style={styles.processingText}>Processing image...</Text>
          </View>
        ) : results ? (
          <View style={styles.resultsContainer}>
            <View style={styles.resultCard}>
              <Text style={styles.resultTitle}>🎵 Symbol Recognition</Text>
              <Text style={styles.resultText}>
                Detected Class: {String(results.ocr.classIndex)}
              </Text>
              <Text style={styles.resultText}>
                Confidence: {String(results.ocr.confidence)}%
              </Text>
              <Text style={styles.resultSubtitle}>Top 3 predictions:</Text>
              {Array.isArray(results.ocr.topPredictions) && results.ocr.topPredictions.map((pred, idx) => (
                <Text key={`pred-${idx}`} style={styles.resultDetail}>
                  #{String(idx + 1)}: Class {String(pred.class ?? 'N/A')} ({String(pred.confidence ?? 'N/A')}%)
                </Text>
              ))}
            </View>

            <View style={styles.resultCard}>
              <Text style={styles.resultTitle}>🎼 Key Signature Type</Text>
              <Text style={styles.resultText}>
                Detected: {String(results.keySignatureC.className)}
              </Text>
              <Text style={styles.resultText}>
                Confidence: {String(results.keySignatureC.confidence)}%
              </Text>
            </View>

            <View style={styles.resultCard}>
              <Text style={styles.resultTitle}>🔢 Number of Accidentals</Text>
              <Text style={styles.resultText}>
                Count: {String(results.keySignatureDigit.count)}
              </Text>
              <Text style={styles.resultText}>
                Confidence: {String(results.keySignatureDigit.confidence)}%
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.button} onPress={retakePicture}>
            <Text style={styles.buttonText}>Retake Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={() => onNavigateToScore(capturedImage.uri)}
          >
            <Text style={styles.buttonText}>Analyze Score</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={onNavigateToTest}
          >
            <Text style={styles.buttonText}>Test Models</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={palette.background} />
      <View style={styles.header}>
        <TouchableOpacity onPress={onNavigateBack}>
          <Text style={styles.linkText}>← Home</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Music Sheet Scanner</Text>
        <TouchableOpacity onPress={onNavigateToTest}>
          <Text style={styles.linkText}>Test →</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.cameraContainer}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="back"
        />
        <View style={styles.cameraOverlay}>
          <View style={styles.targetFrame} />
          <Text style={styles.instructionText}>
            Position music sheet within the frame
          </Text>
        </View>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.captureButton} onPress={takePicture}>
          <View style={styles.captureButtonInner} />
        </TouchableOpacity>
      </View>
    </View>
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
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  permissionText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
    color: palette.inkMuted,
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
  cameraContainer: {
    flex: 1,
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  targetFrame: {
    width: 300,
    height: 200,
    borderWidth: 3,
    borderColor: palette.surfaceStrong,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  instructionText: {
    color: palette.surface,
    fontSize: 14,
    marginTop: 20,
    textAlign: 'center',
    backgroundColor: 'rgba(62, 60, 55, 0.7)',
    padding: 8,
    borderRadius: 4,
  },
  controls: {
    height: 120,
    backgroundColor: palette.surfaceStrong,
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: palette.surface,
    borderWidth: 2,
    borderColor: palette.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: palette.ink,
  },
  previewImage: {
    width: '100%',
    height: 300,
    resizeMode: 'contain',
    backgroundColor: '#000',
  },
  processingContainer: {
    padding: 32,
    alignItems: 'center',
  },
  processingText: {
    marginTop: 16,
    fontSize: 16,
    color: palette.inkMuted,
  },
  resultsContainer: {
    padding: 20,
  },
  resultCard: {
    backgroundColor: palette.surface,
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: palette.border,
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    color: palette.ink,
  },
  resultText: {
    fontSize: 16,
    marginBottom: 4,
    color: palette.inkMuted,
  },
  resultSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
    color: palette.ink,
  },
  resultDetail: {
    fontSize: 14,
    color: palette.inkMuted,
    marginLeft: 16,
  },
  buttonContainer: {
    padding: 20,
    gap: 12,
  },
  button: {
    backgroundColor: palette.surface,
    padding: 14,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: palette.border,
    alignItems: 'center',
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
});
