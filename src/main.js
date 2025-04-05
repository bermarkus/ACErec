/**
 * ACErec - Main Process
 * Electron main process that handles the application lifecycle, communication
 * with the renderer process, and hardware interaction via Brainflow
 */

const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');
const log = require('electron-log');
const BrainflowDataHandler = require('./data/BrainflowDataHandler');

// Configure logging
log.transports.file.level = 'info';
log.info('Application starting...');

// Keep a global reference of the window object to prevent garbage collection
let mainWindow;

// Track recording state
let isRecording = false;
let recordingStartTime = null;
let recordingData = [];

// Store recording configuration for access by stop-recording handler
let recordingConfig = null;

/**
 * Creates the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the index.html file
  mainWindow.loadURL(url.format({
    pathname: path.join(__dirname, 'renderer', 'index.html'),
    protocol: 'file:',
    slashes: true
  }));

  // Open DevTools in development mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Create application menu
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Settings',
          click: () => mainWindow.webContents.send('open-settings')
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Recording',
      submenu: [
        {
          label: 'Start Recording',
          click: () => mainWindow.webContents.send('recording-action', 'start'),
          enabled: !isRecording
        },
        {
          label: 'Stop Recording',
          click: () => mainWindow.webContents.send('recording-action', 'stop'),
          enabled: isRecording
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => mainWindow.webContents.send('open-about')
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Create window when Electron is ready
app.on('ready', () => {
  createWindow();
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC handlers for renderer communication
ipcMain.handle('get-devices', async () => {
  try {
    // Real device detection for FreeEEG32
    // Check for available serial ports
    const { SerialPort } = require('serialport');
    const ports = await SerialPort.list();
    
    const devices = [];
    
    // Look for potential FreeEEG32 devices on serial ports
    for (const port of ports) {
      log.info(`Found serial device: ${port.path}, ${port.manufacturer || 'Unknown manufacturer'}`);
      
      // FreeEEG32 can use various interfaces including direct USB
      // Add device if it matches expected patterns for FreeEEG32
      if (port.manufacturer && 
         (port.manufacturer.includes('STMicroelectronics') || 
          port.manufacturer.includes('STM32') ||
          port.manufacturer.includes('Silicon Labs') ||
          (port.manufacturer.includes('Microsoft') && port.path === 'COM7'))) {
        // Always include COM port in the device name for clear identification
        let deviceName;
        if (port.manufacturer.includes('Silicon Labs')) {
          deviceName = `FreeEEG32 Optical receiver (${port.path})`;
        } else if (port.manufacturer.includes('Microsoft') && port.path === 'COM7') {
          deviceName = `FreeEEG32 USB (${port.path})`;
        } else {
          deviceName = `FreeEEG32 (${port.path})`;
        }
          
        devices.push({
          id: port.path,
          name: deviceName,
          status: 'available',
          serialPort: port.path,
          details: `${port.manufacturer || ''} (${port.path})`
        });
      }
      // Add other potential matches with lower confidence
      else if (port.vendorId && port.productId) {
        devices.push({
          id: port.path,
          name: `Serial Device (${port.path})`,
          status: 'unknown',
          serialPort: port.path,
          details: `${port.manufacturer || 'Unknown'} (${port.path})`
        });
      }
    }
    
    if (devices.length === 0) {
      log.info('No FreeEEG32 devices found');
    } else {
      log.info(`Found ${devices.length} potential device(s)`);
    }
    
    return devices;
  } catch (error) {
    log.error('Error detecting devices:', error);
    return [];
  }
});

// Global references
let dataVerificationInterval = null;
let brainflowHandler = null;

// Function to log actual data samples from the device
async function verifyDataStream() {
  try {
    if (!brainflowHandler) {
      log.warn('Cannot verify data stream: No active Brainflow handler');
      return;
    }
    
    // Get real data from the connected device
    const data = await brainflowHandler.getSampleData(4, 10); // 4 channels, 10 samples per channel
    
    if (data && Object.keys(data).length > 0) {
      log.info(`Data stream verification - ${new Date().toISOString()}:\n${JSON.stringify(data, null, 2)}`);
    } else {
      log.warn('No data received from device');
    }
  } catch (error) {
    log.error('Error in data verification:', error);
  }
}

ipcMain.handle('connect-device', async (event, deviceId, params) => {
  try {
    log.info(`Connecting to device ${deviceId} with params:`, params);
    
    // Create Brainflow handler if it doesn't exist
    if (!brainflowHandler) {
      brainflowHandler = new BrainflowDataHandler();
    }
    
    // Connect to the actual device
    const connectionConfig = {
      serialPort: deviceId,
      samplingRate: params.samplingRate || 512,
      channelCount: params.channelCount || 32,
      deviceName: params.name || deviceId // Pass device name to determine board type
    };
    
    const result = await brainflowHandler.connect(connectionConfig);
    
    if (result.success) {
      // Start periodic data verification (every 3 seconds)
      if (dataVerificationInterval) {
        clearInterval(dataVerificationInterval);
      }
      dataVerificationInterval = setInterval(verifyDataStream, 3000);
      log.info('Started data stream verification');
      
      return { 
        success: true, 
        message: 'Connected to device successfully',
        config: result.config
      };
    } else {
      return { success: false, message: result.message };
    }
  } catch (error) {
    log.error('Error connecting to device:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('disconnect-device', async () => {
  try {
    log.info('Disconnecting device');
    
    // Stop data verification interval
    if (dataVerificationInterval) {
      clearInterval(dataVerificationInterval);
      dataVerificationInterval = null;
      log.info('Stopped data stream verification');
    }
    
    // Disconnect from Brainflow device
    if (brainflowHandler) {
      const result = await brainflowHandler.disconnect();
      return result;
    }
    
    return { success: true, message: 'Disconnected from device' };
  } catch (error) {
    log.error('Error disconnecting device:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('start-recording', async (event, config) => {
  try {
    isRecording = true;
    recordingStartTime = new Date();
    recordingData = [];
    
    // Store the recording configuration for later use
    recordingConfig = config;
    
    log.info('Starting recording with config:', config);
    // TODO: Implement Brainflow session start
    // This is a placeholder - we'll implement the actual Brainflow code later
    
    updateMenu();
    return { success: true, message: 'Recording started' };
  } catch (error) {
    log.error('Error starting recording:', error);
    return { success: false, message: error.message };
  }
});

// Function to save recording data to a file
function saveRecordingFile(config, options) {
  try {
    // Create a default save location in Documents folder
    // Using a fixed path to avoid dependency on app.getPath
    const documentsPath = path.join(process.env.USERPROFILE || process.env.HOME, 'Documents');
    const saveLocation = config?.saveLocation || path.join(documentsPath, 'ACErec Recordings');
    
    log.info(`Saving recording to: ${saveLocation}`);
    
    // Create the directory if it doesn't exist
    if (!fs.existsSync(saveLocation)) {
      log.info(`Creating directory: ${saveLocation}`);
      fs.mkdirSync(saveLocation, { recursive: true });
    }
    
    // Create a timestamp for the filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const subjectId = config?.subjectId || 'Unknown';
    const recordingId = config?.recordingId || `Recording_${timestamp}`;
    
    // Create a placeholder BDF file (just a text file for now)
    const filePath = path.join(saveLocation, `${subjectId}_${recordingId}.txt`);
    const fileContent = `Placeholder BDF file\nRecording date: ${new Date().toString()}\nFormat: ${options.format || 'BDF'}\nChannels: ${config?.channelCount || 32}\nSampling rate: ${config?.samplingRate || 512} Hz`;
    
    fs.writeFileSync(filePath, fileContent);
    log.info(`File saved to: ${filePath}`);
    
    return { success: true, path: filePath };
  } catch (error) {
    log.error('Error saving recording file:', error);
    return { success: false, error: error.message };
  }
}

ipcMain.handle('stop-recording', async (event, saveOptions) => {
  try {
    if (!isRecording) {
      return { success: false, message: 'No recording in progress' };
    }
    
    isRecording = false;
    log.info('Stopping recording with options:', saveOptions);
    
    // Save the recording data to a file
    const saveResult = saveRecordingFile(recordingConfig, saveOptions);
    
    updateMenu();
    
    if (saveResult.success) {
      return { success: true, message: `Recording stopped and saved to ${saveResult.path}` };
    } else {
      return { success: false, message: `Recording stopped but failed to save: ${saveResult.error}` };
    }
  } catch (error) {
    log.error('Error stopping recording:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    log.info('Saving settings:', settings);
    // TODO: Implement actual settings storage
    // For now, just log and return success
    return { success: true };
  } catch (error) {
    log.error('Error saving settings:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('load-settings', async () => {
  try {
    // TODO: Implement actual settings loading
    // For now, return default settings
    return {
      channelCount: 32,
      autoSave: true,
      defaultSaveLocation: path.join(app.getPath('documents'), 'ACErec Recordings')
    };
  } catch (error) {
    log.error('Error loading settings:', error);
    return null;
  }
});

ipcMain.handle('get-data-chunk', async () => {
  try {
    // Generate some dummy EEG data for testing
    const channels = 32;
    const samples = 512; // Using FreeEEG32's 512 Hz sampling rate
    const data = Array(channels).fill().map(() => 
      Array(samples).fill().map(() => Math.random() * 100 - 50)
    );
    
    return { success: true, data };
  } catch (error) {
    log.error('Error getting data chunk:', error);
    return { success: false, message: error.message, data: null };
  }
});

/**
 * Updates the application menu to reflect the current recording state
 */
function updateMenu() {
  const menu = Menu.getApplicationMenu();
  const recordingMenu = menu.items.find(item => item.label === 'Recording');
  
  if (recordingMenu && recordingMenu.submenu) {
    recordingMenu.submenu.items[0].enabled = !isRecording; // Start Recording
    recordingMenu.submenu.items[1].enabled = isRecording;  // Stop Recording
  }
  
  Menu.setApplicationMenu(menu);
}
