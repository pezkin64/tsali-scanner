import * as tf from '@tensorflow/tfjs';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { decodeJpeg } from '@tensorflow/tfjs-react-native';
export class ImageProcessor {
  /**
   * Preprocess image for OCR model (24x24 grayscale)
   */
  static async preprocessForOCR(imageUri) {
    try {
      // Resize to 24x24
      const resized = await manipulateAsync(
        imageUri,
        [{ resize: { width: 24, height: 24 } }],
        { compress: 1, format: SaveFormat.JPEG }
      );

      // Load image and convert to tensor
      const imageData = await this._loadImageAsTensor(resized.uri, 24, 24);
      
      // Convert to grayscale and normalize
      const grayscale = tf.image.rgbToGrayscale(imageData);
      const normalized = grayscale.div(255.0);
      
      // Reshape to [1, 24, 24, 1] for model input
      const reshaped = normalized.expandDims(0);
      
      // Clean up intermediate tensors
      imageData.dispose();
      grayscale.dispose();
      normalized.dispose();
      
      return reshaped;
    } catch (error) {
      console.error('Error preprocessing for OCR:', error);
      throw error;
    }
  }

  /**
   * Preprocess image for Key Signature C model (30x15 grayscale)
   */
  static async preprocessForKeySignatureC(imageUri) {
    try {
      // Resize to 30x15
      const resized = await manipulateAsync(
        imageUri,
        [{ resize: { width: 15, height: 30 } }],
        { compress: 1, format: SaveFormat.JPEG }
      );

      // Load image and convert to tensor
      const imageData = await this._loadImageAsTensor(resized.uri, 15, 30);
      
      // Convert to grayscale and normalize
      const grayscale = tf.image.rgbToGrayscale(imageData);
      const normalized = grayscale.div(255.0);
      
      // Reshape to [1, 30, 15, 1] for model input
      const reshaped = normalized.expandDims(0);
      
      // Clean up intermediate tensors
      imageData.dispose();
      grayscale.dispose();
      normalized.dispose();
      
      return reshaped;
    } catch (error) {
      console.error('Error preprocessing for Key Signature C:', error);
      throw error;
    }
  }

  /**
   * Preprocess image for Key Signature Digit model (30x27 grayscale)
   */
  static async preprocessForKeySignatureDigit(imageUri) {
    try {
      // Resize to 30x27
      const resized = await manipulateAsync(
        imageUri,
        [{ resize: { width: 27, height: 30 } }],
        { compress: 1, format: SaveFormat.JPEG }
      );

      // Load image and convert to tensor
      const imageData = await this._loadImageAsTensor(resized.uri, 27, 30);
      
      // Convert to grayscale and normalize
      const grayscale = tf.image.rgbToGrayscale(imageData);
      const normalized = grayscale.div(255.0);
      
      // Reshape to [1, 30, 27, 1] for model input
      const reshaped = normalized.expandDims(0);
      
      // Clean up intermediate tensors
      imageData.dispose();
      grayscale.dispose();
      normalized.dispose();
      
      return reshaped;
    } catch (error) {
      console.error('Error preprocessing for Key Signature Digit:', error);
      throw error;
    }
  }

  /**
   * Load an image from URI and convert to tensor
   */
  static async _loadImageAsTensor(uri, width, height) {
    try {
      // Read the JPEG file as raw bytes
      const response = await fetch(uri);
      const blob = await response.blob();
      const arrayBuffer = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsArrayBuffer(blob);
      });
      
      // Convert to Uint8Array
      const imageData = new Uint8Array(arrayBuffer);
      
      // Decode JPEG to tensor using tfjs-react-native
      const imageTensor = decodeJpeg(imageData);
      
      return imageTensor;
    } catch (error) {
      console.error('Error loading image as tensor:', error);
      throw error;
    }
  }

  /**
   * Apply threshold to create binary image
   */
  static applyThreshold(tensor, threshold = 0.5) {
    return tf.tidy(() => {
      return tf.cast(tf.greater(tensor, threshold), 'float32');
    });
  }

  /**
   * Enhance contrast of grayscale image
   */
  static enhanceContrast(tensor, factor = 1.5) {
    return tf.tidy(() => {
      const mean = tensor.mean();
      const centered = tensor.sub(mean);
      const enhanced = centered.mul(factor).add(mean);
      return tf.clipByValue(enhanced, 0, 1);
    });
  }

  /**
   * Auto-adjust image brightness and contrast
   */
  static autoAdjust(tensor) {
    return tf.tidy(() => {
      const min = tensor.min();
      const max = tensor.max();
      const range = max.sub(min);
      
      // Normalize to [0, 1] range
      return tensor.sub(min).div(range);
    });
  }
}
