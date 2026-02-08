import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
} from 'react-native';

export const HomeScreen = ({ onNavigate }) => {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1976D2" />
      
      <View style={styles.header}>
        <Text style={styles.title}>🎵 Music Scanner</Text>
        <Text style={styles.subtitle}>Scan, Play, and Enjoy Sheet Music</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <View style={styles.buttonContainer}>
          {/* Scan from Camera */}
          <TouchableOpacity
            style={[styles.actionButton, styles.primaryButton]}
            onPress={() => onNavigate('camera')}
          >
            <Text style={styles.buttonIcon}>📷</Text>
            <Text style={styles.buttonTitle}>Scan from Camera</Text>
            <Text style={styles.buttonDescription}>
              Take a photo of sheet music
            </Text>
          </TouchableOpacity>

          {/* Upload Image */}
          <TouchableOpacity
            style={[styles.actionButton, styles.secondaryButton]}
            onPress={() => onNavigate('upload-image')}
          >
            <Text style={styles.buttonIcon}>🖼️</Text>
            <Text style={styles.buttonTitle}>Upload Image</Text>
            <Text style={styles.buttonDescription}>
              Select an image from gallery
            </Text>
          </TouchableOpacity>

          {/* Upload PDF/Files */}
          <TouchableOpacity
            style={[styles.actionButton, styles.secondaryButton]}
            onPress={() => onNavigate('upload-file')}
          >
            <Text style={styles.buttonIcon}>📄</Text>
            <Text style={styles.buttonTitle}>Upload Files</Text>
            <Text style={styles.buttonDescription}>
              Import PDF or multiple images
            </Text>
          </TouchableOpacity>

          {/* Recent Scans / Settings */}
          <TouchableOpacity
            style={[styles.actionButton, styles.tertiaryButton]}
            onPress={() => onNavigate('settings')}
          >
            <Text style={styles.buttonIcon}>⚙️</Text>
            <Text style={styles.buttonTitle}>Settings</Text>
            <Text style={styles.buttonDescription}>
              App preferences and help
            </Text>
          </TouchableOpacity>
        </View>

        {/* Developer Tools Section */}
        <View style={styles.devSection}>
          <Text style={styles.devTitle}>Developer Tools</Text>
          <View style={styles.devButtons}>
            <TouchableOpacity
              style={styles.devButton}
              onPress={() => onNavigate('test')}
            >
              <Text style={styles.devButtonText}>Test Models</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devButton}
              onPress={() => onNavigate('validation')}
            >
              <Text style={styles.devButtonText}>Validation</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Info Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Powered by TensorFlow.js & React Native
          </Text>
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
    backgroundColor: '#1976D2',
    paddingTop: 60,
    paddingBottom: 40,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#E3F2FD',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
  },
  buttonContainer: {
    marginBottom: 32,
  },
  actionButton: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: '#2196F3',
  },
  secondaryButton: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#2196F3',
  },
  tertiaryButton: {
    backgroundColor: '#fff',
  },
  buttonIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  buttonTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
    marginBottom: 6,
  },
  buttonDescription: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  devSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  devTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  devButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  devButton: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  devButtonText: {
    fontSize: 13,
    color: '#2196F3',
    fontWeight: '600',
  },
  footer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: '#999',
  },
});
