import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Dimensions,
  Image,
} from 'react-native';

/**
 * Real-time visualization component for music playback
 * Shows sheet image with playback cursor bar
 */
export const PlaybackVisualization = ({
  scoreData,
  imageUri,
  isPlaying,
  currentTime,
  totalDuration,
  selectedVoices,
  tempo,
  audioSequence,
}) => {
  const [animatedValue] = useState(new Animated.Value(0));
  const scrollViewRef = useRef(null);
  const [imageWidth, setImageWidth] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const screenWidth = Dimensions.get('window').width;

  console.log('PlaybackVisualization received imageUri:', imageUri);
  console.log('Image URI type:', typeof imageUri);
  console.log('Image URI is truthy:', !!imageUri);
  console.log('Image URI length:', imageUri?.length);

  // Calculate progress and snapping
  const progressRatio = totalDuration > 0 ? currentTime / totalDuration : 0;
  const progressPercent = progressRatio * 100;

  const snappedTime = (() => {
    if (!audioSequence || !audioSequence.segments || audioSequence.segments.length === 0) {
      return currentTime;
    }
    let snapped = 0;
    for (const segment of audioSequence.segments) {
      if (currentTime < segment.time) break;
      snapped = segment.time;
    }
    return snapped;
  })();
  const snappedRatio = totalDuration > 0 ? snappedTime / totalDuration : 0;

  // Playback cursor position on image
  const cursorX = imageWidth > 0 ? imageWidth * snappedRatio : 0;

  // Auto-scroll to keep cursor visible
  useEffect(() => {
    if (!isPlaying || !scrollViewRef.current || imageWidth <= 0 || viewportWidth <= 0) {
      return;
    }

    const targetX = Math.max(
      0,
      Math.min(
        imageWidth - viewportWidth,
        cursorX - viewportWidth * 0.3
      )
    );
    scrollViewRef.current.scrollTo({ x: targetX, animated: true });
  }, [isPlaying, cursorX, imageWidth, viewportWidth]);

  // Tempo indicator animation
  useEffect(() => {
    if (isPlaying) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(animatedValue, {
            toValue: 1,
            duration: (60 / tempo) * 1000,
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
          {String(Math.floor(currentTime))}s / {String(Math.floor(totalDuration))}s
        </Text>
      </View>

      {/* Notes Visualization Grid */}
      <View style={styles.sheetContainer}>
        <Text style={styles.vizTitle}>🎵 Sheet Music</Text>
        
        {imageUri && imageUri.trim() !== '' ? (
          <ScrollView
            ref={scrollViewRef}
            horizontal
            showsHorizontalScrollIndicator={true}
            scrollEventThrottle={16}
            onLayout={(event) => {
              setViewportWidth(event.nativeEvent.layout.width);
            }}
          >
            <View style={styles.imageWrapper}>
              <Image
                source={{ uri: imageUri }}
                style={styles.sheetImage}
                onLoad={(event) => {
                  console.log('Image loaded successfully');
                  const { width, height } = event.nativeEvent.source;
                  console.log('Image dimensions:', width, 'x', height);
                  setImageWidth(width);
                }}
                onError={(error) => {
                  console.error('Image failed to load:', error);
                }}
                resizeMode="contain"
              />
              <View
                style={[
                  styles.playbackCursor,
                  { left: cursorX },
                ]}
              />
            </View>
          </ScrollView>
        ) : (
          <View style={styles.noImageContainer}>
            <Text style={styles.noImageText}>⚠️ No sheet image available</Text>
            <Text style={styles.debugText}>imageUri: {imageUri ? 'present' : 'undefined'}</Text>
            <Text style={styles.debugText}>imageUri type: {typeof imageUri}</Text>
            {imageUri && <Text style={styles.debugText} numberOfLines={3}>Value: {imageUri.substring(0, 100)}...</Text>}
          </View>
        )}
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
          <Text style={styles.statLabel}>Progress</Text>
          <Text style={styles.statValue}>
            {String(Math.round(progressPercent))}%
          </Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Time</Text>
          <Text style={styles.statValue}>
            {String(Math.floor(currentTime))}s / {String(Math.floor(totalDuration))}s
          </Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Notes</Text>
          <Text style={styles.statValue}>
            {String(scoreData.notes.length)}
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
  sheetContainer: {
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
  imageWrapper: {
    position: 'relative',
  },
  sheetImage: {
    width: '100%',
    height: 400,
  },
  playbackCursor: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: '#7B4DFF',
    borderRadius: 2,
    opacity: 0.9,
    zIndex: 10,
  },
  playbackBar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: '#7B4DFF',
    borderRadius: 2,
    opacity: 0.85,
    zIndex: 2,
  },
  noImageContainer: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  noImageText: {
    fontSize: 14,
    color: '#999',
  },
  debugText: {
    fontSize: 11,
    color: '#666',
    marginTop: 4,
    fontFamily: 'monospace',
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
