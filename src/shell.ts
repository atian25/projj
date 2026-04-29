import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export type SupportedShell = "zsh" | "bash" | "fish";

export async function writeCdFinalizer(
  path: string,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  const finalizerFile = env.PROJJ_FINALIZER_FILE;
  if (!finalizerFile) return false;

  await writeFile(finalizerFile, `cd:${resolve(path)}\n`, "utf8");
  return true;
}

const POSIX_WRAPPER = `projj() {
  local __projj_finalizer
  __projj_finalizer="$(mktemp -t projj.XXXXXX)" || return
  PROJJ_FINALIZER_FILE="$__projj_finalizer" command projj "$@"
  local __projj_status=$?
  if [ -f "$__projj_finalizer" ]; then
    local __projj_action
    __projj_action="$(cat "$__projj_finalizer")"
    case "$__projj_action" in
      cd:*) cd "\${__projj_action#cd:}" ;;
    esac
    rm -f "$__projj_finalizer"
  fi
  return $__projj_status
}
`;

const FISH_WRAPPER = `function projj
  set -l __projj_finalizer (mktemp -t projj.XXXXXX)
  if test -z "$__projj_finalizer"
    return 1
  end
  command env PROJJ_FINALIZER_FILE="$__projj_finalizer" projj $argv
  set -l __projj_status $status
  if test -f "$__projj_finalizer"
    set -l __projj_action (cat "$__projj_finalizer")
    switch "$__projj_action"
      case 'cd:*'
        cd (string sub -s 4 "$__projj_action")
    end
    rm -f "$__projj_finalizer"
  end
  return $__projj_status
end
`;

export function shellInit(shell: SupportedShell): string {
  switch (shell) {
    case "zsh":
    case "bash":
      return POSIX_WRAPPER;
    case "fish":
      return FISH_WRAPPER;
  }
}
