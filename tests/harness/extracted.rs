// Code below is copied VERBATIM from ai-agent-bridge/src/slack_commands_parts/,
// with only the crate-specific error type replaced by a unit error so it builds
// without dependencies. Any edit here invalidates the test -- check_verbatim.py
// diffs these bodies against the real sources on every run.

#[derive(Debug, PartialEq, Eq)]
pub struct Error;
pub type Result<T> = std::result::Result<T, Error>;
use std::collections::BTreeMap;

pub const MAX_IDENTIFIER_BYTES: usize = 255;
pub const MAX_FORM_FIELDS: usize = 64;
pub const MAX_PROMPT_BYTES: usize = 100_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Provider { Claude, Chatgpt }

// --- part1.rs: Provider::from_command -------------------------------------
pub fn from_command(command: &str) -> Option<Provider> {
    match command.trim() {
        "/x-ores-claude" => Some(Provider::Claude),
        "/x-ores-chatgpt" => Some(Provider::Chatgpt),
        _ => None,
    }
}

// --- part3.rs: parse_form / percent_decode / hex / field / id_field --------
pub fn parse_form(body: &[u8]) -> Result<BTreeMap<String, String>> {
    let body = std::str::from_utf8(body).map_err(|_| Error)?;
    let mut output = BTreeMap::new();
    for pair in body.split('&').filter(|pair| !pair.is_empty()) {
        if output.len() >= MAX_FORM_FIELDS {
            return Err(Error);
        }
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if output
            .insert(percent_decode(key)?, percent_decode(value)?)
            .is_some()
        {
            return Err(Error);
        }
    }
    Ok(output)
}

pub fn percent_decode(value: &str) -> Result<String> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => { output.push(b' '); index += 1; }
            b'%' if index + 2 < bytes.len() => {
                let high = hex(bytes[index + 1]).ok_or(Error)?;
                let low = hex(bytes[index + 2]).ok_or(Error)?;
                output.push((high << 4) | low);
                index += 3;
            }
            b'%' => return Err(Error),
            byte => { output.push(byte); index += 1; }
        }
    }
    String::from_utf8(output).map_err(|_| Error)
}

pub fn hex(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

pub fn field(form: &BTreeMap<String, String>, key: &str) -> Result<String> {
    form.get(key)
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .ok_or(Error)
}

pub fn id_field(form: &BTreeMap<String, String>, key: &str) -> Result<String> {
    let value = field(form, key)?;
    identifier(key, &value).map_err(|_| Error)
}

// --- part2.rs: identifier / prompt / find_issue ---------------------------
pub fn identifier(_name: &str, value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > MAX_IDENTIFIER_BYTES
        || value.chars().any(|character| {
            !character.is_ascii_alphanumeric() && !matches!(character, '-' | '_' | '.' | ':')
        })
    {
        return Err(Error);
    }
    Ok(value.to_string())
}

pub fn prompt(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > MAX_PROMPT_BYTES || value.contains('\0') {
        return Err(Error);
    }
    Ok(value.to_string())
}

pub fn find_issue(text: &str) -> Option<String> {
    text.split(|character: char| !character.is_ascii_alphanumeric() && character != '-')
        .find_map(|token| {
            let (team, number) = token.split_once('-')?;
            if !(2..=10).contains(&team.len())
                || !team.chars().all(|character| character.is_ascii_uppercase())
                || number.is_empty()
                || !number.chars().all(|character| character.is_ascii_digit())
            {
                return None;
            }
            Some(token.to_string())
        })
}

// --- part6.rs: log_safe / truncate ----------------------------------------
pub fn log_safe(value: &str) -> String {
    let cleaned = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':' | ' ')
            { character } else { '?' }
        })
        .collect::<String>();
    truncate(&cleaned, 64)
}

pub fn truncate(value: &str, maximum_bytes: usize) -> String {
    if value.len() <= maximum_bytes {
        return value.to_string();
    }
    let mut boundary = maximum_bytes.min(value.len());
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value[..boundary].to_string()
}

// --- part5.rs: decode_signature -------------------------------------------
pub fn decode_signature(value: &str) -> Option<[u8; 32]> {
    if value.len() != 64 { return None; }
    let bytes = value.as_bytes();
    let mut output = [0; 32];
    for index in 0..32 {
        output[index] = (hex(bytes[index * 2])? << 4) | hex(bytes[index * 2 + 1])?;
    }
    Some(output)
}
