package org.lectorlibre.mobile

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.speech.tts.TextToSpeech
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import org.json.JSONObject

class SpeechBridge(private val activity: Activity) {
    private var binding = false
    private var bound = false
    private var service: ReaderSpeechService? = null
    private val waiting = ArrayList<Pair<Invoke, JSONObject>>()
    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            service = (binder as ReaderSpeechService.LocalBinder).service
            binding = false
            val pending = waiting.toList(); waiting.clear()
            pending.forEach { (invoke, command) -> run(invoke, command) }
        }
        override fun onServiceDisconnected(name: ComponentName) {
            service = null; binding = false
            waiting.forEach { it.first.reject("El servicio de voz se desconectó.") }; waiting.clear()
        }
    }

    fun command(invoke: Invoke, command: JSONObject) {
        activity.runOnUiThread {
            if (command.optString("action") == "state" && ReaderSpeechService.active == null) {
                try {
                    val saved = JSONObject(activity.getSharedPreferences(ReaderSpeechService.STORE, 0).getString("position", "{}") ?: "{}")
                    invoke.resolve(JSObject(saved.put("hasProgram", false).put("status", "idle").put("previewing", false).toString()))
                } catch (_: Exception) { invoke.resolve(JSObject().put("hasProgram", false).put("status", "idle")) }
                return@runOnUiThread
            }
            if (command.optString("action") == "voiceSettings") {
                try {
                    val intent = Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA)
                    if (intent.resolveActivity(activity.packageManager) != null) activity.startActivity(intent)
                    else activity.startActivity(Intent("com.android.settings.TTS_SETTINGS"))
                    invoke.resolve(JSObject())
                } catch (_: Exception) { invoke.reject("Abre los ajustes de texto a voz de Android para instalar voces.") }
                return@runOnUiThread
            }
            if (service != null) run(invoke, command)
            else {
                waiting.add(invoke to command)
                if (!binding) {
                    binding = true
                    bound = activity.bindService(Intent(activity, ReaderSpeechService::class.java), connection, Activity.BIND_AUTO_CREATE)
                    if (!bound) {
                        binding = false
                        waiting.forEach { it.first.reject("No se pudo abrir el servicio de voz.") }; waiting.clear()
                    }
                }
            }
        }
    }

    private fun run(invoke: Invoke, command: JSONObject) {
        service?.execute(command, { invoke.resolve(JSObject(it.toString())) }, { invoke.reject(it) })
    }

    fun close() {
        if (bound) activity.unbindService(connection)
        bound = false; binding = false; service = null
        waiting.forEach { it.first.reject("La aplicación se cerró.") }; waiting.clear()
    }
}
