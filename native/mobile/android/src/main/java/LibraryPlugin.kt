package org.lectorlibre.mobile

import android.app.Activity
import android.Manifest
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.view.ViewGroup
import android.util.Base64
import androidx.activity.result.ActivityResult
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.PermissionState
import org.json.JSONObject
import java.util.concurrent.Executors

@InvokeArg
class DocumentInfoArgs { lateinit var uri: String }

@InvokeArg
class ChromeArgs {
    lateinit var background: String
    var darkIcons: Boolean = true
}

@InvokeArg class ScanArgs {
    var action: String = "sources"
    var extensions: List<String> = emptyList()
    var keys: List<String> = emptyList()
}
@InvokeArg class SpeechArgs { lateinit var command: HashMap<String, Any> }
@InvokeArg class AuthArgs { lateinit var scopes: List<String>; var interactive: Boolean = false }
@InvokeArg class SecureArgs { lateinit var data: String; var decrypt: Boolean = false }
@InvokeArg class ShareArgs { lateinit var path: String; var copy: Boolean = false }

@TauriPlugin(permissions = [Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS]), Permission(alias = "fileSearch", strings = [Manifest.permission.READ_EXTERNAL_STORAGE])])
class LibraryPlugin(private val activity: Activity) : Plugin(activity) {
    private var webView: WebView? = null
    private var chromeColor: Int = Color.rgb(238, 238, 229)
    private var darkIcons: Boolean = true
    private val scanner = DocumentScanner(activity)
    private val speech = SpeechBridge(activity)
    private val google = GoogleDriveAuth(activity, this)
    private val cards = ShareCards(activity)
    private val secureWorker = Executors.newSingleThreadExecutor()

    @Suppress("DEPRECATION")
    private fun applyChrome() {
        activity.findViewById<ViewGroup>(android.R.id.content)?.setBackgroundColor(chromeColor)
        if (Build.VERSION.SDK_INT < 35) {
            activity.window.statusBarColor = Color.TRANSPARENT
            activity.window.navigationBarColor = Color.TRANSPARENT
        }
        val controller = WindowInsetsControllerCompat(activity.window, activity.window.decorView)
        controller.isAppearanceLightStatusBars = darkIcons
        controller.isAppearanceLightNavigationBars = darkIcons
        if (Build.VERSION.SDK_INT >= 29) {
            activity.window.isStatusBarContrastEnforced = false
            activity.window.isNavigationBarContrastEnforced = false
        }
    }

    override fun load(webView: WebView) {
        this.webView = webView
        val content = activity.findViewById<ViewGroup>(android.R.id.content)
        // WebView padding does not move its HTML viewport. Pad the parent once.
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        content.post { ViewCompat.requestApplyInsets(content) }
        applyChrome()
        (activity as AppCompatActivity).onBackPressedDispatcher.addCallback(
            activity, object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    webView.evaluateJavascript(
                        "window.dispatchEvent(new Event('reader-mobile-back'))", null
                    )
                }
            }
        )
    }

    override fun onPause(activity: AppCompatActivity) {
        webView?.evaluateJavascript(
            "window.dispatchEvent(new Event('reader-mobile-pause'))", null
        )
    }

    override fun onResume(activity: AppCompatActivity) {
        applyChrome()
        ViewCompat.requestApplyInsets(activity.findViewById(android.R.id.content))
        webView?.evaluateJavascript("window.dispatchEvent(new Event('reader-mobile-resume'))", null)
    }

    override fun onDestroy(activity: AppCompatActivity) { speech.close() }

    @Command
    fun scanAction(invoke: Invoke) {
        val args = invoke.parseArgs(ScanArgs::class.java)
        when (args.action) {
            "sources" -> invoke.resolve(JSObject().put("sources", scanner.sources()))
            "scan" -> {
                if (Build.VERSION.SDK_INT <= 32 && getPermissionStates()["fileSearch"] != PermissionState.GRANTED) requestPermissionForAlias("fileSearch", invoke, "fileSearchResult")
                else scanner.scan(invoke, args.extensions)
            }
            "cancel" -> scanner.cancel(invoke)
            "selected" -> scanner.selected(invoke, args.keys)
            "folder" -> {
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
                }
                startActivityForResult(invoke, intent, "folderResult")
            }
            else -> invoke.reject("Orden de búsqueda no válida.")
        }
    }

    @PermissionCallback
    fun fileSearchResult(invoke: Invoke) { scanner.scan(invoke, invoke.parseArgs(ScanArgs::class.java).extensions) }

    @ActivityCallback
    fun folderResult(invoke: Invoke, result: ActivityResult) { scanner.folderResult(invoke, result) }

    @Command
    fun speechAction(invoke: Invoke) {
        val args = invoke.parseArgs(SpeechArgs::class.java)
        if (args.command["action"] == "notificationPermission") {
            if (Build.VERSION.SDK_INT < 33 || getPermissionStates()["notifications"] == PermissionState.GRANTED)
                invoke.resolve(JSObject().put("granted", true))
            else requestPermissionForAlias("notifications", invoke, "notificationResult")
        } else speech.command(invoke, JSONObject(args.command))
    }

    @PermissionCallback
    fun notificationResult(invoke: Invoke) {
        invoke.resolve(JSObject().put("granted", getPermissionStates()["notifications"] == PermissionState.GRANTED))
    }

    @Command
    fun googleAuthorize(invoke: Invoke) {
        val args = invoke.parseArgs(AuthArgs::class.java)
        google.authorize(invoke, args.scopes, args.interactive)
    }

    @ActivityCallback
    fun googleResult(invoke: Invoke, result: ActivityResult) { google.finish(invoke, result) }

    @Command
    fun secureBytes(invoke: Invoke) {
        val args = invoke.parseArgs(SecureArgs::class.java)
        secureWorker.execute {
            try {
                val bytes = Base64.decode(args.data, Base64.NO_WRAP)
                require(bytes.size <= 64_000)
                val result = SecureBytes.transform(bytes, args.decrypt)
                invoke.resolve(JSObject().put("data", Base64.encodeToString(result, Base64.NO_WRAP)))
            } catch (_: Exception) { invoke.reject("No se pudo abrir el almacén seguro de Android.") }
        }
    }

    @Command
    fun shareImage(invoke: Invoke) {
        val args = invoke.parseArgs(ShareArgs::class.java)
        cards.open(invoke, args.path, args.copy)
    }

    @Command
    fun setChrome(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(ChromeArgs::class.java)
            require(Regex("#[0-9a-fA-F]{6}").matches(args.background))
            val color = Color.parseColor(args.background)
            activity.runOnUiThread {
                chromeColor = color
                darkIcons = args.darkIcons
                applyChrome()
                invoke.resolve(JSObject())
            }
        } catch (error: Exception) {
            invoke.reject("No se pudo ajustar la apariencia del sistema.")
        }
    }

    @Command
    fun documentInfo(invoke: Invoke) {
        try {
            val uri = Uri.parse(invoke.parseArgs(DocumentInfoArgs::class.java).uri)
            require(uri.scheme == "content")
            val result = JSObject()
            activity.contentResolver.query(
                uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null
            )?.use { cursor ->
                if (cursor.moveToFirst()) result.put("name", cursor.getString(0))
            }
            result.put("mime", activity.contentResolver.getType(uri))
            invoke.resolve(result)
        } catch (error: Exception) {
            invoke.reject("No se pudo consultar el documento seleccionado.")
        }
    }

    @Command
    fun background(invoke: Invoke) {
        activity.runOnUiThread {
            activity.moveTaskToBack(true)
            invoke.resolve(JSObject())
        }
    }
}
