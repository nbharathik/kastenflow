//! Unpacking Tectonic's release: a `.zip` on Windows, a `.tar.gz` elsewhere,
//! each holding the one program. Only that program is taken, and it is written
//! to a fixed name in the new folder, so nothing in the archive can choose
//! where anything goes. The download has passed its checksum before this
//! runs; the size limits are a second wall. The `.tar.gz` is read by hand
//! (the format is a header block per file), which keeps a crate out of the app.

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use flate2::read::GzDecoder;
use zip::ZipArchive;

use super::engines::TECTONIC_PROGRAM;
use crate::plugins::payload::{Failure, Spec, failed};

/// The largest program accepted, and the most a `.tar.gz` may unpack to.
pub const MAX_PROGRAM: u64 = 300 * 1024 * 1024;
const MAX_UNPACKED: u64 = MAX_PROGRAM + 64 * 1024 * 1024;
const BLOCK: usize = 512;
/// The longest long name read from a GNU header.
const MAX_LONG_NAME: u64 = 4096;

/// How the LaTeX engine is installed: unpacked here, whole when the program is there.
pub fn spec() -> Spec {
    Spec {
        label: "the LaTeX engine".to_owned(),
        required: TECTONIC_PROGRAM,
        unpack: Arc::new(unpack),
    }
}

fn io_failed(what: &'static str) -> impl Fn(io::Error) -> Failure {
    move |err| Failure::Failed(format!("Could not {what}: {err}"))
}

/// Whether an archive entry named `name` is the program: that name last, at
/// most two folders deep, and never a `..` on the way.
fn wanted(name: &str) -> bool {
    let name = name.strip_prefix("./").unwrap_or(name);
    let parts: Vec<&str> = name.split('/').collect();
    parts.len() <= 3
        && parts.last() == Some(&TECTONIC_PROGRAM)
        && !parts.iter().any(|p| *p == ".." || p.is_empty())
}

/// Unpacks the Tectonic program from the archive at `archive` into `into`.
pub fn unpack(
    archive: &Path,
    into: &Path,
    cancel: &AtomicBool,
    progress: &dyn Fn(u64, u64),
) -> Result<(), Failure> {
    let mut magic = [0u8; 4];
    File::open(archive)
        .and_then(|mut f| f.read_exact(&mut magic))
        .map_err(io_failed("open the download"))?;
    fs::create_dir_all(into).map_err(io_failed("make a folder for the LaTeX engine"))?;
    let program = into.join(TECTONIC_PROGRAM);
    let found = if magic == *b"PK\x03\x04" {
        from_zip(archive, &program, cancel, progress)?
    } else if magic[..2] == [0x1f, 0x8b] {
        from_tar_gz(archive, &program, cancel, progress)?
    } else {
        return failed("The download is neither a ZIP nor a .tar.gz file");
    };
    if !found {
        return failed("The download does not hold the LaTeX engine's program");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&program, fs::Permissions::from_mode(0o755))
            .map_err(io_failed("make the LaTeX engine runnable"))?;
    }
    Ok(())
}

/// Copies `size` bytes of `from` to a new file at `to`.
fn write_program(
    from: &mut impl Read,
    size: u64,
    to: &Path,
    cancel: &AtomicBool,
    progress: &dyn Fn(u64, u64),
) -> Result<(), Failure> {
    if size == 0 || size > MAX_PROGRAM {
        return failed("The LaTeX engine in the download has an unexpected size");
    }
    let mut out = File::create_new(to).map_err(io_failed("unpack the LaTeX engine"))?;
    let mut buffer = vec![0u8; 256 * 1024];
    let mut done = 0u64;
    while done < size {
        if cancel.load(Ordering::Relaxed) {
            return Err(Failure::Cancelled);
        }
        let want = buffer.len().min((size - done) as usize);
        let got = from
            .read(&mut buffer[..want])
            .map_err(io_failed("read the download"))?;
        if got == 0 {
            return failed("The download ends before the LaTeX engine does");
        }
        out.write_all(&buffer[..got])
            .map_err(io_failed("unpack the LaTeX engine"))?;
        done += got as u64;
        progress(done, size);
    }
    out.sync_all().map_err(io_failed("unpack the LaTeX engine"))
}

fn from_zip(
    archive: &Path,
    program: &Path,
    cancel: &AtomicBool,
    progress: &dyn Fn(u64, u64),
) -> Result<bool, Failure> {
    let file = File::open(archive).map_err(io_failed("open the download"))?;
    let mut zip = ZipArchive::new(file)
        .map_err(|err| Failure::Failed(format!("The download is not a ZIP file: {err}")))?;
    for at in 0..zip.len() {
        let mut entry = zip
            .by_index(at)
            .map_err(|err| Failure::Failed(format!("The download cannot be read: {err}")))?;
        let link = entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170_000 == 0o120_000);
        if entry.is_dir() || link || !wanted(entry.name()) {
            continue;
        }
        let size = entry.size();
        write_program(&mut entry, size, program, cancel, progress)?;
        return Ok(true);
    }
    Ok(false)
}

/// A header field: the text up to its first NUL.
fn text_of(field: &[u8]) -> String {
    let end = field.iter().position(|b| *b == 0).unwrap_or(field.len());
    String::from_utf8_lossy(&field[..end]).into_owned()
}

/// A header number in octal (a field that does not read as one is none).
fn octal(field: &[u8]) -> Option<u64> {
    let text = text_of(field);
    let text = text.trim();
    if text.is_empty() {
        return Some(0);
    }
    u64::from_str_radix(text, 8).ok()
}

/// Reads up to `buf.len()` bytes; fewer only at the end.
fn read_full(reader: &mut impl Read, buf: &mut [u8]) -> io::Result<usize> {
    let mut got = 0;
    while got < buf.len() {
        match reader.read(&mut buf[got..])? {
            0 => break,
            n => got += n,
        }
    }
    Ok(got)
}

fn skip(reader: &mut impl Read, bytes: u64) -> Result<(), Failure> {
    let skipped = io::copy(&mut reader.take(bytes), &mut io::sink())
        .map_err(io_failed("read the download"))?;
    if skipped == bytes {
        Ok(())
    } else {
        failed("The download ends too soon")
    }
}

fn from_tar_gz(
    archive: &Path,
    program: &Path,
    cancel: &AtomicBool,
    progress: &dyn Fn(u64, u64),
) -> Result<bool, Failure> {
    let file = File::open(archive).map_err(io_failed("open the download"))?;
    // However much the archive claims, no more than this is ever unpacked.
    let mut reader = GzDecoder::new(file).take(MAX_UNPACKED);
    let mut long_name: Option<String> = None;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(Failure::Cancelled);
        }
        let mut header = [0u8; BLOCK];
        let got = read_full(&mut reader, &mut header).map_err(io_failed("read the download"))?;
        if got == 0 || header.iter().all(|b| *b == 0) {
            return Ok(false);
        }
        if got < BLOCK {
            return failed("The download ends too soon");
        }
        let size = octal(&header[124..136])
            .ok_or_else(|| Failure::Failed("The download has an unreadable header".to_owned()))?;
        let padded = size.div_ceil(BLOCK as u64) * BLOCK as u64;
        let kind = header[156];
        if kind == b'L' {
            // GNU: the next entry's long name is this entry's data.
            if size > MAX_LONG_NAME {
                return failed("The download has a name that is too long");
            }
            let mut name = vec![0u8; size as usize];
            reader
                .read_exact(&mut name)
                .map_err(io_failed("read the download"))?;
            skip(&mut reader, padded - size)?;
            long_name = Some(text_of(&name));
            continue;
        }
        let mut name = text_of(&header[0..100]);
        if &header[257..262] == b"ustar" {
            let prefix = text_of(&header[345..500]);
            if !prefix.is_empty() {
                name = format!("{prefix}/{name}");
            }
        }
        let name = long_name.take().unwrap_or(name);
        if (kind == b'0' || kind == 0) && wanted(&name) {
            write_program(&mut reader, size, program, cancel, progress)?;
            return Ok(true);
        }
        skip(&mut reader, padded)?;
    }
}
