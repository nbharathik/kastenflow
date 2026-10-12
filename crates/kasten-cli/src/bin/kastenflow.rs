//! `kastenflow`: the KastenFlow command line. `kasten` is the same program
//! under its old name.

fn main() -> std::process::ExitCode {
    kasten_cli::run("kastenflow")
}
