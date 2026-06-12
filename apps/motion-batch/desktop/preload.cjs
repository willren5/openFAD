const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("fadNative", {
  pickPath(options) {
    return ipcRenderer.invoke("paths:pick", options);
  },
  openAsset(id) {
    return ipcRenderer.invoke("assets:open", { id });
  },
  getPathForFile(file) {
    return webUtils.getPathForFile(file);
  }
});
