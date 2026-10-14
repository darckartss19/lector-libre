package org.lectorlibre.reader

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.app.Instrumentation
import android.os.Bundle
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.lectorlibre.mobile.ReaderSpeechService
import org.lectorlibre.mobile.SecureBytes
import org.lectorlibre.mobile.SpeechProgram
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class AndroidFunctionsTest : Instrumentation() {
    private val instrumentation get() = this
    private val appContext get() = targetContext

    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }

    override fun onStart() {
        val result = Bundle()
        try {
            sentenceNavigationAndUtf16RemainStable()
            androidVaultAuthenticatesEncryptedBytes()
            nativeSpeechContinuesInBackgroundAndStopsImmediately()
            result.putString("stream", "PASS: native UTF-16 queue, encrypted vault, background offline speech, immediate pause/stop and timer controls.")
            finish(android.app.Activity.RESULT_OK, result)
        } catch (failure: Throwable) {
            val stack = java.io.StringWriter()
            failure.printStackTrace(java.io.PrintWriter(stack))
            result.putString("stream", stack.toString())
            finish(android.app.Activity.RESULT_CANCELED, result)
        }
    }

    private fun data(text: String): JSONObject = JSONObject().put("bookId", "b".repeat(64))
        .put("title", "Prueba silenciosa").put("voice", "test").put("rate", 3).put("volume", 0)
        .put("chapters", JSONArray().put(JSONObject().put("id", "first").put("text", text))
            .put(JSONObject().put("id", "second").put("text", "Capítulo final.")))

    fun sentenceNavigationAndUtf16RemainStable() {
        val program = SpeechProgram(data("Primera frase. Segunda frase.\n\nUna cara: \uD83D\uDE00 y más texto."))
        program.skip(1)
        assertEquals("Segunda frase.", program.chapters[0].text.substring(program.offset, program.offset + 14))
        program.skip(-1); assertEquals(0, program.offset)
        assertEquals(0, SpeechProgram.safeOffset("\uD83D\uDE00", 1))
        val content = "Texto largo con palabras. ".repeat(60)
        val long = SpeechProgram(data(content))
        var restored = ""
        while (true) {
            val chunk = long.next() ?: break
            if (chunk.chapter != "first") break
            assertTrue(chunk.text.length <= 350)
            restored += chunk.text; long.offset = chunk.end
        }
        assertEquals(content, restored)
    }

    fun androidVaultAuthenticatesEncryptedBytes() {
        val original = "synthetic-private-test".toByteArray()
        val encrypted = SecureBytes.transform(original, false)
        assertFalse(encrypted.contentEquals(original))
        assertArrayEquals(original, SecureBytes.transform(encrypted, true))
        encrypted[encrypted.lastIndex] = (encrypted.last().toInt() xor 1).toByte()
        try { SecureBytes.transform(encrypted, true); fail("Tampered ciphertext was accepted") }
        catch (_: java.security.GeneralSecurityException) {}
    }

    fun nativeSpeechContinuesInBackgroundAndStopsImmediately() {
        val connected = CountDownLatch(1)
        var service: ReaderSpeechService? = null
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName, binder: IBinder) {
                service = (binder as ReaderSpeechService.LocalBinder).service; connected.countDown()
            }
            override fun onServiceDisconnected(name: ComponentName) {}
        }
        instrumentation.runOnMainSync {
            assertTrue(appContext.bindService(Intent(appContext, ReaderSpeechService::class.java), connection, Context.BIND_AUTO_CREATE))
        }
        assertTrue(connected.await(15, TimeUnit.SECONDS))
        fun command(value: JSONObject): JSONObject {
            val done = CountDownLatch(1); var result: JSONObject? = null; var error: String? = null
            instrumentation.runOnMainSync { service!!.execute(value, { result = it; done.countDown() }, { error = it; done.countDown() }) }
            assertTrue("Native command timed out", done.await(20, TimeUnit.SECONDS))
            assertNull(error); return result!!
        }
        try {
            val voices = command(JSONObject().put("action", "voices")).getJSONArray("voices")
            assertTrue("No offline voice installed in this emulator", voices.length() > 0)
            val preferred = (0 until voices.length()).map { voices.getJSONObject(it) }.firstOrNull { it.getString("language").startsWith("es") } ?: voices.getJSONObject(0)
            val voice = preferred.getString("id")
            command(data("Esta prueba no produce sonido. ".repeat(1200)).put("voice", voice).put("action", "program"))
            instrumentation.uiAutomation.executeShellCommand("input keyevent 3").close()
            val waitUntil = System.currentTimeMillis() + 20_000
            var background = command(JSONObject().put("action", "state"))
            while (background.getInt("offset") == 0 && background.getString("status") == "playing" && System.currentTimeMillis() < waitUntil) {
                Thread.sleep(250)
                background = command(JSONObject().put("action", "state"))
            }
            assertEquals(background.toString(), "playing", background.getString("status"))
            assertTrue(background.toString(), background.getInt("offset") > 0)
            val paused = command(JSONObject().put("action", "pause"))
            assertEquals("paused", paused.getString("status"))
            Thread.sleep(600)
            assertEquals(paused.getInt("offset"), command(JSONObject().put("action", "state")).getInt("offset"))
            val skipped = command(JSONObject().put("action", "skip").put("direction", 1))
            assertTrue(skipped.getInt("offset") > paused.getInt("offset"))
            assertEquals("playing", command(JSONObject().put("action", "resume")).getString("status"))
            assertEquals("15", command(JSONObject().put("action", "timer").put("mode", "15")).getString("sleepMode"))
            val stopped = command(JSONObject().put("action", "stop"))
            assertFalse(stopped.getBoolean("hasProgram"))
            Thread.sleep(600)
            assertFalse(command(JSONObject().put("action", "state")).getBoolean("hasProgram"))
        } finally {
            instrumentation.runOnMainSync { service?.execute(JSONObject().put("action", "stop"), {}, {}); appContext.unbindService(connection) }
            appContext.startActivity(appContext.packageManager.getLaunchIntentForPackage(appContext.packageName)!!.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}
