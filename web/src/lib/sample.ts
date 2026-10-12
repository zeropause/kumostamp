/* Clearly labelled sample sheet, offered only when no extension is connected. */
import { KS, type Db } from "./ks";

export function sampleDb(): Db {
  let db = KS.emptyDb();
  const now = Date.now();
  const m = (min: number) => now - min * 60000;
  const marks: [string, number, number, number, string, number][] = [
    ["JoJo's Bizarre Adventure: Stone Ocean", 1, 1440, 1440, "provider-a.example", m(60 * 26)],
    ["JoJo's Bizarre Adventure: Stone Ocean", 2, 974, 1440, "provider-b.example", m(42)],
    ["Frieren: Beyond Journey's End", 7, 1430, 1440, "provider-a.example", m(60 * 50)],
    ["Frieren: Beyond Journey's End", 8, 611, 1440, "provider-c.example", m(60 * 49)],
    ["Breaking Bad Season 2", 5, 2830, 2830, "provider-d.example", m(60 * 24 * 6)],
  ];
  for (const [series, episode, time, duration, host, at] of marks) {
    db = KS.applyOp(db, { type: "progress", series, episode, time, duration, url: `https://${host}/watch/sample`, host }, at);
  }
  return db;
}
