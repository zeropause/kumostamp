/**
 * Minimal Discord Rich Presence client over the local IPC socket.
 *
 * Discord exposes a named pipe (Windows) or socket (macOS/Linux) and speaks a tiny
 * framed JSON protocol: a uint32 opcode, a uint32 payload length, then the JSON.
 * The connection must stay open for the presence to stay visible, so this class
 * reconnects on its own and re-applies the last activity once Discord is back.
 */
import net from "node:net";
import { randomUUID } from "node:crypto";

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

/** Every place Discord's IPC socket may live, most common first. */
export function socketCandidates() {
  const out = [];
  if (process.platform === "win32") {
    for (let i = 0; i < 10; i++) out.push(`\\\\.\\pipe\\discord-ipc-${i}`);
    return out;
  }
  const base = (process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || "/tmp").replace(/\/+$/, "");
  for (let i = 0; i < 10; i++) {
    out.push(`${base}/discord-ipc-${i}`);
    out.push(`${base}/app/com.discordapp.Discord/discord-ipc-${i}`);
    out.push(`${base}/snap.discord/discord-ipc-${i}`);
  }
  return out;
}

function connectPipe(path) {
  return new Promise((resolve) => {
    const sock = net.connect(path);
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.removeListener("connect", onConnect);
      sock.removeListener("error", onError);
      if (ok) resolve(sock);
      else {
        sock.destroy();
        resolve(null);
      }
    };
    const onConnect = () => finish(true);
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), 1200);
    sock.once("connect", onConnect);
    sock.once("error", onError);
  });
}

export class DiscordRpc {
  constructor({ clientId, log = () => {}, fallback = null }) {
    this.clientId = clientId;
    this.log = log;
    this.fallback = fallback;
    this.sock = null;
    this.buffer = Buffer.alloc(0);
    this.state = "idle"; // idle | connecting | connected
    this.ready = null;
    this.lastActivity = undefined; // undefined = never sent, null = cleared
    this.pending = new Map();
    this.retry = 0;
    this.timer = null;
    this.stopped = false;
  }

  status() {
    return this.state;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.sock) this.sock.destroy();
  }

  async connect() {
    if (this.stopped || this.sock || this.state === "connecting") return;
    this.state = "connecting";
    for (const path of socketCandidates()) {
      const sock = await connectPipe(path);
      if (!sock) continue;
      this.attach(sock);
      try {
        await this.handshake();
        this.state = "connected";
        this.retry = 0;
        this.log(`discord connected (${this.ready ? this.ready.username : "unknown user"})`);
        if (this.lastActivity !== undefined) await this.apply(this.lastActivity).catch(() => {});
        return;
      } catch (e) {
        this.log(`discord handshake failed: ${e.message}`);
        sock.destroy();
        this.detach();
      }
    }
    this.state = "idle";
    this.scheduleRetry();
  }

  attach(sock) {
    this.sock = sock;
    this.buffer = Buffer.alloc(0);
    sock.on("data", (chunk) => this.onData(chunk));
    sock.on("error", () => {});
    sock.on("close", () => this.onClose());
  }

  detach() {
    this.sock = null;
    this.buffer = Buffer.alloc(0);
  }

  onClose() {
    clearTimeout(this.readyTimer);
    this.detach();
    this.state = "idle";
    for (const [, p] of this.pending) p.reject(new Error("Discord disconnected"));
    this.pending.clear();
    if (!this.stopped) this.scheduleRetry();
  }

  scheduleRetry() {
    clearTimeout(this.timer);
    const wait = Math.min(30000, 5000 * 2 ** Math.min(this.retry++, 3));
    this.timer = setTimeout(() => this.connect(), wait);
  }

  handshake() {
    return new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.readyTimer = setTimeout(() => reject(new Error("Discord did not answer the handshake")), 5000);
      this.write(OP_HANDSHAKE, { v: 1, client_id: this.clientId });
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const op = this.buffer.readUInt32LE(0);
      const len = this.buffer.readUInt32LE(4);
      if (this.buffer.length < 8 + len) break;
      const raw = this.buffer.subarray(8, 8 + len).toString("utf8");
      this.buffer = this.buffer.subarray(8 + len);
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (_) {
        continue;
      }
      this.onMessage(op, msg);
    }
  }

  onMessage(op, msg) {
    if (op === OP_PING) {
      this.write(OP_PONG, msg);
      return;
    }
    if (op === OP_CLOSE) {
      if (this.sock) this.sock.end();
      return;
    }
    if (op !== OP_FRAME) return;

    if (msg.cmd === "DISPATCH" && msg.evt === "READY") {
      this.ready = (msg.data && msg.data.user) || null;
      clearTimeout(this.readyTimer);
      if (this.readyResolve) this.readyResolve();
      this.readyResolve = null;
      this.readyReject = null;
      return;
    }

    if (!msg.nonce || !this.pending.has(msg.nonce)) return;
    const p = this.pending.get(msg.nonce);
    this.pending.delete(msg.nonce);
    if (msg.evt === "ERROR") p.reject(new Error((msg.data && msg.data.message) || "Discord rejected the activity"));
    else p.resolve(msg.data);
  }

  write(op, payload) {
    if (!this.sock) return false;
    const data = Buffer.from(JSON.stringify(payload), "utf8");
    const head = Buffer.alloc(8);
    head.writeUInt32LE(op, 0);
    head.writeUInt32LE(data.length, 4);
    this.sock.write(Buffer.concat([head, data]));
    return true;
  }

  request(payload) {
    return new Promise((resolve, reject) => {
      const nonce = randomUUID();
      this.pending.set(nonce, { resolve, reject });
      if (!this.write(OP_FRAME, Object.assign({}, payload, { nonce }))) {
        this.pending.delete(nonce);
        reject(new Error("Discord is not connected"));
        return;
      }
      setTimeout(() => {
        if (this.pending.delete(nonce)) reject(new Error("Discord did not answer"));
      }, 10000);
    });
  }

  /**
   * Send (or queue) an activity. Queued activities are re-applied after a reconnect.
   * `fallback(activity)` may return progressively simpler candidates; each is tried
   * in turn so one unsupported field does not cost the whole presence.
   */
  async setActivity(activity) {
    this.lastActivity = activity;
    if (this.state !== "connected") return { queued: true };
    const extra = this.fallback ? this.fallback(activity) : null;
    const candidates = [activity].concat(Array.isArray(extra) ? extra : extra ? [extra] : []);

    let failure = null;
    let previous = null;
    for (const candidate of candidates) {
      const json = JSON.stringify(candidate);
      if (json === previous) continue; // a fallback that changed nothing
      previous = json;
      try {
        const result = await this.request({ cmd: "SET_ACTIVITY", args: { pid: process.pid, activity: candidate } });
        this.lastActivity = candidate;
        return result;
      } catch (e) {
        failure = e;
      }
    }
    throw failure || new Error("Discord rejected the activity");
  }

  clearActivity() {
    this.lastActivity = null;
    if (this.state !== "connected") return { queued: true };
    return this.request({ cmd: "SET_ACTIVITY", args: { pid: process.pid } }).catch(() => null);
  }

  apply(activity) {
    return activity ? this.setActivity(activity) : Promise.resolve(this.clearActivity());
  }
}
