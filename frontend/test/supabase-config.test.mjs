import assert from "node:assert/strict";
import test from "node:test";
import { resolveSupabasePublicConfig } from "../src/lib/supabase/public-config.ts";

test("a deployment without public build variables still enables the production Google login", () => {
  const config = resolveSupabasePublicConfig();
  assert.equal(config.url, "https://ufyfhcboglcnfdxarysr.supabase.co");
  assert.match(config.key, /^sb_publishable_/);
  assert.deepEqual(resolveSupabasePublicConfig("", "", ""), config);
  assert.deepEqual(resolveSupabasePublicConfig("  ", "  ", "  "), config);
});

test("an explicitly configured project overrides the production defaults", () => {
  assert.deepEqual(resolveSupabasePublicConfig(" https://other.supabase.co/ ", "", " sb_publishable_other "), {
    url: "https://other.supabase.co", key: "sb_publishable_other",
  });
  assert.equal(resolveSupabasePublicConfig(undefined, "legacy-anon-key", "publishable-key").key, "legacy-anon-key");
});

test("a custom project never receives the production project's key", () => {
  assert.equal(resolveSupabasePublicConfig("https://other.supabase.co").key, undefined);
});
