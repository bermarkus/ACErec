/**
 * BrainflowDataHandler - Module for interfacing between Brainflow and BDFWriter
 * Handles data acquisition, buffering, and saving to BDF format
 */

const brainflow = require('brainflow');
const path = require('path');
const fs = require('fs');
const BDFWriter = require('./BDFWriter');
const log = require('electron-log');

class BrainflowDataHandler {
  constructor() {
    // Brainflow configuration
    this.boardShim = null;
    this.samplingRate = 250; // Default sampling rate (Hz)
    this.channels = []; // Channel configuration
    
    // Data buffer for recording
    this.dataBuffer = [];
    this.isRecording = false;
    this.recordingStartTime = null;
    
    // Recording configuration
    this.subjectId = 'Unknown';
    this.recordingId = 'Recording';
    this.saveLocation = '';
    
    // BDF Writer instance
    this.bdfWriter = null;
    
    log.info('BrainflowDataHandler initialized');
  }
  
  /**
   * Connect to a Brainflow-supported device
   * @param {Object} config - Configuration for the board connection
   * @returns {Object} - Connection result
   */
  async connect(config) {
    try {
      log.info('Connecting to Brainflow device:', config);
      
      // Set up parameters based on device type
      const params = new brainflow.BrainFlowInputParams();
      
      // For FreeEEG32, use synthetic board for now but could be changed to actual board type
      // This is a placeholder - in a real implementation, you would use the appropriate board ID
      const boardId = brainflow.BoardIds.SYNTHETIC_BOARD; // Replace with actual FreeEEG32 board ID when available
      
      // If serial port is provided, configure it
      if (config.serialPort) {
        params.serial_port = config.serialPort;
      }
      
      // Create board shim instance
      this.boardShim = new brainflow.BoardShim(boardId, params);
      
      // Initialize the board
      await this.boardShim.prepare_session();
      
      // Get board information
      this.samplingRate = this.boardShim.get_sampling_rate(boardId);
      const eegChannels = this.boardShim.get_eeg_channels(boardId);
      
      // Set up channel information
      this.channels = eegChannels.map((channelNum, index) => {
        return {
          label: `EEG ${index + 1}`,
          physicalMin: -150,  // -150 μV
          physicalMax: 150,   // 150 μV
          digitalMin: -8388608,
          digitalMax: 8388607,
          prefiltering: 'HP:0.1Hz LP:100Hz',
          transducerType: 'AgAgCl electrode',
          unit: 'uV'
        };
      });
      
      // Start streaming data
      this.boardShim.start_stream();
      
      log.info(`Connected to device. Sampling rate: ${this.samplingRate}Hz, Channels: ${this.channels.length}`);
      
      return {
        success: true,
        message: 'Connected successfully',
        config: {
          samplingRate: this.samplingRate,
          channels: this.channels.length
        }
      };
    } catch (error) {
      log.error('Error connecting to device:', error);
      return { success: false, message: error.message };
    }
  }
  
  /**
   * Disconnect from the current device
   * @returns {Object} - Disconnection result
   */
  async disconnect() {
    try {
      if (!this.boardShim) {
        return { success: true, message: 'No device connected' };
      }
      
      // Stop recording if in progress
      if (this.isRecording) {
        await this.stopRecording();
      }
      
      // Stop streaming and release session
      this.boardShim.stop_stream();
      this.boardShim.release_session();
      this.boardShim = null;
      
      log.info('Disconnected from device');
      
      return { success: true, message: 'Disconnected successfully' };
    } catch (error) {
      log.error('Error disconnecting from device:', error);
      return { success: false, message: error.message };
    }
  }
  
  /**
   * Start recording data to buffer
   * @param {Object} config - Recording configuration
   * @returns {Object} - Result of starting recording
   */
  async startRecording(config) {
    try {
      if (!this.boardShim) {
        return { success: false, message: 'No device connected' };
      }
      
      if (this.isRecording) {
        return { success: false, message: 'Recording already in progress' };
      }
      
      // Configure recording
      this.subjectId = config.subjectId || 'Unknown';
      this.recordingId = config.recordingId || `Recording_${new Date().toISOString().replace(/[:.]/g, '-')}`;
      this.saveLocation = config.saveLocation || path.join(process.cwd(), 'recordings');
      
      // Ensure save directory exists
      if (!fs.existsSync(this.saveLocation)) {
        fs.mkdirSync(this.saveLocation, { recursive: true });
      }
      
      // Initialize data buffer
      this.dataBuffer = [];
      this.isRecording = true;
      this.recordingStartTime = new Date();
      
      log.info(`Started recording: ${this.recordingId} for subject ${this.subjectId}`);
      
      return { 
        success: true, 
        message: 'Recording started',
        startTime: this.recordingStartTime
      };
    } catch (error) {
      log.error('Error starting recording:', error);
      return { success: false, message: error.message };
    }
  }
  
  /**
   * Stop recording and save data to BDF file
   * @param {Object} options - Options for saving the recording
   * @returns {Object} - Result of stopping recording
   */
  async stopRecording(options = {}) {
    try {
      if (!this.isRecording) {
        return { success: false, message: 'No recording in progress' };
      }
      
      // Get all data since starting recording
      const data = this.boardShim.get_board_data();
      
      // Extract EEG channels
      const eegChannels = this.boardShim.get_eeg_channels(this.boardShim.get_board_id());
      const eegData = eegChannels.map(channel => data[channel]);
      
      // Create BDF file
      const fileName = `${this.subjectId}_${this.recordingId}_${this.recordingStartTime.toISOString().replace(/[:.]/g, '-')}.bdf`;
      const filePath = path.join(this.saveLocation, fileName);
      
      // Create BDF writer
      this.bdfWriter = new BDFWriter({
        channels: this.channels,
        samplingRate: this.samplingRate,
        subjectId: this.subjectId,
        recordingId: this.recordingId,
        startDate: this.recordingStartTime
      });
      
      // Write data to BDF file
      this.bdfWriter.open(filePath);
      this.bdfWriter.writeSamples(eegData);
      this.bdfWriter.close();
      
      // Reset recording state
      this.isRecording = false;
      this.dataBuffer = [];
      
      log.info(`Recording stopped and saved to: ${filePath}`);
      
      return { 
        success: true, 
        message: 'Recording saved successfully',
        filePath: filePath
      };
    } catch (error) {
      log.error('Error stopping recording:', error);
      this.isRecording = false;  // Make sure to reset recording state even on error
      return { success: false, message: error.message };
    }
  }
  
  /**
   * Get the latest data for visualization
   * @param {number} sampleCount - Number of samples to retrieve
   * @returns {Array} - Latest EEG data
   */
  getLatestData(sampleCount = 250) {
    try {
      if (!this.boardShim) {
        return { success: false, message: 'No device connected', data: null };
      }
      
      // Get the latest data from Brainflow
      const data = this.boardShim.get_current_board_data(sampleCount);
      
      // Extract EEG channels
      const eegChannels = this.boardShim.get_eeg_channels(this.boardShim.get_board_id());
      const eegData = eegChannels.map(channel => data[channel]);
      
      return { 
        success: true, 
        data: eegData,
        timestamp: new Date()
      };
    } catch (error) {
      log.error('Error getting latest data:', error);
      return { success: false, message: error.message, data: null };
    }
  }
  
  /**
   * Get a list of available devices
   * @returns {Array} - List of available devices
   */
  static async getAvailableDevices() {
    try {
      // This is a placeholder implementation
      // Brainflow doesn't have a direct method to enumerate all connected devices
      // In a real implementation, you might need to scan serial ports or use device-specific detection
      
      // For now, return a hardcoded list of potential FreeEEG32 devices
      // This would be replaced with actual device detection logic
      return [
        { 
          id: 'freeeeg32',
          name: 'FreeEEG32',
          status: 'available',
          boardId: brainflow.BoardIds.SYNTHETIC_BOARD, // Replace with actual board ID
          serialPort: 'COM1' // This would be detected in a real implementation
        }
      ];
    } catch (error) {
      log.error('Error getting available devices:', error);
      return [];
    }
  }
}

module.exports = BrainflowDataHandler;
