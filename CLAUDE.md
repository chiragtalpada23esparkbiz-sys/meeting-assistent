# Meeting Assistant — CLAUDE.md

## What this project is

A real-time AI meeting copilot built as a cross-platform Electron desktop app. It captures microphone and system audio simultaneously, streams both to AssemblyAI for live transcription with speaker separation, then uses Claude to generate contextual suggestions (interview answers, sales responses) based on what the other person just said. The app window is always-on-top and invisible during screen share.

---

## Repository layout

```
Meeting-tracker/
└── meeting-assistent/          # Electron app (main project)
    ├── src/
    │   ├── index.ts            # Main process entry — creates window, starts relay, registers IPC
    │   ├── ipc.ts              # All IPC handlers; routes transcript events to renderer + extension
    │   ├── preload.ts          # contextBridge — exposes window.electronAPI to renderer
    │   ├── renderer.ts         # Renderer process — UI, recording controls, transcript display
    │   ├── recorder.ts         # MeetingRecorder class — captures mic + system audio
    │   ├── audioMixer.ts       # PCM streaming + WAV encoding utilities
    │   ├── assemblyai.ts       # Two AssemblyAI streaming sessions (mic=A, system=B)
    │   ├── assistantManager.ts # Claude streaming completions + assistant plugin dispatch
    │   ├── localRelay.ts       # WebSocket server (port 5000) — relays transcripts to extension
    │   ├── systemAudio.ts      # Platform-specific system audio source detection
    │   ├── uploader.ts         # HTTP POST final WAV + WS chunk streaming to external server
    │   ├── types.ts            # Shared TypeScript interfaces
    │   ├── global.d.ts         # window.electronAPI type declarations
    │   ├── assistants/
    │   │   ├── types.ts        # AssistantPlugin interface + Turn type
    │   │   ├── index.ts        # ASSISTANTS registry
    │   │   ├── interview.ts    # Interview assistant — detects questions from interviewer
    │   │   └── sales.ts        # Sales assistant — detects objections from prospects
    │   ├── index.html          # Renderer HTML shell
    │   └── index.css           # App styles
    ├── chrome-extension/       # Companion Chrome extension (Manifest V3)
    │   ├── manifest.json       # Declares sidePanel + Google Meet host permission
    │   ├── background.js       # Opens side panel on Meet tabs
    │   ├── sidepanel.html      # Extension side panel UI
    │   ├── sidepanel.js        # Connects to ws://localhost:5000, renders transcript
    │   └── sidepanel.css
    ├── transcription-server/   # DELETED — was a faster-whisper fallback, replaced by AssemblyAI
    ├── recordings/             # WAV files saved locally (gitignored)
    ├── .env                    # ASSEMBLYAI_API_KEY + ANTHROPIC_API_KEY (never commit)
    ├── forge.config.ts         # Electron Forge packaging config
    ├── webpack.main.config.ts
    ├── webpack.renderer.config.ts
    ├── package.json
    └── tsconfig.json
```

---

## Architecture and data flow

### Recording pipeline

```
Microphone ──────► createPcmStreamer ──► sendMicPcm (IPC) ──► AssemblyAI session A (speaker="A")
                 ├──► MediaRecorder (mixed stream) ──► WAV chunks ──► final upload

System Audio ────► createPcmStreamer ──► sendSystemPcm (IPC) ──► AssemblyAI session B (speaker="B")
(desktop capture) └──► mixed into MediaRecorder above
```

### Transcription + AI suggestion pipeline

```
AssemblyAI turn event
  └─► transcriptEvents EventEmitter (assemblyai.ts)
        └─► ipc.ts listener
              ├─► win.webContents.send('transcript-update')  ──► renderer.ts (live display)
              ├─► broadcastToExtension()  ──► localRelay.ts  ──► Chrome extension
              └─► safeProcess(speaker, text)
                    └─► assistantManager.processTurn()
                          └─► activeAssistant.shouldRespond() → if true:
                                └─► Claude streaming (claude-opus-4-5, max_tokens=300)
                                      ├─► 'suggestion-start' IPC
                                      ├─► 'suggestion-chunk' IPC (streamed)
                                      └─► 'suggestion-done' IPC
```

### Speaker assignment (hardcoded)
- **Speaker A** = microphone = "You" in the UI
- **Speaker B** = system audio (desktop capture) = "Interviewer" or "Prospect" depending on mode

### Local relay
`localRelay.ts` runs a WebSocket server on `ws://127.0.0.1:5000`. The Chrome extension connects to it and receives the same transcript messages. This lets the transcript appear in Google Meet's side panel while the Electron window is hidden from screen share.

---

## Key design decisions

**Two separate AssemblyAI sessions** — one for mic, one for system audio — instead of a mixed stream. This gives clean per-speaker transcripts without diarization, since the audio sources are already separated at capture time.

**Debounce fallback on partial transcripts** — `ipc.ts` waits 800ms after the last partial from speaker B before treating it as final. This catches questions when `end_of_turn` fires late from AssemblyAI.

**Deduplication via `lastProcessedText`** — identical normalized turns are not re-sent to the assistant. Reset via `reset-last-question` IPC when the user clicks "Got it".

**Content protection + always-on-top** — `mainWindow.setContentProtection(true)` excludes the window from screen capture. `setAlwaysOnTop(true, 'screen-saver')` keeps it visible above meeting overlays.

**No markdown in assistant prompts** — interview assistant explicitly requests plain text output. Renderer does its own lightweight markdown rendering (`renderMarkdown()`) from the buffered full response, not per-chunk, so markdown across chunk boundaries renders correctly.

---

## Assistant plugin system

Each assistant implements `AssistantPlugin` (`src/assistants/types.ts`):

```typescript
interface AssistantPlugin {
  id: string;
  name: string;
  description: string;
  shouldRespond(turn: Turn, history: Turn[], mySpeaker: string): boolean;
  buildPrompt(turn: Turn, history: Turn[]): string;
  systemPrompt: string;
}
```

Add a new assistant by implementing this interface and registering it in `src/assistants/index.ts` ASSISTANTS array.

**Interview assistant** — responds only when speaker B asks a question (matched by regex patterns: `?`, `tell me`, `describe`, `what/how/why`, etc.). Uses STAR-method coaching prompt. 3–5 sentences max.

**Sales assistant** — responds only when speaker B triggers objection patterns (pricing, competitors, hesitation). Consultative tone, value-focused.

---

## Environment variables

All keys live in `meeting-assistent/.env`. Never commit this file.

| Variable | Purpose |
|---|---|
| `ASSEMBLYAI_API_KEY` | AssemblyAI streaming transcription |
| `ANTHROPIC_API_KEY` | Claude API (claude-opus-4-5) |
| `SERVER_URL` | HTTP upload endpoint (default: `http://localhost:4000`) |
| `WS_URL` | WebSocket chunk streaming endpoint (default: `ws://localhost:4000`) |

---

## Development

```bash
cd meeting-assistent
npm install
npm start          # electron-forge start (dev mode, opens DevTools detached)
```

On first run on macOS: the app will prompt for microphone permission and show a dialog for Screen Recording permission (required for system audio). On Linux/Windows: system audio capture works via `chromeMediaSource: 'desktop'` without extra setup.

**macOS system audio note**: macOS does not natively expose system audio to `desktopCapturer`. The guidance shown to users is to install [BlackHole](https://existential.audio/blackhole) as a loopback device.

---

## Build / package

```bash
npm run make       # builds distributable for current platform
npm run package    # packages without creating installer
```

Targets: Windows (Squirrel), macOS (ZIP), Linux (DEB, RPM). ASAR packaging enabled with Electron Fuses hardening.

---

## Chrome extension

Load unpacked from `meeting-assistent/chrome-extension/` in Chrome (developer mode). The extension:
- Auto-opens a side panel when you navigate to `meet.google.com`
- Connects to `ws://localhost:5000` (the local relay in the Electron app)
- Displays the live transcript (speaker-labeled) in the side panel
- Reconnects automatically every 2 seconds if the Electron app is not running

---

## IPC surface (preload.ts → main process)

| Channel | Direction | Purpose |
|---|---|---|
| `get-system-audio-source` | renderer → main | Get desktop capture source ID + platform guidance |
| `get-audio-sources` | renderer → main | List all screen/window sources |
| `upload-final` | renderer → main | POST final WAV to server |
| `start-deepgram` | renderer → main | Open two AssemblyAI sessions |
| `send-mic-pcm` | renderer → main | Stream mic PCM chunk |
| `send-system-pcm` | renderer → main | Stream system audio PCM chunk |
| `stop-deepgram` | renderer → main | Close AssemblyAI sessions |
| `get-assistants` | renderer → main | List registered assistants |
| `get-active-assistant` | renderer → main | Get current assistant id |
| `set-assistant` | renderer → main | Switch active assistant + reset history |
| `reset-assistant` | renderer → main | Clear conversation history |
| `reset-last-question` | renderer → main | Clear dedup state for next question |
| `transcript-update` | main → renderer | Live transcript message `{type, text, speaker}` |
| `suggestion-start` | main → renderer | AI response beginning `{question}` |
| `suggestion-chunk` | main → renderer | Streamed text delta from Claude |
| `suggestion-done` | main → renderer | AI response complete |
| `suggestion-error` | main → renderer | Error string from Claude |
