pub fn drive_enabled() -> bool {
    cfg!(feature = "drive-sync") && (cfg!(windows) || cfg!(target_os = "android"))
}

pub fn require_drive() -> Result<(), String> {
    if drive_enabled() {
        Ok(())
    } else {
        Err("La sincronización con Drive está desactivada en esta versión pública. Estará disponible en una versión futura.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(not(feature = "drive-sync"))]
    fn public_build_cannot_enable_drive_even_with_existing_credentials() {
        assert!(!drive_enabled());
        assert!(require_drive().is_err());
    }
}
