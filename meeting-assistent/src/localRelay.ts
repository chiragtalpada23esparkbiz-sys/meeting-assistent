import { WebSocketServer, WebSocket } from 'ws';

const PORT = 5000;
const clients = new Set<WebSocket>();

export function startLocalRelay(): void {
  const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[Relay] Chrome extension connected — total: ${clients.size}`);
    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[Relay] Extension disconnected — total: ${clients.size}`);
    });
  });

  wss.on('error', (err) => console.error('[Relay] Error:', err.message));
  console.log(`[Relay] Local relay started on ws://127.0.0.1:${PORT}`);
}

export function broadcastToExtension(msg: { type: string; text?: string }): void {
  if (clients.size === 0) return;
  const data = JSON.stringify(msg);
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}
