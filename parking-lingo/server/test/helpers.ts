import { getFixture } from "@parking-lingo/core/fixtures";
import type { SignReading } from "@parking-lingo/core";
import { createApp } from "../src/app";
import { testConfig, type Config } from "../src/config";
import type { ReadSignInput, ReadSignResult, SignReader } from "../src/signReader";

/** Smallest thing that sniffs as a JPEG (SOI + APP0/JFIF header). */
export const TINY_JPEG_B64 = "/9j/4AAQSkZJRgABAQ==";
/** PNG signature + IHDR start. */
export const TINY_PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString("base64");
/** ISO-BMFF 'ftypheic' header, as produced by the iPhone camera. */
export const TINY_HEIC_B64 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]).toString("base64");

export const FIXED_NOW = new Date("2026-11-12T02:30:00Z"); // Thu 12 Nov 2026, 1:30 pm Sydney

/** Records calls and returns a queue of results (or throws queued errors). */
export class FakeReader implements SignReader {
  calls: ReadSignInput[] = [];
  constructor(private readonly respond: (input: ReadSignInput, call: number) => Promise<ReadSignResult> | ReadSignResult) {}
  async read(input: ReadSignInput): Promise<ReadSignResult> {
    this.calls.push(input);
    return this.respond(input, this.calls.length);
  }
}

export function readerReturning(reading: SignReading): FakeReader {
  return new FakeReader(() => ({ reading: structuredClone(reading), model: "fake-model", attempts: 1 }));
}

export function makeApp(reader: SignReader, overrides: Partial<Config> = {}) {
  const config = testConfig({ trustProxy: "xff", ...overrides });
  return createApp({ config, reader, clock: () => FIXED_NOW, log: () => {} });
}

let ipCounter = 0;
/** A fresh client IP per call so tests don't trip each other's rate limits. */
export function freshIp(): string {
  ipCounter++;
  return `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

export function post(app: ReturnType<typeof makeApp>, path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": freshIp(), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function readSignBody(overrides: { image?: Record<string, unknown>; context?: Record<string, unknown> } = {}) {
  return {
    image: { base64: TINY_JPEG_B64, mediaType: "image/jpeg", ...overrides.image },
    context: { timeZone: "Australia/Sydney", ...overrides.context },
  };
}

export const twoPMeter = getFixture("nsw-2p-meter-weekdays-sat").reading;
export const splitSides = getFixture("split-sides-no-stopping-1p").reading;
