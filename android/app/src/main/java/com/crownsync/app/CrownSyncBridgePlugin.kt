package com.crownsync.app

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.UUID

@CapacitorPlugin(
    name = "CrownSyncBridge",
    permissions = [
        Permission(strings = [Manifest.permission.READ_PHONE_STATE], alias = "phoneState"),
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "postNotifications")
    ]
)
class CrownSyncBridgePlugin : Plugin() {

    @PluginMethod
    fun getPermissionsStatus(call: PluginCall) {
        val ctx = context
        val ret = JSObject()
        ret.put("notificationAccess", isNotificationListenerEnabled(ctx))
        ret.put(
            "phoneState",
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_PHONE_STATE) ==
                PackageManager.PERMISSION_GRANTED
        )
        ret.put(
            "postNotifications",
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) ==
                    PackageManager.PERMISSION_GRANTED
            } else {
                true
            }
        )
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        ret.put("batteryOptimizationIgnored", pm.isIgnoringBatteryOptimizations(ctx.packageName))
        call.resolve(ret)
    }

    @PluginMethod
    fun openNotificationListenerSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }

    @PluginMethod
    fun requestPhoneStatePermission(call: PluginCall) {
        if (getPermissionState("phoneState") == PermissionState.GRANTED) {
            call.resolve()
        } else {
            requestPermissionForAlias("phoneState", call, "permissionCallback")
        }
    }

    @PluginMethod
    fun requestPostNotificationsPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            getPermissionState("postNotifications") == PermissionState.GRANTED
        ) {
            call.resolve()
        } else {
            requestPermissionForAlias("postNotifications", call, "permissionCallback")
        }
    }

    @PermissionCallback
    private fun permissionCallback(call: PluginCall) {
        call.resolve()
    }

    @PluginMethod
    fun requestBatteryOptimizationExemption(call: PluginCall) {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = Uri.parse("package:${context.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        call.resolve()
    }

    @PluginMethod
    fun getInstalledApps(call: PluginCall) {
        val pm = context.packageManager
        val launcherIntent = Intent(Intent.ACTION_MAIN, null).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
        }
        val resolveInfos = pm.queryIntentActivities(launcherIntent, 0)
        val seen = HashSet<String>()
        val apps = mutableListOf<Pair<String, String>>()

        for (ri in resolveInfos) {
            val pkg = ri.activityInfo.packageName ?: continue
            if (pkg == context.packageName || !seen.add(pkg)) continue
            val label = ri.loadLabel(pm).toString()
            apps.add(pkg to label)
        }

        apps.sortBy { it.second.lowercase() }

        val jsArray = JSArray()
        for ((pkg, label) in apps) {
            val obj = JSObject()
            obj.put("packageName", pkg)
            obj.put("appName", label)
            jsArray.put(obj)
        }

        val ret = JSObject()
        ret.put("apps", jsArray)
        call.resolve(ret)
    }

    @PluginMethod
    fun getAllowedApps(call: PluginCall) {
        val allowed = EventRelayClient.getAllowedApps(context)
        val arr = JSArray()
        allowed.forEach { arr.put(it) }
        val ret = JSObject()
        ret.put("packages", arr)
        call.resolve(ret)
    }

    @PluginMethod
    fun setAllowedApps(call: PluginCall) {
        val arr = call.getArray("packages") ?: JSArray()
        val set = HashSet<String>()
        for (i in 0 until arr.length()) {
            val pkg = arr.optString(i, "")
            if (pkg.isNotEmpty()) set.add(pkg)
        }
        EventRelayClient.setAllowedApps(context, set)
        call.resolve()
    }

    @PluginMethod
    fun syncAuthConfig(call: PluginCall) {
        val deviceId = call.getString("deviceId")
        if (!deviceId.isNullOrBlank()) {
            EventRelayClient.saveDeviceId(context, deviceId)
        }
        call.resolve()
    }

    @PluginMethod
    fun sendTestEvent(call: PluginCall) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val status = EventRelayClient.relayBlocking(
                    context,
                    mapOf(
                        "eventId" to UUID.randomUUID().toString(),
                        "eventType" to "test_notification",
                        "appName" to "Crown Sync (Phone)",
                        "title" to "Phone Connection Test",
                        "body" to "Native Android relay succeeded.",
                        "timestamp" to System.currentTimeMillis()
                    )
                )
                val ret = JSObject()
                ret.put("status", status)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject(e.message ?: "Native relay failed")
            }
        }
    }

    private fun isNotificationListenerEnabled(context: Context): Boolean {
        val cn = ComponentName(context, CrownSyncNotificationListener::class.java)
        val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
        return flat != null && flat.contains(cn.flattenToString())
    }
}
