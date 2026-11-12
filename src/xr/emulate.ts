/**
 * Dev-only: installs Meta's WebXR emulator (IWER) posing as a Quest 3, so VR
 * mode can be tried and screenshotted in a desktop browser. Enable with `?xr`.
 * The device is exposed as `window.__xr` for scripting poses and buttons.
 */
export async function installQuestEmulator(): Promise<void> {
  const { XRDevice, metaQuest3 } = await import('iwer');
  const device = new XRDevice(metaQuest3);
  // Desktop Chrome has a native navigator.xr with no headset behind it; replace it.
  device.installRuntime({ forceInstall: true });
  (window as unknown as { __xr: unknown }).__xr = device;
}
