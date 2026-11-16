import { registerPlugin } from '@capacitor/core';

export interface PermissionStatus {
  notificationAccess: boolean;
  phoneState: boolean;
  postNotifications: boolean;
  batteryOptimizationIgnored: boolean;
}

export interface InstalledApp {
  packageName: string;
  appName: string;
}

export interface CrownSyncBridgePlugin {
  getPermissionsStatus(): Promise<PermissionStatus>;
  openNotificationListenerSettings(): Promise<void>;
  requestPhoneStatePermission(): Promise<void>;
  requestPostNotificationsPermission(): Promise<void>;
  requestBatteryOptimizationExemption(): Promise<void>;
  getInstalledApps(): Promise<{ apps: InstalledApp[] }>;
  getAllowedApps(): Promise<{ packages: string[] }>;
  setAllowedApps(options: { packages: string[] }): Promise<void>;
  syncAuthConfig(options: { deviceId: string; uid: string }): Promise<void>;
  sendTestEvent(): Promise<{ status: string }>;
}

export const CrownSyncBridge = registerPlugin<CrownSyncBridgePlugin>('CrownSyncBridge');
