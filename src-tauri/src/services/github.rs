use crate::errors::AppError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;

const USER_AGENT: &str = "Control-App";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const API_TIMEOUT: Duration = Duration::from_secs(8);
const WEB_TIMEOUT: Duration = Duration::from_secs(10);
const CACHE_LIMIT: usize = 30;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub tag: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub assets: Vec<Asset>,
}

fn agent(timeout: Duration) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout(timeout)
        .redirects(5)
        .build()
}

fn fetch_text(url: &str, timeout: Duration) -> Result<String, String> {
    let response = agent(timeout)
        .get(url)
        .set("User-Agent", USER_AGENT)
        .call()
        .map_err(|e| e.to_string())?;
    response.into_string().map_err(|e| e.to_string())
}

fn html_unescape(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn from_api(repo: &str, limit: usize) -> Result<Vec<Release>, String> {
    let url = format!("https://api.github.com/repos/{repo}/releases?per_page={limit}");
    let response = agent(API_TIMEOUT)
        .get(&url)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| e.to_string())?;
    let json: serde_json::Value = response.into_json().map_err(|e| e.to_string())?;
    let mut releases = Vec::new();
    for item in json.as_array().into_iter().flatten() {
        let tag = item["tag_name"].as_str().unwrap_or_default();
        if tag.is_empty() {
            continue;
        }
        let assets = item["assets"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|asset| {
                Some(Asset {
                    name: asset["name"].as_str()?.to_string(),
                    url: asset["browser_download_url"].as_str()?.to_string(),
                    size: asset["size"].as_u64(),
                })
            })
            .collect();
        releases.push(Release {
            tag: tag.to_string(),
            notes: item["body"].as_str().map(str::to_string),
            published_at: item["published_at"].as_str().map(str::to_string),
            assets,
        });
    }
    if releases.is_empty() {
        return Err("API вернул пустой список релизов".into());
    }
    Ok(releases)
}

fn web_tags(repo: &str, limit: usize) -> Result<Vec<String>, String> {
    let url = format!("https://github.com/{repo}/releases.atom");
    let body = fetch_text(&url, WEB_TIMEOUT)?;
    let entries = regex::Regex::new(r"(?s)<entry>(.*?)</entry>").expect("valid regex");
    let link = regex::Regex::new(r#"/releases/tag/([^"<>\s]+)"#).expect("valid regex");
    let mut tags: Vec<String> = Vec::new();
    for entry in entries.captures_iter(&body) {
        let Some(captured) = link.captures(&entry[1]) else {
            continue;
        };
        let tag = html_unescape(&captured[1]);
        if tag.is_empty() || tags.contains(&tag) {
            continue;
        }
        tags.push(tag);
        if tags.len() >= limit {
            break;
        }
    }
    if tags.is_empty() {
        return Err("в ленте релизов нет тегов".into());
    }
    Ok(tags)
}

fn web_assets(repo: &str, tag: &str) -> Vec<Asset> {
    let url = format!("https://github.com/{repo}/releases/expanded_assets/{tag}");
    let Ok(body) = fetch_text(&url, WEB_TIMEOUT) else {
        return Vec::new();
    };
    let link =
        regex::Regex::new(r#"href="(/[^"]*?/releases/download/[^"]+)""#).expect("valid regex");
    let mut assets: Vec<Asset> = Vec::new();
    for captured in link.captures_iter(&body) {
        let path = html_unescape(&captured[1]);
        let Some(name) = path.rsplit('/').next().filter(|name| !name.is_empty()) else {
            continue;
        };
        let url = format!("https://github.com{path}");
        if assets.iter().any(|asset| asset.url == url) {
            continue;
        }
        assets.push(Asset {
            name: name.to_string(),
            url,
            size: None,
        });
    }
    assets
}

fn from_web(repo: &str, limit: usize) -> Result<Vec<Release>, String> {
    let tags = web_tags(repo, limit)?;
    let assets: Vec<Vec<Asset>> = std::thread::scope(|scope| {
        let handles: Vec<_> = tags
            .iter()
            .map(|tag| scope.spawn(|| web_assets(repo, tag)))
            .collect();
        handles
            .into_iter()
            .map(|handle| handle.join().unwrap_or_default())
            .collect()
    });
    let releases = tags
        .into_iter()
        .zip(assets)
        .map(|(tag, assets)| Release {
            tag,
            notes: None,
            published_at: None,
            assets,
        })
        .collect();
    Ok(releases)
}

fn cache_path(repo: &str) -> Option<PathBuf> {
    let safe: String = repo
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let dir = crate::storage::settings::app_data_dir().ok()?.join("cache");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join(format!("github-{safe}.json")))
}

fn load_cache(repo: &str) -> Option<Vec<Release>> {
    let path = cache_path(repo)?;
    let bytes = std::fs::read(path).ok()?;
    let releases: Vec<Release> = serde_json::from_slice(&bytes).ok()?;
    (!releases.is_empty()).then_some(releases)
}

fn save_cache(repo: &str, fresh: &[Release]) {
    let Some(path) = cache_path(repo) else {
        return;
    };
    let mut merged = fresh.to_vec();
    if let Some(previous) = load_cache(repo) {
        for release in previous {
            if !merged.iter().any(|item| item.tag == release.tag) {
                merged.push(release);
            }
        }
    }
    merged.truncate(CACHE_LIMIT);
    if let Ok(bytes) = serde_json::to_vec_pretty(&merged) {
        let _ = std::fs::write(path, bytes);
    }
}

pub fn releases(repo: &str, limit: usize) -> Result<Vec<Release>, AppError> {
    let mut attempts: Vec<String> = Vec::new();
    match from_api(repo, limit) {
        Ok(mut list) => {
            list.truncate(limit);
            save_cache(repo, &list);
            return Ok(list);
        }
        Err(error) => {
            tracing::warn!(error = %error, repo, "GitHub API недоступен, пробую страницу релизов");
            attempts.push(format!("api.github.com: {error}"));
        }
    }
    match from_web(repo, limit) {
        Ok(list) => {
            save_cache(repo, &list);
            return Ok(list);
        }
        Err(error) => {
            tracing::warn!(error = %error, repo, "страница релизов GitHub недоступна");
            attempts.push(format!("github.com: {error}"));
        }
    }
    if let Some(cached) = load_cache(repo) {
        tracing::warn!(
            repo,
            "GitHub недоступен, использую сохранённый список версий"
        );
        let mut list = cached;
        list.truncate(limit);
        return Ok(list);
    }
    Err(AppError::new(
        "GITHUB_BLOCKED",
        "Не удалось связаться с GitHub. Включите защиту zapret или VPN и повторите",
    )
    .with_details(serde_json::json!({ "attempts": attempts })))
}

pub fn latest(repo: &str) -> Result<Release, AppError> {
    releases(repo, 1)?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::new("NO_RELEASES", "GitHub не вернул информацию о релизе"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn web_tag_extraction_keeps_tag_from_atom() {
        let body = r#"<feed><entry><title>v3.0.1</title><link rel="alternate" type="text/html" href="https://github.com/o/r/releases/tag/v3.0.1"/></entry><entry><link href="https://github.com/o/r/releases/tag/v3.0.0"/></entry></feed>"#;
        let entries = regex::Regex::new(r"(?s)<entry>(.*?)</entry>").unwrap();
        let link = regex::Regex::new(r#"/releases/tag/([^"<>\s]+)"#).unwrap();
        let tags: Vec<String> = entries
            .captures_iter(body)
            .filter_map(|entry| link.captures(&entry[1]).map(|c| c[1].to_string()))
            .collect();
        assert_eq!(tags, vec!["v3.0.1", "v3.0.0"]);
    }

    #[test]
    fn web_assets_link_is_absolute() {
        let body = r#"<a href="/o/r/releases/download/v3.0.1/zapret.zip">zapret.zip</a><a href="/o/r/releases/download/v3.0.1/notes.txt">notes</a>"#;
        let link = regex::Regex::new(r#"href="(/[^"]*?/releases/download/[^"]+)""#).unwrap();
        let urls: Vec<String> = link
            .captures_iter(body)
            .map(|c| format!("https://github.com{}", &c[1]))
            .collect();
        assert_eq!(
            urls,
            vec![
                "https://github.com/o/r/releases/download/v3.0.1/zapret.zip",
                "https://github.com/o/r/releases/download/v3.0.1/notes.txt"
            ]
        );
    }
}
