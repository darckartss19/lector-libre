package org.lectorlibre.mobile

import android.app.Activity
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.Scope
import org.json.JSONArray

class GoogleDriveAuth(private val activity: Activity, private val plugin: LibraryPlugin) {
    private val allowed = setOf(
        "https://www.googleapis.com/auth/drive.appdata",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/drive.readonly"
    )

    fun authorize(invoke: Invoke, scopes: List<String>, interactive: Boolean) {
        if (scopes.isEmpty() || !allowed.containsAll(scopes)) {
            invoke.reject("Permiso de Drive no válido.")
            return
        }
        if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(activity) != ConnectionResult.SUCCESS) {
            invoke.reject("Actualiza los Servicios de Google Play para conectar Drive.")
            return
        }
        val request = AuthorizationRequest.builder().setRequestedScopes(scopes.distinct().map(::Scope)).build()
        Identity.getAuthorizationClient(activity).authorize(request).addOnSuccessListener { result ->
            if (!result.hasResolution()) resolve(invoke, result)
            else if (!interactive) invoke.reject("Vuelve a conectar Google para renovar el permiso de Drive.")
            else {
                val intent = result.pendingIntent
                if (intent == null) invoke.reject("Google no pudo abrir el permiso de Drive.")
                else plugin.startIntentSenderForResult(invoke, IntentSenderRequest.Builder(intent.intentSender).build(), "googleResult")
            }
        }.addOnFailureListener {
            invoke.reject("No se pudo conectar Google. Comprueba internet y el cliente Android del proyecto de Google.")
        }
    }

    fun finish(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.reject("Se canceló el permiso de Google.")
            return
        }
        try { resolve(invoke, Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(result.data)) }
        catch (_: Exception) { invoke.reject("Google no devolvió un permiso válido.") }
    }

    private fun resolve(invoke: Invoke, result: AuthorizationResult) {
        val token = result.accessToken
        val scopes = result.grantedScopes
        if (token.isNullOrBlank() || "https://www.googleapis.com/auth/drive.appdata" !in scopes) {
            invoke.reject("Se necesita el permiso para guardar el progreso del lector en Drive.")
            return
        }
        // This response goes to Rust, never to the WebView or logs.
        invoke.resolve(JSObject().put("accessToken", token).put("scopes", JSONArray(scopes)))
    }
}
