'use strict';
/**
 * Minimal RFC 6455 WebSocket server (text frames only) so the project needs no npm packages.
 * Usage: attach(httpServer, (conn, req) => { conn.onmessage = str => ...; conn.onclose = () => ...; conn.send(str) })
 */
const crypto = require('crypto');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 1 << 20; // 1 MB

class Conn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frag = [];
    this.closed = false;
    this.alive = true;
    this.onmessage = null;
    this.onclose = null;
    socket.setNoDelay(true);
    socket.on('data', (d) => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  send(str) {
    if (this.closed) return;
    this._frame(0x1, Buffer.from(str));
  }

  _frame(op, payload) {
    const len = payload.length;
    let header;
    if (len < 126) header = Buffer.from([0x80 | op, len]);
    else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | op; header[1] = 126; header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | op; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
    }
    try { this.socket.write(Buffer.concat([header, payload])); } catch { /* socket gone */ }
  }

  ping() { this._frame(0x9, Buffer.alloc(0)); }

  close(code = 1000) {
    if (this.closed) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code);
    this._frame(0x8, p);
    this.socket.end();
    this._closed();
  }

  _closed() {
    if (this.closed) return;
    this.closed = true;
    try { this.socket.destroy(); } catch { /* ignore */ }
    if (this.onclose) this.onclose();
  }

  _data(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = !!(b0 & 0x80), op = b0 & 0x0f, masked = !!(b1 & 0x80);
      let len = b1 & 0x7f, off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2)); off = 10;
      }
      if (len > MAX_PAYLOAD) return this.close(1009);
      if (!masked) return this.close(1002); // clients must mask
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      this._handle(fin, op, payload);
    }
  }

  _handle(fin, op, payload) {
    if (op === 0x8) return this.close();
    if (op === 0x9) return this._frame(0xA, payload);
    if (op === 0xA) { this.alive = true; return; }
    if (op === 0x1 || op === 0x0) {
      if (op === 0x1) this.frag = [];
      this.frag.push(payload);
      if (fin) {
        const msg = Buffer.concat(this.frag).toString('utf8');
        this.frag = [];
        if (this.onmessage) this.onmessage(msg);
      }
    }
  }
}

function attach(server, onconn, path = '/ws') {
  server.on('upgrade', (req, socket) => {
    const url = (req.url || '').split('?')[0];
    const key = req.headers['sec-websocket-key'];
    if (url !== path || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key) {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    const conn = new Conn(socket);
    onconn(conn, req);
  });

  // Heartbeat: drop connections that stop answering pings.
  const timer = setInterval(() => {
    server.emit('ws-heartbeat');
  }, 20000);
  timer.unref();
}

module.exports = { attach };
