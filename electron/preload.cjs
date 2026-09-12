const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sangotaDesktop', {
  setFullscreen: (value) => ipcRenderer.invoke('desktop:set-fullscreen', value),
  onFullscreenChange: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('desktop:fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('desktop:fullscreen-changed', listener);
  },
});
