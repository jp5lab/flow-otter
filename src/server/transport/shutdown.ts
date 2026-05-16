export type ShutdownHandler = () => Promise<void>;

export function installShutdown(handler: ShutdownHandler): void {
  let shuttingDown = false;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`shutdown initiated by ${signal}\n`);
    void handler()
      .then(() => process.exit(0))
      .catch((err) => {
        process.stderr.write(`shutdown error: ${String(err)}\n`);
        process.exit(1);
      });
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
}
