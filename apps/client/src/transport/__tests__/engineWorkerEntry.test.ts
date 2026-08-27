import { describe, expect, it } from "vitest";
import { start } from "../engineWorkerEntry.js";

describe("bundled browser worker entry", () => {
  it("resolves the browser-safe FCB engine entry", () => {
    expect(start).toBeTypeOf("function");
  });
});
