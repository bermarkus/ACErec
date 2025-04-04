/**
 * ACErec - Preload Script
 * Exposes a safe API to the renderer process via contextBridge
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'api', {
    // Device management
    getDevices: () => ipcRenderer.invoke('get-devices'),
    connectDevice: (deviceId, params) => ipcRenderer.invoke('connect-device', deviceId, params),
    disconnectDevice: () => ipcRenderer.invoke('disconnect-device'),
    
    // Recording controls
    startRecording: (config) => ipcRenderer.invoke('start-recording', config),
    stopRecording: (saveOptions) => ipcRenderer.invoke('stop-recording', saveOptions),
    
    // Configuration
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    loadSettings: () => ipcRenderer.invoke('load-settings'),
    
    // Data visualization
    getDataChunk: () => ipcRenderer.invoke('get-data-chunk'),
    
    // Event listeners
    on: (channel, callback) => {
      // Whitelist channels we are allowed to listen to
      const validChannels = [
        'device-data', 
        'recording-status', 
        'device-status',
        'open-settings',
        'open-about',
        'recording-action'
      ];
      
      if (validChannels.includes(channel)) {
        // Deliberately strip event as it includes `sender`
        const subscription = (event, ...args) => callback(...args);
        ipcRenderer.on(channel, subscription);
        
        // Return a function to remove this event listener
        return () => {
          ipcRenderer.removeListener(channel, subscription);
        };
      }
      
      return null;
    }
  }
);
