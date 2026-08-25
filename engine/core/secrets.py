"""At-rest encryption for the credentials the app has to keep.

The LinkedIn session is a real credential: whoever holds the cookies is logged in
as the user. It cannot be hashed (we have to replay it), so it is encrypted with
a key the app never stores next to the data.

* **Windows** — DPAPI (``CryptProtectData``). The key is derived by the OS from
  the user's login credentials, so the blob is useless on another account or
  machine, and nothing key-shaped is written to disk at all.
* **Everything else** — a 32-byte key file in the data directory, owner-only,
  with a BLAKE2b keystream and a BLAKE2b MAC over the ciphertext. This is the
  development path; the shipped product is Windows.

Both paths produce a self-describing blob (``v1:dpapi:`` / ``v1:kf:``) so a
credential written by one is never silently misread by the other.
"""

from __future__ import annotations

import hmac
import os
import secrets as _secrets
import sys
from pathlib import Path

from .config import get_settings
from .logging import get_logger

log = get_logger(__name__)

#: Mixed into the DPAPI blob so a credential from another app cannot be decrypted
#: through this one even under the same Windows account.
_ENTROPY = b"linkedin-outreach/v1/session"

_KEY_FILENAME = ".session-key"
_KEY_SIZE = 32
_NONCE_SIZE = 16
_MAC_SIZE = 32


class SecretError(RuntimeError):
    """Raised when a stored credential cannot be read back."""


# --------------------------------------------------------------------- Windows


def _dpapi_call(protect: bool, payload: bytes) -> bytes:
    import ctypes
    from ctypes import wintypes

    class DataBlob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    def to_blob(data: bytes) -> DataBlob:
        buffer = ctypes.create_string_buffer(data, len(data))
        return DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))

    source = to_blob(payload)
    entropy = to_blob(_ENTROPY)
    result = DataBlob()

    crypt32 = ctypes.windll.crypt32
    function = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    # (pDataIn, description, pOptionalEntropy, reserved, promptStruct, flags, pDataOut)
    ok = function(
        ctypes.byref(source),
        None,
        ctypes.byref(entropy),
        None,
        None,
        0,
        ctypes.byref(result),
    )
    if not ok:
        raise SecretError(
            f"Windows {'CryptProtectData' if protect else 'CryptUnprotectData'} failed "
            f"(error {ctypes.GetLastError()})"
        )

    try:
        return ctypes.string_at(result.pbData, result.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(result.pbData)


# ------------------------------------------------------------------ key file


def _key_path() -> Path:
    return get_settings().data_dir / _KEY_FILENAME


def _load_or_create_key() -> bytes:
    path = _key_path()
    if path.exists():
        key = path.read_bytes()
        if len(key) == _KEY_SIZE:
            return key
        log.warning("Session key at %s is malformed; regenerating", path)

    key = _secrets.token_bytes(_KEY_SIZE)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Create with owner-only permissions from the outset rather than widening
    # then narrowing, which would leave a window where the key is readable.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(key)
    return key


def _keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    """BLAKE2b in counter mode — a PRF expanded to the length we need."""
    out = bytearray()
    counter = 0
    while len(out) < length:
        import hashlib

        block = hashlib.blake2b(
            nonce + counter.to_bytes(8, "big"), key=key, digest_size=64
        ).digest()
        out.extend(block)
        counter += 1
    return bytes(out[:length])


def _mac(key: bytes, nonce: bytes, ciphertext: bytes) -> bytes:
    import hashlib

    return hashlib.blake2b(nonce + ciphertext, key=key, digest_size=_MAC_SIZE).digest()


def _keyfile_encrypt(payload: bytes) -> bytes:
    key = _load_or_create_key()
    nonce = _secrets.token_bytes(_NONCE_SIZE)
    keystream = _keystream(key, nonce, len(payload))
    ciphertext = bytes(a ^ b for a, b in zip(payload, keystream, strict=True))
    return nonce + _mac(key, nonce, ciphertext) + ciphertext


def _keyfile_decrypt(blob: bytes) -> bytes:
    if len(blob) < _NONCE_SIZE + _MAC_SIZE:
        raise SecretError("Stored credential is truncated")

    key = _load_or_create_key()
    nonce = blob[:_NONCE_SIZE]
    tag = blob[_NONCE_SIZE : _NONCE_SIZE + _MAC_SIZE]
    ciphertext = blob[_NONCE_SIZE + _MAC_SIZE :]

    if not hmac.compare_digest(tag, _mac(key, nonce, ciphertext)):
        raise SecretError("Stored credential failed its integrity check")

    keystream = _keystream(key, nonce, len(ciphertext))
    return bytes(a ^ b for a, b in zip(ciphertext, keystream, strict=True))


# --------------------------------------------------------------------- public


def encrypt(plaintext: str) -> bytes:
    """Encrypt a secret for storage in SQLite."""
    payload = plaintext.encode("utf-8")
    if sys.platform == "win32":
        return b"v1:dpapi:" + _dpapi_call(True, payload)
    return b"v1:kf:" + _keyfile_encrypt(payload)


def decrypt(blob: bytes | None) -> str | None:
    """Read a secret back. Returns None when there is nothing stored."""
    if not blob:
        return None

    if blob.startswith(b"v1:dpapi:"):
        if sys.platform != "win32":
            raise SecretError("This credential was encrypted with Windows DPAPI")
        return _dpapi_call(False, blob[len(b"v1:dpapi:") :]).decode("utf-8")

    if blob.startswith(b"v1:kf:"):
        return _keyfile_decrypt(blob[len(b"v1:kf:") :]).decode("utf-8")

    raise SecretError("Unrecognised credential format")


def try_decrypt(blob: bytes | None) -> str | None:
    """Decrypt, downgrading failure to None.

    A credential that cannot be read means the user signs in again — that is a
    recoverable inconvenience, not a reason to fail the call that needed it.
    """
    try:
        return decrypt(blob)
    except SecretError as error:
        log.warning("Discarding unreadable stored credential: %s", error)
        return None
