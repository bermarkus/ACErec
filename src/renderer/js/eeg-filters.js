/**
 * EEG Signal Filtering Implementation
 * Provides bandpass and notch filtering for EEG signal processing
 */

class EEGFilters {
  constructor() {
    // Default filter settings
    this.settings = {
      bandpassEnabled: false,
      bandpassLow: 1, // Hz
      bandpassHigh: 50, // Hz
      notchEnabled: false,
      notchFreq: 50, // Hz (for 50Hz power line noise)
      notchWidth: 5, // Width of the notch filter
      samplingRate: 250 // Default sampling rate
    };

    // Filter coefficients cache
    this.bandpassCoeffs = null;
    this.notchCoeffs = null;
    
    // Filter states for each channel
    this.bandpassStates = [];
    this.notchStates = [];
  }

  /**
   * Initialize filters for a specific number of channels and sampling rate
   * @param {Number} channelCount - Number of EEG channels
   * @param {Number} samplingRate - Sampling rate in Hz
   */
  initializeFilters(channelCount, samplingRate) {
    this.settings.samplingRate = samplingRate;
    
    // Reset filter states
    this.bandpassStates = Array(channelCount).fill().map(() => ({ x1: 0, x2: 0, y1: 0, y2: 0 }));
    this.notchStates = Array(channelCount).fill().map(() => ({ x1: 0, x2: 0, y1: 0, y2: 0 }));
    
    // Compute filter coefficients
    this.updateBandpassCoefficients();
    this.updateNotchCoefficients();
    
    console.log(`Initialized filters for ${channelCount} channels at ${samplingRate}Hz`);
  }
  
  /**
   * Update bandpass filter settings
   * @param {Object} settings - Filter settings
   */
  updateBandpassSettings(settings) {
    let updated = false;
    
    if (settings.enabled !== undefined && this.settings.bandpassEnabled !== settings.enabled) {
      this.settings.bandpassEnabled = settings.enabled;
      updated = true;
    }
    
    if (settings.lowFreq !== undefined && this.settings.bandpassLow !== settings.lowFreq) {
      this.settings.bandpassLow = settings.lowFreq;
      updated = true;
    }
    
    if (settings.highFreq !== undefined && this.settings.bandpassHigh !== settings.highFreq) {
      this.settings.bandpassHigh = settings.highFreq;
      updated = true;
    }
    
    if (updated) {
      this.updateBandpassCoefficients();
    }
    
    return updated;
  }
  
  /**
   * Update notch filter settings
   * @param {Object} settings - Filter settings
   */
  updateNotchSettings(settings) {
    let updated = false;
    
    if (settings.enabled !== undefined && this.settings.notchEnabled !== settings.enabled) {
      this.settings.notchEnabled = settings.enabled;
      updated = true;
    }
    
    if (settings.frequency !== undefined && this.settings.notchFreq !== settings.frequency) {
      this.settings.notchFreq = settings.frequency;
      updated = true;
    }
    
    if (settings.width !== undefined && this.settings.notchWidth !== settings.width) {
      this.settings.notchWidth = settings.width;
      updated = true;
    }
    
    if (updated) {
      this.updateNotchCoefficients();
    }
    
    return updated;
  }
  
  /**
   * Calculate bandpass filter coefficients using Butterworth design
   */
  updateBandpassCoefficients() {
    const lowFreq = this.settings.bandpassLow;
    const highFreq = this.settings.bandpassHigh;
    const fs = this.settings.samplingRate;
    
    // Normalized frequencies
    const w1 = 2 * Math.PI * lowFreq / fs;
    const w2 = 2 * Math.PI * highFreq / fs;
    
    // Coefficients for second-order bandpass
    const d = Math.cos((w1 + w2) / 2) / Math.cos((w2 - w1) / 2);
    const c = (1 - Math.tan((w2 - w1) / 4)) / (1 + Math.tan((w2 - w1) / 4));
    
    this.bandpassCoeffs = {
      b0: (1 - c) / 2,
      b1: 0,
      b2: -(1 - c) / 2,
      a1: -d * (1 + c),
      a2: c
    };
    
    console.log(`Updated bandpass coefficients: ${lowFreq}-${highFreq}Hz`);
  }
  
  /**
   * Calculate notch filter coefficients
   */
  updateNotchCoefficients() {
    const notchFreq = this.settings.notchFreq;
    const width = this.settings.notchWidth;
    const fs = this.settings.samplingRate;
    
    // Normalized frequency
    const w0 = 2 * Math.PI * notchFreq / fs;
    const alpha = Math.sin(w0) * Math.sinh(Math.log(2) / 2 * width * w0 / Math.sin(w0));
    
    // Coefficients for second-order notch
    const a0 = 1 + alpha;
    
    this.notchCoeffs = {
      b0: 1 / a0,
      b1: -2 * Math.cos(w0) / a0,
      b2: 1 / a0,
      a1: -2 * Math.cos(w0) / a0,
      a2: (1 - alpha) / a0
    };
    
    console.log(`Updated notch coefficients: ${notchFreq}Hz, width ${width}Hz`);
  }
  
  /**
   * Apply bandpass filter to a sample
   * @param {Number} sample - Input sample
   * @param {Number} channel - Channel index
   * @returns {Number} Filtered sample
   */
  applyBandpass(sample, channel) {
    if (!this.settings.bandpassEnabled || !this.bandpassCoeffs) {
      return sample;
    }
    
    const state = this.bandpassStates[channel];
    const c = this.bandpassCoeffs;
    
    // Second-order IIR filter implementation
    const output = c.b0 * sample + c.b1 * state.x1 + c.b2 * state.x2 - c.a1 * state.y1 - c.a2 * state.y2;
    
    // Update state
    state.x2 = state.x1;
    state.x1 = sample;
    state.y2 = state.y1;
    state.y1 = output;
    
    return output;
  }
  
  /**
   * Apply notch filter to a sample
   * @param {Number} sample - Input sample
   * @param {Number} channel - Channel index
   * @returns {Number} Filtered sample
   */
  applyNotch(sample, channel) {
    if (!this.settings.notchEnabled || !this.notchCoeffs) {
      return sample;
    }
    
    const state = this.notchStates[channel];
    const c = this.notchCoeffs;
    
    // Second-order IIR filter implementation
    const output = c.b0 * sample + c.b1 * state.x1 + c.b2 * state.x2 - c.a1 * state.y1 - c.a2 * state.y2;
    
    // Update state
    state.x2 = state.x1;
    state.x1 = sample;
    state.y2 = state.y1;
    state.y1 = output;
    
    return output;
  }
  
  /**
   * Process a batch of EEG data through the filters
   * @param {Array} data - 2D array of EEG data [channels][samples]
   * @returns {Array} Filtered data
   */
  processData(data) {
    if (!data || !data.length) return data;
    
    // If filters are disabled, return the original data
    if (!this.settings.bandpassEnabled && !this.settings.notchEnabled) {
      return data;
    }
    
    // Clone the data to avoid modifying the original
    const filteredData = JSON.parse(JSON.stringify(data));
    
    // Apply filters to each channel and sample
    for (let channel = 0; channel < filteredData.length; channel++) {
      for (let i = 0; i < filteredData[channel].length; i++) {
        let sample = filteredData[channel][i];
        
        // Apply bandpass filter
        if (this.settings.bandpassEnabled) {
          sample = this.applyBandpass(sample, channel);
        }
        
        // Apply notch filter
        if (this.settings.notchEnabled) {
          sample = this.applyNotch(sample, channel);
        }
        
        filteredData[channel][i] = sample;
      }
    }
    
    return filteredData;
  }
  
  /**
   * Reset filter states
   */
  resetFilters() {
    if (this.bandpassStates) {
      for (const state of this.bandpassStates) {
        state.x1 = 0;
        state.x2 = 0;
        state.y1 = 0;
        state.y2 = 0;
      }
    }
    
    if (this.notchStates) {
      for (const state of this.notchStates) {
        state.x1 = 0;
        state.x2 = 0;
        state.y1 = 0;
        state.y2 = 0;
      }
    }
    
    console.log('Filter states reset');
  }
}

// Export the filter class
window.EEGFilters = EEGFilters;
