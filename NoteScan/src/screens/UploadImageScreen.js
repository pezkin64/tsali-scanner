import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ModelService } from '../services/ModelService';
import { ImageProcessor } from '../utils/ImageProcessor';

export const UploadImageScreen = ({ onNavigateBack, onNavigateToScore }) => {
  const [selectedImage, setSelectedImage] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);

  const pickImage = async () => {
    try {
      // Request permission
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (permissionResult.granted === false) {
        Alert.alert('Permission Required', 'Permission to access gallery is required!');
        return;
      }

      // Launch image picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setSelectedImage(asset);
        await processImage(asset);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image: ' + error.message);
    }
  };

  const processImage = async (image) => {
    setProcessing(true);
    setResults(null);

    try {
      console.log('📸 Processing uploaded image...');
      const service = ModelService.getInstance();
      
      // Process the image for OCR
      const ocrInput = await ImageProcessor.preprocessForOCR(image.uri);
      const ocrPredictionsData = await service.predictSymbol(ocrInput);
      const ocrPredictions = Array.from(ocrPredictionsData);
      const ocrMaxValue = Math.max(...ocrPredictions);
      const ocrClassIndex = ocrPredictions.indexOf(ocrMaxValue);
      ocrInput.dispose();

      // Process for key signature C
      const keyCSInput = await ImageProcessor.preprocessForKeySignatureC(image.uri);
      const keyCSPredictionsData = await service.predictKeySignature(keyCSInput);
      const keyCSPredictions = Array.from(keyCSPredictionsData);
      const keyCSMaxValue = Math.max(...keyCSPredictions);
      const keyCSClassIndex = keyCSPredictions.indexOf(keyCSMaxValue);
      keyCSInput.dispose();

      // Process for key signature digit
      const keyDigitInput = await ImageProcessor.preprocessForKeySignatureDigit(image.uri);
      const keyDigitPredictionsData = await service.predictDigitCount(keyDigitInput);
      const keyDigitPredictions = Array.from(keyDigitPredictionsData);
      const keyDigitMaxValue = Math.max(...keyDigitPredictions);
      const keyDigitClassIndex = keyDigitPredictions.indexOf(keyDigitMaxValue);
      keyDigitInput.dispose();

      const predictions = {
        ocr: {
          classIndex: ocrClassIndex,
          confidence: String((ocrMaxValue * 100).toFixed(1)),
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onNavigateBack}>
          <Text style={styles.linkText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Upload Image</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.content}>
        {!selectedImage ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🖼️</Text>
            <Text style={styles.emptyTitle}>No Image Selected</Text>
            <Text style={styles.emptyDescription}>
              Select a music sheet image from your gallery
            </Text>
            <TouchableOpacity style={styles.pickButton} onPress={pickImage}>
              <Text style={styles.pickButtonText}>Choose Image</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.resultContainer}>
            <Image source={{ uri: selectedImage.uri }} style={styles.previewImage} />

            {processing ? (
              <View style={styles.processingContainer}>
                <ActivityIndicator size="large" color="#2196F3" />
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

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
              <TouchableOpacity style={styles.pickButton} onPress={pickImage}>
                <Text style={styles.pickButtonText}>Choose Another</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.pickButton, { backgroundColor: '#4CAF50' }]} 
                onPress={() => onNavigateToScore(selectedImage.uri)}
              >
                <Text style={styles.pickButtonText}>Analyze Score</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
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
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 400,
  },
  emptyIcon: {
    fontSize: 80,
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  emptyDescription: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
  },
  pickButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 8,
    marginTop: 20,
  },
  pickButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  resultContainer: {
    padding: 16,
  },
  previewImage: {
    width: '100%',
    height: 300,
    resizeMode: 'contain',
    backgroundColor: '#000',
    borderRadius: 8,
    marginBottom: 20,
  },
  processingContainer: {
    padding: 32,
    alignItems: 'center',
  },
  processingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  resultsContainer: {
    marginBottom: 20,
  },
  resultCard: {
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
  resultTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2196F3',
    marginBottom: 8,
  },
  resultText: {
    fontSize: 14,
    color: '#555',
    marginBottom: 4,
  },
});
