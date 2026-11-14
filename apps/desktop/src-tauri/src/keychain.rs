//! API keys in the macOS Keychain (TL-13): one generic password per account (`anthropic`,
//! `codex`) under Noter's own service. Any failure but "not found" is `keychain_locked`.

use noter_core::{KeychainLocked, Secret, SecretStore};
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

const SERVICE: &str = "com.getahead.noter.api-keys";
/// `errSecItemNotFound`.
const NOT_FOUND: i32 = -25300;

pub(crate) struct Keychain;

impl SecretStore for Keychain {
    fn get(&self, account: &str) -> Result<Option<Secret>, KeychainLocked> {
        match get_generic_password(SERVICE, account) {
            Ok(bytes) => String::from_utf8(bytes)
                .map(|key| Some(Secret::new(key)))
                .map_err(|_| KeychainLocked),
            Err(e) if e.code() == NOT_FOUND => Ok(None),
            Err(_) => Err(KeychainLocked),
        }
    }

    fn set(&self, account: &str, secret: &Secret) -> Result<(), KeychainLocked> {
        set_generic_password(SERVICE, account, secret.expose().as_bytes()).map_err(|_| KeychainLocked)
    }

    fn remove(&self, account: &str) -> Result<(), KeychainLocked> {
        match delete_generic_password(SERVICE, account) {
            Err(e) if e.code() != NOT_FOUND => Err(KeychainLocked),
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn a_missing_key_can_be_set_read_and_removed_twice() {
        let account = format!(
            "noter-test-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        );
        let store = Keychain;
        let secret = Secret::new("test-secret".to_owned());

        let _ = store.remove(&account);
        assert!(store.get(&account).unwrap().is_none());
        store.set(&account, &secret).unwrap();
        assert_eq!(store.get(&account).unwrap().unwrap().expose(), "test-secret");
        store.remove(&account).unwrap();
        assert!(store.get(&account).unwrap().is_none());
        store.remove(&account).unwrap();
    }
}
