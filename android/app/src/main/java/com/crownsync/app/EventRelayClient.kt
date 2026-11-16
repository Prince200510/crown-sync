package com.crownsync.app

import android.content.Context
import android.util.Log
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.Collections

object EventRelayClient {
    private const val TAG = "CrownSyncRelay"
    // Replace with your deployed Vercel URL, e.g. https://crown-sync.vercel.app/api/relayEvent
    private const val RELAY_URL = "https://YOUR_VERCEL_DOMAIN.vercel.app/api/relayEvent"
    private const val PREFS_NAME = "crown_sync_prefs"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_ALLOWED_APPS = "allowed_apps"

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val recentEventIds = Collections.synchronizedSet(LinkedHashSet<String>())

    fun saveDeviceId(context: Context, deviceId: String) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_DEVICE_ID, deviceId)
            .apply()
    }

    fun getDeviceId(context: Context): String? {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_DEVICE_ID, null)
    }

    fun setAllowedApps(context: Context, packages: Set<String>) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putStringSet(KEY_ALLOWED_APPS, packages)
            .apply()
    }

    fun getAllowedApps(context: Context): Set<String> {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getStringSet(KEY_ALLOWED_APPS, emptySet()) ?: emptySet()
    }

    fun relayAsync(context: Context, payload: Map<String, Any?>) {
        val eventId = payload["eventId"] as? String ?: return
        synchronized(recentEventIds) {
            if (recentEventIds.contains(eventId)) return
            recentEventIds.add(eventId)
            if (recentEventIds.size > 200) {
                val first = recentEventIds.iterator().next()
                recentEventIds.remove(first)
            }
        }

        scope.launch {
            relayBlocking(context, payload)
        }
    }

    suspend fun relayBlocking(context: Context, payload: Map<String, Any?>): String {
        val user = FirebaseAuth.getInstance().currentUser
        if (user == null) {
            Log.w(TAG, "Skipping relay: no authenticated Firebase user")
            return "unauthenticated"
        }

        val deviceId = getDeviceId(context)
        if (deviceId.isNullOrBlank()) {
            Log.w(TAG, "Skipping relay: deviceId not configured")
            return "missing_device_id"
        }

        val fullPayload = payload.toMutableMap()
        fullPayload["sourceDeviceId"] = deviceId

        val idToken = user.getIdToken(false).await().token
            ?: throw IllegalStateException("Failed to obtain Firebase ID token")
        val jsonBody = JSONObject(fullPayload).toString()

        var attempt = 0
        while (attempt < 2) {
            try {
                val conn = (URL(RELAY_URL).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 10_000
                    readTimeout = 10_000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Authorization", "Bearer $idToken")
                }
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(jsonBody) }
                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val respText = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
                conn.disconnect()

                if (code !in 200..299) {
                    throw RuntimeException("HTTP $code: $respText")
                }
                val respJson = JSONObject(respText)
                return respJson.optString("status", "relayed")
            } catch (e: Exception) {
                attempt++
                Log.w(TAG, "Relay attempt $attempt failed: ${e.javaClass.simpleName}")
                if (attempt < 2) {
                    delay(1000L)
                } else {
                    throw e
                }
            }
        }
        return "failed"
    }
}
