const { app, BrowserWindow, Menu, shell } = require("electron");

const cockpitUrl = process.env.TOMORROWEDGE_DESKTOP_URL ?? readArgValue("--tomorrowedge-url");
const isWslgRuntime = process.env.TOMORROWEDGE_DESKTOP_WSLG === "1";
const appName = "TomorrowEdge";

if (!cockpitUrl) {
  throw new Error("TOMORROWEDGE_DESKTOP_URL or --tomorrowedge-url is required.");
}

app.setName(appName);
app.commandLine.appendSwitch("class", appName);

if (isWslgRuntime) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-dev-shm-usage");
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("ozone-platform", "x11");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    title: "TomorrowEdge GUI Client",
    backgroundColor: "#f6fafc",
    show: false,
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: !isWslgRuntime
    }
  });

  Menu.setApplicationMenu(null);

  const presentWindow = () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (isWslgRuntime) win.moveTop();
  };

  win.once("ready-to-show", presentWindow);
  win.loadURL(cockpitUrl);
  win.webContents.once("did-finish-load", presentWindow);
  if (isWslgRuntime) setTimeout(presentWindow, 750);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) {
      createWindow();
      return;
    }
    for (const win of windows) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (isWslgRuntime) win.moveTop();
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

function readArgValue(name) {
  const prefix = `${name}=`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const value = process.argv[index];
    if (value === name) return process.argv[index + 1];
    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }
  return undefined;
}
