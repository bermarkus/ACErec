/**
 * EEG Visualization and Processing Functions
 * Contains functions for channel selection and EEG visualization
 */

// Channel selection functions
function selectAllChannels() {
  const checkboxes = document.querySelectorAll('#channel-toggles input[type="checkbox"]');
  checkboxes.forEach(checkbox => {
    checkbox.checked = true;
  });
  
  // Update visible channels
  updateVisibleChannels();
  
  // Update visualization
  if (appState.visualization.chart) {
    updateVisualization();
  }
}

function deselectAllChannels() {
  const checkboxes = document.querySelectorAll('#channel-toggles input[type="checkbox"]');
  checkboxes.forEach(checkbox => {
    checkbox.checked = false;
  });
  
  // Update visible channels
  updateVisibleChannels();
  
  // Update visualization
  if (appState.visualization.chart) {
    updateVisualization();
  }
}

function updateVisibleChannels() {
  const checkboxes = document.querySelectorAll('#channel-toggles input[type="checkbox"]');
  appState.visualization.visibleChannels = [];
  
  checkboxes.forEach((checkbox, index) => {
    if (checkbox.checked) {
      appState.visualization.visibleChannels.push(index);
    }
  });
  
  console.log(`Visible channels updated: ${appState.visualization.visibleChannels.length} channels visible`);
}

function generateChannelToggles(channelCount) {
  const container = document.getElementById('channel-toggles');
  container.innerHTML = '';
  
  // Initialize visible channels array with all channels
  appState.visualization.visibleChannels = Array.from({ length: channelCount }, (_, i) => i);
  
  for (let i = 0; i < channelCount; i++) {
    const channelToggle = document.createElement('div');
    channelToggle.className = 'channel-toggle';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `channel-${i}`;
    checkbox.checked = true;
    checkbox.addEventListener('change', updateVisibleChannels);
    
    const label = document.createElement('label');
    label.htmlFor = `channel-${i}`;
    label.textContent = `Ch ${i + 1}`;
    
    channelToggle.appendChild(checkbox);
    channelToggle.appendChild(label);
    container.appendChild(channelToggle);
  }
}

// Filter UI functions
function updateBandpassUI() {
  const enabled = document.getElementById('bandpass-enabled').checked;
  const lowInput = document.getElementById('bandpass-low');
  const highInput = document.getElementById('bandpass-high');
  const applyButton = document.getElementById('apply-bandpass');
  
  lowInput.disabled = !enabled;
  highInput.disabled = !enabled;
  applyButton.disabled = !enabled;
  
  if (enabled && appState.isConnected) {
    applyButton.disabled = false;
  }
}

function updateNotchUI() {
  const enabled = document.getElementById('notch-enabled').checked;
  const freqSelect = document.getElementById('notch-freq');
  const widthInput = document.getElementById('notch-width');
  const applyButton = document.getElementById('apply-notch');
  
  freqSelect.disabled = !enabled;
  widthInput.disabled = !enabled;
  applyButton.disabled = !enabled;
  
  if (enabled && appState.isConnected) {
    applyButton.disabled = false;
  }
}

// Apply filters
function applyBandpassFilter() {
  if (!appState.visualization.filters) return;
  
  const enabled = document.getElementById('bandpass-enabled').checked;
  const lowFreq = parseFloat(document.getElementById('bandpass-low').value);
  const highFreq = parseFloat(document.getElementById('bandpass-high').value);
  
  // Validate frequency range
  if (lowFreq >= highFreq) {
    alert('Low cutoff frequency must be less than high cutoff frequency');
    return;
  }
  
  console.log(`Applying bandpass filter: ${enabled ? 'enabled' : 'disabled'}, ${lowFreq}Hz - ${highFreq}Hz`);
  
  // Update filter settings
  const updated = appState.visualization.filters.updateBandpassSettings({
    enabled: enabled,
    lowFreq: lowFreq,
    highFreq: highFreq
  });
  
  if (updated && appState.visualization.data.length > 0) {
    // Reset filter states when changing filter parameters
    appState.visualization.filters.resetFilters();
    
    // Update visualization
    updateVisualization();
  }
}

function applyNotchFilter() {
  if (!appState.visualization.filters) return;
  
  const enabled = document.getElementById('notch-enabled').checked;
  const frequency = parseInt(document.getElementById('notch-freq').value);
  const width = parseFloat(document.getElementById('notch-width').value);
  
  console.log(`Applying notch filter: ${enabled ? 'enabled' : 'disabled'}, ${frequency}Hz, width ${width}Hz`);
  
  // Update filter settings
  const updated = appState.visualization.filters.updateNotchSettings({
    enabled: enabled,
    frequency: frequency,
    width: width
  });
  
  if (updated && appState.visualization.data.length > 0) {
    // Reset filter states when changing filter parameters
    appState.visualization.filters.resetFilters();
    
    // Update visualization
    updateVisualization();
  }
}

// Process data with current filter settings
function processEEGData(data) {
  if (!appState.visualization.filters || !data || !data.length) {
    return data;
  }
  
  // Apply filters to data
  return appState.visualization.filters.processData(data);
}
