// Gauntlet divergence #1: WebSocketClient uses the standard WebSocket API
// (works in Node and Bun) rather than upstream's `http.request` + hand-rolled
// frame parser. Required for Bun. The public API (`on/connect/send/close/
// isConnected`) matches upstream's, so callers don't need to know which
// backend is in use.
//
// When syncing from upstream, preserve this class body verbatim — upstream
// rarely touches `lib/websocket-client.js`, and any change should be
// audited against Bun compatibility before being ported.
class WebSocketClient {
  constructor(url) {
    this.url = url;
    this.callbacks = {};
    this.ws = null;
    this.connected = false;
  }

  on(event, callback) {
    this.callbacks[event] = callback;
  }

  isConnected() {
    return this.connected && this.ws !== null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.addEventListener('open', () => {
        this.connected = true;
        if (this.callbacks.open) this.callbacks.open();
        resolve();
      });

      this.ws.addEventListener('message', (event) => {
        if (this.callbacks.message) {
          const data = typeof event.data === 'string' ? event.data : event.data.toString('utf8');
          this.callbacks.message(data);
        }
      });

      this.ws.addEventListener('error', (event) => {
        this.connected = false;
        if (this.callbacks.error) this.callbacks.error(event);
        reject(event);
      });

      this.ws.addEventListener('close', () => {
        this.connected = false;
        if (this.callbacks.close) this.callbacks.close();
      });
    });
  }

  send(data) {
    if (!this.ws || !this.connected) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(data);
  }

  close() {
    this.connected = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

module.exports = { WebSocketClient };
