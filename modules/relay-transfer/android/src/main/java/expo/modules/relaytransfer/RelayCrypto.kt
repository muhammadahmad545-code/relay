package expo.modules.relaytransfer

import android.util.Base64
import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import javax.crypto.KeyAgreement
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Wire format for every encrypted message: nonce (12 bytes) || ciphertext || GCM tag (16 bytes).
 * The AAD string binds a message to its purpose so a captured message cannot be replayed elsewhere.
 */
object RelayCrypto {
  const val KEY_BYTES = 32
  const val NONCE_BYTES = 12
  const val TAG_BYTES = 16
  const val OVERHEAD = NONCE_BYTES + TAG_BYTES

  private val random = SecureRandom()

  fun newKey(): ByteArray = ByteArray(KEY_BYTES).also { random.nextBytes(it) }

  fun newId(): String {
    val bytes = ByteArray(9).also { random.nextBytes(it) }
    return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
  }

  /** Request token derived from the key. Proves the caller scanned the QR code without revealing the key. */
  fun token(key: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256")
    digest.update("relay-auth-v1".toByteArray(Charsets.UTF_8))
    digest.update(key)
    return digest.digest().take(16).joinToString("") { "%02x".format(it) }
  }

  fun encodeKey(key: ByteArray): String =
    Base64.encodeToString(key, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

  fun decodeKey(encoded: String): ByteArray {
    val key = try {
      Base64.decode(encoded, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    } catch (e: IllegalArgumentException) {
      throw IllegalArgumentException("The pairing code is not valid.")
    }
    require(key.size == KEY_BYTES) { "The pairing code is not valid." }
    return key
  }

  fun seal(key: ByteArray, aad: String, plain: ByteArray, offset: Int = 0, length: Int = plain.size): ByteArray {
    val nonce = ByteArray(NONCE_BYTES).also { random.nextBytes(it) }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BYTES * 8, nonce))
    cipher.updateAAD(aad.toByteArray(Charsets.UTF_8))
    val sealed = ByteArray(NONCE_BYTES + cipher.getOutputSize(length))
    System.arraycopy(nonce, 0, sealed, 0, NONCE_BYTES)
    cipher.doFinal(plain, offset, length, sealed, NONCE_BYTES)
    return sealed
  }

  /** Throws javax.crypto.AEADBadTagException when the key is wrong or the data was altered. */
  fun open(key: ByteArray, aad: String, sealed: ByteArray): ByteArray {
    require(sealed.size >= OVERHEAD) { "Encrypted message is too short." }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BYTES * 8, sealed, 0, NONCE_BYTES))
    cipher.updateAAD(aad.toByteArray(Charsets.UTF_8))
    return cipher.doFinal(sealed, NONCE_BYTES, sealed.size - NONCE_BYTES)
  }

  // ---- linking a browser by scanning its screen --------------------------------------------

  class LinkResponse(val publicKey: String, val sealedKey: String)

  private const val URL_FLAGS = Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP

  private fun fixed32(value: BigInteger): ByteArray {
    val raw = value.toByteArray()
    val out = ByteArray(32)
    val length = minOf(32, raw.size)
    System.arraycopy(raw, raw.size - length, out, 32 - length, length)
    return out
  }

  /**
   * The browser's P-256 public key arrived through the camera. Do ECDH with a fresh key pair and
   * wrap the session key so only that browser can unwrap it.
   */
  fun linkResponse(sessionKey: ByteArray, id: String, browserPublicKey: String): LinkResponse {
    val point = try {
      Base64.decode(browserPublicKey, URL_FLAGS)
    } catch (e: IllegalArgumentException) {
      throw IllegalArgumentException("That is not a Relay link code.")
    }
    require(point.size == 65 && point[0] == 4.toByte()) { "That is not a Relay link code." }

    val params = AlgorithmParameters.getInstance("EC").run {
      init(ECGenParameterSpec("secp256r1"))
      getParameterSpec(ECParameterSpec::class.java)
    }
    val x = BigInteger(1, point.copyOfRange(1, 33))
    val y = BigInteger(1, point.copyOfRange(33, 65))
    // generatePublic validates that the point is on the curve.
    val theirs = KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(ECPoint(x, y), params))

    val pair = KeyPairGenerator.getInstance("EC").run {
      initialize(ECGenParameterSpec("secp256r1"), random)
      generateKeyPair()
    }
    val shared = KeyAgreement.getInstance("ECDH").run {
      init(pair.private)
      doPhase(theirs, true)
      generateSecret()
    }
    val wrapKey = MessageDigest.getInstance("SHA-256").run {
      update("relay-link-v1".toByteArray(Charsets.UTF_8))
      update(shared)
      update(id.toByteArray(Charsets.UTF_8))
      digest()
    }
    val w = (pair.public as ECPublicKey).w
    val mine = byteArrayOf(4) + fixed32(w.affineX) + fixed32(w.affineY)
    return LinkResponse(
      Base64.encodeToString(mine, URL_FLAGS),
      Base64.encodeToString(seal(wrapKey, "link:$id", sessionKey), URL_FLAGS)
    )
  }
}
