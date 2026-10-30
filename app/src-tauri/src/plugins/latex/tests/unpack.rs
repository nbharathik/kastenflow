//! Unpacking Tectonic's release: the one program and nothing else, from a
//! `.zip` or a `.tar.gz` built here by hand.

use std::fs;
use std::io::Write;
use std::sync::atomic::AtomicBool;

use flate2::Compression;
use flate2::write::GzEncoder;
use zip::write::SimpleFileOptions;

use super::support::Dir;
use crate::plugins::latex::engines::TECTONIC_PROGRAM;
use crate::plugins::latex::unpack::{spec, unpack};
use crate::plugins::payload::Failure;

/// One tar entry: a 512-byte header and the data padded to 512.
fn tar_entry(name: &str, kind: u8, data: &[u8]) -> Vec<u8> {
    let mut header = [0u8; 512];
    header[..name.len()].copy_from_slice(name.as_bytes());
    header[100..107].copy_from_slice(b"0000755");
    header[124..135].copy_from_slice(format!("{:011o}", data.len()).as_bytes());
    header[156] = kind;
    header[257..262].copy_from_slice(b"ustar");
    let mut out = header.to_vec();
    out.extend_from_slice(data);
    out.resize(out.len().div_ceil(512) * 512, 0);
    out
}

fn tar_gz(entries: &[(&str, u8, &[u8])]) -> Vec<u8> {
    let mut tar = Vec::new();
    for (name, kind, data) in entries {
        tar.extend(tar_entry(name, *kind, data));
    }
    tar.extend([0u8; 1024]);
    let mut gz = GzEncoder::new(Vec::new(), Compression::fast());
    gz.write_all(&tar).unwrap();
    gz.finish().unwrap()
}

fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, data) in entries {
        zip.start_file(*name, SimpleFileOptions::default()).unwrap();
        zip.write_all(data).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

fn run(dir: &Dir, archive: &[u8]) -> Result<(), Failure> {
    let file = dir.join("download.partial");
    fs::write(&file, archive).unwrap();
    unpack(&file, &dir.join("new"), &AtomicBool::new(false), &|_, _| {})
}

fn program(dir: &Dir) -> Vec<u8> {
    fs::read(dir.join("new").join(TECTONIC_PROGRAM)).unwrap()
}

const BODY: &[u8] = b"program bytes, more than a handful of them";

#[test]
fn the_program_is_taken_from_a_tar_gz() {
    let dir = Dir::new("unpack-tar");
    let archive = tar_gz(&[("README", b'0', b"read me"), (TECTONIC_PROGRAM, b'0', BODY)]);
    // On Windows the platform's name is the .exe; the archive would hold that.
    run(&dir, &archive).unwrap();
    assert_eq!(program(&dir), BODY);
    // Only the program is written: nothing else from the archive.
    let names: Vec<String> = fs::read_dir(dir.join("new"))
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, [TECTONIC_PROGRAM]);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(dir.join("new").join(TECTONIC_PROGRAM))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o111, 0o111);
    }
}

#[test]
fn the_program_is_taken_from_a_zip() {
    let dir = Dir::new("unpack-zip");
    let archive = zip_of(&[("LICENSE", b"MIT"), (TECTONIC_PROGRAM, BODY)]);
    run(&dir, &archive).unwrap();
    assert_eq!(program(&dir), BODY);
}

#[test]
fn the_program_may_be_in_a_folder_of_the_archive() {
    let dir = Dir::new("unpack-folder");
    let name = format!("tectonic-0.15.0/{TECTONIC_PROGRAM}");
    run(
        &dir,
        &tar_gz(&[("tectonic-0.15.0/", b'5', b""), (&name, b'0', BODY)]),
    )
    .unwrap();
    assert_eq!(program(&dir), BODY);
    let dir = Dir::new("unpack-folder-zip");
    run(&dir, &zip_of(&[(&name, BODY)])).unwrap();
    assert_eq!(program(&dir), BODY);
    let dir = Dir::new("unpack-dot");
    run(
        &dir,
        &tar_gz(&[(&format!("./{TECTONIC_PROGRAM}"), b'0', BODY)]),
    )
    .unwrap();
    assert_eq!(program(&dir), BODY);
}

/// An entry whose name is too long for the header: a `L` entry holds it.
fn with_long_name(name: &str) -> Vec<u8> {
    let mut data = name.as_bytes().to_vec();
    data.push(0);
    tar_gz(&[
        ("././@LongLink", b'L', &data),
        ("short-name-in-the-header", b'0', BODY),
    ])
}

#[test]
fn a_gnu_long_name_is_read() {
    // One folder with a long name: the program is found by the long name.
    let long = format!("{}/{TECTONIC_PROGRAM}", "d".repeat(120));
    let dir = Dir::new("unpack-long");
    run(&dir, &with_long_name(&long)).unwrap();
    assert_eq!(program(&dir), BODY);
    // The short name in the header is not the program.
    let other = Dir::new("unpack-long-other");
    assert!(run(&other, &with_long_name("somewhere/else.txt")).is_err());
    // Four folders deep is more than a release has.
    let deep = Dir::new("unpack-long-deep");
    assert!(run(&deep, &with_long_name(&format!("a/b/c/{TECTONIC_PROGRAM}"))).is_err());
}

#[test]
fn an_archive_without_the_program_is_refused_with_a_sentence() {
    for archive in [
        tar_gz(&[("README", b'0', b"x")]),
        tar_gz(&[]),
        zip_of(&[("README", b"x")]),
        // The program as a link or a folder is not the program.
        tar_gz(&[(TECTONIC_PROGRAM, b'2', b"")]),
        tar_gz(&[(TECTONIC_PROGRAM, b'5', b"")]),
        // Names that try to climb are not the program.
        tar_gz(&[(&format!("../{TECTONIC_PROGRAM}"), b'0', BODY)]),
        zip_of(&[(&format!("../{TECTONIC_PROGRAM}"), BODY)]),
        tar_gz(&[(&format!("/{TECTONIC_PROGRAM}"), b'0', BODY)]),
        tar_gz(&[(&format!("a//{TECTONIC_PROGRAM}"), b'0', BODY)]),
    ] {
        let dir = Dir::new("unpack-none");
        match run(&dir, &archive) {
            Err(Failure::Failed(why)) => assert!(why.contains("LaTeX engine"), "{why}"),
            other => panic!("{other:?}"),
        }
        assert!(!dir.join("new").join(TECTONIC_PROGRAM).exists());
    }
}

#[test]
fn a_file_that_is_not_an_archive_or_is_cut_short_is_refused() {
    let dir = Dir::new("unpack-bad");
    for bytes in [
        b"".to_vec(),
        b"abc".to_vec(),
        b"this is plain text, not an archive".to_vec(),
    ] {
        assert!(matches!(run(&dir, &bytes), Err(Failure::Failed(_))));
    }
    // Data that does not compress, so cutting the archive cuts the program.
    let mut noise = Vec::new();
    let mut state = 0x2545_F491_u32;
    for _ in 0..64 * 1024 {
        state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        noise.push((state >> 24) as u8);
    }
    let whole = tar_gz(&[(TECTONIC_PROGRAM, b'0', &noise)]);
    run(&Dir::new("unpack-whole"), &whole).unwrap();
    for cut in [10, whole.len() / 4, whole.len() / 2, whole.len() - 1000] {
        let dir = Dir::new("unpack-cut");
        let result = run(&dir, &whole[..cut]);
        assert!(
            matches!(result, Err(Failure::Failed(_))),
            "cut at {cut}: {result:?}"
        );
    }
    let zipped = zip_of(&[(TECTONIC_PROGRAM, BODY)]);
    let dir = Dir::new("unpack-cut-zip");
    assert!(run(&dir, &zipped[..zipped.len() / 2]).is_err());
}

#[test]
fn an_empty_program_or_a_header_that_lies_is_refused() {
    let dir = Dir::new("unpack-empty");
    assert!(run(&dir, &tar_gz(&[(TECTONIC_PROGRAM, b'0', b"")])).is_err());
    // A header that claims more data than the archive holds.
    let mut tar = tar_entry(TECTONIC_PROGRAM, b'0', BODY);
    tar[124..135].copy_from_slice(format!("{:011o}", 5_000_000_u64).as_bytes());
    tar.truncate(512 + 512);
    let mut gz = GzEncoder::new(Vec::new(), Compression::fast());
    gz.write_all(&tar).unwrap();
    let dir = Dir::new("unpack-lie");
    assert!(run(&dir, &gz.finish().unwrap()).is_err());
    // A size that is not a number.
    let mut tar = tar_entry(TECTONIC_PROGRAM, b'0', BODY);
    tar[124..135].copy_from_slice(b"zzzzzzzzzzz");
    let mut gz = GzEncoder::new(Vec::new(), Compression::fast());
    gz.write_all(&tar).unwrap();
    let dir = Dir::new("unpack-nan");
    assert!(run(&dir, &gz.finish().unwrap()).is_err());
}

#[test]
fn the_plugin_installer_installs_the_engine_from_a_download_and_finds_it_after() {
    use crate::diagrams::tests::support::{Reply, Scratch, block_on, local, serve, source_for};
    use crate::plugins::latex::engines::payload_program;
    use crate::plugins::payload::{client, install, installed_version};
    use std::sync::Arc;

    let scratch = Scratch::new();
    let archive = tar_gz(&[("README", b'0', b"read me"), (TECTONIC_PROGRAM, b'0', BODY)]);
    let base = serve(vec![("/tectonic", Reply::body(archive.clone()))]);
    let source = source_for(&format!("{base}/tectonic"), &archive);
    let root = scratch.path("plugins/latex");
    let result = block_on(async {
        let web = client(local).unwrap();
        install(
            &web,
            &source,
            &root,
            &spec(),
            Arc::new(AtomicBool::new(false)),
            Arc::new(|_| {}),
        )
        .await
    });
    result.unwrap();
    let dir = root.join(&source.version);
    assert!(installed_version(&dir, &source.version, TECTONIC_PROGRAM));
    assert_eq!(fs::read(dir.join(TECTONIC_PROGRAM)).unwrap(), BODY);
    assert_eq!(
        payload_program(&root, &source.version),
        Some(dir.join(TECTONIC_PROGRAM))
    );
}

#[test]
fn a_cancel_stops_the_unpacking_and_the_spec_names_the_program() {
    let dir = Dir::new("unpack-cancel");
    let file = dir.join("download.partial");
    fs::write(&file, tar_gz(&[(TECTONIC_PROGRAM, b'0', BODY)])).unwrap();
    let result = unpack(&file, &dir.join("new"), &AtomicBool::new(true), &|_, _| {});
    assert_eq!(result, Err(Failure::Cancelled));
    let spec = spec();
    assert_eq!(spec.required, TECTONIC_PROGRAM);
    assert_eq!(spec.label, "the LaTeX engine");
}

#[test]
fn a_download_that_unpacks_to_far_more_than_it_should_is_not_followed() {
    // A tar whose one file claims to be bigger than any engine: refused before a byte is written.
    let dir = Dir::new("unpack-big");
    let mut tar = tar_entry(TECTONIC_PROGRAM, b'0', b"x");
    tar[124..135].copy_from_slice(format!("{:011o}", 400u64 * 1024 * 1024).as_bytes());
    let mut gz = GzEncoder::new(Vec::new(), Compression::fast());
    gz.write_all(&tar).unwrap();
    let result = run(&dir, &gz.finish().unwrap());
    assert!(matches!(result, Err(Failure::Failed(_))), "{result:?}");
    assert!(!dir.join("new").join(TECTONIC_PROGRAM).exists());
}
