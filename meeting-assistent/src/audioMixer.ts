export interface PcmStreamer {
  stop: () => void;
}

/**
 * Taps raw 16-bit PCM from a MediaStream and fires onPcmChunk for each buffer.
 * Used to stream audio to Deepgram in real-time.
 */
export function createPcmStreamer(
  stream: MediaStream,
  onPcmChunk: (buffer: ArrayBuffer) => void
): PcmStreamer {
  const ctx = new AudioContext({ sampleRate: 16000 });
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);

  let chunksSent = 0;
  processor.onaudioprocess = (e) => {
    const float32 = e.inputBuffer.getChannelData(0);
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    chunksSent++;
    if (chunksSent <= 3) console.log(`[PCM] chunk #${chunksSent} — ${int16.byteLength} bytes`);
    onPcmChunk(int16.buffer.slice(0));
  };

  // Resume in case AudioContext starts suspended
  ctx.resume();

  // Connect through a silent gain so audio isn't played through speakers
  const silent = ctx.createGain();
  silent.gain.value = 0;
  source.connect(processor);
  processor.connect(silent);
  silent.connect(ctx.destination);

  return {
    stop: () => {
      processor.disconnect();
      source.disconnect();
      silent.disconnect();
      ctx.close();
    },
  };
}

export interface AudioMixResult {
  mixedStream: MediaStream;
  stop: () => void;
}

export async function createAudioMix(
  micStream: MediaStream | null,
  systemStream: MediaStream | null
): Promise<AudioMixResult> {
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const destination = audioContext.createMediaStreamDestination();
  const nodes: AudioNode[] = [];

  if (micStream) {
    const micSource = audioContext.createMediaStreamSource(micStream);
    const micGain = audioContext.createGain();
    micGain.gain.value = 1.0;
    micSource.connect(micGain).connect(destination);
    nodes.push(micSource, micGain);
  }

  if (systemStream) {
    const sysSource = audioContext.createMediaStreamSource(systemStream);
    const sysGain = audioContext.createGain();
    sysGain.gain.value = 0.8;
    sysSource.connect(sysGain).connect(destination);
    nodes.push(sysSource, sysGain);
  }

  return {
    mixedStream: destination.stream,
    stop: () => {
      nodes.forEach((n) => n.disconnect());
      audioContext.close();
    },
  };
}

export async function chunksToWav(chunks: ArrayBuffer[]): Promise<ArrayBuffer> {
  const blob = new Blob(chunks, { type: 'audio/webm;codecs=opus' });
  const arrayBuffer = await blob.arrayBuffer();

  try {
    const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
      const ctx = new AudioContext();
      ctx.decodeAudioData(arrayBuffer.slice(0), (buf) => {
        ctx.close();
        resolve(buf);
      }, reject);
    });
    return audioBufferToWav(decoded);
  } catch {
    // fallback: return the raw webm if WAV conversion fails
    return arrayBuffer;
  }
}

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const sampleRate = buffer.sampleRate;
  const numChannels = 1;
  const bitDepth = 16;

  // Downmix to mono
  let samples: Float32Array;
  if (buffer.numberOfChannels === 1) {
    samples = buffer.getChannelData(0);
  } else {
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    samples = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) samples[i] = (left[i] + right[i]) / 2;
  }

  const dataLength = samples.length * 2;
  const wav = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wav);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);                                    // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return wav;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
