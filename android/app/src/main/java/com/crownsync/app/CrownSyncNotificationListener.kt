package com.crownsync.app

import android.app.Notification
import android.content.ComponentName
import android.content.pm.PackageManager
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.util.UUID

class CrownSyncNotificationListener : NotificationListenerService() {

    override fun onListenerConnected() {
        super.onListenerConnected()
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            requestRebind(ComponentName(this, CrownSyncNotificationListener::class.java))
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        handleNotification(sbn, "notification_posted")
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        if (sbn == null) return
        handleNotification(sbn, "notification_removed")
    }

    private fun handleNotification(sbn: StatusBarNotification, eventType: String) {
        val pkg = sbn.packageName ?: return
        // Prevent forwarding loops by excluding this app's own notifications
        if (pkg == applicationContext.packageName) return

        // Ignore ongoing/group-summary noise
        val notification = sbn.notification ?: return
        if ((notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return

        val allowedApps = EventRelayClient.getAllowedApps(applicationContext)
        if (!allowedApps.contains(pkg)) return

        val extras = notification.extras
        val title = extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim() ?: ""
        val text = extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim() ?: ""

        val appName = try {
            val appInfo = packageManager.getApplicationInfo(pkg, 0)
            packageManager.getApplicationLabel(appInfo).toString()
        } catch (_: PackageManager.NameNotFoundException) {
            pkg
        }

        val payload = mapOf(
            "eventId" to UUID.randomUUID().toString(),
            "eventType" to eventType,
            "notificationKey" to sbn.key,
            "appName" to appName,
            "title" to title,
            "body" to text,
            "timestamp" to System.currentTimeMillis()
        )

        EventRelayClient.relayAsync(applicationContext, payload)
    }
}
