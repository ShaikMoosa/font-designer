// Electron main process for Glyphs for Windows (Phase 6).
// Loads the Vite build (dist/index.html) in a secure window and provides
// native Windows file dialogs over IPC. The renderer never gets Node
// access: contextIsolation is on, nodeIntegration is off, and the only
// bridge is electron/preload.cjs.
const { app, BrowserWindow, dialog, ipcMain, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const { spawn } = require("node:child_process");

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const FONTC_PORT = 8765;
let mainWindow = null;
let fontcProcess = null;

// --- Bundled compile service (Phase 7) ---
// The fontc sidecar (tools/fontc/server.py, packaged with PyInstaller
// in --onedir mode so stopping it cannot orphan a child process) powers
// WOFF2 and variable-font export on 127.0.0.1:8765. In a packaged app it
// lives in resources/fontc/fontc.exe; in development that exe is used
// when built, otherwise the service runs from tools/fontc via uv.
// Set GLYPHS_FONTC=off to disable, or GLYPHS_FONTC_PATH to a custom exe.
// If the port is already served (a manually started service), the
// sidecar exits on bind and the existing service keeps answering.
function fontcExecutable() {
  if (process.env.GLYPHS_FONTC_PATH) return process.env.GLYPHS_FONTC_PATH;
  if (app.isPackaged) return path.join(process.resourcesPath, "fontc", "fontc.exe");
  return path.join(__dirname, "..", "resources", "fontc", "fontc", "fontc.exe");
}

function startFontc() {
  if (process.env.GLYPHS_FONTC === "off" || fontcProcess) return;
  const exe = fontcExecutable();
  try {
    if (fsSync.existsSync(exe)) {
      fontcProcess = spawn(exe, [], { windowsHide: true, cwd: path.dirname(exe) });
    } else if (!app.isPackaged) {
      const serviceDir = path.join(__dirname, "..", "tools", "fontc");
      fontcProcess = spawn("uv", ["run", "python", "server.py"], { windowsHide: true, cwd: serviceDir });
    } else {
      console.error(`fontc sidecar missing at ${exe}; WOFF2/variable export will report the service offline.`);
      return;
    }
  } catch (err) {
    console.error(`fontc sidecar failed to start: ${err.message}`);
    fontcProcess = null;
    return;
  }
  fontcProcess.on("error", (err) => {
    console.error(`fontc sidecar error: ${err.message}`);
    fontcProcess = null;
  });
  fontcProcess.on("exit", (code) => {
    if (code) console.error(`fontc sidecar exited with code ${code} (port ${FONTC_PORT} may already be served).`);
    fontcProcess = null;
  });
}

function stopFontc() {
  if (fontcProcess) {
    fontcProcess.kill();
    fontcProcess = null;
  }
}

if (process.platform === "win32") {
  app.setAppUserModelId("com.shaikmoosa.glyphsforwindows");
}

function sendMenuCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("glyphs:menu-command", command);
  }
}

function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "New Font", accelerator: "CmdOrCtrl+N", click: () => sendMenuCommand("new") },
        { label: "Open…", accelerator: "CmdOrCtrl+O", click: () => sendMenuCommand("open") },
        { label: "Save as .glyphs (OpenStep)", accelerator: "CmdOrCtrl+S", click: () => sendMenuCommand("save-glyphs") },
        { label: "Export UFO (.zip)", accelerator: "CmdOrCtrl+E", click: () => sendMenuCommand("export-ufo") },
        { label: "Export Font…", click: () => sendMenuCommand("export-font") },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", click: () => sendMenuCommand("undo") },
        { label: "Redo", accelerator: "CmdOrCtrl+Y", click: () => sendMenuCommand("redo") },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function sanitizeFilters(filters) {
  if (!Array.isArray(filters)) return [{ name: "All files", extensions: ["*"] }];
  const clean = filters
    .filter((f) => f && typeof f.name === "string" && Array.isArray(f.extensions))
    .map((f) => ({
      name: f.name.slice(0, 64),
      extensions: f.extensions
        .map((e) => String(e).replace(/[^a-z0-9]/gi, "").toLowerCase())
        .filter(Boolean)
        .slice(0, 8),
    }))
    .filter((f) => f.extensions.length);
  return clean.length ? clean : [{ name: "All files", extensions: ["*"] }];
}

function registerIpc() {
  ipcMain.handle("glyphs:open-file", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Open font",
      properties: ["openFile"],
      filters: [
        { name: "Font sources (.glyphs, .json, UFO .zip)", extensions: ["glyphs", "json", "zip"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_BYTES) throw new Error("File is larger than 64 MB.");
    const buffer = await fs.readFile(filePath);
    const name = path.basename(filePath);
    if (/\.zip$/i.test(name)) {
      return { name, kind: "binary", base64: buffer.toString("base64") };
    }
    return { name, kind: "text", text: buffer.toString("utf8") };
  });

  ipcMain.handle("glyphs:save-file", async (_event, request) => {
    if (!request || typeof request.defaultName !== "string") {
      throw new Error("Save request is missing a file name.");
    }
    const defaultName = path.basename(request.defaultName).slice(0, 180) || "Untitled.glyphs";
    const hasText = typeof request.text === "string";
    const hasBytes = typeof request.base64 === "string";
    if (!hasText && !hasBytes) throw new Error("Save request has no content.");
    const data = hasText ? Buffer.from(request.text, "utf8") : Buffer.from(request.base64, "base64");
    if (data.length > MAX_FILE_BYTES) throw new Error("File is larger than 64 MB.");
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save file",
      defaultPath: defaultName,
      filters: sanitizeFilters(request.filters),
    });
    if (result.canceled || !result.filePath) return { saved: false };
    await fs.writeFile(result.filePath, data);
    return { saved: true, path: result.filePath, name: path.basename(result.filePath) };
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, "..", "build", "icon.ico");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: "Glyphs for Windows",
    ...(fsSync.existsSync(iconPath) ? { icon: iconPath } : {}),
    backgroundColor: "#14181d",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => { mainWindow = null; });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    buildMenu();
    registerIpc();
    startFontc();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", stopFontc);
}
