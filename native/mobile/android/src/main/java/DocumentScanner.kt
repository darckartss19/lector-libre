package org.lectorlibre.mobile

import android.app.Activity
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.provider.MediaStore
import androidx.activity.result.ActivityResult
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.ArrayDeque
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class DocumentScanner(private val activity: Activity) {
    private val preferences = activity.getSharedPreferences("document-search", 0)
    private val worker = Executors.newSingleThreadExecutor()
    private val cancelled = AtomicBoolean(false)
    private val busy = AtomicBoolean(false)
    private val records = LinkedHashMap<String, JSONObject>()

    fun sources(): JSONArray {
        val saved = JSONArray(preferences.getString("sources", "[]"))
        val grants = activity.contentResolver.persistedUriPermissions
            .filter { it.isReadPermission }.map { it.uri.toString() }.toSet()
        for (i in 0 until saved.length()) {
            val root = saved.getJSONObject(i)
            root.put("readable", root.getString("uri") in grants)
        }
        return saved
    }

    fun accessState(): JSObject {
        val roots = sources()
        val readable = (0 until roots.length()).count { roots.getJSONObject(it).optBoolean("readable") }
        val scoped = Build.VERSION.SDK_INT >= 29
        return JSObject().put("sources", roots).put("scopedStorage", scoped)
            .put("needsFolder", scoped && readable == 0)
            .put("legacyPermissionDenied", !scoped && activity.checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED)
    }

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
            invoke.resolve(accessState())
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
        val access = accessState()
        if (access.getBoolean("needsFolder")) {
            invoke.resolve(access.put("files", JSONArray()))
            return
        }
        if (!busy.compareAndSet(false, true)) {
            invoke.reject("Ya hay una búsqueda en curso.")
            return
        }
        cancelled.set(false)
        worker.execute {
            val result = try {
                val allowed = extensions.filter { it.matches(Regex("[a-z0-9]+")) }.toSet()
                val found = LinkedHashMap<String, JSONObject>()
                val omitted = ArrayList<String>()
                fun add(uri: Uri, name: String, size: Long, location: String) {
                    val extension = name.substringAfterLast('.', "").lowercase(Locale.ROOT)
                    if (extension !in allowed) return
                    val key = MessageDigest.getInstance("SHA-256").digest(uri.toString().toByteArray())
                        .joinToString("") { "%02x".format(it) }
                    found[key] = JSONObject().put("key", key).put("uri", uri.toString())
                        .put("name", name).put("size", size.coerceAtLeast(0)).put("format", extension)
                        .put("location", location)
                }
                // MediaStore only returns the files visible to this application.
                var limitedIndex = false
                if (!access.getBoolean("legacyPermissionDenied")) try {
                    val base = MediaStore.Files.getContentUri("external")
                    val columns = if (android.os.Build.VERSION.SDK_INT < 29) arrayOf("_id", "_display_name", "_size", "_data") else arrayOf("_id", "_display_name", "_size")
                    val cursor = activity.contentResolver.query(base, columns, null, null, null)
                    if (cursor == null) limitedIndex = true
                    cursor?.use {
                        while (!cancelled.get() && cursor.moveToNext()) {
                            val name = cursor.getString(1) ?: if (columns.size == 4) cursor.getString(3)?.substringAfterLast('/') else null
                            add(Uri.withAppendedPath(base, cursor.getLong(0).toString()), name ?: "", cursor.getLong(2), "Archivos visibles del teléfono")
                        }
                    }
                } catch (_: Exception) { limitedIndex = true }
                val roots = sources()
                for (i in 0 until roots.length()) {
                    if (cancelled.get()) break
                    val root = roots.getJSONObject(i)
                    if (!root.optBoolean("readable")) {
                        omitted.add(root.getString("name"))
                        continue
                    }
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
                            val cursor = activity.contentResolver.query(children, projection, null, null, null)
                            if (cursor == null) omitted.add(location)
                            cursor?.use {
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
                found.values.sortedBy { it.getString("name").lowercase(Locale.ROOT) }.forEach { row ->
                    val visible = JSONObject(row.toString())
                    visible.remove("uri")
                    rows.put(visible)
                }
                accessState().put("files", rows).put("sources", roots)
                    .put("cancelled", cancelled.get()).put("unreadableFolders", omitted.distinct().size)
                    .put("limitedIndex", limitedIndex)
            } catch (_: Exception) {
                null
            } finally { busy.set(false) }
            if (result != null) invoke.resolve(result)
            else invoke.reject("No se pudo completar la búsqueda. Puedes autorizar una carpeta y volver a buscar.")
        }
    }
}
