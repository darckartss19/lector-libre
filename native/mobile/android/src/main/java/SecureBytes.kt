package org.lectorlibre.mobile

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object SecureBytes {
    private const val ALIAS = "lector-libre-drive-v1"
    private val prefix = byteArrayOf(0x4c, 0x4c, 0x01)

    @Synchronized
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }

    fun transform(input: ByteArray, decrypt: Boolean): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        if (!decrypt) {
            cipher.init(Cipher.ENCRYPT_MODE, key())
            return prefix + cipher.iv + cipher.doFinal(input)
        }
        require(input.size >= 31 && input.copyOfRange(0, 3).contentEquals(prefix))
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, input.copyOfRange(3, 15)))
        return cipher.doFinal(input.copyOfRange(15, input.size))
    }
}
