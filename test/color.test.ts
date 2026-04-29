import { describe, expect, test } from "bun:test";
import { createColorTheme, shouldUseColor } from "../src/color";

describe("color", () => {
  test("theme returns plain text when disabled", () => {
    const colors = createColorTheme(false);

    expect(colors.repoHeader("==> repo")).toBe("==> repo");
    expect(colors.failureTitle("Failed")).toBe("Failed");
  });

  test("theme applies ansi styles when enabled", () => {
    const colors = createColorTheme(true);

    expect(colors.repoHeader("==> repo")).toContain("\x1b[");
    expect(colors.failureTitle("Failed")).toContain("\x1b[");
    expect(colors.exitReason("(command not found)")).toContain("\x1b[");
  });

  test("NO_COLOR disables color", () => {
    expect(shouldUseColor({ NO_COLOR: "1", FORCE_COLOR: "1" }, true)).toBe(false);
  });

  test("FORCE_COLOR enables color without tty", () => {
    expect(shouldUseColor({ FORCE_COLOR: "1" }, false)).toBe(true);
  });

  test("tty enables color by default", () => {
    expect(shouldUseColor({}, true)).toBe(true);
    expect(shouldUseColor({}, false)).toBe(false);
  });
});
