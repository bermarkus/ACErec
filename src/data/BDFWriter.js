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
    this.fileVersion = '0       '; // 8 chars, BIOSEMI format
    this.dataFormat = '24BIT'; 
    this.dataRecordDuration = 1; // in seconds
    
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
        // Convert physical value to digital value (24-bit)
        const physRange = channel.physicalMax - channel.physicalMin;
        const digRange = channel.digitalMax - channel.digitalMin;
        const digitalValue = Math.round(
          ((data[c][s] - channel.physicalMin) / physRange) * digRange + channel.digitalMin
        );
        
        // Ensure value is within 24-bit range (-8388608 to 8388607)
        const clampedValue = Math.max(-8388608, Math.min(8388607, digitalValue));
        
        // Write 24-bit value as 3 bytes in little-endian format
        buffer.writeUInt8(clampedValue & 0xFF, offset);
        buffer.writeUInt8((clampedValue >> 8) & 0xFF, offset + 1);
        buffer.writeUInt8((clampedValue >> 16) & 0xFF, offset + 2);
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
    
    const samplesPerRecord = this.samplingRate * this.dataRecordDuration;
    
    // If samples array can't be evenly divided into records, adjust the last record
    for (let i = 0; i < samples[0].length; i += samplesPerRecord) {
      const end = Math.min(i + samplesPerRecord, samples[0].length);
      const recordData = samples.map(channel => channel.slice(i, end));
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
    
    // 8 bytes: Version
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
    
    // 44 bytes: Reserved for BDF+ data
    headerBuffer.write('BIOSEMI'.padEnd(44, ' '), offset, 44);
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
      const samplesPerRecord = (this.samplingRate * this.dataRecordDuration).toString();
      headerBuffer.write(samplesPerRecord.padEnd(8, ' '), offset, 8);
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
   * Closes the BDF file, writing the header
   */
  close() {
    if (!this.fileHandle) {
      throw new Error('No file is open for closing');
    }
    
    // Write the header with updated information
    this._writeHeader();
    
    // Close the file
    fs.closeSync(this.fileHandle);
    this.fileHandle = null;
    
    return this;
  }
}

module.exports = BDFWriter;
