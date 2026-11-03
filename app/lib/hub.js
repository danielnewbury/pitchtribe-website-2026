'use strict';
/* Server-Sent Events hub: pushes "content changed", "identify" and "reload"
   to connected screens so updates appear within a second. */

class Hub {
  constructor() {
    this.clients = new Set();
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) c.res.write(': ping\n\n');
    }, 25_000);
    this.heartbeat.unref();
  }

  add(req, res, screenId) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const client = { res, screenId };
    this.clients.add(client);
    req.on('close', () => this.clients.delete(client));
    return client;
  }

  write(client, event, data) {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`);
  }

  broadcast(event, data) {
    for (const c of this.clients) this.write(c, event, data);
  }

  send(screenId, event, data) {
    let n = 0;
    for (const c of this.clients) {
      if (c.screenId === screenId) {
        this.write(c, event, data);
        n += 1;
      }
    }
    return n;
  }

  isConnected(screenId) {
    for (const c of this.clients) if (c.screenId === screenId) return true;
    return false;
  }

  close() {
    clearInterval(this.heartbeat);
    for (const c of this.clients) c.res.end();
    this.clients.clear();
  }
}

module.exports = { Hub };
