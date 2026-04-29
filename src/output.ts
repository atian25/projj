export type Output = {
  stdout(text: string): void;
  stderr(text: string): void;
};

export const consoleOutput: Output = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
