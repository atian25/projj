import { styleText } from "node:util";

type Style = Parameters<typeof styleText>[0];

export type ColorTheme = {
  heading: (text: string) => string;
  repoHeader: (text: string) => string;
  command: (text: string) => string;
  failureTitle: (text: string) => string;
  warning: (text: string) => string;
  exitReason: (text: string) => string;
  taskSource: (text: string) => string;
};

export function shouldUseColor(
  env: Record<string, string | undefined>,
  isTty: boolean | undefined,
): boolean {
  if (env.NO_COLOR !== undefined) return false;
  if (env.NODE_DISABLE_COLORS !== undefined) return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== "0";
  return Boolean(isTty);
}

export function createColorTheme(enabled: boolean): ColorTheme {
  const apply = (style: Style, text: string) => (enabled ? styleText(style, text) : text);

  return {
    heading: (text) => apply("bold", text),
    repoHeader: (text) => apply(["cyan", "bold"], text),
    command: (text) => apply("dim", text),
    failureTitle: (text) => apply(["red", "bold"], text),
    warning: (text) => apply("yellow", text),
    exitReason: (text) => apply("yellow", text),
    taskSource: (text) => apply("bold", text),
  };
}
