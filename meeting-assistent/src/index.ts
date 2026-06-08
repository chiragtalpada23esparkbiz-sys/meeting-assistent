import { app, BrowserWindow, systemPreferences, dialog } from 'electron';
import { setupIpcHandlers } from './ipc';
import { startLocalRelay } from './localRelay';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (require('electron-squirrel-startup')) app.quit();

async function requestPermissions(): Promise<void> {
  if (process.platform !== 'darwin') return;

  const micStatus = systemPreferences.getMediaAccessStatus('microphone');
  if (micStatus !== 'granted') {
    await systemPreferences.askForMediaAccess('microphone');
  }

  const screenStatus = systemPreferences.getMediaAccessStatus('screen');
  if (screenStatus !== 'granted') {
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'Screen Recording Permission Required',
      message: 'Meeting Assistant needs Screen Recording permission to capture system audio.',
      detail:
        'Go to System Preferences → Security & Privacy → Screen Recording, enable Meeting Assistant, then restart the app.',
      buttons: ['OK'],
    });
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 420,
    height: 600,
    minWidth: 360,
    minHeight: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    resizable: true,
    focusable: false,
    // On Linux, hints to the WM that this is a floating utility — some X11 screen recorders skip toolbar-type windows
    ...(process.platform === 'linux' && { type: 'toolbar' as const }),
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      experimentalFeatures: true,
    },
  });

  // Exclude from screen capture — WDA_EXCLUDEFROMCAPTURE (Windows), NSWindowSharingNone (macOS)
  // On Linux this is a no-op — OS doesn't support it
  mainWindow.setContentProtection(true);

  // Keep above all other windows including screen share overlays
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  // Stay visible when the meeting app moves to a different workspace or goes fullscreen
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // macOS: hide from Mission Control so it doesn't appear in workspace previews
  if (process.platform === 'darwin') {
    mainWindow.setHiddenInMissionControl(true);
  }


  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(async () => {
  await requestPermissions();
  startLocalRelay();
  setupIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
