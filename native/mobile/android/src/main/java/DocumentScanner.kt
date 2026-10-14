package org.lectorlibre.mobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.MediaStore
import androidx.activity.result.ActivityResult
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.ArrayDeque
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class DocumentScanner(private val activity: Activity) {
    private val preferences = activity.getSharedPreferences("document-search", 0)
    private val worker = Executors.newSingleThreadExecutor()
    private val cancelled = AtomicBoolean(false)
    private val busy = AtomicBoolean(false)
    private val records = LinkedHashMap<String, JSONObject>()

    fun sources(): JSONArray = JSONArray(preferences.getString("sources", "[]"))

    fun folderResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.resolve(JSObject().put("cancelled", true))
            return
        }
        try {
            val uri = requireNotNull(result.data?.data)
            activity.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val roots = sources()
            val id = DocumentsContract.getTreeDocumentId(uri)
            val document = DocumentsContract.buildDocumentUriUsingTree(uri, id)
            var name = "Carpeta autorizada"
            activity.contentResolver.query(document, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) name = it.getString(0)
            }
            if ((0 until roots.length()).none { roots.getJSONObject(it).getString("uri") == uri.toString() }) {
                roots.put(JSONObject().put("uri", uri.toString()).put("name", name))
                preferences.edit().putString("sources", roots.toString()).apply()
            }
            invoke.resolve(JSObject().put("sources", roots))
        } catch (error: Exception) {
            invoke.reject("No se pudo conservar el permiso de esa carpeta.")
        }
    }

    fun cancel(invoke: Invoke) {
        cancelled.set(true)
        invoke.resolve(JSObject())
    }

    fun selected(invoke: Invoke, keys: List<String>) {
        val selected = JSONArray()
        synchronized(records) {
            for (key in keys.distinct()) {
                val record = records[key] ?: run {
                    invoke.reject("La búsqueda cambió. Vuelve a seleccionar los documentos.")
                    return
                }
                selected.put(record)
            }
        }
        invoke.resolve(JSObject().put("files", selected))
    }

    fun scan(invoke: Invoke, extensions: List<String>) {
        if (!busy.compareAndSet(false, true)) {
            invoke.reject("Ya hay una búsqueda en curso.")
            return
        }
        cancelled.set(false)
        worker.execute {
            try {
                val allowed = extensions.filter { it.matches(Regex("[a-z0-9]+")) }.toSet()
                val found = LinkedHashMap<String, JSONObject>()
                val omitted = ArrayList<String>()
                fun add(uri: Uri, name: String, size: Long, location: String) {
                    val extension = name.substringAfterLast('.', "").lowercase()
                    if (extension !in allowed) return
                    val key = MessageDigest.getInstance("SHA-256").digest(uri.toString().toByteArray())
                        .joinToString("") { "%02x".format(it) }
                    found[key] = JSONObject().put("key", key).put("uri", uri.toString())
                        .put("name", name).put("size", size.coerceAtLeast(0)).put("format", extension)
                        .put("location", location)
                }
                // MediaStore only returns the files visible to this application.
                try {
                    val base = MediaStore.Files.getContentUri("external")
                    val columns = if (android.os.Build.VERSION.SDK_INT < 29) arrayOf("_id", "_display_name", "_size", "_data") else arrayOf("_id", "_display_name", "_size")
                    activity.contentResolver.query(base, columns, null, null, null)?.use { cursor ->
                        while (!cancelled.get() && cursor.moveToNext()) {
                            val name = cursor.getString(1) ?: if (columns.size == 4) cursor.getString(3)?.substringAfterLast('/') else null
                            add(Uri.withAppendedPath(base, cursor.getLong(0).toString()), name ?: "", cursor.getLong(2), "Archivos visibles del teléfono")
                        }
                    }
                } catch (_: SecurityException) { /* Folder permissions remain available. */ }
                val roots = sources()
                for (i in 0 until roots.length()) {
                    if (cancelled.get()) break
                    val root = roots.getJSONObject(i)
                    val tree = Uri.parse(root.getString("uri"))
                    val queue = ArrayDeque<Pair<String, String>>()
                    val visited = HashSet<String>()
                    queue.add(DocumentsContract.getTreeDocumentId(tree) to root.getString("name"))
                    while (!queue.isEmpty() && !cancelled.get()) {
                        val (id, location) = queue.removeFirst()
                        if (!visited.add(id)) continue
                        try {
                            val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, id)
                            val projection = arrayOf("document_id", "_display_name", "mime_type", "_size", "flags")
                            activity.contentResolver.query(children, projection, null, null, null)?.use { cursor ->
                                while (!cancelled.get() && cursor.moveToNext()) {
                                    val childId = cursor.getString(0)
                                    val name = cursor.getString(1) ?: ""
                                    if (cursor.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR) {
                                        queue.add(childId to "$location / $name")
                                    } else if (cursor.getLong(4) and DocumentsContract.Document.FLAG_VIRTUAL_DOCUMENT.toLong() == 0L) {
                                        add(DocumentsContract.buildDocumentUriUsingTree(tree, childId), name, cursor.getLong(3), location)
                                    }
                                }
                            }
                        } catch (_: Exception) { omitted.add(location) }
                    }
                }
                synchronized(records) { records.clear(); records.putAll(found) }
                val rows = JSONArray()
                found.values.sortedBy { it.getString("name").lowercase() }.forEach { row ->
                    val visible = JSONObject(row.toString())
                    visible.remove("uri")
                    rows.put(visible)
                }
                invoke.resolve(JSObject().put("files", rows).put("sources", roots)
                    .put("cancelled", cancelled.get()).put("unreadableFolders", omitted.distinct().size))
            } catch (_: Exception) {
                invoke.reject("No se pudo completar la búsqueda. Puedes autorizar una carpeta y volver a buscar.")
            } finally { busy.set(false) }
        }
    }
}
