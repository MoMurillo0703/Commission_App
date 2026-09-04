import { describe, expect, it } from "vitest";
import {
  DATABASE_LIVENESS_TIMEOUT,
  DATABASE_UNAVAILABLE_MESSAGE,
  ensureLiveClient,
  withDeadline,
} from "./liveness";

type FakeClient = {
  id: string;
  ping: () => Promise<void>;
};

describe("database liveness", () => {
  it("times out a ping that never settles", async () => {
    await expect(withDeadline(new Promise(() => {}), 20, DATABASE_LIVENESS_TIMEOUT)).rejects.toThrow(DATABASE_LIVENESS_TIMEOUT);
  });

  it("recycles a stale hung client once and proceeds after the replacement pings", async () => {
    const created: string[] = [];
    const disposed: string[] = [];
    let sequence = 0;
    const stale: FakeClient = { id: "stale", ping: () => new Promise(() => {}) };
    let current: FakeClient | undefined = stale;

    const live = await ensureLiveClient({
      getCurrent: () => current,
      setCurrent: (client) => { current = client; },
      create: () => {
        const id = `fresh-${++sequence}`;
        created.push(id);
        return { id, ping: async () => undefined };
      },
      ping: (client) => client.ping(),
      dispose: async (client) => { disposed.push(client.id); },
      pingTimeoutMs: 20,
    });

    expect(live.id).toBe("fresh-1");
    expect(current?.id).toBe("fresh-1");
    expect(created).toEqual(["fresh-1"]);
    expect(disposed).toEqual(["stale"]);
  });

  it("returns a controlled failure and does not recycle again when the replacement is also dead", async () => {
    const created: string[] = [];
    const disposed: string[] = [];
    let sequence = 0;
    let current: FakeClient | undefined = { id: "stale", ping: async () => { throw new Error("stale"); } };

    await expect(ensureLiveClient({
      getCurrent: () => current,
      setCurrent: (client) => { current = client; },
      create: () => {
        const id = `dead-${++sequence}`;
        created.push(id);
        return { id, ping: async () => { throw new Error("dead"); } };
      },
      ping: (client) => client.ping(),
      dispose: async (client) => { disposed.push(client.id); },
      pingTimeoutMs: 20,
    })).rejects.toThrow(DATABASE_UNAVAILABLE_MESSAGE);

    expect(created).toEqual(["dead-1"]);
    expect(disposed).toEqual(["stale", "dead-1"]);
    expect(current).toBeUndefined();
  });
});
