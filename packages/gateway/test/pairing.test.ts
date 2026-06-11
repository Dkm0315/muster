import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  approvePairing,
  loadPairings,
  pairingScopes,
  requestPairing,
  resolvePairing,
} from "../src/index.js";

test("unpaired sender gets a stable pairing code until approved", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-pairing-"));
  const first = await requestPairing("telegram:bot", "12345", cwd);
  assert.match(first.code, /^[A-Z2-9]{8}$/);

  const second = await requestPairing("telegram:bot", "12345", cwd);
  assert.equal(second.code, first.code, "repeated requests reuse the same code");

  const other = await requestPairing("telegram:bot", "67890", cwd);
  assert.notEqual(other.code, first.code, "different senders get different codes");

  assert.equal(await resolvePairing("telegram:bot", "12345", cwd), undefined);
});

test("approvePairing mints a pairingId and the sender resolves afterwards", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-pairing-approve-"));
  const pending = await requestPairing("slack:T024", "U1", cwd);
  const paired = await approvePairing(pending.code, cwd);
  assert.match(paired.pairingId, /^pair_[0-9a-f]{8}$/);
  assert.equal(paired.surfaceId, "slack:T024");
  assert.equal(paired.senderId, "U1");

  const resolved = await resolvePairing("slack:T024", "U1", cwd);
  assert.equal(resolved?.pairingId, paired.pairingId);

  const store = await loadPairings(cwd);
  assert.equal(store.pending.length, 0, "approved pairing leaves the pending list");
  assert.equal(store.paired.length, 1);
});

test("approvePairing rejects unknown codes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-pairing-unknown-"));
  await assert.rejects(() => approvePairing("NOPE1234", cwd), /No pending pairing/);
});

test("pairingScopes grants exactly the pairing lane and the resolved user lane", () => {
  const scopes = pairingScopes({
    pairingId: "pair_abcd1234",
    surfaceId: "telegram:bot",
    senderId: "12345",
    approvedAt: new Date().toISOString(),
  });
  assert.deepEqual(scopes, [
    { kind: "pairing", id: "telegram:bot:12345" },
    { kind: "user", id: "pair_abcd1234" },
  ]);
});
