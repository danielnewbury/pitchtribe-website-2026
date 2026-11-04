'use strict';
/* Just enough of the tar format (POSIX ustar) to write and read PitchTribe
   backup files: regular files with short names, nothing else. Used gzipped
   (.tar.gz), so a backup opens in any archive tool too. */
const fs = require('node:fs');

const BLOCK = 512;
const MAX_SIZE = 8 ** 11 - 1; // 11 octal digits: just under 8 GiB per file

function octal(n, width) {
  return `${n.toString(8).padStart(width - 1, '0')}\0`;
}

/** A 512-byte ustar header for a regular file. */
function header(name, size, mtime = new Date()) {
  if (Buffer.byteLength(name) > 100) throw new Error(`name too long for tar: ${name}`);
  if (size > MAX_SIZE) throw new Error(`file too large for tar: ${name}`);
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, 100, 'utf8');
  h.write(octal(0o644, 8), 100, 'ascii');
  h.write(octal(0, 8), 108, 'ascii');
  h.write(octal(0, 8), 116, 'ascii');
  h.write(octal(size, 12), 124, 'ascii');
  h.write(octal(Math.floor(mtime.getTime() / 1000), 12), 136, 'ascii');
  h.write('        ', 148, 'ascii'); // checksum is computed with spaces here
  h.write('0', 156, 'ascii');
  h.write('ustar\0', 257, 'ascii');
  h.write('00', 263, 'ascii');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return h;
}

const padding = (size) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

/**
 * Yields a tar stream of the given entries, chunk by chunk; use it with
 * stream.Readable.from() and pipeline() so backpressure and errors are handled.
 * Each entry is { name, buffer } or { name, file } (a path, read in chunks).
 */
async function* tarChunks(entries) {
  for (const e of entries) {
    if (e.buffer) {
      yield header(e.name, e.buffer.length);
      yield e.buffer;
      yield padding(e.buffer.length);
      continue;
    }
    const { size, mtime } = fs.statSync(e.file);
    yield header(e.name, size, mtime);
    let sent = 0;
    for await (const chunk of size ? fs.createReadStream(e.file, { end: size - 1 }) : []) {
      sent += chunk.length;
      yield chunk;
    }
    if (sent !== size) throw new Error(`${e.name} changed while it was being backed up`);
    yield padding(size);
  }
  yield Buffer.alloc(BLOCK * 2);
}

function parseHeader(h) {
  if (h.every((b) => b === 0)) return null; // end of archive
  const str = (start, len) => h.subarray(start, start + len).toString('utf8').replace(/\0.*$/s, '');
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
  if (parseInt(str(148, 8).trim(), 8) !== sum) throw new Error('This isn’t a PitchTribe backup file (bad tar header)');
  const prefix = str(345, 155);
  const name = prefix ? `${prefix}/${str(0, 100)}` : str(0, 100);
  return { name, size: parseInt(str(124, 12).trim() || '0', 8), type: str(156, 1) || '0' };
}

/**
 * Reads a tar stream (an async iterable of Buffers). For each regular file,
 * calls onEntry(name, size), which returns a path to write it to, or null to
 * skip it. Directories and other entry types are skipped.
 */
async function readTar(input, onEntry) {
  let buf = Buffer.alloc(0);
  let entry = null; // { left, pad, fd }
  let done = false;
  const take = (n) => { const out = buf.subarray(0, n); buf = buf.subarray(n); return out; };
  for await (const chunk of input) {
    if (done) continue;
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (entry) {
        if (entry.left > 0) {
          if (!buf.length) break;
          const part = take(Math.min(entry.left, buf.length));
          if (entry.fd !== null) fs.writeSync(entry.fd, part);
          entry.left -= part.length;
          if (entry.left > 0) break;
        }
        if (buf.length < entry.pad) break;
        take(entry.pad);
        if (entry.fd !== null) fs.closeSync(entry.fd);
        entry = null;
      }
      if (buf.length < BLOCK) break;
      const h = parseHeader(take(BLOCK));
      if (!h) { done = true; break; }
      const target = h.type === '0' ? onEntry(h.name, h.size) : null;
      entry = { left: h.size, pad: padding(h.size).length, fd: target ? fs.openSync(target, 'w') : null };
    }
  }
  if (entry) {
    if (entry.fd !== null) fs.closeSync(entry.fd);
    throw new Error('The backup file is incomplete — it may not have finished downloading');
  }
  if (!done) throw new Error('The backup file is incomplete — it may not have finished downloading');
}

module.exports = { tarChunks, readTar };
