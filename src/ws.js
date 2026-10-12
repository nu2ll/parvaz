'use strict';
// Minimal RFC 6455 WebSocket server implementation (no dependencies).
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const config = require('./config');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_BUFFERED = 4 * 1024 * 1024; // drop clients that stop reading

class WebSocketConnection extends EventEmitter {
  constructor(socket, head) {
    super();
    this.socket = socket;
    this.buffer = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
    this.fragments = [];
    this.fragOpcode = 0;
    this.fragSize = 0;
    this.closed = false;
    this.done = false;
    this.isAlive = true;

    socket.setNoDelay(true);
    socket.setTimeout(0);
    socket.on('data', (chunk) => {
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
      this._parse();
    });
    socket.on('close', () => this._finish());
    socket.on('error', () => this._finish());
    if (this.buffer.length) setImmediate(() => this._parse());
  }

  _parse() {
    while (!this.closed) {
      const buf = this.buffer;
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const rsv = buf[0] & 0x70;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let offset = 2;

      if (rsv) return this.close(1002);
      if (!masked) return this.close(1002); // clients MUST mask
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(config.limits.wsFrameBytes)) return this.close(1009);
        len = Number(big);
        offset = 10;
      }
      if (len > config.limits.wsFrameBytes) return this.close(1009);
      if (buf.length < offset + 4 + len) return;

      const mask = buf.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(buf.subarray(offset, offset + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buffer = buf.subarray(offset + len);
      this._frame(fin, opcode, payload);
    }
  }

  _frame(fin, opcode, payload) {
    if (opcode >= 0x8) {
      if (!fin || payload.length > 125) return this.close(1002);
      if (opcode === 0x8) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
        return this.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000);
      }
      if (opcode === 0x9) return this._write(0xa, payload);
      if (opcode === 0xa) { this.isAlive = true; return; }
      return this.close(1002);
    }

    if (opcode === 0x0) {
      if (!this.fragOpcode) return this.close(1002);
    } else {
      if (this.fragOpcode || (opcode !== 0x1 && opcode !== 0x2)) return this.close(1002);
      this.fragOpcode = opcode;
    }
    this.fragments.push(payload);
    this.fragSize += payload.length;
    if (this.fragSize > config.limits.wsFrameBytes) return this.close(1009);
    if (!fin) return;

    const data = this.fragments.length === 1 ? this.fragments[0] : Buffer.concat(this.fragments);
    const op = this.fragOpcode;
    this.fragments = [];
    this.fragOpcode = 0;
    this.fragSize = 0;
    this.isAlive = true;
    if (op === 0x1) this.emit('message', data.toString('utf8'));
    else this.emit('binary', data);
  }

  _write(opcode, payload) {
    if (this.closed || this.socket.destroyed) return;
    if (this.socket.writableLength > MAX_BUFFERED) return this.terminate();
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    this.socket.write(Buffer.concat([header, payload]));
  }

  send(data) {
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    this._write(0x1, Buffer.from(text, 'utf8'));
  }

  ping() {
    this.isAlive = false;
    this._write(0x9, Buffer.alloc(0));
  }

  close(code = 1000) {
    if (this.closed) return;
    const p = Buffer.alloc(2);
    p.writeUInt16BE(code);
    this._write(0x8, p);
    this.closed = true;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 2000).unref();
    this._finish();
  }

  terminate() {
    this.closed = true;
    this.socket.destroy();
    this._finish();
  }

  _finish() {
    if (this.done) return;
    this.done = true;
    this.closed = true;
    this.emit('close');
  }
}

function rejectUpgrade(socket, status, text) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function acceptUpgrade(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  if (req.method !== 'GET' || upgrade !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') {
    rejectUpgrade(socket, 400, 'Bad Request');
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  return new WebSocketConnection(socket, head);
}

module.exports = { acceptUpgrade, rejectUpgrade, WebSocketConnection };
