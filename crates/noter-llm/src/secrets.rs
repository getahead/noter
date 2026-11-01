// @cpt-algo:cpt-noter-algo-core-credentials-privacy-secret-boundary:p1
//! API keys (TL-13): the [`SecretStore`] seam, the Keychain in the app and memory in tests and
//! noter-core-harness, and the [`Secret`] that carries a key only to verification, the store
//! and a runtime's environment.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};

use noter_protocol::RuntimeChoice;
use zeroize::Zeroizing;

use crate::runtime::lock;

// @cpt-begin:cpt-noter-algo-core-credentials-privacy-secret-boundary:p1:inst-secret-scrub
/// An API key in memory: never printed, its buffer wiped when the last copy drops.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(Zeroizing<String>);

impl Secret {
    pub fn new(key: String) -> Self {
        Self(Zeroizing::new(key))
    }

    /// The key itself: for the store and a runtime's environment, never for a record or a log.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(…)")
    }
}
// @cpt-end:cpt-noter-algo-core-credentials-privacy-secret-boundary:p1:inst-secret-scrub

/// The Keychain could not be read or written (locked, or access denied): `keychain_locked`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeychainLocked;

/// Where API keys live, by account (`anthropic`, `codex`).
pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<Secret>, KeychainLocked>;
    fn set(&self, account: &str, secret: &Secret) -> Result<(), KeychainLocked>;
    /// For `api_key_remove` (M3); no M2 command calls it.
    fn remove(&self, account: &str) -> Result<(), KeychainLocked>;
}

/// The Keychain stand-in of tests and noter-core-harness: keys in memory, and a lock that
/// fails every access the way a locked Keychain does.
#[derive(Debug, Default)]
pub struct MemorySecrets {
    keys: Mutex<HashMap<String, Secret>>,
    locked: AtomicBool,
}

impl MemorySecrets {
    pub fn set_locked(&self, locked: bool) {
        self.locked.store(locked, Ordering::SeqCst);
    }

    fn open(&self) -> Result<MutexGuard<'_, HashMap<String, Secret>>, KeychainLocked> {
        if self.locked.load(Ordering::SeqCst) {
            return Err(KeychainLocked);
        }
        Ok(lock(&self.keys))
    }
}

impl SecretStore for MemorySecrets {
    fn get(&self, account: &str) -> Result<Option<Secret>, KeychainLocked> {
        Ok(self.open()?.get(account).cloned())
    }

    fn set(&self, account: &str, secret: &Secret) -> Result<(), KeychainLocked> {
        self.open()?.insert(account.into(), secret.clone());
        Ok(())
    }

    fn remove(&self, account: &str) -> Result<(), KeychainLocked> {
        self.open()?.remove(account);
        Ok(())
    }
}

/// The store account of an API-key runtime's key; `None` for own accounts and the local runtime.
pub fn key_account(runtime: RuntimeChoice) -> Option<&'static str> {
    match runtime {
        RuntimeChoice::ClaudeApiKey => Some("anthropic"),
        RuntimeChoice::CodexApiKey => Some("codex"),
        _ => None,
    }
}
