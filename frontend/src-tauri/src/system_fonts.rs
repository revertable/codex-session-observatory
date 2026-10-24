use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SystemFont {
    pub family: String,
    pub display_name: String,
}

fn normalize(mut fonts: Vec<SystemFont>) -> Vec<SystemFont> {
    fonts.retain(|f| !f.family.trim().is_empty() && !f.family.starts_with('@'));
    fonts.sort_by_key(|f| (f.family.to_lowercase(), f.display_name.clone()));
    fonts.dedup_by(|a, b| a.family.to_lowercase() == b.family.to_lowercase());
    fonts.sort_by_key(|f| (f.display_name.to_lowercase(), f.family.clone()));
    fonts
}

#[cfg(windows)]
pub fn list() -> Result<Vec<SystemFont>, String> {
    use windows::{
        Win32::{
            Globalization::GetUserDefaultLocaleName,
            Graphics::DirectWrite::{
                DWRITE_FACTORY_TYPE_SHARED, DWriteCreateFactory, IDWriteFactory,
                IDWriteLocalizedStrings,
            },
        },
        core::PCWSTR,
    };

    // COM handles and buffers stay within this blocking task. No font installation
    // or filesystem enumeration is performed; DirectWrite owns the collection.
    unsafe fn name(names: &IDWriteLocalizedStrings, locale: &str) -> windows::core::Result<String> {
        let mut index = 0;
        let mut exists = windows::core::BOOL(0);
        let requested: Vec<u16> = locale.encode_utf16().chain(Some(0)).collect();
        unsafe {
            names.FindLocaleName(PCWSTR(requested.as_ptr()), &mut index, &mut exists)?;
        }
        if !exists.as_bool() && locale != "en-us" {
            let english: Vec<u16> = "en-us".encode_utf16().chain(Some(0)).collect();
            unsafe {
                names.FindLocaleName(PCWSTR(english.as_ptr()), &mut index, &mut exists)?;
            }
        }
        if !exists.as_bool() {
            index = 0;
        }
        let mut buffer = vec![0u16; unsafe { names.GetStringLength(index)? } as usize + 1];
        unsafe {
            names.GetString(index, &mut buffer)?;
        }
        buffer.pop();
        Ok(String::from_utf16_lossy(&buffer))
    }

    let result = unsafe {
        (|| -> windows::core::Result<Vec<SystemFont>> {
            let factory: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)?;
            let mut collection = None;
            factory.GetSystemFontCollection(&mut collection, true)?;
            let collection = collection.ok_or_else(windows::core::Error::from_win32)?;
            let mut locale = [0u16; 85];
            let length = GetUserDefaultLocaleName(&mut locale);
            let locale = if length > 1 {
                String::from_utf16_lossy(&locale[..length as usize - 1])
            } else {
                "en-us".into()
            };
            let mut fonts = Vec::new();
            for i in 0..collection.GetFontFamilyCount() {
                let names = collection.GetFontFamily(i)?.GetFamilyNames()?;
                fonts.push(SystemFont {
                    family: name(&names, "en-us")?,
                    display_name: name(&names, &locale)?,
                });
            }
            Ok(normalize(fonts))
        })()
    };
    result.map_err(|e| e.to_string())
}

#[cfg(not(windows))]
pub fn list() -> Result<Vec<SystemFont>, String> {
    Err("System font selection is supported on Windows.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn families_are_deduplicated_without_merging_distinct_families() {
        let fonts = normalize(
            [
                ("Malgun Gothic", "맑은 고딕"),
                ("malgun gothic", "맑은 고딕"),
                ("Arial", "Arial"),
                ("Arial Narrow", "Arial Narrow"),
                ("@Arial", "@Arial"),
                ("", ""),
            ]
            .into_iter()
            .map(|(a, b)| SystemFont {
                family: a.into(),
                display_name: b.into(),
            })
            .collect(),
        );
        assert_eq!(fonts.len(), 3);
        assert!(fonts.iter().any(|f| f.display_name == "맑은 고딕"));
        assert!(fonts.iter().any(|f| f.family == "Arial Narrow"));
    }
    #[cfg(windows)]
    #[test]
    fn actual_windows_collection_has_nonempty_unique_family_names() {
        let fonts = list().expect("DirectWrite system font enumeration");
        assert!(!fonts.is_empty());
        let unique: std::collections::HashSet<_> =
            fonts.iter().map(|f| f.family.to_lowercase()).collect();
        assert_eq!(fonts.len(), unique.len());
        assert!(fonts.iter().all(|f| !f.display_name.is_empty()));
    }
}
