use crate::domain::strategy::GameFilterMode;
use crate::errors::AppError;
use crate::services::filters::{self, IpsetMode};
use crate::services::process_runner::decode_output;
use crate::services::profiles::{Profile, ProfileFakes};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::io::Read;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs, UdpSocket};
use std::path::Path;
use std::time::{Duration, Instant};

const PROBE_TIMEOUT: Duration = Duration::from_millis(900);
const PROBE_ATTEMPTS: usize = 3;
const SPEED_TIMEOUT: Duration = Duration::from_secs(6);
const META_TIMEOUT: Duration = Duration::from_secs(3);
const TLS_TIMEOUT: Duration = Duration::from_secs(4);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyProbe {
    pub id: String,
    pub label: String,
    pub host: String,
    pub ok: bool,
    pub ms: Option<u64>,
    pub avg_ms: Option<u64>,
    pub jitter_ms: Option<u64>,
    pub loss_percent: u8,
    pub method: String,
    pub tls_ok: bool,
    pub tls_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProfile {
    pub dns_ok: bool,
    pub dns_ms: Option<u64>,
    pub mtu: Option<u16>,
    pub dns_servers: Vec<String>,
    pub gateway: Option<String>,
    pub local_ip: Option<String>,
    pub provider: Option<String>,
    pub asn: Option<String>,
    pub city: Option<String>,
    pub country: Option<String>,
    pub public_ip: Option<String>,
    pub download_mbps: Option<u64>,
    pub latency: Vec<LatencyProbe>,
    pub avg_latency_ms: Option<u64>,
    pub jitter_ms: Option<u64>,
    pub loss_percent: Option<u8>,
    pub reachable: usize,
    pub tls_reachable: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedApp {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub source: String,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub value: String,
    pub label: String,
    pub kind: String,
    pub score: u32,
    pub reasons: Vec<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorReport {
    pub scanned_at: String,
    pub duration_ms: u64,
    pub network: NetworkProfile,
    pub apps: Vec<DetectedApp>,
    pub candidates: Vec<Candidate>,
    pub recommended: Option<String>,
    pub summary: String,
    pub profile: Profile,
}

struct AppDef {
    id: &'static str,
    name: &'static str,
    kind: &'static str,
    processes: &'static [&'static str],
    keywords: &'static [&'static str],
}

const APP_CATALOG: &[AppDef] = &[
    AppDef {
        id: "steam",
        name: "Steam",
        kind: "launcher",
        processes: &["steam", "steamwebhelper"],
        keywords: &["steam"],
    },
    AppDef {
        id: "cs2",
        name: "Counter-Strike 2",
        kind: "game",
        processes: &["cs2"],
        keywords: &["counter-strike 2", "cs2"],
    },
    AppDef {
        id: "dota2",
        name: "Dota 2",
        kind: "game",
        processes: &["dota2"],
        keywords: &["dota 2"],
    },
    AppDef {
        id: "valorant",
        name: "VALORANT",
        kind: "game",
        processes: &["valorant", "riotclientservices"],
        keywords: &["valorant"],
    },
    AppDef {
        id: "league",
        name: "League of Legends",
        kind: "game",
        processes: &["leagueclient", "leagueclientux"],
        keywords: &["league of legends"],
    },
    AppDef {
        id: "fortnite",
        name: "Fortnite",
        kind: "game",
        processes: &["fortniteclient-win64-shipping"],
        keywords: &["fortnite"],
    },
    AppDef {
        id: "gta",
        name: "GTA V",
        kind: "game",
        processes: &["gta5", "playgtav"],
        keywords: &["grand theft auto v", "gta v"],
    },
    AppDef {
        id: "minecraft",
        name: "Minecraft",
        kind: "game",
        processes: &["minecraft", "javaw"],
        keywords: &["minecraft"],
    },
    AppDef {
        id: "roblox",
        name: "Roblox",
        kind: "game",
        processes: &["robloxplayerbeta"],
        keywords: &["roblox"],
    },
    AppDef {
        id: "warzone",
        name: "Call of Duty",
        kind: "game",
        processes: &["cod", "modernwarfare"],
        keywords: &["call of duty"],
    },
    AppDef {
        id: "apex",
        name: "Apex Legends",
        kind: "game",
        processes: &["r5apex"],
        keywords: &["apex legends"],
    },
    AppDef {
        id: "tarkov",
        name: "Escape from Tarkov",
        kind: "game",
        processes: &["escapefromtarkov"],
        keywords: &["escape from tarkov"],
    },
    AppDef {
        id: "wot",
        name: "World of Tanks",
        kind: "game",
        processes: &["worldoftanks"],
        keywords: &["world of tanks", "мир танков"],
    },
    AppDef {
        id: "genshin",
        name: "Genshin Impact",
        kind: "game",
        processes: &["genshinimpact"],
        keywords: &["genshin impact"],
    },
    AppDef {
        id: "honkai",
        name: "Honkai: Star Rail",
        kind: "game",
        processes: &["starrail"],
        keywords: &["honkai"],
    },
    AppDef {
        id: "discord",
        name: "Discord",
        kind: "messenger",
        processes: &["discord"],
        keywords: &["discord"],
    },
    AppDef {
        id: "telegram",
        name: "Telegram",
        kind: "messenger",
        processes: &["telegram"],
        keywords: &["telegram"],
    },
    AppDef {
        id: "whatsapp",
        name: "WhatsApp",
        kind: "messenger",
        processes: &["whatsapp"],
        keywords: &["whatsapp"],
    },
    AppDef {
        id: "spotify",
        name: "Spotify",
        kind: "media",
        processes: &["spotify"],
        keywords: &["spotify"],
    },
    AppDef {
        id: "chrome",
        name: "Google Chrome",
        kind: "browser",
        processes: &["chrome"],
        keywords: &["google chrome"],
    },
    AppDef {
        id: "firefox",
        name: "Firefox",
        kind: "browser",
        processes: &["firefox"],
        keywords: &["firefox"],
    },
    AppDef {
        id: "edge",
        name: "Microsoft Edge",
        kind: "browser",
        processes: &["msedge"],
        keywords: &["microsoft edge"],
    },
    AppDef {
        id: "opera",
        name: "Opera",
        kind: "browser",
        processes: &["opera"],
        keywords: &["opera"],
    },
    AppDef {
        id: "yandex",
        name: "Яндекс Браузер",
        kind: "browser",
        processes: &["browser"],
        keywords: &["яндекс браузер", "yandex"],
    },
    AppDef {
        id: "epic",
        name: "Epic Games",
        kind: "launcher",
        processes: &["epicgameslauncher"],
        keywords: &["epic games"],
    },
    AppDef {
        id: "battlenet",
        name: "Battle.net",
        kind: "launcher",
        processes: &["battle.net"],
        keywords: &["battle.net"],
    },
    AppDef {
        id: "gog",
        name: "GOG Galaxy",
        kind: "launcher",
        processes: &["galaxyclient"],
        keywords: &["gog galaxy"],
    },
    AppDef {
        id: "ubisoft",
        name: "Ubisoft Connect",
        kind: "launcher",
        processes: &["upc", "ubisoftconnect"],
        keywords: &["ubisoft connect"],
    },
];

#[derive(Default)]
struct Features {
    hostlist_auto: bool,
    hostlist: bool,
    ipset: bool,
    udp443: bool,
    tcp443: bool,
    fake_tls: bool,
    fake_quic: bool,
    fake_discord: bool,
    fake_stun: bool,
    fake_unknown: bool,
    l7_discord: bool,
    l7_stun: bool,
    hostfakesplit: bool,
    seqovl: bool,
    cutoff: bool,
    any_protocol: bool,
    hostlist_domains: bool,
    fooling_ts: bool,
    fooling_badseq: bool,
    fake_tls_mod: bool,
    ip_id_zero: bool,
    wide_ports: bool,
    game_placeholder: bool,
    groups: usize,
    repeats_max: u32,
    repeats_avg: f64,
    seqovl_size: u32,
    fake_tls_count: usize,
    hostfake_hosts: Vec<String>,
    modes: Vec<String>,
}

struct Needs {
    games: bool,
    discord: bool,
    youtube: bool,
    telegram: bool,
    unstable: bool,
    youtube_tls_failed: bool,
    telegram_tls_failed: bool,
}

fn command_text(program: &str, args: &[&str]) -> Option<String> {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new(program)
        .args(args)
        .creation_flags(0x0800_0000)
        .output()
        .ok()?;
    Some(decode_output(&output.stdout))
}

fn ipv4_tokens(text: &str) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut result = Vec::new();
    for token in text.split(|c: char| !(c.is_ascii_digit() || c == '.')) {
        if token.is_empty() || token.matches('.').count() != 3 {
            continue;
        }
        if token.parse::<std::net::Ipv4Addr>().is_err() {
            continue;
        }
        if seen.insert(token.to_string()) {
            result.push(token.to_string());
        }
    }
    result
}

fn route_defaults() -> (Option<String>, Option<String>) {
    let Some(text) = command_text("route", &["print", "-4"]) else {
        return (None, None);
    };
    let mut best: Option<(u32, String, Option<String>)> = None;
    for line in text.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 5 || cols[0] != "0.0.0.0" || cols[1] != "0.0.0.0" {
            continue;
        }
        let Ok(metric) = cols[4].parse::<u32>() else {
            continue;
        };
        if best
            .as_ref()
            .is_some_and(|(current, _, _)| *current <= metric)
        {
            continue;
        }
        let gateway = cols[2];
        let iface = cols[3];
        let gateway = (gateway != "On-link" && gateway != "0.0.0.0").then(|| gateway.to_string());
        let iface = (iface != "0.0.0.0" && iface != "127.0.0.1").then(|| iface.to_string());
        best = Some((metric, gateway.unwrap_or_default(), iface));
    }
    match best {
        Some((_, gateway, iface)) => {
            let gateway = (!gateway.is_empty()).then_some(gateway);
            (iface, gateway)
        }
        None => (None, None),
    }
}

fn detect_dns_servers(gateway: &Option<String>) -> Vec<String> {
    let mut dns = Vec::new();
    if let Some(text) = command_text("netsh", &["interface", "ipv4", "show", "dnsservers"]) {
        for token in ipv4_tokens(&text) {
            if token.starts_with("127.") || token == "0.0.0.0" {
                continue;
            }
            if !dns.contains(&token) {
                dns.push(token);
            }
        }
    }
    if dns.is_empty() {
        if let Some(gateway) = gateway.clone() {
            dns.push(gateway);
        }
    }
    dns
}

fn interface_for_ip(ip: &str) -> Option<String> {
    let text = command_text("netsh", &["interface", "ipv4", "show", "addresses"])?;
    let mut current: Option<String> = None;
    for line in text.lines() {
        if let (Some(start), Some(end)) = (line.find('"'), line.rfind('"')) {
            if end > start + 1 {
                current = Some(line[start + 1..end].to_string());
            }
        }
        if line.contains(ip) {
            return current.clone();
        }
    }
    None
}

fn detect_mtu(local_ip: &Option<String>) -> Option<u16> {
    let text = command_text("netsh", &["interface", "ipv4", "show", "subinterfaces"])?;
    let mut rows: Vec<(u16, u32, String)> = Vec::new();
    for line in text.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 4 {
            continue;
        }
        let (Ok(mtu), Ok(sense)) = (cols[0].parse::<u16>(), cols[1].parse::<u32>()) else {
            continue;
        };
        if !(576..=9000).contains(&mtu) {
            continue;
        }
        rows.push((mtu, sense, cols[3..].join(" ")));
    }
    if let Some(ip) = local_ip.as_deref() {
        if let Some(name) = interface_for_ip(ip) {
            if let Some((mtu, _, _)) = rows.iter().find(|(_, _, row)| *row == name) {
                return Some(*mtu);
            }
        }
    }
    rows.iter()
        .filter(|(_, sense, _)| *sense != 5)
        .map(|(mtu, _, _)| *mtu)
        .max()
}

fn skip_dns_name(buffer: &[u8], mut pos: usize) -> Option<usize> {
    loop {
        let len = *buffer.get(pos)? as usize;
        if len == 0 {
            return Some(pos + 1);
        }
        if len & 0xC0 == 0xC0 {
            return Some(pos + 2);
        }
        pos += 1 + len;
    }
}

fn dns_query(server: &str, name: &str, qtype: u16) -> Option<Vec<u8>> {
    let target: SocketAddr = format!("{server}:53").parse().ok()?;
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket
        .set_read_timeout(Some(Duration::from_millis(900)))
        .ok()?;

    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .subsec_nanos() as u16;
    let mut packet = Vec::with_capacity(64);
    packet.extend_from_slice(&nonce.to_be_bytes());
    packet.extend_from_slice(&[0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    for part in name.split('.') {
        if part.is_empty() || part.len() > 63 {
            return None;
        }
        packet.push(part.len() as u8);
        packet.extend_from_slice(part.as_bytes());
    }
    packet.extend_from_slice(&[0x00]);
    packet.extend_from_slice(&qtype.to_be_bytes());
    packet.extend_from_slice(&[0x00, 0x01]);

    socket.send_to(&packet, target).ok()?;
    let mut buffer = [0u8; 1024];
    let (read, _) = socket.recv_from(&mut buffer).ok()?;
    if read < 12 {
        return None;
    }
    Some(buffer[..read].to_vec())
}

fn dns_records(response: &[u8], qtype: u16) -> Vec<Vec<u8>> {
    let mut result = Vec::new();
    if response.len() < 12 {
        return result;
    }
    let questions = u16::from_be_bytes([response[4], response[5]]) as usize;
    let answers = u16::from_be_bytes([response[6], response[7]]) as usize;
    let mut pos = 12usize;
    for _ in 0..questions {
        let Some(next) = skip_dns_name(response, pos) else {
            return result;
        };
        pos = next + 4;
    }
    for _ in 0..answers {
        let Some(next) = skip_dns_name(response, pos) else {
            return result;
        };
        pos = next;
        if pos + 10 > response.len() {
            return result;
        }
        let record_type = u16::from_be_bytes([response[pos], response[pos + 1]]);
        let length = u16::from_be_bytes([response[pos + 8], response[pos + 9]]) as usize;
        let start = pos + 10;
        let end = start + length;
        if end > response.len() {
            return result;
        }
        if record_type == qtype {
            result.push(response[start..end].to_vec());
        }
        pos = end;
    }
    result
}

fn dns_txt(servers: &[String], name: &str) -> Option<String> {
    let fallback = ["8.8.8.8".to_string()];
    for server in servers.iter().chain(fallback.iter()) {
        let Some(response) = dns_query(server, name, 16) else {
            continue;
        };
        for record in dns_records(&response, 16) {
            let mut text = String::new();
            let mut index = 0usize;
            while index < record.len() {
                let len = record[index] as usize;
                let start = index + 1;
                let end = start + len;
                if end > record.len() {
                    break;
                }
                if let Ok(part) = std::str::from_utf8(&record[start..end]) {
                    text.push_str(part);
                }
                index = end;
            }
            let text = text.trim().to_string();
            if !text.is_empty() {
                return Some(text);
            }
        }
    }
    None
}

fn asn_lookup(public_ip: &str, servers: &[String]) -> Option<String> {
    let octets: Vec<&str> = public_ip.split('.').collect();
    if octets.len() != 4 {
        return None;
    }
    let reversed = format!(
        "{}.{}.{}.{}.origin.asn.cymru.com",
        octets[3], octets[2], octets[1], octets[0]
    );
    let text = dns_txt(servers, &reversed)?;
    let asn = text.split('|').next()?.split_whitespace().next()?;
    asn.parse::<u32>().ok().map(|value| format!("AS{value}"))
}

fn dns_latency(servers: &[String]) -> Option<u64> {
    let server = servers.first()?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos();
    let name = format!("probe{nonce:x}.cloudflare.com");
    let started = Instant::now();
    dns_query(server, &name, 1)?;
    Some(started.elapsed().as_millis() as u64)
}

fn ping_rtts(host: &str) -> (Vec<u64>, Option<u8>) {
    let Some(text) = command_text("ping", &["-n", "3", "-w", "900", host]) else {
        return (Vec::new(), None);
    };
    let Ok(times) = regex::Regex::new(r"(?i)[=<]\s*(\d+)\s*(?:ms|мс)") else {
        return (Vec::new(), None);
    };
    let rtts: Vec<u64> = times
        .captures_iter(&text)
        .filter_map(|cap| cap.get(1))
        .filter_map(|m| m.as_str().parse::<u64>().ok())
        .collect();
    let loss = regex::Regex::new(r"\((\d+)%")
        .ok()
        .and_then(|re| re.captures(&text))
        .and_then(|cap| cap.get(1))
        .and_then(|m| m.as_str().parse::<u8>().ok());
    (rtts, loss)
}

fn tcp_rtts(host: &str) -> (Vec<u64>, Option<u8>) {
    let Ok(addrs) = (host, 443).to_socket_addrs() else {
        return (Vec::new(), None);
    };
    let addrs: Vec<SocketAddr> = addrs.collect();
    if addrs.is_empty() {
        return (Vec::new(), None);
    }
    let mut rtts = Vec::new();
    let mut failed = 0usize;
    for _ in 0..PROBE_ATTEMPTS {
        let mut hit = None;
        for addr in &addrs {
            let started = Instant::now();
            if TcpStream::connect_timeout(addr, PROBE_TIMEOUT).is_ok() {
                hit = Some(started.elapsed().as_millis() as u64);
                break;
            }
        }
        match hit {
            Some(ms) => rtts.push(ms),
            None => failed += 1,
        }
    }
    let loss = ((failed * 100) / PROBE_ATTEMPTS) as u8;
    (rtts, Some(loss))
}

fn jitter(rtts: &[u64]) -> Option<u64> {
    if rtts.len() < 2 {
        return None;
    }
    let diffs: Vec<u64> = rtts
        .windows(2)
        .map(|pair| pair[0].abs_diff(pair[1]))
        .collect();
    Some(diffs.iter().sum::<u64>() / diffs.len() as u64)
}

fn tls_check(url: &str) -> (bool, Option<u64>) {
    let agent = ureq::AgentBuilder::new().timeout(TLS_TIMEOUT).build();
    let started = Instant::now();
    match agent.get(url).call() {
        Ok(response) => {
            drop(response);
            (true, Some(started.elapsed().as_millis() as u64))
        }
        Err(ureq::Error::Status(_, _)) => (true, Some(started.elapsed().as_millis() as u64)),
        Err(_) => (false, None),
    }
}

fn probe(id: &str, label: &str, host: &str, tls_url: &str) -> LatencyProbe {
    let (mut rtts, mut loss) = ping_rtts(host);
    let mut method = "icmp";
    if rtts.is_empty() {
        let (tcp, tcp_loss) = tcp_rtts(host);
        rtts = tcp;
        loss = tcp_loss;
        method = "tcp";
    }
    let (tls_ok, tls_ms) = tls_check(tls_url);
    let ok = !rtts.is_empty();
    let ms = rtts.iter().min().copied();
    let avg_ms = if ok {
        Some(rtts.iter().sum::<u64>() / rtts.len() as u64)
    } else {
        None
    };
    LatencyProbe {
        id: id.into(),
        label: label.into(),
        host: host.into(),
        ok,
        ms,
        avg_ms,
        jitter_ms: jitter(&rtts),
        loss_percent: loss.unwrap_or(if ok { 0 } else { 100 }),
        method: method.into(),
        tls_ok,
        tls_ms,
    }
}

struct NetworkMeta {
    provider: Option<String>,
    asn: Option<String>,
    city: Option<String>,
    country: Option<String>,
    public_ip: Option<String>,
}

fn fetch_text(url: &str) -> Option<String> {
    let agent = ureq::AgentBuilder::new().timeout(META_TIMEOUT).build();
    agent.get(url).call().ok()?.into_string().ok()
}

fn public_identity() -> Option<(String, Option<String>)> {
    if let Some(text) = fetch_text("https://cloudflare.com/cdn-cgi/trace") {
        let mut ip = None;
        let mut location = None;
        for line in text.lines() {
            if let Some(value) = line.strip_prefix("ip=") {
                ip = Some(value.trim().to_string());
            }
            if let Some(value) = line.strip_prefix("loc=") {
                location = Some(value.trim().to_string());
            }
        }
        if let Some(ip) = ip.filter(|value| value.parse::<std::net::IpAddr>().is_ok()) {
            return Some((ip, location));
        }
    }
    let ip = fetch_text("https://api.ipify.org")?.trim().to_string();
    ip.parse::<std::net::IpAddr>().ok().map(|_| (ip, None))
}

fn isp_lookup(ip: &str) -> Option<(Option<String>, Option<String>)> {
    let json: serde_json::Value = ureq::get(&format!("https://api.iplocation.net/?ip={ip}"))
        .timeout(META_TIMEOUT)
        .call()
        .ok()?
        .into_json()
        .ok()?;
    let text = |key: &str| {
        json[key]
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    Some((text("isp"), text("country_name")))
}

fn network_meta(dns_servers: &[String]) -> Option<NetworkMeta> {
    let (ip, trace_country) = public_identity()?;
    let (isp, country) = isp_lookup(&ip).unwrap_or((None, None));
    let asn = asn_lookup(&ip, dns_servers);
    Some(NetworkMeta {
        provider: isp,
        asn,
        city: None,
        country: country.or(trace_country),
        public_ip: Some(ip),
    })
}

fn measure_download(url: &str, min_bytes: usize) -> Option<u64> {
    let agent = ureq::AgentBuilder::new().timeout(SPEED_TIMEOUT).build();
    let response = agent.get(url).call().ok()?;
    let started = Instant::now();
    let mut reader = response.into_reader();
    let mut buffer = [0u8; 32 * 1024];
    let mut total = 0usize;
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => total += read,
            Err(_) => break,
        }
    }
    let elapsed = started.elapsed().as_secs_f64();
    if total < min_bytes || elapsed < 0.05 {
        return None;
    }
    Some(((total as f64 * 8.0) / elapsed / 1_000_000.0).round() as u64)
}

fn download_speed() -> Option<u64> {
    for url in [
        "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
        "https://speed.cloudflare.com/__down?bytes=2000000",
    ] {
        if let Some(mbps) = measure_download(url, 200_000) {
            return Some(mbps);
        }
    }
    None
}

fn collect_network() -> NetworkProfile {
    let (local_ip, gateway) = route_defaults();
    let dns_servers = detect_dns_servers(&gateway);
    let dns_ms = dns_latency(&dns_servers);
    let mtu = detect_mtu(&local_ip);

    let targets: [(&str, &str, &str, &str); 5] = [
        (
            "discord",
            "Discord",
            "discord.com",
            "https://discord.com/api/v9/gateway",
        ),
        (
            "youtube",
            "YouTube",
            "www.youtube.com",
            "https://www.youtube.com/generate_204",
        ),
        (
            "steam",
            "Steam",
            "store.steampowered.com",
            "https://store.steampowered.com/robots.txt",
        ),
        (
            "telegram",
            "Telegram",
            "web.telegram.org",
            "https://web.telegram.org/",
        ),
        (
            "cloudflare",
            "Cloudflare",
            "1.1.1.1",
            "https://cloudflare.com/cdn-cgi/trace",
        ),
    ];

    let dns_for_meta = dns_servers.clone();
    let (latency, meta, download_mbps) = std::thread::scope(|scope| {
        let probes: Vec<_> = targets
            .iter()
            .map(|(id, label, host, tls_url)| scope.spawn(move || probe(id, label, host, tls_url)))
            .collect();
        let meta = scope.spawn(move || network_meta(&dns_for_meta));
        let speed = scope.spawn(download_speed);
        let latency = probes
            .into_iter()
            .filter_map(|handle| handle.join().ok())
            .collect::<Vec<_>>();
        (
            latency,
            meta.join().ok().flatten(),
            speed.join().ok().flatten(),
        )
    });

    let ok: Vec<&LatencyProbe> = latency.iter().filter(|probe| probe.ok).collect();
    let avg_latency_ms = if ok.is_empty() {
        None
    } else {
        Some(ok.iter().filter_map(|probe| probe.avg_ms).sum::<u64>() / ok.len() as u64)
    };
    let jitter_ms = ok.iter().filter_map(|probe| probe.jitter_ms).max();
    let loss_percent = {
        let values: Vec<u8> = ok.iter().map(|probe| probe.loss_percent).collect();
        (!values.is_empty()).then(|| values.iter().copied().max().unwrap_or(0))
    };
    let tls_reachable = latency.iter().filter(|probe| probe.tls_ok).count();
    let meta = meta.unwrap_or(NetworkMeta {
        provider: None,
        asn: None,
        city: None,
        country: None,
        public_ip: None,
    });

    NetworkProfile {
        dns_ok: dns_ms.is_some(),
        dns_ms,
        mtu,
        dns_servers,
        gateway,
        local_ip,
        provider: meta.provider,
        asn: meta.asn,
        city: meta.city,
        country: meta.country,
        public_ip: meta.public_ip,
        download_mbps,
        reachable: ok.len(),
        total: latency.len(),
        tls_reachable,
        latency,
        avg_latency_ms,
        jitter_ms,
        loss_percent,
    }
}

fn installed_names() -> Vec<String> {
    let mut names = Vec::new();
    for key in [
        r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ] {
        let Some(text) = command_text("reg", &["query", key, "/s", "/v", "DisplayName"]) else {
            continue;
        };
        for line in text.lines() {
            if let Some(idx) = line.find("REG_SZ") {
                let name = line[idx + "REG_SZ".len()..].trim().to_lowercase();
                if !name.is_empty() {
                    names.push(name);
                }
            }
        }
    }
    names
}

fn collect_apps() -> Vec<DetectedApp> {
    let processes: BTreeSet<String> = crate::services::process_scan::list_all_names()
        .into_iter()
        .collect();
    let installed = installed_names();

    let mut result = Vec::new();
    for def in APP_CATALOG {
        let running = def.processes.iter().any(|p| processes.contains(*p));
        let installed_match = installed
            .iter()
            .any(|name| def.keywords.iter().any(|keyword| name.contains(keyword)));
        if !running && !installed_match {
            continue;
        }
        result.push(DetectedApp {
            id: def.id.into(),
            name: def.name.into(),
            kind: def.kind.into(),
            source: if running { "process" } else { "installed" }.into(),
            running,
        });
    }
    result.sort_by(|a, b| {
        let rank = |kind: &str| match kind {
            "game" => 0,
            "messenger" => 1,
            "media" => 2,
            "browser" => 3,
            _ => 4,
        };
        rank(&a.kind)
            .cmp(&rank(&b.kind))
            .then_with(|| b.running.cmp(&a.running))
            .then_with(|| a.name.cmp(&b.name))
    });
    result.truncate(24);
    result
}

fn arg_values<'a>(text: &'a str, key: &str) -> Vec<&'a str> {
    text.split(key)
        .skip(1)
        .filter_map(|part| part.split_whitespace().next())
        .collect()
}

fn numbers(text: &str, key: &str) -> Vec<u32> {
    let mut values = Vec::new();
    for value in arg_values(text, key) {
        let digits: String = value.chars().take_while(char::is_ascii_digit).collect();
        if let Ok(number) = digits.parse::<u32>() {
            values.push(number);
        }
    }
    values
}

fn features(content: &str, label: &str) -> Features {
    let lower = content.to_lowercase();
    let mut f = Features {
        hostlist_auto: lower.contains("--hostlist-auto"),
        hostlist: lower.contains("--hostlist"),
        ipset: lower.contains("--ipset"),
        udp443: lower.contains("--filter-udp=443")
            || lower.contains("--wf-udp=443")
            || lower.contains("--wf-udp=1024-65535"),
        tcp443: lower.contains("--filter-tcp=443")
            || lower.contains("--wf-tcp=443")
            || lower.contains("--wf-tcp=80,443")
            || lower.contains("--wf-tcp=1024-65535"),
        fake_tls: lower.contains("--dpi-desync-fake-tls"),
        fake_quic: lower.contains("--dpi-desync-fake-quic"),
        fake_discord: lower.contains("--dpi-desync-fake-discord"),
        fake_stun: lower.contains("--dpi-desync-fake-stun"),
        fake_unknown: lower.contains("--dpi-desync-fake-unknown"),
        fake_tls_mod: lower.contains("--dpi-desync-fake-tls-mod="),
        ip_id_zero: lower.contains("--ip-id=zero"),
        hostfakesplit: lower.contains("hostfakesplit"),
        seqovl: lower.contains("--dpi-desync-split-seqovl="),
        cutoff: lower.contains("--dpi-desync-cutoff="),
        any_protocol: lower.contains("--dpi-desync-any-protocol=1"),
        hostlist_domains: lower.contains("--hostlist-domains="),
        wide_ports: lower.contains("1024-65535"),
        game_placeholder: lower.contains("%gamefilter%"),
        groups: lower.matches("--new").count() + 1,
        repeats_max: numbers(&lower, "--dpi-desync-repeats=")
            .into_iter()
            .max()
            .unwrap_or(0),
        repeats_avg: {
            let values = numbers(&lower, "--dpi-desync-repeats=");
            if values.is_empty() {
                0.0
            } else {
                values.iter().sum::<u32>() as f64 / values.len() as f64
            }
        },
        seqovl_size: numbers(&lower, "--dpi-desync-split-seqovl=")
            .into_iter()
            .max()
            .unwrap_or(0),
        fake_tls_count: lower.matches("--dpi-desync-fake-tls=").count(),
        ..Features::default()
    };
    for part in lower.split("--dpi-desync=").skip(1) {
        let value = part.split_whitespace().next().unwrap_or("");
        for mode in value.split(',') {
            if !mode.is_empty() && !f.modes.iter().any(|m| m == mode) {
                f.modes.push(mode.to_string());
            }
        }
    }
    for part in lower.split("--dpi-desync-fooling=").skip(1) {
        let value = part.split_whitespace().next().unwrap_or("");
        for token in value.split(',') {
            if token == "ts" {
                f.fooling_ts = true;
            }
            if token == "badseq" {
                f.fooling_badseq = true;
            }
        }
    }
    for part in lower.split("--filter-l7=").skip(1) {
        let value = part.split_whitespace().next().unwrap_or("");
        for token in value.split(',') {
            if token == "discord" {
                f.l7_discord = true;
            }
            if token == "stun" {
                f.l7_stun = true;
            }
        }
    }
    for part in lower.split("--dpi-desync-hostfakesplit-mod=").skip(1) {
        let value = part.split_whitespace().next().unwrap_or("");
        for token in value.split(',') {
            if let Some(host) = token.strip_prefix("host=") {
                let host = host.trim_matches('"').to_string();
                if !host.is_empty() && !f.hostfake_hosts.contains(&host) {
                    f.hostfake_hosts.push(host);
                }
            }
        }
    }
    if label.to_lowercase().contains("discord") {
        f.l7_discord = true;
    }
    f
}

impl Needs {
    fn detect(apps: &[DetectedApp], network: &NetworkProfile) -> Self {
        let tls_failed = |id: &str| {
            network
                .latency
                .iter()
                .find(|probe| probe.id == id)
                .is_some_and(|probe| !probe.tls_ok)
        };
        Self {
            games: apps.iter().any(|app| app.kind == "game"),
            discord: apps.iter().any(|app| app.id == "discord"),
            youtube: apps
                .iter()
                .any(|app| app.kind == "media" || app.kind == "browser"),
            telegram: apps.iter().any(|app| app.id == "telegram"),
            unstable: network.reachable < network.total || network.loss_percent.unwrap_or(0) > 0,
            youtube_tls_failed: tls_failed("youtube"),
            telegram_tls_failed: tls_failed("telegram"),
        }
    }
}

fn coverage(f: &Features, needs: &Needs) -> (f64, Vec<(f64, String)>) {
    let mut items: Vec<(f64, f64, &'static str)> = Vec::new();

    if needs.games {
        let mut value: f64 = 0.0;
        if f.game_placeholder {
            value += 0.42;
        }
        if f.any_protocol {
            value += 0.18;
        }
        if f.fake_unknown {
            value += 0.15;
        }
        if f.cutoff {
            value += 0.13;
        }
        if f.wide_ports {
            value += 0.12;
        }
        items.push((0.30, value.min(1.0), "Игровой UDP-фильтр"));
    }
    if needs.discord {
        let mut value: f64 = 0.0;
        if f.l7_discord {
            value += 0.40;
        }
        if f.l7_stun {
            value += 0.15;
        }
        if f.fake_discord {
            value += 0.25;
        }
        if f.hostlist_domains {
            value += 0.10;
        }
        if f.fake_stun {
            value += 0.10;
        }
        items.push((0.20, value.min(1.0), "Голосовой Discord"));
    }
    if needs.youtube {
        let mut value: f64 = 0.0;
        if f.hostlist {
            value += 0.28;
        }
        if f.fake_tls {
            value += 0.28;
        }
        if f.fake_quic {
            value += 0.18;
        }
        if f.hostfakesplit {
            value += 0.16;
        }
        if f.ipset {
            value += 0.10;
        }
        let weight = if needs.youtube_tls_failed { 0.24 } else { 0.18 };
        items.push((weight, value.min(1.0), "YouTube и QUIC"));
    }
    if needs.telegram {
        let mut value: f64 = 0.0;
        if f.tcp443 {
            value += 0.28;
        }
        if f.udp443 {
            value += 0.24;
        }
        if f.fake_tls {
            value += 0.28;
        }
        if f.ipset {
            value += 0.20;
        }
        let weight = if needs.telegram_tls_failed {
            0.15
        } else {
            0.10
        };
        items.push((weight, value.min(1.0), "Telegram по TCP и UDP"));
    }
    if needs.unstable {
        let mut value: f64 = 0.0;
        if f.hostlist_auto {
            value += 0.48;
        } else if f.hostlist {
            value += 0.24;
        }
        if f.ipset {
            value += 0.18;
        }
        if f.fake_tls {
            value += 0.18;
        }
        if f.fooling_ts || f.fooling_badseq {
            value += 0.10;
        }
        items.push((0.12, value.min(1.0), "Обход нестабильных узлов"));
    }

    let total: f64 = items.iter().map(|(weight, _, _)| weight).sum();
    if total == 0.0 {
        return (0.55, Vec::new());
    }
    let got: f64 = items.iter().map(|(weight, value, _)| weight * value).sum();
    let mut reasons: Vec<(f64, String)> = items
        .iter()
        .filter(|(_, value, _)| *value >= 0.7)
        .map(|(weight, value, reason)| (weight * value, (*reason).to_string()))
        .collect();
    reasons.sort_by(|a, b| b.0.total_cmp(&a.0));
    (got / total, reasons)
}

fn robustness(f: &Features, network: &NetworkProfile) -> f64 {
    let jitter = network.jitter_ms.unwrap_or(0);
    let loss = network.loss_percent.unwrap_or(0);
    let unstable = jitter >= 8 || loss >= 2;
    let mut value: f64 = 0.42;
    if f.fooling_ts {
        value += 0.14;
    }
    if f.fooling_badseq {
        value += 0.10;
    }
    if f.seqovl {
        value += 0.10;
    }
    if f.hostfakesplit {
        value += 0.08;
    }
    if f.fake_tls_mod {
        value += 0.05;
    }
    if f.hostfake_hosts.len() > 1 {
        value += 0.03;
    }
    if f.fake_tls_count >= 2 {
        value += 0.02;
    }
    if f.ip_id_zero {
        value += 0.02;
    }
    if f.seqovl_size >= 600 {
        value += 0.02;
    }
    let russian = network.country.as_deref().is_some_and(|country| {
        country.eq_ignore_ascii_case("Russian Federation")
            || country.eq_ignore_ascii_case("Russia")
            || country.eq_ignore_ascii_case("RU")
    });
    if russian && f.hostfake_hosts.iter().any(|host| host.ends_with(".ru")) {
        value += 0.03;
    }
    if (5..=9).contains(&f.repeats_max) {
        value += 0.10;
    }
    if unstable {
        if f.repeats_max >= 8 {
            value += 0.12;
        }
        if f.cutoff {
            value += 0.04;
        }
    } else if f.repeats_max > 10 {
        value -= 0.06;
    }
    value.clamp(0.0, 1.0)
}

fn efficiency(f: &Features) -> f64 {
    let mut value: f64 = 1.0;
    if f.groups > 9 {
        value -= 0.12;
    }
    if f.repeats_avg > 9.0 {
        value -= 0.06;
    }
    if f.repeats_max > 10 {
        value -= 0.04;
    }
    if f.modes.len() > 4 {
        value -= 0.05;
    }
    value.clamp(0.0, 1.0)
}

fn trait_reasons(f: &Features) -> Vec<String> {
    let mut reasons = Vec::new();
    if f.fake_tls_mod {
        reasons.push("fake-TLS с рандомизацией SNI".into());
    }
    if f.hostfakesplit {
        if f.hostfake_hosts.is_empty() {
            reasons.push("hostfakesplit по SNI".into());
        } else {
            reasons.push(format!("hostfakesplit: {}", f.hostfake_hosts.join(", ")));
        }
    }
    if f.fooling_ts {
        reasons.push("маскировка TTL (fooling=ts)".into());
    }
    if f.fooling_badseq {
        reasons.push("подмена sequence (badseq)".into());
    }
    if f.seqovl_size > 0 {
        reasons.push(format!("перекрытие {} байт", f.seqovl_size));
    }
    if f.fake_tls_count >= 2 {
        reasons.push("несколько fake-TLS шаблонов".into());
    }
    if f.l7_discord && f.fake_stun {
        reasons.push("STUN для голосового Discord".into());
    }
    if f.game_placeholder && f.any_protocol {
        reasons.push("игровой UDP без ограничений".into());
    }
    if f.repeats_max >= 10 {
        reasons.push(format!("повторы {} для плохих линий", f.repeats_max));
    }
    if f.hostlist_auto {
        reasons.push("сам пополняет список доменов".into());
    }
    if f.ip_id_zero {
        reasons.push("обнуление IP ID".into());
    }
    if f.hostlist_domains {
        reasons.push("отдельный список discord.media".into());
    }
    reasons
}

fn score(
    value: &str,
    kind: &str,
    f: &Features,
    needs: &Needs,
    network: &NetworkProfile,
    last: &str,
) -> (u32, Vec<String>, Vec<String>) {
    let (fit, ranked) = coverage(f, needs);
    let mut reasons: Vec<String> = ranked
        .into_iter()
        .map(|(_, reason)| reason)
        .take(1)
        .collect();
    let mut tags = Vec::new();

    if f.tcp443 && f.udp443 {
        tags.push("QUIC".into());
    }
    if f.hostlist_auto {
        tags.push("авто-список".into());
    } else if f.hostlist {
        tags.push("hostlist".into());
    }
    if f.modes.iter().any(|mode| mode == "fake") {
        tags.push("fake".into());
    }
    if f.fake_tls {
        tags.push("fake-TLS".into());
    }
    if f.hostfakesplit {
        tags.push("hostfakesplit".into());
    }
    if f.fooling_ts {
        tags.push("ts".into());
    }
    if kind == "preset" {
        tags.push("пресет".into());
    }

    let mut raw = 0.58 * fit + 0.24 * robustness(f, network) + 0.18 * efficiency(f);
    if kind == "preset" {
        raw += 0.01;
    }
    if last == value {
        raw += 0.015;
        reasons.push("Текущая стратегия уже запускалась".into());
    }
    if kind == "preset" {
        reasons.push("Ваш собственный пресет".into());
    }
    for reason in trait_reasons(f) {
        if reasons.len() >= 3 {
            break;
        }
        if !reasons.contains(&reason) {
            reasons.push(reason);
        }
    }

    if reasons.len() < 2 {
        let mut extra: Vec<(&'static str, f64)> = Vec::new();
        if f.tcp443 && f.udp443 {
            extra.push(("Закрывает TCP и QUIC", 0.16));
        }
        if f.hostlist_auto {
            extra.push(("Сам пополняет список доменов", 0.12));
        }
        if f.seqovl {
            extra.push(("Дробление TLS с перекрытием", 0.10));
        }
        if f.fake_tls {
            extra.push(("fake-TLS против SNI-блокировок", 0.10));
        }
        if f.game_placeholder {
            extra.push(("Учитывает игровой UDP", 0.08));
        }
        for (reason, _) in extra {
            if reasons.len() >= 3 {
                break;
            }
            if !reasons.iter().any(|existing| existing == reason) {
                reasons.push(reason.to_string());
            }
        }
    }
    reasons.truncate(3);
    tags.truncate(5);

    let value = (8.0 + 88.0 * raw).round().clamp(5.0, 97.0) as u32;
    (value, reasons, tags)
}

fn signature(content: &str, label: &str) -> String {
    let lower = content.to_lowercase();
    let lower = lower.replace(&label.to_lowercase(), "<self>");
    let Ok(whitespace) = regex::Regex::new(r"\s+") else {
        return lower;
    };
    whitespace.replace_all(&lower, " ").trim().to_string()
}

fn build_candidates(
    dir: &Path,
    apps: &[DetectedApp],
    network: &NetworkProfile,
    last: &str,
) -> Vec<Candidate> {
    let needs = Needs::detect(apps, network);
    let mut scored: Vec<(Candidate, String)> = Vec::new();

    let mut push = |value: String, label: String, kind: &str, content: &str| {
        let f = features(content, &label);
        let (score, reasons, tags) = score(&value, kind, &f, &needs, network, last);
        let mark = signature(content, &label);
        scored.push((
            Candidate {
                value,
                label,
                kind: kind.into(),
                score,
                reasons,
                tags,
            },
            mark,
        ));
    };

    for strategy in crate::storage::settings::list_strategies(dir) {
        let content = std::fs::read_to_string(&strategy.path).unwrap_or_default();
        push(strategy.value, strategy.label, "version", &content);
    }
    if let Ok(presets) = crate::services::presets::list() {
        for preset in presets {
            push(
                format!("preset:{}", preset.name),
                preset.name,
                "preset",
                &preset.content,
            );
        }
    }

    scored.sort_by(|(a, _), (b, _)| {
        b.score
            .cmp(&a.score)
            .then_with(|| (b.value.as_str() == last).cmp(&(a.value.as_str() == last)))
            .then_with(|| a.label.cmp(&b.label))
    });

    let mut seen = BTreeSet::new();
    let mut candidates: Vec<Candidate> = scored
        .into_iter()
        .filter(|(_, mark)| seen.insert(mark.clone()))
        .map(|(candidate, _)| candidate)
        .collect();
    candidates.truncate(5);
    candidates
}

fn pick_fake(
    fakes: &filters::FakesInfo,
    hint: &[&str],
    current: Option<&String>,
) -> Option<String> {
    if let Some(value) = current.filter(|value| !value.is_empty()) {
        return Some(value.clone());
    }
    fakes
        .fakes
        .iter()
        .find(|fake| {
            let lower = fake.to_lowercase();
            hint.iter().any(|hint| lower.contains(hint))
        })
        .cloned()
}

fn build_profile(
    dir: &Path,
    candidates: &[Candidate],
    apps: &[DetectedApp],
    network: &NetworkProfile,
) -> Profile {
    let best = candidates.first();
    let games: Vec<&DetectedApp> = apps.iter().filter(|a| a.kind == "game").collect();
    let discord = apps.iter().any(|a| a.id == "discord");
    let media = apps
        .iter()
        .any(|a| a.kind == "media" || a.kind == "browser");

    let name = if !games.is_empty() && discord {
        "Авто - Игры и Discord".to_string()
    } else if !games.is_empty() {
        "Авто - Игры".to_string()
    } else if discord && media {
        "Авто - YouTube и Discord".to_string()
    } else if discord {
        "Авто - Discord".to_string()
    } else if media {
        "Авто - YouTube".to_string()
    } else {
        "Авто - Универсальный".to_string()
    };

    let mut details = Vec::new();
    if !games.is_empty() {
        let names: Vec<&str> = games
            .iter()
            .take(4)
            .map(|game| game.name.as_str())
            .collect();
        details.push(format!("игры: {}", names.join(", ")));
    }
    if discord {
        details.push("Discord".into());
    }
    if let Some(mtu) = network.mtu {
        details.push(format!("MTU {mtu}"));
    }
    if let Some(avg) = network.avg_latency_ms {
        details.push(format!("средняя задержка {avg} мс"));
    }
    if let Some(provider) = network.provider.as_deref() {
        let asn = network
            .asn
            .as_deref()
            .map(|asn| format!(" ({asn})"))
            .unwrap_or_default();
        details.push(format!("{provider}{asn}"));
    }
    if let Some(mbps) = network.download_mbps {
        details.push(format!("скорость {mbps} Мбит/с"));
    }
    if !network.dns_servers.is_empty() {
        details.push(format!("DNS {}", network.dns_servers.join(", ")));
    }
    let description = if details.is_empty() {
        "Собрано автоматически по параметрам компьютера и сети.".to_string()
    } else {
        format!("Собрано автоматически: {}.", details.join(" · "))
    };

    let fakes = filters::fakes_get(dir);
    let game_fake = if games.is_empty() {
        None
    } else {
        pick_fake(&fakes, &["quic", "http"], fakes.current_game.as_ref())
    };
    let discord_fake = if discord {
        pick_fake(&fakes, &["tls"], fakes.current_discord.as_ref())
    } else {
        None
    };

    Profile {
        id: String::new(),
        name,
        description: description.chars().take(480).collect(),
        strategy: best.map(|c| c.value.clone()).unwrap_or_default(),
        game_filter: if games.is_empty() {
            GameFilterMode::Disabled
        } else {
            GameFilterMode::All
        },
        ipset: IpsetMode::Loaded,
        fakes: ProfileFakes {
            discord: discord_fake,
            game: game_fake,
        },
        lists: Default::default(),
        created_at: String::new(),
        updated_at: String::new(),
        source: "auto".into(),
    }
}

fn emit_step(state: &crate::state::AppState, id: &str, status: &str) {
    state.sink.emit_json(
        "advisor://step",
        serde_json::json!({ "id": id, "status": status }),
    );
}

pub async fn scan(state: &crate::state::AppState) -> Result<AdvisorReport, AppError> {
    let started = Instant::now();

    emit_step(state, "network", "running");
    let network = tokio::task::spawn_blocking(collect_network)
        .await
        .map_err(|e| {
            AppError::new("INTERNAL", "Сбой проверки сети")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;
    emit_step(state, "network", "ok");

    emit_step(state, "apps", "running");
    let apps = tokio::task::spawn_blocking(collect_apps)
        .await
        .map_err(|e| {
            AppError::new("INTERNAL", "Сбой поиска приложений")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;
    emit_step(state, "apps", "ok");

    emit_step(state, "strategies", "running");
    let settings = crate::storage::settings::read_settings_raw()?;
    let dir = crate::storage::settings::find_flowseal_dir(&settings).ok_or_else(|| {
        AppError::new(
            "NO_ZAPRET_INSTALL",
            "Установка Zapret не найдена. Установите версию, чтобы подобрать стратегию",
        )
    })?;
    let last = crate::storage::settings::settings_str(&settings, "lastStrategy")
        .unwrap_or("")
        .to_string();
    let apps_for_scan = apps.clone();
    let network_for_scan = network.clone();
    let dir_for_scan = dir.clone();
    let candidates = tokio::task::spawn_blocking(move || {
        build_candidates(&dir_for_scan, &apps_for_scan, &network_for_scan, &last)
    })
    .await
    .map_err(|e| {
        AppError::new("INTERNAL", "Сбой подбора стратегий")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    emit_step(state, "strategies", "ok");

    emit_step(state, "profile", "running");
    let profile = build_profile(&dir, &candidates, &apps, &network);
    emit_step(state, "profile", "ok");

    let recommended = candidates.first().map(|c| c.value.clone());
    let summary = build_summary(&apps, &network, &candidates);
    let report = AdvisorReport {
        scanned_at: chrono::Utc::now().to_rfc3339(),
        duration_ms: started.elapsed().as_millis() as u64,
        network,
        apps,
        candidates,
        recommended,
        summary,
        profile,
    };

    persist_report(state, &report).await;
    Ok(report)
}

fn build_summary(
    apps: &[DetectedApp],
    network: &NetworkProfile,
    candidates: &[Candidate],
) -> String {
    let games = apps.iter().filter(|a| a.kind == "game").count();
    let others = apps.iter().filter(|a| a.kind != "game").count();
    let mut parts = Vec::new();
    if let Some(provider) = network.provider.as_deref() {
        let asn = network
            .asn
            .as_deref()
            .map(|asn| format!(" ({asn})"))
            .unwrap_or_default();
        parts.push(format!("{provider}{asn}"));
    }
    if let Some(country) = network.country.as_deref() {
        parts.push(country.to_string());
    }
    if games > 0 {
        parts.push(format!("игр: {games}"));
    }
    if others > 0 {
        parts.push(format!("приложений: {others}"));
    }
    if let Some(avg) = network.avg_latency_ms {
        parts.push(format!("средний отклик {avg} мс"));
    }
    if let Some(jitter) = network.jitter_ms.filter(|value| *value > 0) {
        parts.push(format!("джиттер {jitter} мс"));
    }
    parts.push(format!(
        "доступно {} из {} узлов",
        network.reachable, network.total
    ));
    if let Some(mbps) = network.download_mbps {
        parts.push(format!("скорость {mbps} Мбит/с"));
    }
    if let Some(mtu) = network.mtu {
        parts.push(format!("MTU {mtu}"));
    }
    let head = format!("Компьютер изучен: {}", parts.join(", "));
    match candidates.first() {
        Some(best) => format!(
            "{head}. Лучший вариант — {} (соответствие {}%).",
            best.label, best.score
        ),
        None => format!("{head}. Стратегии не найдены."),
    }
}

async fn persist_report(state: &crate::state::AppState, report: &AdvisorReport) {
    let Ok(snapshot) = crate::storage::settings::read_settings_recovering() else {
        return;
    };
    let mut content = snapshot.content.clone();
    if !content.is_object() {
        content = serde_json::json!({});
    }
    content["advisor"] = serde_json::to_value(report).unwrap_or_default();
    if let Err(e) =
        crate::storage::settings::write_settings_checked(&state.locks, &snapshot, content).await
    {
        tracing::warn!(error = %e.user_message, "не удалось сохранить отчёт подбора стратегии");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn network() -> NetworkProfile {
        NetworkProfile {
            dns_ok: true,
            dns_ms: Some(12),
            mtu: Some(1500),
            dns_servers: vec![],
            gateway: None,
            local_ip: None,
            provider: None,
            asn: None,
            city: None,
            country: None,
            public_ip: None,
            download_mbps: Some(100),
            latency: vec![],
            avg_latency_ms: Some(40),
            jitter_ms: Some(2),
            loss_percent: Some(0),
            reachable: 0,
            tls_reachable: 0,
            total: 0,
        }
    }

    #[test]
    fn detects_auto_hostlist_and_quic() {
        let f = features(
            "winws.exe --wf-tcp=80,443 --wf-udp=443 --hostlist-auto=\"%LISTS%auto.txt\" --dpi-desync=fake,split2",
            "general",
        );
        assert!(f.hostlist_auto);
        assert!(f.udp443);
        assert!(f.tcp443);
        assert!(f.modes.contains(&"fake".to_string()));
        assert!(f.modes.contains(&"split2".to_string()));
    }

    #[test]
    fn game_traffic_beats_plain_split() {
        let network = network();
        let apps = vec![DetectedApp {
            id: "cs2".into(),
            name: "Counter-Strike 2".into(),
            kind: "game".into(),
            source: "process".into(),
            running: true,
        }];
        let needs = Needs::detect(&apps, &network);
        let game = features(
            "winws.exe --wf-tcp=1024-65535 --wf-udp=1024-65535 --dpi-desync=fake,disorder --dpi-desync-any-protocol=1 --dpi-desync-cutoff=n4 --dpi-desync-fake-unknown-udp=game.bin",
            "gameFilter",
        );
        let plain = features("winws.exe --wf-tcp=443 --dpi-desync=split", "simple");
        let (game_score, _, _) = score("game", "version", &game, &needs, &network, "");
        let (plain_score, _, _) = score("simple", "version", &plain, &needs, &network, "");
        assert!(game_score > plain_score);
    }

    #[test]
    fn score_is_not_saturated() {
        let network = network();
        let apps = vec![
            DetectedApp {
                id: "cs2".into(),
                name: "Counter-Strike 2".into(),
                kind: "game".into(),
                source: "process".into(),
                running: true,
            },
            DetectedApp {
                id: "discord".into(),
                name: "Discord".into(),
                kind: "messenger".into(),
                source: "process".into(),
                running: true,
            },
        ];
        let needs = Needs::detect(&apps, &network);
        let full = features(
            "winws.exe --wf-tcp=80,443 --wf-udp=443 --hostlist=\"auto.txt\" --ipset=\"ip.txt\" --filter-l7=discord,stun --hostlist-domains=discord.media --dpi-desync=fake,multisplit --dpi-desync-split-seqovl=664 --dpi-desync-fooling=ts --dpi-desync-repeats=8 --dpi-desync-fake-tls=tls.bin --dpi-desync-fake-discord=d.bin --dpi-desync-fake-stun=s.bin --dpi-desync-any-protocol=1 --dpi-desync-cutoff=n4 --dpi-desync-fake-unknown-udp=g.bin %GameFilterTCP%",
            "game",
        );
        let weak = features("winws.exe --wf-tcp=443 --dpi-desync=split", "plain");
        let (full_score, _, _) = score("full", "version", &full, &needs, &network, "");
        let (weak_score, _, _) = score("weak", "version", &weak, &needs, &network, "");
        assert!(full_score < 100);
        assert!(full_score > weak_score);
        assert!(full_score - weak_score >= 12);
    }

    #[test]
    fn tls_and_fakesplit_beat_plain_multisplit() {
        let network = network();
        let apps = vec![
            DetectedApp {
                id: "telegram".into(),
                name: "Telegram".into(),
                kind: "messenger".into(),
                source: "process".into(),
                running: true,
            },
            DetectedApp {
                id: "browser".into(),
                name: "Google Chrome".into(),
                kind: "browser".into(),
                source: "process".into(),
                running: true,
            },
        ];
        let needs = Needs::detect(&apps, &network);
        let plain = features(
            "winws.exe --wf-tcp=80,443 --wf-udp=443 --hostlist=\"list.txt\" --ipset=\"ip.txt\" --dpi-desync=multisplit --dpi-desync-split-seqovl=568 --dpi-desync-split-pos=1 --dpi-desync-repeats=12",
            "general",
        );
        let modern = features(
            "winws.exe --wf-tcp=80,443 --wf-udp=443 --hostlist=\"list.txt\" --ipset=\"ip.txt\" --dpi-desync=fake,hostfakesplit --dpi-desync-fooling=ts --dpi-desync-repeats=8 --dpi-desync-fake-tls=tls.bin --dpi-desync-fake-quic=quic.bin",
            "general (ALT12)",
        );
        let (plain_score, _, _) = score("plain", "version", &plain, &needs, &network, "");
        let (modern_score, _, _) = score("modern", "version", &modern, &needs, &network, "");
        assert!(modern_score > plain_score);
        assert!(modern_score - plain_score >= 6);
    }

    #[test]
    fn identical_strategies_collapse() {
        let first = signature(
            "winws --hostlist=\"C:\\zapret\\ALT11.txt\" --dpi-desync=fake",
            "ALT11",
        );
        let second = signature(
            "winws --hostlist=\"C:\\zapret\\ALT12.txt\" --dpi-desync=fake",
            "ALT12",
        );
        assert_eq!(first, second);
        let other = signature(
            "winws --hostlist=\"C:\\zapret\\ALT2.txt\" --dpi-desync=split",
            "ALT2",
        );
        assert_ne!(first, other);
    }
}
