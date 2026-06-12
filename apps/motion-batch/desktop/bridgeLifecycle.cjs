const DEFAULT_CLOSE_TIMEOUT_MS = 1500;

function closeHttpServer(server, { timeoutMs = DEFAULT_CLOSE_TIMEOUT_MS } = {}) {
  if (!server) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    let forceTimer;
    let failTimer;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      clearTimeout(failTimer);
      if (error) reject(error);
      else resolve();
    };

    const forceClose = () => {
      try {
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
      } catch (error) {
        finish(error);
      }
    };

    forceTimer = setTimeout(forceClose, timeoutMs);
    forceTimer.unref?.();
    failTimer = setTimeout(() => {
      finish(new Error("Timed out while closing the local bridge HTTP server."));
    }, timeoutMs * 2);
    failTimer.unref?.();

    try {
      server.close((error) => finish(error));
    } catch (error) {
      finish(error);
    }
  });
}

module.exports = {
  closeHttpServer
};
