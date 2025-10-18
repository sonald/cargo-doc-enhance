use std::ffi::OsStr;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use crate::injector;

#[derive(Debug, Default)]
pub struct Summary {
    pub modified: usize,
    pub skipped: usize,
}

pub fn enhance_dir(doc_dir: &Path) -> io::Result<Summary> {
    process_dir(doc_dir, Mode::Enhance)
}

pub fn revert_dir(doc_dir: &Path) -> io::Result<Summary> {
    process_dir(doc_dir, Mode::Revert)
}

enum Mode {
    Enhance,
    Revert,
}

fn process_dir(doc_dir: &Path, mode: Mode) -> io::Result<Summary> {
    let mut summary = Summary::default();
    let mut stack: Vec<PathBuf> = vec![doc_dir.to_path_buf()];

    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                stack.push(path);
                continue;
            }

            if path.extension() == Some(OsStr::new("html")) {
                if injector::should_skip_file(&path) {
                    summary.skipped += 1;
                    continue;
                }

                match process_html_file(&path, &mode) {
                    Ok(true) => summary.modified += 1,
                    Ok(false) => summary.skipped += 1,
                    Err(e) => eprintln!("Failed to process {}: {e}", path.display()),
                }
            }
        }
    }

    Ok(summary)
}

fn process_html_file(path: &Path, mode: &Mode) -> io::Result<bool> {
    let mut content = String::new();
    fs::File::open(path)?.read_to_string(&mut content)?;

    let updated = match mode {
        Mode::Enhance => injector::inject(&content),
        Mode::Revert => injector::revert(&content),
    };

    if let Some(modified) = updated {
        fs::File::create(path)?.write_all(modified.as_bytes())?;
        Ok(true)
    } else {
        Ok(false)
    }
}
