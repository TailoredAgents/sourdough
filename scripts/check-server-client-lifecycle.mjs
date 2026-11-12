import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { getSupabaseAdminClient } from "../src/lib/supabase.ts";

assert.equal(typeof global.gc, "function", "Run with --expose-gc.");
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://audit.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service-role-key";
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("Network access is disabled for this check.");
};

async function exerciseFactory() {
  const references = [];
  for (let i = 0; i < 100; i += 1) {
    const client = getSupabaseAdminClient();
    assert.ok(client);
    await client.auth.initialize();
    references.push(new WeakRef(client));
  }
  return references;
}

const references = await exerciseFactory();
for (let i = 0; i < 5; i += 1) {
  await nextTurn();
  global.gc();
}
await nextTurn();
const retained = references.filter((reference) => reference.deref()).length;
assert.equal(retained, 0, "Unused server clients must be collectable.");
assert.equal(networkCalls, 0);
console.log("Server client lifecycle passed: 100 clients released, no network calls.");
