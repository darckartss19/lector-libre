package org.lectorlibre.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Binder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class ReaderSpeechService : Service() {
    inner class LocalBinder : Binder() { val service: ReaderSpeechService get() = this@ReaderSpeechService }
    private val handler = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var ready: Boolean? = null
    private val waiting = ArrayList<Triple<JSONObject, (JSONObject) -> Unit, (String) -> Unit>>()
    private var program: SpeechProgram? = null
    private var chunk: ReadingChunk? = null
    private var utterance: String? = null
    private var preview = false
    private var status = "idle"
    private var fault: String? = null
    private var reason = ""
    private var sleepMode = "off"
    private var deadline: Long? = null
    private var sleepChapter: String? = null
    private var persistedAt = 0L
    private lateinit var wakeLock: PowerManager.WakeLock
    private lateinit var media: MediaSession
    private lateinit var audio: AudioManager
    private var focusRequest: AudioFocusRequest? = null
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
            handler.post { pause("interruption") }
    }
    private val expiration = Runnable { pause("timer"); sleepMode = "off"; deadline = null; persist(true) }

    override fun onCreate() {
        super.onCreate()
        active = this
        audio = getSystemService(AudioManager::class.java)
        wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LectorLibre:Reading")
        media = MediaSession(this, "LectorLibreReading").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() { resume() }
                override fun onPause() { pause("user") }
                override fun onStop() { stopReading() }
                override fun onSkipToNext() { skip(1) }
                override fun onSkipToPrevious() { skip(-1) }
            }, handler)
            isActive = true
        }
        if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CHANNEL, "Lectura en voz alta", NotificationManager.IMPORTANCE_LOW))
        tts = TextToSpeech(this) { code -> handler.post {
            ready = code == TextToSpeech.SUCCESS
            if (ready == true) installListener()
            val pending = waiting.toList(); waiting.clear()
            pending.forEach { (command, done, fail) -> execute(command, done, fail) }
        } }
    }

    override fun onBind(intent: Intent): IBinder = LocalBinder()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        foreground()
        if (program == null) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); return START_NOT_STICKY }
        when (intent?.action) {
            "play" -> resume()
            "pause" -> pause("user")
            "stop" -> stopReading()
            "next" -> skip(1)
            "previous" -> skip(-1)
        }
        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) { stopReading(); stopSelf() }

    override fun onDestroy() {
        stopReading()
        tts?.shutdown()
        waiting.forEach { it.third("El servicio de voz se cerró.") }; waiting.clear()
        media.release()
        if (active === this) active = null
        super.onDestroy()
    }

    fun execute(command: JSONObject, done: (JSONObject) -> Unit, fail: (String) -> Unit) {
        val action = command.optString("action")
        if (ready == null && action !in listOf("state", "timer", "pause", "stop", "cancel")) {
            waiting.add(Triple(command, done, fail)); return
        }
        try {
            if (ready == false && action in listOf("program", "resume", "speak")) error("Instala un motor de texto a voz en los ajustes de Android.")
            when (action) {
                "voices" -> { done(JSONObject().put("voices", voiceCatalog())); return }
                "program" -> {
                    cancelUtterance()
                    program = SpeechProgram(command)
                    if (sleepMode == "chapter") sleepChapter = program!!.chapters[program!!.index].id
                    applyVoice(program!!.voice, program!!.rate)
                    fault = null; reason = ""; preview = false
                    startReaderService()
                    playNext()
                }
                "resume" -> {
                    program?.let { p ->
                        p.voice = command.optString("voice", p.voice)
                        p.rate = command.optDouble("rate", p.rate.toDouble()).toFloat()
                    }
                    resume()
                }
                "pause", "cancel" -> pause("user")
                "stop" -> stopReading()
                "skip" -> skip(command.getInt("direction"))
                "timer" -> timer(command.optString("mode", "off"))
                "speak" -> {
                    pause("preview")
                    applyVoice(command.getString("voice"), command.optDouble("rate", 1.0).toFloat())
                    preview = true; status = "preview"; utterance = "preview:" + UUID.randomUUID()
                    tts!!.speak(command.getString("text").take(3500), TextToSpeech.QUEUE_FLUSH, Bundle(), utterance)
                }
                "state" -> {}
                else -> error("Orden de voz no válida.")
            }
            done(snapshot())
        } catch (problem: Exception) {
            fault = problem.message ?: "No se pudo iniciar la voz."
            pause("error")
            fail(fault!!)
        }
    }

    fun snapshot(): JSONObject {
        val p = program
        val saved = JSONObject(getSharedPreferences(STORE, 0).getString("position", "{}") ?: "{}")
        if (p == null) return saved.put("hasProgram", false).put("status", "idle").put("previewing", preview && utterance != null)
        val result = JSONObject().put("bookId", p.bookId).put("title", p.title).put("voice", p.voice).put("rate", p.rate)
            .put("chapter", p.chapters[p.index].id).put("offset", p.offset).put("status", status).put("hasProgram", true)
            .put("sleepMode", sleepMode).put("deadline", deadline ?: JSONObject.NULL).put("reason", reason)
            .put("previewing", preview && utterance != null).put("error", fault ?: JSONObject.NULL)
        val c = chunk
        result.put("active", if (status == "playing" && c != null) JSONObject().put("id", utterance)
            .put("chapter", c.chapter).put("start", c.start).put("end", c.end).put("text", c.text) else JSONObject.NULL)
        return result
    }

    private fun voiceCatalog(): JSONArray {
        val result = JSONArray()
        if (ready != true) return result
        tts?.voices?.filter { !it.isNetworkConnectionRequired && "notInstalled" !in it.features.orEmpty() }
            ?.sortedWith(compareBy({ it.locale.toLanguageTag() }, { -it.quality }, { it.name }))?.forEach { voice ->
                result.put(JSONObject().put("id", "android:${voice.name}").put("name", "${voice.locale.displayName} · ${voice.name}")
                    .put("language", voice.locale.toLanguageTag()).put("culture", voice.locale.toLanguageTag())
                    .put("engine", "android").put("installed", true).put("quality", voice.quality))
            }
        return result
    }

    private fun applyVoice(id: String, rate: Float) {
        require(rate.isFinite() && rate in 0.5f..3f)
        val voice = tts?.voices?.firstOrNull { "android:${it.name}" == id && !it.isNetworkConnectionRequired && "notInstalled" !in it.features.orEmpty() }
            ?: error("Esa voz sin conexión no está instalada. Revisa las voces de Android.")
        check(tts!!.setVoice(voice) == TextToSpeech.SUCCESS) { "No se pudo activar esa voz." }
        tts!!.setSpeechRate(rate)
        tts!!.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
    }

    private fun installListener() {
        tts!!.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String) {}
            override fun onDone(id: String) { handler.post {
                if (id != utterance) return@post
                if (preview) { utterance = null; preview = false; status = "paused"; return@post }
                val p = program ?: return@post
                p.offset = chunk?.end ?: p.offset
                utterance = null; chunk = null
                persist(true); playNext()
            } }
            @Deprecated("Android compatibility callback")
            override fun onError(id: String) { failed(id) }
            override fun onError(id: String, code: Int) { failed(id) }
            override fun onRangeStart(id: String, start: Int, end: Int, frame: Int) { handler.post {
                if (id != utterance || status != "playing") return@post
                val c = chunk ?: return@post
                val p = program ?: return@post
                if (start in 0..c.text.length) p.offset = SpeechProgram.safeOffset(p.chapters[p.index].text, c.start + start)
                persist(false)
            } }
        })
    }

    private fun failed(id: String) { handler.post {
        if (id != utterance) return@post
        fault = "El motor de voz no pudo leer ese fragmento."
        pause("error")
    } }

    private fun playNext() {
        val p = program ?: return
        if (deadline?.let { System.currentTimeMillis() >= it } == true) { pause("timer"); return }
        val next = p.next()
        if (next == null) { pause("finished"); timer("off"); status = "finished"; persist(true); getSystemService(NotificationManager::class.java).cancel(NOTIFICATION); updateMedia(); return }
        if (sleepMode == "chapter" && sleepChapter != null && next.chapter != sleepChapter) {
            p.index = p.chapters.indexOfFirst { it.id == sleepChapter }
            p.offset = p.chapters[p.index].text.length
            pause("chapter"); sleepMode = "off"; persist(true); return
        }
        if (!focus()) { fault = "Otra aplicación está usando el audio."; pause("interruption"); return }
        if (!wakeLock.isHeld) wakeLock.acquire()
        chunk = next; utterance = UUID.randomUUID().toString(); status = "playing"; reason = ""
        foreground()
        val params = Bundle().apply { putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, p.volume) }
        if (tts!!.speak(next.text, TextToSpeech.QUEUE_FLUSH, params, utterance) != TextToSpeech.SUCCESS) {
            fault = "No se pudo iniciar el fragmento de voz."; pause("error")
        }
        persist(true)
    }

    private fun resume() {
        val p = program ?: return
        if (ready != true) return
        cancelUtterance(); applyVoice(p.voice, p.rate); preview = false; fault = null
        startReaderService(); playNext()
    }

    private fun skip(direction: Int) {
        val wasPlaying = status == "playing"
        cancelUtterance()
        program?.skip(direction)
        if (sleepMode == "chapter") sleepChapter = program?.let { it.chapters[it.index].id }
        status = "paused"; persist(true)
        if (wasPlaying) playNext() else updateMedia()
    }

    private fun cancelUtterance() { utterance = null; chunk = null; tts?.stop(); preview = false }

    private fun pause(why: String) {
        cancelUtterance(); status = if (fault == null) "paused" else "error"; reason = why
        if (wakeLock.isHeld) wakeLock.release()
        abandonFocus(); persist(true); updateMedia()
        if (program != null) getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification())
        stopForeground(STOP_FOREGROUND_DETACH)
    }

    private fun stopReading() {
        pause("stop"); status = "idle"; timer("off"); persist(true); program = null
        getSystemService(NotificationManager::class.java).cancel(NOTIFICATION)
        stopSelf()
    }

    private fun timer(mode: String) {
        require(mode in listOf("off", "15", "30", "60", "chapter"))
        handler.removeCallbacks(expiration)
        sleepMode = mode
        deadline = mode.toLongOrNull()?.let { System.currentTimeMillis() + it * 60_000 }
        sleepChapter = if (mode == "chapter") program?.let { it.chapters[it.index].id } else null
        deadline?.let { handler.postDelayed(expiration, (it - System.currentTimeMillis()).coerceAtLeast(0)) }
    }

    @Suppress("DEPRECATION")
    private fun focus(): Boolean {
        if (Build.VERSION.SDK_INT >= 26) {
            val request = focusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setOnAudioFocusChangeListener(focusListener, handler).build().also { focusRequest = it }
            return audio.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        }
        return audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    @Suppress("DEPRECATION")
    private fun abandonFocus() {
        if (Build.VERSION.SDK_INT >= 26) focusRequest?.let { audio.abandonAudioFocusRequest(it) }
        else audio.abandonAudioFocus(focusListener)
    }

    private fun startReaderService() {
        val intent = Intent(this, ReaderSpeechService::class.java)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent) else startService(intent)
        foreground()
    }

    private fun updateMedia() {
        val state = if (status == "playing") PlaybackState.STATE_PLAYING else if (status in listOf("idle", "finished")) PlaybackState.STATE_STOPPED else PlaybackState.STATE_PAUSED
        media.setPlaybackState(PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_STOP or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS)
            .setState(state, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f).build())
        program?.let { media.setMetadata(MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, it.title).build()) }
    }

    private fun foreground() { updateMedia(); startForeground(NOTIFICATION, notification()) }

    @Suppress("DEPRECATION")
    private fun notification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
        fun action(name: String): PendingIntent {
            val intent = Intent(this, ReaderSpeechService::class.java).setAction(name)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            return if (Build.VERSION.SDK_INT >= 26) PendingIntent.getForegroundService(this, name.hashCode(), intent, flags)
            else PendingIntent.getService(this, name.hashCode(), intent, flags)
        }
        val launch = packageManager.getLaunchIntentForPackage(packageName)!!
        val content = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return builder.setSmallIcon(android.R.drawable.ic_media_play).setContentTitle(program?.title ?: "Lectura en voz alta")
            .setContentText(if (status == "playing") "Leyendo" else "En pausa").setContentIntent(content).setOnlyAlertOnce(true)
            .setOngoing(status == "playing").setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(Notification.Action.Builder(android.R.drawable.ic_media_previous, "Anterior", action("previous")).build())
            .addAction(Notification.Action.Builder(if (status == "playing") android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (status == "playing") "Pausar" else "Continuar", action(if (status == "playing") "pause" else "play")).build())
            .addAction(Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Detener", action("stop")).build())
            .setStyle(Notification.MediaStyle().setMediaSession(media.sessionToken).setShowActionsInCompactView(0, 1, 2)).build()
    }

    private fun persist(force: Boolean) {
        if (program == null || (!force && System.currentTimeMillis() - persistedAt < 1000)) return
        persistedAt = System.currentTimeMillis()
        val data = snapshot().apply { remove("active") }
        getSharedPreferences(STORE, 0).edit().putString("position", data.toString()).apply()
    }

    companion object {
        const val STORE = "reader-speech-position"
        private const val CHANNEL = "reading"
        private const val NOTIFICATION = 1180
        @Volatile var active: ReaderSpeechService? = null
            private set
    }
}
