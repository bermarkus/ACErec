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

// Configure logging
log.transports.file.level = 'info';
log.info('Application starting...');

// Keep a global reference of the window object to prevent garbage collection
let mainWindow;

// Track recording state
let isRecording = false;
let recordingStartTime = null;
let recordingData = [];

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
    // TODO: Implement Brainflow device detection here
    // This is a placeholder - we'll implement the actual Brainflow code later
    return [
      { id: 1, name: 'FreeEEG32', status: 'available' }
    ];
  } catch (error) {
    log.error('Error detecting devices:', error);
    return [];
  }
});

ipcMain.handle('start-recording', async (event, config) => {
  try {
    isRecording = true;
    recordingStartTime = new Date();
    recordingData = [];
    
    // TODO: Implement Brainflow session start
    // This is a placeholder - we'll implement the actual Brainflow code later
    
    updateMenu();
    return { success: true, message: 'Recording started' };
  } catch (error) {
    log.error('Error starting recording:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('stop-recording', async (event, saveOptions) => {
  try {
    if (!isRecording) {
      return { success: false, message: 'No recording in progress' };
    }
    
    isRecording = false;
    
    // TODO: Implement Brainflow session stop and BDF saving
    // This is a placeholder - we'll implement the actual BDF saving code later
    
    updateMenu();
    return { success: true, message: 'Recording stopped and saved' };
  } catch (error) {
    log.error('Error stopping recording:', error);
    return { success: false, message: error.message };
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
