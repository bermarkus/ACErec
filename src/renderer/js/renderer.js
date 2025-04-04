/**
 * ACErec - Renderer Process
 * Handles UI interactions and communicates with the main process via the exposed API
 */

// DOM Elements
const elements = {
  deviceStatus: document.getElementById('device-status'),
  recordingStatus: document.getElementById('recording-status'),
  recordingDuration: document.getElementById('recording-duration'),
  deviceSelect: document.getElementById('device-select'),
  refreshDevicesBtn: document.getElementById('refresh-devices-btn'),
  connectBtn: document.getElementById('connect-btn'),
  disconnectBtn: document.getElementById('disconnect-btn'),
  subjectIdInput: document.getElementById('subject-id'),
  recordingIdInput: document.getElementById('recording-id'),
  saveLocationInput: document.getElementById('save-location'),
  browseBtn: document.getElementById('browse-btn'),
  startRecordingBtn: document.getElementById('start-recording-btn'),
  stopRecordingBtn: document.getElementById('stop-recording-btn'),
  samplingRateSelect: document.getElementById('sampling-rate'),
  eegVisualization: document.getElementById('eeg-visualization'),
  
  // Modals
  settingsModal: document.getElementById('settings-modal'),
  aboutModal: document.getElementById('about-modal'),
  saveSettingsBtn: document.getElementById('save-settings-btn'),
  cancelSettingsBtn: document.getElementById('cancel-settings-btn'),
  channelCountInput: document.getElementById('channel-count'),
  autoSaveCheckbox: document.getElementById('auto-save'),
  defaultSaveLocationInput: document.getElementById('default-save-location'),
  browseDefaultLocationBtn: document.getElementById('browse-default-location-btn')
};

// Application State
const appState = {
  isConnected: false,
  isRecording: false,
  recordingStartTime: null,
  selectedDevice: null,
  recordingDurationInterval: null,
  devices: [],
  settings: {
    channelCount: 32,
    autoSave: true,
    defaultSaveLocation: ''
  }
};

// Initialize the application
async function init() {
  // Load settings
  try {
    const savedSettings = await window.api.loadSettings();
    if (savedSettings) {
      appState.settings = { ...appState.settings, ...savedSettings };
      updateSettingsUI();
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
  
  // Set up event listeners
  setupEventListeners();
  
  // Initial device refresh
  refreshDevices();
  
  // Set up IPC listeners
  setupIPCListeners();
}

// Set up event listeners for UI elements
function setupEventListeners() {
  // Device connection
  elements.refreshDevicesBtn.addEventListener('click', refreshDevices);
  elements.connectBtn.addEventListener('click', connectDevice);
  elements.disconnectBtn.addEventListener('click', disconnectDevice);
  
  // Recording controls
  elements.startRecordingBtn.addEventListener('click', startRecording);
  elements.stopRecordingBtn.addEventListener('click', stopRecording);
  elements.browseBtn.addEventListener('click', browseSaveLocation);
  
  // Modal controls (Settings)
  elements.saveSettingsBtn.addEventListener('click', saveSettings);
  elements.cancelSettingsBtn.addEventListener('click', () => toggleModal('settings', false));
  elements.browseDefaultLocationBtn.addEventListener('click', browseDefaultSaveLocation);
  
  // Close buttons for modals
  document.querySelectorAll('.close-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.modal').forEach(modal => {
        modal.classList.remove('show');
      });
    });
  });
}

// Set up IPC listeners for communication with main process
function setupIPCListeners() {
  window.api.on('device-data', handleDeviceData);
  window.api.on('recording-status', handleRecordingStatus);
  window.api.on('device-status', handleDeviceStatus);
  window.api.on('open-settings', () => toggleModal('settings', true));
  window.api.on('open-about', () => toggleModal('about', true));
  window.api.on('recording-action', handleRecordingAction);
}

// Refresh available devices
async function refreshDevices() {
  try {
    elements.refreshDevicesBtn.disabled = true;
    elements.deviceSelect.innerHTML = '<option value="" disabled selected>Searching...</option>';
    
    appState.devices = await window.api.getDevices();
    
    elements.deviceSelect.innerHTML = '';
    if (appState.devices.length === 0) {
      elements.deviceSelect.innerHTML = '<option value="" disabled selected>No devices found</option>';
      elements.connectBtn.disabled = true;
    } else {
      appState.devices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.id;
        option.textContent = device.name;
        elements.deviceSelect.appendChild(option);
      });
      elements.connectBtn.disabled = false;
    }
  } catch (error) {
    console.error('Error refreshing devices:', error);
    elements.deviceSelect.innerHTML = '<option value="" disabled selected>Error finding devices</option>';
    elements.connectBtn.disabled = true;
  } finally {
    elements.refreshDevicesBtn.disabled = false;
  }
}

// Connect to selected device
async function connectDevice() {
  try {
    const deviceId = elements.deviceSelect.value;
    if (!deviceId) return;
    
    elements.connectBtn.disabled = true;
    elements.deviceStatus.textContent = 'Connecting...';
    
    // Get the selected device
    appState.selectedDevice = appState.devices.find(device => device.id == deviceId);
    
    // Set up connection parameters
    const connectionParams = {
      samplingRate: parseInt(elements.samplingRateSelect.value),
      channelCount: appState.settings.channelCount
    };
    
    // Connect to the device
    const result = await window.api.connectDevice(deviceId, connectionParams);
    
    if (result.success) {
      appState.isConnected = true;
      elements.deviceStatus.textContent = 'Connected';
      elements.connectBtn.disabled = true;
      elements.disconnectBtn.disabled = false;
      elements.startRecordingBtn.disabled = false;
      
      // Clear any placeholder in the visualization
      elements.eegVisualization.innerHTML = '<canvas id="eeg-canvas"></canvas>';
      
      // Initialize visualization (this would be implemented with charting library)
      initializeVisualization();
    } else {
      elements.deviceStatus.textContent = 'Connection failed';
      elements.connectBtn.disabled = false;
      console.error('Connection failed:', result.message);
    }
  } catch (error) {
    console.error('Error connecting to device:', error);
    elements.deviceStatus.textContent = 'Connection error';
    elements.connectBtn.disabled = false;
  }
}

// Disconnect from device
async function disconnectDevice() {
  try {
    elements.disconnectBtn.disabled = true;
    
    // If recording, stop it first
    if (appState.isRecording) {
      await stopRecording();
    }
    
    const result = await window.api.disconnectDevice();
    
    appState.isConnected = false;
    elements.deviceStatus.textContent = 'Not connected';
    elements.connectBtn.disabled = false;
    elements.disconnectBtn.disabled = true;
    elements.startRecordingBtn.disabled = true;
    
    // Reset visualization
    elements.eegVisualization.innerHTML = '<div class="placeholder-message">Connect to a device to view EEG data</div>';
  } catch (error) {
    console.error('Error disconnecting from device:', error);
    elements.disconnectBtn.disabled = false;
  }
}

// Start recording
async function startRecording() {
  try {
    if (!appState.isConnected) return;
    
    elements.startRecordingBtn.disabled = true;
    elements.recordingStatus.textContent = 'Starting...';
    
    // Prepare recording configuration
    const config = {
      subjectId: elements.subjectIdInput.value || 'Unknown',
      recordingId: elements.recordingIdInput.value || `Recording_${new Date().toISOString().replace(/[:.]/g, '-')}`,
      saveLocation: elements.saveLocationInput.value || appState.settings.defaultSaveLocation,
      samplingRate: parseInt(elements.samplingRateSelect.value),
      channelCount: appState.settings.channelCount
    };
    
    const result = await window.api.startRecording(config);
    
    if (result.success) {
      appState.isRecording = true;
      appState.recordingStartTime = new Date();
      elements.recordingStatus.textContent = 'Recording';
      elements.stopRecordingBtn.disabled = false;
      
      // Start duration counter
      startDurationCounter();
    } else {
      elements.recordingStatus.textContent = 'Failed to start';
      elements.startRecordingBtn.disabled = false;
      console.error('Failed to start recording:', result.message);
    }
  } catch (error) {
    console.error('Error starting recording:', error);
    elements.recordingStatus.textContent = 'Error';
    elements.startRecordingBtn.disabled = false;
  }
}

// Stop recording
async function stopRecording() {
  try {
    if (!appState.isRecording) return;
    
    elements.stopRecordingBtn.disabled = true;
    elements.recordingStatus.textContent = 'Stopping...';
    
    // Prepare saving options
    const saveOptions = {
      format: 'BDF',
      includeAnnotations: true
    };
    
    const result = await window.api.stopRecording(saveOptions);
    
    // Regardless of result, reset recording state
    appState.isRecording = false;
    stopDurationCounter();
    elements.recordingStatus.textContent = 'Not recording';
    elements.recordingDuration.textContent = '00:00:00';
    elements.startRecordingBtn.disabled = false;
    elements.stopRecordingBtn.disabled = true;
    
    if (!result.success) {
      console.error('Error stopping recording:', result.message);
      alert(`Error stopping recording: ${result.message}`);
    }
  } catch (error) {
    console.error('Error stopping recording:', error);
    elements.recordingStatus.textContent = 'Error';
    elements.stopRecordingBtn.disabled = false;
  }
}

// Browse for save location
function browseSaveLocation() {
  // This will be handled by the main process through IPC
  // For now, just use a placeholder
  elements.saveLocationInput.value = appState.settings.defaultSaveLocation || 'C:\\EEG Recordings';
}

// Browse for default save location
function browseDefaultSaveLocation() {
  // This will be handled by the main process through IPC
  // For now, just use a placeholder
  elements.defaultSaveLocationInput.value = 'C:\\EEG Recordings';
}

// Save settings
async function saveSettings() {
  try {
    // Get values from form
    const settings = {
      channelCount: parseInt(elements.channelCountInput.value) || 32,
      autoSave: elements.autoSaveCheckbox.checked,
      defaultSaveLocation: elements.defaultSaveLocationInput.value
    };
    
    // Save settings via IPC
    await window.api.saveSettings(settings);
    
    // Update app state
    appState.settings = settings;
    
    // Close modal
    toggleModal('settings', false);
  } catch (error) {
    console.error('Error saving settings:', error);
    alert('Failed to save settings');
  }
}

// Handle device data (for visualization)
function handleDeviceData(data) {
  // This would update the EEG visualization with new data
  // Implementation would depend on the visualization library used
  console.log('Received device data:', data);
}

// Handle recording status updates from main process
function handleRecordingStatus(status) {
  if (status.isRecording !== appState.isRecording) {
    appState.isRecording = status.isRecording;
    
    if (status.isRecording) {
      elements.recordingStatus.textContent = 'Recording';
      elements.startRecordingBtn.disabled = true;
      elements.stopRecordingBtn.disabled = false;
      appState.recordingStartTime = new Date(status.startTime);
      startDurationCounter();
    } else {
      elements.recordingStatus.textContent = 'Not recording';
      elements.startRecordingBtn.disabled = false;
      elements.stopRecordingBtn.disabled = true;
      stopDurationCounter();
      elements.recordingDuration.textContent = '00:00:00';
    }
  }
}

// Handle device status updates from main process
function handleDeviceStatus(status) {
  if (status.isConnected !== appState.isConnected) {
    appState.isConnected = status.isConnected;
    
    if (status.isConnected) {
      elements.deviceStatus.textContent = 'Connected';
      elements.connectBtn.disabled = true;
      elements.disconnectBtn.disabled = false;
      elements.startRecordingBtn.disabled = false;
    } else {
      elements.deviceStatus.textContent = 'Not connected';
      elements.connectBtn.disabled = false;
      elements.disconnectBtn.disabled = true;
      elements.startRecordingBtn.disabled = true;
      elements.stopRecordingBtn.disabled = true;
      
      // If recording, stop the counter
      if (appState.isRecording) {
        appState.isRecording = false;
        stopDurationCounter();
        elements.recordingStatus.textContent = 'Not recording';
        elements.recordingDuration.textContent = '00:00:00';
      }
    }
  }
}

// Handle recording actions from the main process (menu)
function handleRecordingAction(action) {
  if (action === 'start' && !appState.isRecording) {
    startRecording();
  } else if (action === 'stop' && appState.isRecording) {
    stopRecording();
  }
}

// Toggle modal visibility
function toggleModal(modalName, show) {
  const modal = modalName === 'settings' ? elements.settingsModal : elements.aboutModal;
  
  if (show) {
    modal.classList.add('show');
    updateSettingsUI();
  } else {
    modal.classList.remove('show');
  }
}

// Update settings UI with current values
function updateSettingsUI() {
  elements.channelCountInput.value = appState.settings.channelCount;
  elements.autoSaveCheckbox.checked = appState.settings.autoSave;
  elements.defaultSaveLocationInput.value = appState.settings.defaultSaveLocation;
}

// Start recording duration counter
function startDurationCounter() {
  // Clear existing interval if any
  stopDurationCounter();
  
  // Start a new interval
  appState.recordingDurationInterval = setInterval(() => {
    const now = new Date();
    const elapsed = now - appState.recordingStartTime;
    elements.recordingDuration.textContent = formatDuration(elapsed);
  }, 1000);
}

// Stop recording duration counter
function stopDurationCounter() {
  if (appState.recordingDurationInterval) {
    clearInterval(appState.recordingDurationInterval);
    appState.recordingDurationInterval = null;
  }
}

// Format duration in milliseconds to HH:MM:SS
function formatDuration(ms) {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));
  
  return [hours, minutes, seconds]
    .map(num => num.toString().padStart(2, '0'))
    .join(':');
}

// Initialize EEG visualization
function initializeVisualization() {
  // This would set up the EEG visualization using a charting library
  // For now, just display a placeholder message
  elements.eegVisualization.innerHTML = `
    <div style="text-align: center; padding: 20px;">
      <p>EEG Visualization Initialized</p>
      <p>Channel Count: ${appState.settings.channelCount}</p>
      <p>Sampling Rate: ${elements.samplingRateSelect.value} Hz</p>
    </div>
  `;
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', init);
