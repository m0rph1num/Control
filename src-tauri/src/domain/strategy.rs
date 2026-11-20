use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GameFilterMode {
    #[default]
    Disabled,
    All,
    Tcp,
    Udp,
}

impl GameFilterMode {
    pub fn tcp_udp(self) -> (&'static str, &'static str) {
        match self {
            Self::All => ("1024-65535", "1024-65535"),
            Self::Tcp => ("1024-65535", "12"),
            Self::Udp => ("12", "1024-65535"),
            Self::Disabled => ("12", "12"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedStrategy {
    pub args: Vec<String>,
    pub bin_path: PathBuf,
}

pub fn split_args(s: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_quote = false;
    for c in s.chars() {
        match c {
            '"' => in_quote = !in_quote,
            ' ' if !in_quote => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(c),
        }
    }
    if !current.is_empty() {
        args.push(current);
    }
    args
}

pub fn parse_strategy_args(content: &str, dir: &Path, game_mode: GameFilterMode) -> ParsedStrategy {
    let mut args_lines: Vec<String> = Vec::new();

    for raw_line in content.lines() {
        let line = raw_line.trim().trim_end_matches('\r');
        if let Some(idx) = line.find("winws.exe") {
            let part = line[idx + "winws.exe".len()..].trim();
            if !part.is_empty() {
                args_lines.push(part.to_string());
            }
            continue;
        }
        if !args_lines.is_empty() && !line.is_empty() {
            let clean = line.replace('^', "").trim().to_string();
            if !clean.is_empty() {
                args_lines.push(clean);
            }
        }
    }

    let mut full_args = args_lines.join(" ");

    full_args = collapse_whitespace(&full_args);

    let bin_dir = dir.join("bin");
    let lists_dir = dir.join("lists");
    let bin_re = regex::Regex::new(r#""%BIN%([^"]+)""#).unwrap();
    let lists_re = regex::Regex::new(r#""%LISTS%([^"]+)""#).unwrap();
    let bin_bare_re = regex::Regex::new(r"%BIN%([^\s&|]+)").unwrap();
    let lists_bare_re = regex::Regex::new(r"%LISTS%([^\s&|]+)").unwrap();

    full_args = bin_re
        .replace_all(&full_args, |c: &regex::Captures| {
            format!("\"{}\"", bin_dir.join(&c[1]).to_string_lossy())
        })
        .into_owned();
    full_args = lists_re
        .replace_all(&full_args, |c: &regex::Captures| {
            format!("\"{}\"", lists_dir.join(&c[1]).to_string_lossy())
        })
        .into_owned();
    full_args = bin_bare_re
        .replace_all(&full_args, |c: &regex::Captures| {
            bin_dir.join(&c[1]).to_string_lossy().into_owned()
        })
        .into_owned();
    full_args = lists_bare_re
        .replace_all(&full_args, |c: &regex::Captures| {
            lists_dir.join(&c[1]).to_string_lossy().into_owned()
        })
        .into_owned();

    let (gf_tcp, gf_udp) = game_mode.tcp_udp();
    full_args = full_args
        .replace("%GameFilter%", gf_tcp)
        .replace("%GameFilterTCP%", gf_tcp)
        .replace("%GameFilterUDP%", gf_udp);

    full_args = full_args
        .chars()
        .filter(|c| *c != '^' && *c != '%')
        .collect();
    let full_args = full_args.trim().to_string();

    ParsedStrategy {
        args: split_args(&full_args),
        bin_path: dir.join("bin").join("winws.exe"),
    }
}

fn collapse_whitespace(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> PathBuf {
        PathBuf::from("C:\\zapret\\v1.0.0")
    }

    #[test]
    fn parses_multiline_bat_with_continuations() {
        let bat = "@echo off\r\n\
            winws.exe --wf-tcp=80,443 ^\r\n\
            --wf-udp=443,50000-50100 ^\r\n\
            --filter-tcp=80,443 --dpi-desync=fake,multidisorder\r\n";
        let p = parse_strategy_args(bat, &dir(), GameFilterMode::Disabled);
        assert_eq!(p.args[0], "--wf-tcp=80,443");
        assert!(p
            .args
            .contains(&"--dpi-desync=fake,multidisorder".to_string()));
        assert_eq!(p.bin_path, dir().join("bin").join("winws.exe"));
    }

    #[test]
    fn quoted_winws_path_merges_args_like_reference() {
        let bat = "start \"zapret\" /low \"%BIN%winws.exe\" --wf-tcp=80,443";
        let p = parse_strategy_args(bat, &dir(), GameFilterMode::Disabled);
        assert_eq!(p.args, vec![" --wf-tcp=80,443".to_string()]);
    }

    #[test]
    fn resolves_bin_and_lists_placeholders() {
        let bat = "winws.exe --hostlist=\"%LISTS%list-general-user.txt\" --ipset=\"%LISTS%ipset-all.txt\" ^\n --wf-tcp=443";
        let p = parse_strategy_args(bat, &dir(), GameFilterMode::Disabled);
        assert!(p.args.contains(&format!(
            "--hostlist={}",
            dir()
                .join("lists")
                .join("list-general-user.txt")
                .to_string_lossy()
        )));
    }

    #[test]
    fn game_filter_placeholders_follow_mode() {
        let bat = "winws.exe --wf-tcp=%GameFilterTCP% --wf-udp=%GameFilterUDP%";
        let tcp_only = parse_strategy_args(bat, &dir(), GameFilterMode::Tcp);
        assert!(tcp_only.args.contains(&"--wf-tcp=1024-65535".to_string()));
        assert!(tcp_only.args.contains(&"--wf-udp=12".to_string()));
        let all = parse_strategy_args(bat, &dir(), GameFilterMode::All);
        assert!(all.args.contains(&"--wf-udp=1024-65535".to_string()));
    }

    #[test]
    fn split_args_matches_reference_behavior() {
        assert_eq!(
            split_args("--flag \"C:\\Program Files\\x\\y.exe\" --n=1"),
            vec!["--flag", "C:\\Program Files\\x\\y.exe", "--n=1"]
        );
    }

    #[test]
    fn strips_stray_caret_and_percent() {
        let bat = "winws.exe --dpi-desync=fake 100%% ^\n broken^";
        let p = parse_strategy_args(bat, &dir(), GameFilterMode::Disabled);
        assert!(!p.args.iter().any(|a| a.contains('%') || a.contains('^')));
    }
}
