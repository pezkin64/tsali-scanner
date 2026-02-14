import React, { useEffect, useState } from 'react';
import { StatusBar, View, Text, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-react-native';
import { HomeScreen } from './src/screens/HomeScreen';
import { CameraScreen } from './src/screens/CameraScreen';
import { ModelTestScreen } from './src/screens/ModelTestScreen';
import { ValidationScreen } from './src/screens/ValidationScreen';
import { PlaybackScreen } from './src/screens/PlaybackScreen';
import { ModelService } from './src/services/ModelService';

export default function App() {
  const [tfReady, setTfReady] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [currentScreen, setCurrentScreen] = useState('home'); // 'home', 'camera', 'upload-file', 'settings', 'help', 'library', 'test', 'validation', 'playback'
  const [playbackImageUri, setPlaybackImageUri] = useState(null);

  useEffect(() => {
    const initApp = async () => {
      try {
        console.log('🚀 Initializing TensorFlow.js...');
        await tf.setBackend('cpu');
        await tf.ready();
        console.log('✅ TensorFlow.js is ready');
        setTfReady(true);

        // Initialize models
        console.log('🔄 Loading ML models...');
        const service = ModelService.getInstance();
        await service.initialize();
        console.log('✅ Models loaded successfully');
        setModelsLoaded(true);
      } catch (err) {
        console.error('❌ Error initializing app:', err.message);
        setError(err.message);
        setTfReady(true); // Still show the screen even if initialization fails
      }
    };

    initApp();

    return () => {
      // Cleanup
    };
  }, []);

  const pickImageFromGallery = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permissionResult.granted) {
        Alert.alert('Permission Required', 'Permission to access gallery is required!');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      setPlaybackImageUri(asset.uri);
      setCurrentScreen('playback');
    } catch (err) {
      console.error('Error picking image:', err?.message || err);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const pickImageFromCamera = async () => {
    try {
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync();

      if (!permissionResult.granted) {
        Alert.alert('Permission Required', 'Permission to access camera is required!');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      setPlaybackImageUri(asset.uri);
      setCurrentScreen('playback');
    } catch (err) {
      console.error('Error capturing image:', err?.message || err);
      Alert.alert('Error', 'Failed to capture image. Please try again.');
    }
  };

  if (!tfReady || !modelsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' }}>
        <ActivityIndicator size="large" color="#2196F3" />
        <Text style={{ fontSize: 16, color: '#333', marginTop: 16 }}>
          {!tfReady ? 'Initializing TensorFlow...' : 'Loading models...'}
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#ffebee', padding: 20 }}>
        <Text style={{ fontSize: 14, color: '#c62828', textAlign: 'center' }}>
          TensorFlow initialization error: {error}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <StatusBar barStyle="dark-content" backgroundColor="#F9F7F1" />
      {currentScreen === 'home' ? (
        <HomeScreen
          onNavigate={setCurrentScreen}
          onPickFromGallery={pickImageFromGallery}
          onPickFromCamera={pickImageFromCamera}
        />
      ) : currentScreen === 'camera' ? (
        <CameraScreen 
          onNavigateToScore={(uri) => {
            setPlaybackImageUri(uri);
            setCurrentScreen('playback');
          }}
          onNavigateToTest={() => setCurrentScreen('test')}
          onNavigateBack={() => setCurrentScreen('home')}
        />
      ) : currentScreen === 'test' ? (
        <ModelTestScreen
          onNavigateToCamera={() => setCurrentScreen('camera')}
          onNavigateToValidation={() => setCurrentScreen('validation')}
          onNavigateBack={() => setCurrentScreen('home')}
        />
      ) : currentScreen === 'validation' ? (
        <ValidationScreen onNavigateBack={() => setCurrentScreen('test')} />
      ) : currentScreen === 'playback' ? (
        <PlaybackScreen 
          imageUri={playbackImageUri}
          onNavigateBack={() => setCurrentScreen('home')}
        />
      ) : currentScreen === 'upload-file' ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' }}>
          <Text style={{ fontSize: 18, color: '#333', marginBottom: 20 }}>📄 Upload Files</Text>
          <Text style={{ fontSize: 14, color: '#666', marginBottom: 20 }}>Coming soon...</Text>
          <Text 
            style={{ color: '#2196F3', fontSize: 16 }} 
            onPress={() => setCurrentScreen('home')}
          >
            ← Back to Home
          </Text>
        </View>
      ) : currentScreen === 'settings' ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' }}>
          <Text style={{ fontSize: 18, color: '#333', marginBottom: 20 }}>⚙️ Settings</Text>
          <Text style={{ fontSize: 14, color: '#666', marginBottom: 20 }}>Coming soon...</Text>
          <TouchableOpacity onPress={() => setCurrentScreen('home')}>
            <Text style={{ color: '#2196F3', fontSize: 16 }}>← Back to Home</Text>
          </TouchableOpacity>
        </View>
      ) : currentScreen === 'help' ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' }}>
          <Text style={{ fontSize: 18, color: '#333', marginBottom: 20 }}>❓ Help</Text>
          <Text style={{ fontSize: 14, color: '#666', marginBottom: 20 }}>Coming soon...</Text>
          <TouchableOpacity onPress={() => setCurrentScreen('home')}>
            <Text style={{ color: '#2196F3', fontSize: 16 }}>← Back to Home</Text>
          </TouchableOpacity>
        </View>
      ) : currentScreen === 'library' ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' }}>
          <Text style={{ fontSize: 18, color: '#333', marginBottom: 20 }}>🎼 Scanned Music</Text>
          <Text style={{ fontSize: 14, color: '#666', marginBottom: 20 }}>Coming soon...</Text>
          <TouchableOpacity onPress={() => setCurrentScreen('home')}>
            <Text style={{ color: '#2196F3', fontSize: 16 }}>← Back to Home</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}
