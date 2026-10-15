// Preload bridge: the only surface the renderer can use to reach the
// desktop shell. Keep it narrow — file open/save and native menu commands.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("glyphsDesktop", {
  isDesktop: true,
  platform: process.platform,
  openFile: () => ipcRenderer.invoke("glyphs:open-file"),
  saveFile: (request) => ipcRenderer.invoke("glyphs:save-file", request),
  onMenuCommand: (callback) => {
    const listener = (_event, command) => callback(String(command));
    ipcRenderer.on("glyphs:menu-command", listener);
    return () => ipcRenderer.removeListener("glyphs:menu-command", listener);
  },
});
