import { Socket } from "node:net";
import { resolveSrv } from "node:dns/promises";
import type { ServerStatus } from "../shared/types";

const DEFAULT_PORT = 25565;
const TIMEOUT_MS = 4000;

function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let current = value;

  do {
    let byte = current & 0x7f;
    current >>>= 7;
    if (current !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (current !== 0);

  return Buffer.from(bytes);
}

function writeString(value: string): Buffer {
  const payload = Buffer.from(value, "utf8");
  return Buffer.concat([writeVarInt(payload.length), payload]);
}

function packet(id: number, payload: Buffer): Buffer {
  const body = Buffer.concat([writeVarInt(id), payload]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

function readVarInt(buffer: Buffer, offset: number): { value: number; size: number } | null {
  let value = 0;
  let size = 0;

  while (true) {
    if (offset + size >= buffer.length) return null;
    const byte = buffer[offset + size];
    value |= (byte & 0x7f) << (7 * size);
    size += 1;
    if ((byte & 0x80) === 0) break;
    if (size > 5) return null;
  }

  return { value, size };
}

function flattenMotd(description: unknown): string {
  if (typeof description === "string") return description;

  if (description && typeof description === "object") {
    const node = description as { text?: string; extra?: unknown[]; translate?: string };
    const own = node.text ?? node.translate ?? "";
    const extra = Array.isArray(node.extra) ? node.extra.map((child) => flattenMotd(child)).join("") : "";
    return `${own}${extra}`;
  }

  return "";
}

async function resolveAddress(address: string): Promise<{ host: string; port: number }> {
  const [rawHost, rawPort] = address.split(":");
  if (rawPort) return { host: rawHost, port: Number(rawPort) };

  try {
    const records = await resolveSrv(`_minecraft._tcp.${rawHost}`);
    if (records.length > 0) {
      return { host: records[0].name, port: records[0].port };
    }
  } catch {
    /* no SRV record, fall through to the plain host */
  }

  return { host: rawHost, port: DEFAULT_PORT };
}

export async function pingServer(address: string): Promise<ServerStatus> {
  const offline: ServerStatus = {
    address,
    online: false,
    players: 0,
    maxPlayers: 0,
    ping: 0,
    motd: "",
    version: ""
  };

  const { host, port } = await resolveAddress(address);

  return new Promise<ServerStatus>((resolve) => {
    const socket = new Socket();
    const started = Date.now();
    let chunks = Buffer.alloc(0);
    let settled = false;

    const finish = (status: ServerStatus): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(status);
    };

    socket.setTimeout(TIMEOUT_MS);
    socket.on("timeout", () => finish(offline));
    socket.on("error", () => finish(offline));

    socket.connect(port, host, () => {
      const handshake = packet(
        0x00,
        Buffer.concat([
          writeVarInt(767),
          writeString(host),
          Buffer.from([(port >> 8) & 0xff, port & 0xff]),
          writeVarInt(1)
        ])
      );

      socket.write(handshake);
      socket.write(packet(0x00, Buffer.alloc(0)));
    });

    socket.on("data", (chunk) => {
      chunks = Buffer.concat([chunks, chunk]);

      const length = readVarInt(chunks, 0);
      if (!length) return;
      if (chunks.length < length.size + length.value) return;

      const idAt = length.size;
      const id = readVarInt(chunks, idAt);
      if (!id) return finish(offline);

      const stringAt = idAt + id.size;
      const stringLength = readVarInt(chunks, stringAt);
      if (!stringLength) return finish(offline);

      const jsonStart = stringAt + stringLength.size;
      const json = chunks.subarray(jsonStart, jsonStart + stringLength.value).toString("utf8");

      try {
        const parsed = JSON.parse(json) as {
          players?: { online?: number; max?: number };
          version?: { name?: string };
          description?: unknown;
        };

        finish({
          address,
          online: true,
          players: parsed.players?.online ?? 0,
          maxPlayers: parsed.players?.max ?? 0,
          ping: Date.now() - started,
          motd: flattenMotd(parsed.description).replace(/§./g, "").trim(),
          version: parsed.version?.name ?? ""
        });
      } catch {
        finish(offline);
      }
    });
  });
}

export async function pingAll(addresses: string[]): Promise<ServerStatus[]> {
  return Promise.all(addresses.map((address) => pingServer(address)));
}
