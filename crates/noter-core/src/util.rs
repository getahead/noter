use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::Path;

use noter_protocol::ipc::{Caller, CommandCtx};
use noter_protocol::model::WindowLabel;
use noter_protocol::{internal, CoreError, ErrorCode};

pub(crate) fn write_private(path: &Path, bytes: &[u8]) -> Result<(), CoreError> {
    write_private_with(path, |file| file.write_all(bytes).map_err(internal))
}

pub(crate) fn write_private_with(
    path: &Path,
    write: impl FnOnce(&mut std::fs::File) -> Result<(), CoreError>,
) -> Result<(), CoreError> {
    let dir = path
        .parent()
        .ok_or_else(|| CoreError::new(ErrorCode::Internal, "no folder"))?;
    std::fs::create_dir_all(dir).map_err(internal)?;
    let name = path
        .file_name()
        .ok_or_else(|| CoreError::new(ErrorCode::Internal, "no filename"))?;
    let tmp = path.with_file_name(format!("{}.tmp", name.to_string_lossy()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(internal)?;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(internal)?;
        write(&mut file)?;
        file.sync_all().map_err(internal)?;
        std::fs::rename(&tmp, path).map_err(internal)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(tmp);
    }
    result
}

pub(crate) fn marks(n: usize) -> String {
    vec!["?"; n].join(", ")
}

pub(crate) fn private_dir(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

pub(crate) fn main_window_ctx() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn private_atomic_write_sets_mode_even_when_replacing_a_permissive_temp() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secret.json");
        let temp = dir.path().join("secret.json.tmp");
        std::fs::write(&temp, b"old").unwrap();
        std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o644)).unwrap();
        super::write_private(&path, b"second").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"second");
        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
