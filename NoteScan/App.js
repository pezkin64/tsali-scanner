import React, { useEffect, useState } from 'react';
import { StatusBar, View, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-react-native';
import { HomeScreen } from './src/screens/HomeScreen';
import { CameraScreen } from './src/screens/CameraScreen';
import { ModelTestScreen } from './src/screens/ModelTestScreen';
import { ValidationScreen } from './src/screens/ValidationScreen';
import { UploadImageScreen } from './src/screens/UploadImageScreen';
import { MusicScoreScreen } from './src/screens/MusicScoreScreen';
import { PlaybackScreen } from './src/screens/PlaybackScreen';
import { ModelService } from './src/services/ModelService';

export default function App() {
  const [tfReady, setTfReady] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [currentScreen, setCurrentScreen] = useState('home'); // 'home', 'camera', 'upload-image', 'upload-file', 'settings', 'test', 'validation', 'score', 'playback'
  const [scoreImageUri, setScoreImageUri] = useState(null);
  const [scoreData, setScoreData] = useState(null);
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
      <StatusBar barStyle="light-content" backgroundColor="#2196F3" />
      {currentScreen === 'home' ? (
        <HomeScreen onNavigate={setCurrentScreen} />
      ) : currentScreen === 'camera' ? (
        <CameraScreen 
          onNavigateToScore={(uri) => {
            setScoreImageUri(uri);
            setCurrentScreen('score');
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
      ) : currentScreen === 'score' ? (
        <MusicScoreScreen 
          imageUri={scoreImageUri}
          onNavigateBack={() => setCurrentScreen('home')}
          onNavigateToPlayback={(data, imageUri) => {
            console.log('📱 App.js: onNavigateToPlayback called');
            console.log('📱 App.js: Received data:', data?.notes?.length, 'notes');
            console.log('📱 App.js: Received imageUri:', imageUri);
            console.log('📱 App.js: imageUri is truthy:', !!imageUri);
            setScoreData(data);
            setPlaybackImageUri(imageUri);
            setCurrentScreen('playback');
          }}
        />
      ) : currentScreen === 'playback' ? (
        <PlaybackScreen 
          scoreData={scoreData}
          imageUri={playbackImageUri}
          onNavigateBack={() => setCurrentScreen('score')}
        />
      ) : currentScreen === 'upload-image' ? (
        <UploadImageScreen 
          onNavigateBack={() => setCurrentScreen('home')}
          onNavigateToScore={(uri) => {
            setScoreImageUri(uri);
            setCurrentScreen('score');
          }}
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
      ) : null}
    </View>
  );
}
