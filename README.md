# ACErec

An Electron-based EEG acquisition application for FreeEEG32 devices, with BDF export capabilities.

## Overview

ACErec allows you to:
- Connect to FreeEEG32 devices using the Brainflow library
- Record EEG data with configurable parameters
- Save recordings in BioSemi Data Format (BDF) files
- Visualize EEG data in real-time
- Run as a desktop application on both Windows and macOS

## Project Structure

```
ACErec/
├── src/
│   ├── main.js            # Electron main process
│   ├── preload.js         # Secure preload script for IPC
│   ├── data/
│   │   ├── BDFWriter.js   # BDF file format writer
│   │   └── BrainflowDataHandler.js  # Brainflow integration
│   └── renderer/          # Frontend UI
│       ├── index.html     # Main application window
│       ├── css/
│       │   └── styles.css # Application styling
│       └── js/
│           └── renderer.js # UI logic and event handling
└── package.json           # Project configuration
```

## Prerequisites

- Node.js (v14 or newer)
- npm (v6 or newer)
- Python (for Brainflow compilation)

## Installation

1. Clone this repository:
```
git clone https://github.com/username/ACErec.git
cd ACErec
```

2. Install dependencies:
```
npm install
```

## Development

To start the application in development mode:

```
npm run dev
```

## Building

To build installers for your current platform:

```
npm run build
```

For specific platforms:

```
npm run build:win  # Windows
npm run build:mac  # macOS
```

## Using ACErec

1. **Connect to Device**:
   - Select your FreeEEG32 device from the dropdown
   - Configure the sampling rate
   - Click "Connect"

2. **Record Data**:
   - Enter subject ID and recording ID
   - Select a save location
   - Click "Start Recording"
   - When finished, click "Stop Recording"

3. **Configuration**:
   - Adjust channel count in Settings
   - Set default save location
   - Configure auto-save options

## Technology Stack

- **Electron**: Cross-platform desktop application framework
- **Brainflow**: Brain-computer interface library
- **Node.js**: JavaScript runtime
- **BDFWriter**: Custom module for BDF file generation

## Extending ACErec

The application is designed to be modular, allowing you to:

1. Add support for additional EEG devices by extending the BrainflowDataHandler
2. Implement additional file formats by creating writers similar to BDFWriter
3. Enhance visualization by integrating charting libraries in the renderer process

## License

MIT
