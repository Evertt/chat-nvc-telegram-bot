import { assertEquals } from "https://deno.land/std@0.179.0/testing/asserts.ts";

Deno.test("example", function (): void {
  assertEquals("world", "world");
  assertEquals({ hello: "world" }, { hello: "world" });
});
