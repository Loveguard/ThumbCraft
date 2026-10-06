/** An error's message as the user should read it: Electron prefixes IPC errors with "Error invoking remote method …". */
export const errorText = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
