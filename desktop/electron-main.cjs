const { app, BrowserWindow, Menu, shell } = require("electron");

const cockpitUrl = process.env.TOMORROWEDGE_DESKTOP_URL;
const isWslgRuntime = process.env.TOMORROWEDGE_DESKTOP_WSLG === "1";

if (!cockpitUrl) {
  throw new Error("TOMORROWEDGE_DESKTOP_URL is required.");
}

if (isWslgRuntime) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-dev-shm-usage");
  app.commandLine.appendSwitch("no-sandbox");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    title: "TomorrowEdge GUI Client",
    backgroundColor: "#f6fafc",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: !isWslgRuntime
    }
  });

  Menu.setApplicationMenu(null);
  win.loadURL(cockpitUrl);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
