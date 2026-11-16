package com.crownsync.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import java.util.UUID

class CrownSyncCallReceiver : BroadcastReceiver() {

    companion object {
        private const val PREFS_NAME = "crown_sync_call_state"
        private const val KEY_WAS_RINGING = "was_ringing"
        private const val KEY_ACTIVE_CALL_ID = "active_call_id"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return

        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val wasRinging = prefs.getBoolean(KEY_WAS_RINGING, false)
        val activeCallId = prefs.getString(KEY_ACTIVE_CALL_ID, null)

        when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> {
                if (!wasRinging) {
                    val callId = UUID.randomUUID().toString()
                    prefs.edit()
                        .putBoolean(KEY_WAS_RINGING, true)
                        .putString(KEY_ACTIVE_CALL_ID, callId)
                        .apply()

                    // Caller number is optional and not assumed from READ_PHONE_STATE
                    @Suppress("DEPRECATION")
                    val optionalNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
                        ?.trim()
                        ?.takeIf { it.isNotEmpty() }

                    val payload = mapOf(
                        "eventId" to UUID.randomUUID().toString(),
                        "eventType" to "call_ringing",
                        "callId" to callId,
                        "callSeq" to 1,
                        "appName" to "Phone",
                        "title" to (optionalNumber ?: "Incoming call"),
                        "body" to "",
                        "timestamp" to System.currentTimeMillis()
                    )
                    EventRelayClient.relayAsync(context.applicationContext, payload)
                }
            }

            TelephonyManager.EXTRA_STATE_OFFHOOK,
            TelephonyManager.EXTRA_STATE_IDLE -> {
                if (wasRinging && activeCallId != null) {
                    prefs.edit()
                        .putBoolean(KEY_WAS_RINGING, false)
                        .remove(KEY_ACTIVE_CALL_ID)
                        .apply()

                    val payload = mapOf(
                        "eventId" to UUID.randomUUID().toString(),
                        "eventType" to "call_ended",
                        "callId" to activeCallId,
                        "callSeq" to 2,
                        "appName" to "Phone",
                        "title" to "Call ended",
                        "body" to "",
                        "timestamp" to System.currentTimeMillis()
                    )
                    EventRelayClient.relayAsync(context.applicationContext, payload)
                }
            }
        }
    }
}
