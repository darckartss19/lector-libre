package org.lectorlibre.mobile

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import java.io.File

class ShareCards(private val activity: Activity) {
    fun open(invoke: Invoke, path: String, copy: Boolean) {
        try {
            val file = File(path).canonicalFile
            val root = File(activity.cacheDir, "quote-share").canonicalFile
            require(file.parentFile == root && file.name.endsWith(".png") && file.isFile)
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
            val clip = ClipData.newUri(activity.contentResolver, "Tarjeta de lectura", uri)
            activity.runOnUiThread {
                try {
                    if (copy) (activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(clip)
                    else {
                        val send = Intent(Intent.ACTION_SEND).apply {
                            type = "image/png"
                            putExtra(Intent.EXTRA_STREAM, uri)
                            clipData = clip
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        activity.startActivity(Intent.createChooser(send, "Compartir tarjeta"))
                    }
                    invoke.resolve(JSObject())
                } catch (_: Exception) { invoke.reject("No se pudo abrir el destino de la tarjeta.") }
            }
        } catch (_: Exception) { invoke.reject("La tarjeta no está disponible para compartir.") }
    }
}
