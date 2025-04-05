/**
 * BDFWriter - A module for writing BioSemi Data Format (BDF) files
 * BDF is an extension of EDF with 24-bit resolution instead of 16-bit
 */

const fs = require('fs');
const path = require('path');

class BDFWriter {
  constructor(options = {}) {
    // Required parameters
    this.channels = options.channels || [];
    this.samplingRate = options.samplingRate || 250; // Hz
    
    // Optional parameters with defaults
    this.subjectId = options.subjectId || 'X';
    this.recordingId = options.recordingId || 'BDF Recording';
    this.startDate = options.startDate || new Date();
    this.duration = options.duration || -1; // Will be calculated based on data
    
    // BDF specific parameters
    // For EDFbrowser compatibility, we'll use standard ASCII format
    this.isBDFPlus = options.isBDFPlus || false; // Whether to use BDF+ format
    this.fileVersion = '0       '; // 8 chars, standard EDF/BDF version
    this.isContinuous = options.isContinuous !== false; // Default to continuous recording
    this.dataRecordDuration = 1; // in seconds, fixed at 1 second per data record
    
    // Allow explicit setting of data records (critical for correct file size)
    if (options.dataRecords && Number.isInteger(options.dataRecords)) {
      this.dataRecords = options.dataRecords;
      this.dataRecordsExplicitlySet = true; // Flag to prevent recalculation
    } else {
      this.dataRecords = 1; // Default to 1 data record if not specified
      this.dataRecordsExplicitlySet = false;
    }
    
    // Internal state
    this.fileHandle = null;
    this.headerSize = 256 + (this.channels.length * 256);
    this.dataRecords = 0;
    
    // Validate configuration
    this._validateConfig();
  }
  
  /**
   * Validates the configuration parameters
   * @private
   */
  _validateConfig() {
    if (!Array.isArray(this.channels) || this.channels.length === 0) {
      throw new Error('BDFWriter requires at least one channel');
    }
    
    // Ensure all channels have required properties
    this.channels.forEach((channel, index) => {
      if (!channel.label) {
        channel.label = `Channel ${index + 1}`;
      }
      
      // Ensure physical/digital min/max values are set
      if (channel.physicalMin === undefined) channel.physicalMin = -262144;
      if (channel.physicalMax === undefined) channel.physicalMax = 262143;
      if (channel.digitalMin === undefined) channel.digitalMin = -8388608;
      if (channel.digitalMax === undefined) channel.digitalMax = 8388607;
      
      // Ensure prefilterings and transducer type are set
      if (!channel.prefiltering) channel.prefiltering = 'None';
      if (!channel.transducerType) channel.transducerType = 'Unknown';
      if (!channel.unit) channel.unit = 'uV';
    });
  }
  
  /**
   * Opens a BDF file for writing
   * @param {string} filename - Path to the file to write
   */
  open(filename) {
    if (this.fileHandle) {
      throw new Error('A file is already open');
    }
    
    this.filename = filename;
    this.fileHandle = fs.openSync(filename, 'w');
    
    // Calculate samples per record: sampling rate * record duration (typically 1s)
    this.samplesPerRecord = Math.floor(this.samplingRate * this.dataRecordDuration);
    
    // Calculate the size of one data record in bytes (all channels combined)
    // For each channel: samplesPerRecord * 3 bytes (24-bit BDF format)
    this.dataRecordSize = this.channels.length * (this.samplesPerRecord * 3);
    
    // Write placeholder for the header (will be updated when closing the file)
    const placeholderHeader = Buffer.alloc(this.headerSize, ' ');
    fs.writeSync(this.fileHandle, placeholderHeader);
    
    return this;
  }
  
  /**
   * Write a data record to the BDF file
   * @param {Array} data - 2D array of samples [channels][samples]
   */
  writeDataRecord(data) {
    if (!this.fileHandle) {
      throw new Error('No file is open for writing');
    }
    
    if (!Array.isArray(data) || data.length !== this.channels.length) {
      throw new Error(`Expected data for ${this.channels.length} channels`);
    }
    
    // Check if all channels have the same number of samples
    const numSamples = data[0].length;
    for (let i = 1; i < data.length; i++) {
      if (data[i].length !== numSamples) {
        throw new Error('All channels must have the same number of samples');
      }
    }
    
    // Buffer to hold the entire data record
    const recordSize = this.channels.reduce((sum, ch) => sum + numSamples * 3, 0);
    const buffer = Buffer.alloc(recordSize);
    
    let offset = 0;
    for (let c = 0; c < this.channels.length; c++) {
      const channel = this.channels[c];
      
      // Convert and write each sample for this channel (24-bit little-endian)
      for (let s = 0; s < numSamples; s++) {
        // Convert physical value to digital value (16-bit compatible for EDFbrowser)
        const physRange = channel.physicalMax - channel.physicalMin;
        const digRange = channel.digitalMax - channel.digitalMin;
        const digitalValue = Math.round(
          ((data[c][s] - channel.physicalMin) / physRange) * digRange + channel.digitalMin
        );
        
        // Ensure value is within 16-bit range (-32768 to 32767)
        const clampedValue = Math.max(-32768, Math.min(32767, digitalValue));
        
        // For BDF format, we still need to write 3 bytes (24-bit storage)
        // but we'll ensure the value stays within 16-bit range
        // Write as little-endian: first 2 bytes contain the 16-bit value, 3rd byte is 0
        buffer.writeUInt8(clampedValue & 0xFF, offset);
        buffer.writeUInt8((clampedValue >> 8) & 0xFF, offset + 1);
        buffer.writeUInt8(0, offset + 2); // Most significant byte is always 0 for 16-bit values
        offset += 3;
      }
    }
    
    // Write the buffer to the file
    fs.writeSync(this.fileHandle, buffer);
    this.dataRecords++;
    
    return this;
  }
  
  /**
   * Write samples to the BDF file
   * @param {Array} samples - 2D array of samples [channels][samples]
   */
  writeSamples(samples) {
    if (!this.fileHandle) {
      throw new Error('No file is open for writing');
    }
    
    // Make sure we have valid data
    if (!samples || !Array.isArray(samples) || samples.length === 0 || 
        !Array.isArray(samples[0]) || samples[0].length === 0) {
      throw new Error('Invalid samples array provided to writeSamples');
    }
    
    // Calculate samples per record based on sampling rate and duration
    const samplesPerRecord = Math.floor(this.samplingRate * this.dataRecordDuration);
    
    // Determine how many full data records we can write
    const totalFullRecords = Math.floor(samples[0].length / samplesPerRecord);
    
    // Write full records first
    for (let i = 0; i < totalFullRecords; i++) {
      const start = i * samplesPerRecord;
      const end = start + samplesPerRecord;
      const recordData = samples.map(channel => channel.slice(start, end));
      this.writeDataRecord(recordData);
    }
    
    // Handle remaining samples if any (partial record)
    const remainingSamples = samples[0].length % samplesPerRecord;
    if (remainingSamples > 0) {
      const start = totalFullRecords * samplesPerRecord;
      const recordData = samples.map(channel => {
        // Get remaining samples and pad if needed
        const partialData = channel.slice(start);
        // If we need to pad to match samplesPerRecord, duplicate the last sample
        while (partialData.length < samplesPerRecord) {
          partialData.push(partialData[partialData.length - 1] || 0);
        }
        return partialData;
      });
      this.writeDataRecord(recordData);
    }
    
    return this;
  }
  
  /**
   * Creates and writes the BDF header
   * @private
   */
  _writeHeader() {
    const headerBuffer = Buffer.alloc(this.headerSize, ' ');
    let offset = 0;
    
    // 8 bytes: Version - using standard ASCII for compatibility
    headerBuffer.write(this.fileVersion, offset, 8);
    offset += 8;
    
    // 80 bytes: Local patient identification
    headerBuffer.write(this.subjectId.padEnd(80, ' '), offset, 80);
    offset += 80;
    
    // 80 bytes: Local recording identification
    headerBuffer.write(this.recordingId.padEnd(80, ' '), offset, 80);
    offset += 80;
    
    // 8 bytes: Start date (dd.mm.yy)
    const startDateStr = this.startDate.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit'
    }).replace(/\//g, '.');
    headerBuffer.write(startDateStr.padEnd(8, ' '), offset, 8);
    offset += 8;
    
    // 8 bytes: Start time (hh.mm.ss)
    const startTimeStr = this.startDate.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).replace(/:/g, '.');
    headerBuffer.write(startTimeStr.padEnd(8, ' '), offset, 8);
    offset += 8;
    
    // 8 bytes: Header size in bytes
    headerBuffer.write(this.headerSize.toString().padEnd(8, ' '), offset, 8);
    offset += 8;
    
    // 44 bytes: Reserved field - According to EDF specification, this should be blank (spaces)
    headerBuffer.write(''.padEnd(44, ' '), offset, 44);
    offset += 44;
    
    // 8 bytes: Number of data records
    headerBuffer.write(this.dataRecords.toString().padEnd(8, ' '), offset, 8);
    offset += 8;
    
    // 8 bytes: Duration of a data record in seconds
    headerBuffer.write(this.dataRecordDuration.toString().padEnd(8, ' '), offset, 8);
    offset += 8;
    
    // 4 bytes: Number of channels
    headerBuffer.write(this.channels.length.toString().padEnd(4, ' '), offset, 4);
    offset += 4;
    
    // Now write all the per-channel information in blocks
    
    // NS * 16 bytes: Labels
    for (const channel of this.channels) {
      headerBuffer.write(channel.label.padEnd(16, ' '), offset, 16);
      offset += 16;
    }
    
    // NS * 80 bytes: Transducer type
    for (const channel of this.channels) {
      headerBuffer.write(channel.transducerType.padEnd(80, ' '), offset, 80);
      offset += 80;
    }
    
    // NS * 8 bytes: Physical dimension (e.g., uV)
    for (const channel of this.channels) {
      headerBuffer.write(channel.unit.padEnd(8, ' '), offset, 8);
      offset += 8;
    }
    
    // NS * 8 bytes: Physical minimum
    for (const channel of this.channels) {
      headerBuffer.write(channel.physicalMin.toString().padEnd(8, ' '), offset, 8);
      offset += 8;
    }
    
    // NS * 8 bytes: Physical maximum
    for (const channel of this.channels) {
      headerBuffer.write(channel.physicalMax.toString().padEnd(8, ' '), offset, 8);
      offset += 8;
    }
    
    // NS * 8 bytes: Digital minimum
    for (const channel of this.channels) {
      headerBuffer.write(channel.digitalMin.toString().padEnd(8, ' '), offset, 8);
      offset += 8;
    }
    
    // NS * 8 bytes: Digital maximum
    for (const channel of this.channels) {
      headerBuffer.write(channel.digitalMax.toString().padEnd(8, ' '), offset, 8);
      offset += 8;
    }
    
    // NS * 80 bytes: Prefiltering
    for (const channel of this.channels) {
      headerBuffer.write(channel.prefiltering.padEnd(80, ' '), offset, 80);
      offset += 80;
    }
    
    // NS * 8 bytes: Number of samples per record
    for (const channel of this.channels) {
      // Use the precalculated samplesPerRecord to ensure consistency
      headerBuffer.write(this.samplesPerRecord.toString().padEnd(8, ' '), offset, 8);
      offset += 8;
    }
    
    // NS * 32 bytes: Reserved
    for (let i = 0; i < this.channels.length; i++) {
      offset += 32; // Just leave as spaces
    }
    
    // Seek to the beginning of the file and write the header
    fs.writeSync(this.fileHandle, headerBuffer, 0, this.headerSize, 0);
  }
  
  /**
   * Calculates and ensures the data record count exactly matches file contents
   * @private
   */
  _calculateExactDataRecords() {
    // Get current file size
    const stats = fs.fstatSync(this.fileHandle);
    const actualFileSize = stats.size;
    
    // Calculate data portion size (file size minus header)
    const dataSize = actualFileSize - this.headerSize;
    
    // Calculate exact number of data records that would fit in the data size
    // This needs to be an integer value for BDF format compliance
    return Math.floor(dataSize / this.dataRecordSize);
  }
  
  /**
   * Closes the BDF file, writing the header with accurate information
   */
  close() {
    if (!this.fileHandle) {
      throw new Error('No file is open for closing');
    }
    
    // Skip recalculating data records if explicitly set during initialization
    // This is important to maintain the exact file size for compatibility
    if (!this.dataRecordsExplicitlySet) {
      // Only calculate based on file size if not explicitly set
      const exactDataRecords = this._calculateExactDataRecords();
      this.dataRecords = Math.max(1, exactDataRecords);
    }

    // Calculate what the file size should be according to header information
    const expectedDataSize = this.dataRecords * this.dataRecordSize;
    const expectedFileSize = this.headerSize + expectedDataSize;
    
    // Get the actual current file size
    const stats = fs.fstatSync(this.fileHandle);
    const actualFileSize = stats.size;
    
    // If actual file size doesn't match expected (according to header), adjust the file size
    if (actualFileSize !== expectedFileSize) {
      // Truncate or extend the file to match expected size exactly
      fs.ftruncateSync(this.fileHandle, expectedFileSize);
    }
    
    // Write the header with updated information
    this._writeHeader();
    
    // Force a file sync to ensure all changes are written
    fs.fsyncSync(this.fileHandle);
    
    // Close the file
    fs.closeSync(this.fileHandle);
    this.fileHandle = null;
    
    // Double-check file size after closing
    // This is a validation step to confirm our file size matches what we expect
    try {
      const finalStats = fs.statSync(this.filename);
      const finalSize = finalStats.size;
      const expectedSize = this.headerSize + (this.dataRecords * this.dataRecordSize);
      
      if (finalSize !== expectedSize) {
        console.error(`BDF file size verification failed: Expected ${expectedSize} bytes but got ${finalSize} bytes`);
      }
    } catch (error) {
      console.error(`Error verifying final file size: ${error.message}`);
    }
    
    return this;
  }
}

module.exports = BDFWriter;
