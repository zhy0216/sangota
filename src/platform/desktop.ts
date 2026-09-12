import { getSettings, updateSettings } from '../state/settings';

declare global {
  interface Window {
    sangotaDesktop?: {
      setFullscreen(value: boolean): Promise<void>;
      onFullscreenChange(callback: (value: boolean) => void): () => void;
    };
  }
}

/** Restore desktop fullscreen and keep F11 / native window changes in settings. */
export function initializeDesktop(): void {
  const desktop = window.sangotaDesktop;
  if (!desktop) return;
  const unsubscribe = desktop.onFullscreenChange((fullscreen) => updateSettings({ fullscreen }));
  window.addEventListener('beforeunload', unsubscribe, { once: true });
  void desktop.setFullscreen(getSettings().fullscreen).catch((error) => {
    console.error('Could not restore fullscreen:', error);
  });
}

/** Return false in a browser, where Phaser owns fullscreen. */
export function setDesktopFullscreen(value: boolean): boolean {
  const desktop = window.sangotaDesktop;
  if (!desktop) return false;
  void desktop.setFullscreen(value).catch((error) => {
    console.error('Could not change fullscreen:', error);
  });
  return true;
}
