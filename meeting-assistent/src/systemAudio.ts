import { desktopCapturer } from 'electron';
import * as os from 'os';
import type { SystemAudioSource } from './types';

export async function getSystemAudioSource(): Promise<SystemAudioSource> {
  const platform = os.platform();
  const sources = await desktopCapturer.getSources({ types: ['screen'] });

  if (platform === 'win32' || platform === 'linux') {
    const screen = sources.find(
      (s) => s.name === 'Entire Screen' || s.name.toLowerCase().includes('screen')
    );
    return {
      sourceId: screen ? screen.id : (sources[0]?.id ?? null),
      platform,
      supported: true,
    };
  }

  if (platform === 'darwin') {
    return {
      sourceId: sources[0]?.id ?? null,
      platform,
      supported: false,
      guidance:
        'macOS requires BlackHole for system audio. Install from existential.audio/blackhole and set it as your output device.',
    };
  }

  return { sourceId: null, platform, supported: false };
}
