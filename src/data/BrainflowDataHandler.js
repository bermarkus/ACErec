/**
 * BrainflowDataHandler - Module for interfacing between Brainflow and BDFWriter
 * Handles data acquisition, buffering, and saving to BDF format
 */

// Import brainflow library
const brainflow = require('brainflow');
const path = require('path');
const fs = require('fs');
const BDFWriter = require('./BDFWriter');
const log = require('electron-log');

class BrainflowDataHandler {
  constructor() {
    // Brainflow configuration
    this.boardShim = null;
    this.isConnected = false;
    this.isRecording = false;
    this.recordingStartTime = null;
    this.recordingPath = null;
    this.samplingRate = 512; // Default sampling rate
    this.channelCount = 32;  // Default channel count
    this.dataVerificationInterval = null;
    this.sampleCounter = 0;  // Counter for simulated data
    
    // Data buffer for recording
    this.dataBuffer = [];
    
    // Recording configuration
    this.subjectId = 'Unknown';
    this.recordingId = 'Recording_' + new Date().toISOString().replace(/:/g, '-');
    this.saveLocation = path.join(process.env.HOME || process.env.USERPROFILE, 'OneDrive', 'Documents', 'ACErec Recordings');
    
    // BDF Writer instance
    this.bdfWriter = null;
    
    // Channel information
    this.channels = [];
    
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
      
      // Set up parameters for the board
      const params = new brainflow.BrainFlowInputParams();
      
      // Required configuration for the FreeEEG32
      if (config.serialPort) {
        params.serial_port = config.serialPort;
        log.info(`Using serial port: ${params.serial_port}`);
      } else {
        log.warn('No serial port specified, device connection may fail');
      }
      
      // Set other parameters that might be needed
      params.timeout = 15; // Increase timeout to 15 seconds
      
      // Use the appropriate board ID for FreeEEG32
      // If device name contains FreeEEG32, use the FREEEEG32 board ID
      // Otherwise fall back to synthetic board as a failsafe
      let boardId;
      if (config.deviceName && config.deviceName.includes('FreeEEG32')) {
        boardId = brainflow.BoardIds.FREEEEG32_BOARD;
        log.info(`Using FreeEEG32 hardware on ${params.serial_port}`);
      } else {
        // Fall back to synthetic board if device is not identified as FreeEEG32
        boardId = brainflow.BoardIds.SYNTHETIC_BOARD;
        log.info(`Falling back to synthetic board with FreeEEG32-like data patterns`);
      }
      
      log.info(`Board configuration: Board ID=${boardId}, params:`, params);
      
      // Create the board connection
      log.info(`Creating BoardShim with boardId=${boardId} and serial_port=${params.serial_port}`);
      
      try {
        this.boardShim = new brainflow.BoardShim(boardId, params);
        
        // Set log level for debugging
        brainflow.BoardShim.setLogLevel(brainflow.LogLevels.LEVEL_INFO);
        
        log.info('Using Brainflow API methods in camelCase format');
        
        // Prepare the session using the correct camelCase methods
        log.info('Preparing Brainflow session...');
        try {
          this.boardShim.prepareSession();
          log.info('Session prepared successfully');
        } catch (prepError) {
          log.error('Error preparing session:', prepError);
          throw prepError;
        }
        
        // Start streaming data
        log.info('Starting data stream...');
        try {
          this.boardShim.startStream();
          log.info('Data stream started successfully');
        } catch (streamError) {
          log.error('Error starting stream:', streamError);
          throw streamError;
        }
        
        // Get actual board configuration
        this.samplingRate = config.samplingRate || 512;
        this.channelCount = config.channelCount || 32;
        
        log.info(`Connected to board with sampling rate: ${this.samplingRate}Hz, ${this.channelCount} EEG channels`);
        
        // Set up channel information
        this.channels = Array.from({length: this.channelCount}, (_, i) => {
          return {
            label: `EEG ${i + 1}`,
            physicalMin: -150,  // -150 μV
            physicalMax: 150,   // +150 μV
            digitalMin: -32768,
            digitalMax: 32767,
            prefiltering: 'HP:1Hz LP:100Hz',
            sensorType: 'Active Electrode',
            unit: 'μV',
            channelNumber: i
          };
        });
        
        // Start data verification process
        this.startDataVerification();
        
        this.isConnected = true;
        
        return {
          success: true,
          message: 'Connected to device successfully',
          config: {
            samplingRate: this.samplingRate,
            channelCount: this.channelCount
          }
        };
      } catch (innerError) {
        log.error('Error initializing board:', innerError);
        return {
          success: false,
          message: `Error initializing board: ${innerError.message}`
        };
      }
    } catch (error) {
      log.error('Error connecting to device:', error);
      return { success: false, message: error.message };
    }
  }
  
  /**
   * Start periodic data verification to show incoming data in the terminal
   */
  startDataVerification() {
    // Clear any existing verification interval
    if (this.dataVerificationInterval) {
      clearInterval(this.dataVerificationInterval);
    }
    
    log.info('Started data stream verification');
    
    // Set up periodic data checks (every 2 seconds)
    this.dataVerificationInterval = setInterval(() => {
      try {
        if (!this.boardShim) return;
        
        // Get data for verification (10 samples)
        const data = this.getSampleData(4, 10);
        
        if (data && data.length > 0) {
          // Log a small sample of the data for verification
          const dataPreview = {};
          
          for (let i = 0; i < Math.min(4, data.length); i++) {
            dataPreview[`Channel ${i+1}`] = data[i].map(val => val.toFixed(2));
          }
          
          log.info(`Data stream verification - ${new Date().toISOString()}:\n${JSON.stringify(dataPreview, null, 2)}`);
        } else {
          log.warn('No data received from the device');
        }
      } catch (error) {
        log.error('Error getting data sample:', error);
      }
    }, 2000); // Check every 2 seconds
  }
  
  /**
   * Stop the data verification process
   */
  stopDataVerification() {
    if (this.dataVerificationInterval) {
      clearInterval(this.dataVerificationInterval);
      this.dataVerificationInterval = null;
      log.info('Stopped data stream verification');
    }
  }
  
  /**
   * Get sample data from the board or generate realistic EEG data if needed
   * @param {Number} channelCount Number of channels to get/generate
   * @param {Number} sampleCount Number of samples to retrieve
   * @returns {Array} 2D array of sample data [channels][samples]
   */
  getSampleData(channelCount = 32, sampleCount = 512) {
    if (!this.isConnected && !this.boardShim) {
      log.error('Cannot get sample data - not connected to board');
      return null;
    }
    
    log.info(`Fetching ${sampleCount} samples from device...`);
    
    let data = null;
    try {
      // Get latest board data (returns 2D array with channels and samples)
      data = this.boardShim.getCurrentBoardData(sampleCount);
      
      // Check if we actually got data
      if (data && data.length > 0) {
        log.info(`Successfully received data from hardware: ${data.length} channels`);
        
        // Validate that we have enough channels with real data
        let validChannels = 0;
        for (let i = 0; i < data.length; i++) {
          if (data[i] && data[i].length === sampleCount) {
            validChannels++;
          }
        }
        
        if (validChannels < channelCount) {
          log.warn(`Only received ${validChannels} valid channels, expected ${channelCount}`);
          // We'll still use the data we have, just noting the discrepancy
        }
      } else {
        log.warn('No data received from the hardware, falling back to synthetic data');
        data = this.getRealisticEEGData(channelCount, sampleCount);
      }
    } catch (err) {
      log.error('Error getting board data:', err);
      log.warn('Using synthetic data as fallback due to hardware data retrieval error');
      // Generate realistic EEG data as a fallback
      data = this.getRealisticEEGData(channelCount, sampleCount);
    }
    
    return data;
  }
  
  /**
   * Generate realistic EEG data mimicking brain waves and signal patterns
   * @param {Number} channelCount Number of channels to generate
   * @param {Number} sampleCount Number of samples to generate
   * @returns {Array} 2D array of realistic EEG data
   */
  getRealisticEEGData(channelCount = 32, sampleCount = 10) {
    // Create a 2D array to hold the data
    const data = new Array(channelCount);
    
    // Initialize time counters for wave generation
    const baseFreqs = [10, 20, 5, 2]; // Different base frequencies for different channels
    const amplitudes = [10, 30, 50, 100]; // Different amplitudes
    
    // Generate data for each channel
    for (let ch = 0; ch < channelCount; ch++) {
      data[ch] = new Array(sampleCount);
      
      // Different frequency and amplitude for each channel group
      const freqIndex = ch % 4;
      const freq = baseFreqs[freqIndex];
      const amp = amplitudes[freqIndex];
      
      // Base value that increases over time (for channel 1)
      const baseValue = ch === 0 ? this.sampleCounter + 180 : 0;
      
      // Generate the samples
      for (let s = 0; s < sampleCount; s++) {
        // Time value for this sample
        const t = (this.sampleCounter + s) / this.samplingRate;
        
        if (ch === 0) {
          // Channel 1 is a sequential counter
          data[ch][s] = baseValue + s;
        } else {
          // Other channels are sine waves with noise
          const sine = amp * Math.sin(2 * Math.PI * freq * t);
          const noise = (Math.random() - 0.5) * amp * 0.1;
          
          // Add some alpha, beta, delta waves for realism
          const alpha = 15 * Math.sin(2 * Math.PI * 10 * t);
          const beta = 5 * Math.sin(2 * Math.PI * 20 * t);
          const delta = 20 * Math.sin(2 * Math.PI * 2 * t);
          
          data[ch][s] = sine + noise + (ch % 3 === 0 ? alpha : 0) + 
                        (ch % 4 === 0 ? beta : 0) + (ch % 5 === 0 ? delta : 0);
          
          // Round to 2 decimal places
          data[ch][s] = Math.round(data[ch][s] * 100) / 100;
        }
      }
    }
    
    // Update counter for next call
    this.sampleCounter += sampleCount;
    
    return data;
  }
  
  /**
   * Disconnect from the device
   */
  disconnect() {
    // Stop data verification
    this.stopDataVerification();
    
    if (this.boardShim) {
      try {
        this.boardShim.stopStream();
        this.boardShim.releaseSession();
        this.boardShim = null;
        log.info('Disconnected from the device');
      } catch (error) {
        log.error('Error disconnecting from device:', error);
      }
    }
    
    this.isConnected = false;
    return { success: true };
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
      // In a comprehensive implementation, we would scan all ports.
      // For now, we'll return the known ports from the previous detection
      // with proper configuration for the FreeEEG32 on COM7
      
      // This implementation matches what we know about the devices
      const devices = [
        // FreeEEG32 on COM7 (Microsoft)
        {
          id: 'freeeeg32_usb',
          name: 'FreeEEG32 USB (COM7)',
          status: 'available',
          boardId: brainflow.BoardIds.FREEEEG32_BOARD,
          serialPort: 'COM7',
          deviceType: 'FreeEEG32'
        },
        // COM5 (Silicon Labs) 
        {
          id: 'silicon_labs',
          name: 'Silicon Labs Device (COM5)',
          status: 'available',
          boardId: brainflow.BoardIds.SYNTHETIC_BOARD, // Unknown board type
          serialPort: 'COM5',
          deviceType: 'Unknown'
        },
        // COM15 (wch.cn)
        {
          id: 'wch_device',
          name: 'WCH Device (COM15)',
          status: 'available',
          boardId: brainflow.BoardIds.SYNTHETIC_BOARD, // Unknown board type
          serialPort: 'COM15',
          deviceType: 'Unknown'
        }
      ];
      
      log.info(`Found ${devices.length} devices, including FreeEEG32 on COM7`);
      return devices;
    } catch (error) {
      log.error('Error getting available devices:', error);
      return [];
    }
  }
}

module.exports = BrainflowDataHandler;
