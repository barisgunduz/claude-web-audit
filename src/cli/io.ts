export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
}

export const processIo: Io = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

/** Wraps an Io so that the value of PSI_API_KEY can never reach the terminal. */
export function withRedaction(io: Io, env: NodeJS.ProcessEnv): Io {
  const secret = env.PSI_API_KEY?.trim() ?? '';
  const redact = (text: string): string =>
    secret === '' ? text : text.split(secret).join('[redacted]');
  return {
    stdout: (text) => {
      io.stdout(redact(text));
    },
    stderr: (text) => {
      io.stderr(redact(text));
    },
  };
}
