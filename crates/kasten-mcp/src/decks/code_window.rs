//! Running the program of a code picture for the agent tools: the code, and the inputs the picture
//! declared (read here, from the vault, as the agent could read them), go to KastenFlow's window
//! through the vault's mailbox; the window runs them in its sandbox (no network, no vault, one
//! message out) and the picture comes back. Nothing is run in this process, and the window is given
//! nothing it was not handed. Code an agent wrote waits there for the person's "Allow to run" the
//! first time for a deck; this process only waits long enough for them to answer.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use kasten_core::Kasten;
use kasten_core::agent::Session;
use kasten_core::bridge::{
    Answer, Call, DEFAULT_RUN_MS, GeneratorInputText, GeneratorOutput as Wire, GeneratorPayload,
    MAX_INPUT_BYTES,
};
use kasten_core::frontmatter::split;
use kasten_core::latex::base64_decode;
use serde_json::Value;
use slides_core::agent::{
    GeneratorDrawn, GeneratorJob, ImageKind, StoreError, StoreResult, hash_of, sniff,
};
use slides_core::{GeneratorInputKind, GeneratorOutput};

use crate::decks::store::failed;

/// How long a person is waited for when the code is an agent's and the deck is not yet allowed.
const PERMISSION_WAIT: Duration = Duration::from_secs(100);
/// Room for the mailbox and the window's own checks.
const SLACK: Duration = Duration::from_secs(20);
/// The most warnings and log lines told, and the longest of each.
const MOST_LINES: usize = 20;
const LINE_CHARS: usize = 300;

pub(super) const APP_CLOSED: &str = "Running code is not available right now: KastenFlow runs it in its own window, so open KastenFlow on this vault and ask again.";
const TIMED_OUT: &str = "The KastenFlow window did not run the code in time. Check that KastenFlow is open and showing, and that the person has not been left waiting to allow the code to run, then ask again.";
const CANCELLED: &str = "This request was cancelled before the code was run.";

/// One program at a time: the window runs them in turn.
static ONE: Mutex<()> = Mutex::new(());

fn unavailable(message: impl Into<String>) -> StoreError {
    StoreError::Unavailable(message.into())
}

/// What a picture's declared inputs hold now, as text.
fn read_inputs(kasten: &Kasten, job: &GeneratorJob) -> StoreResult<Vec<GeneratorInputText>> {
    let mut out = Vec::new();
    for input in &job.generator.inputs {
        let text = match input.kind {
            GeneratorInputKind::Data => input.value.clone(),
            GeneratorInputKind::Asset => {
                kasten
                    .read_text_asset(&input.value)
                    .map_err(|error| match error {
                        kasten_core::Error::NotFound(_) => StoreError::NotFound(format!(
                            "There is no text file `{}` in the vault's assets.",
                            input.value
                        )),
                        other => failed(other),
                    })?
            }
            GeneratorInputKind::Note => {
                let note = kasten.read(&input.value).map_err(failed)?;
                split(&note.text).body.to_string()
            }
        };
        if text.len() > MAX_INPUT_BYTES {
            return Err(StoreError::Invalid(format!(
                "The input {} is larger than {} MB.",
                input.name,
                MAX_INPUT_BYTES / 1024 / 1024
            )));
        }
        out.push(GeneratorInputText {
            name: input.name.clone(),
            text,
        });
    }
    Ok(out)
}

/// Names what the picture depends on besides its code: the inputs and the deck's colours.
fn inputs_hash(payload: &GeneratorPayload) -> String {
    let mut basis = String::new();
    for input in &payload.inputs {
        basis.push_str(&format!(
            "{}\0{}\0{}\u{1}",
            input.name,
            input.text.len(),
            input.text
        ));
    }
    for (token, colour) in &payload.theme {
        basis.push_str(&format!("{token}\0{colour}\u{2}"));
    }
    hash_of(&basis)
}

fn lines(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .take(MOST_LINES)
        .map(|line| line.chars().take(LINE_CHARS).collect())
        .collect()
}

/// The picture the window answered with, checked by its bytes again here.
fn drawn(result: &Value, output: GeneratorOutput, hash: String) -> StoreResult<GeneratorDrawn> {
    let svg = output == GeneratorOutput::Svg;
    let (kind, bytes) = if svg {
        let text = result["svg"]
            .as_str()
            .ok_or_else(|| unavailable("The KastenFlow window sent no picture"))?;
        (ImageKind::Svg, text.as_bytes().to_vec())
    } else {
        let text = result["png_base64"]
            .as_str()
            .ok_or_else(|| unavailable("The KastenFlow window sent no picture"))?;
        (ImageKind::Png, base64_decode(text).map_err(failed)?)
    };
    if sniff(&bytes) != Some(kind) {
        return Err(unavailable(
            "The KastenFlow window sent something that is not the picture asked for",
        ));
    }
    let side = |key: &str| u32::try_from(result[key].as_u64().unwrap_or(0)).unwrap_or(0);
    let preview = result["preview_png_base64"]
        .as_str()
        .and_then(|text| base64_decode(text).ok())
        .filter(|png| sniff(png) == Some(ImageKind::Png));
    Ok(GeneratorDrawn {
        kind,
        bytes,
        width: side("width"),
        height: side("height"),
        preview,
        inputs_hash: hash,
        at: kasten_core::Instant::now().millis,
        warnings: lines(&result["warnings"]),
        logs: lines(&result["logs"]),
    })
}

/// Runs the program in the window and waits: the picture, or a sentence for why not. `session` is
/// the agent's, which is how the window knows the code is not the person's.
pub(super) fn run(
    kasten: &Kasten,
    session: Option<&Session>,
    cancel: Option<&AtomicBool>,
    job: &GeneratorJob,
) -> StoreResult<GeneratorDrawn> {
    if cancel.is_some_and(|c| c.load(Ordering::SeqCst)) {
        return Err(unavailable(CANCELLED));
    }
    let payload = GeneratorPayload {
        language: job.generator.language.clone(),
        code: job.generator.code.clone(),
        inputs: read_inputs(kasten, job)?,
        theme: job.theme.clone(),
    };
    payload.check().map_err(failed)?;
    let hash = inputs_hash(&payload);
    let bytes = serde_json::to_vec(&payload).map_err(|e| StoreError::Io(e.to_string()))?;
    let call = Call::RunGenerator {
        deck: Some(job.deck.clone()),
        output: match job.generator.output {
            GeneratorOutput::Svg => Wire::Svg,
            GeneratorOutput::Png => Wire::Png,
        },
        timeout_ms: DEFAULT_RUN_MS,
    };
    call.check().map_err(failed)?;
    let mailbox = crate::bridge::mailbox_of(kasten).map_err(failed)?;
    let wait = Duration::from_millis(DEFAULT_RUN_MS) + PERMISSION_WAIT + SLACK;
    let _alone = ONE.lock().unwrap_or_else(|p| p.into_inner());
    match mailbox.ask_with(&call, session, wait, Some(&bytes)) {
        Ok(Answer::Reply(reply)) if reply.ok => drawn(&reply.result, job.generator.output, hash),
        Ok(Answer::Reply(reply)) => {
            Err(StoreError::Invalid(reply.error.unwrap_or_else(|| {
                "The KastenFlow window gave no reason".to_owned()
            })))
        }
        Ok(Answer::AppClosed) => Err(unavailable(APP_CLOSED)),
        Ok(Answer::TimedOut) => Err(unavailable(TIMED_OUT)),
        Err(error) => Err(failed(error)),
    }
}
