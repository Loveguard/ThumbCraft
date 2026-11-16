// ThumbCraft reads Minecraft 1.18 and newer (port of shared/minecraft/compat.ts).
use std::cmp::Ordering;

/// Milliseconds since 1970 for "2021-11-30" or "2021-11-30T09:16:29+00:00" (what version jsons hold).
pub fn parse_date(s: &str) -> Option<f64> {
    let s = s.trim();
    let num = |a: usize, b: usize| -> Option<i64> { s.get(a..b)?.parse().ok() };
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    if s.as_bytes().get(4) != Some(&b'-') || s.as_bytes().get(7) != Some(&b'-') {
        return None;
    }
    let (mut h, mut mi, mut se, mut offset) = (0, 0, 0, 0i64);
    if s.len() > 10 {
        h = num(11, 13)?;
        mi = num(14, 16)?;
        se = num(17, 19).unwrap_or(0);
        let tail = &s[19.min(s.len())..];
        let tail = tail.trim_start_matches(|c: char| c == '.' || c.is_ascii_digit());
        if let Some(sign) = tail.chars().next().filter(|c| *c == '+' || *c == '-') {
            let t = &tail[1..];
            let oh: i64 = t.get(0..2)?.parse().ok()?;
            let om: i64 = t.get(t.len().saturating_sub(2)..)?.parse().unwrap_or(0);
            offset = (oh * 60 + om) * if sign == '+' { 1 } else { -1 };
        }
    }
    // Days from the civil date (Howard Hinnant's algorithm).
    let yy = if mo <= 2 { y - 1 } else { y };
    let era = if yy >= 0 { yy } else { yy - 399 } / 400;
    let yoe = yy - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    let secs = days * 86400 + h * 3600 + mi * 60 + se - offset * 60;
    Some(secs as f64 * 1000.0)
}

const RELEASES: [(&str, &str); 4] =
    [("1.18", "2021-11-30"), ("1.19", "2022-06-07"), ("1.20", "2023-06-07"), ("1.21", "2024-06-13")];

/// Release time given to ids we can't date (modded profiles, new naming schemes): treat them as current.
const UNKNOWN_IS_CURRENT: f64 = 8.64e15;

/// Compares dotted version numbers (1.20.4 < 1.21); missing parts count as 0.
pub fn compare_versions(a: &str, b: &str) -> Ordering {
    let parse = |s: &str| -> Vec<i64> {
        s.split('.')
            .map(|n| {
                // Like parseInt: an optional sign, then leading digits ("10-pre" is 10).
                let t = n.trim();
                let (sign, rest) = if let Some(r) = t.strip_prefix('-') { (-1, r) } else { (1, t.trim_start_matches('+')) };
                let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                digits.parse::<i64>().map(|v| v * sign).unwrap_or(0)
            })
            .collect()
    };
    let (pa, pb) = (parse(a), parse(b));
    for i in 0..pa.len().max(pb.len()) {
        let d = pa.get(i).unwrap_or(&0) - pb.get(i).unwrap_or(&0);
        if d != 0 {
            return d.cmp(&0);
        }
    }
    Ordering::Equal
}

/// Best guess at a version's release time (ms).
pub fn release_time_of(id: &str, release_time: Option<&str>) -> f64 {
    if let Some(t) = release_time.and_then(parse_date) {
        return t;
    }
    let re = regex::Regex::new(r"^(\d+\.\d+(?:\.\d+)?)").unwrap();
    if let Some(m) = re.captures(id).map(|c| c[1].to_string()) {
        if m.starts_with("1.") {
            let mut best = 0.0;
            for (v, d) in RELEASES {
                if compare_versions(&m, v) != Ordering::Less {
                    best = parse_date(d).unwrap_or(0.0);
                }
            }
            return best;
        }
    }
    UNKNOWN_IS_CURRENT
}

pub fn is_supported(id: &str, release_time: Option<&str>) -> bool {
    release_time_of(id, release_time) >= parse_date("2021-09-15").unwrap()
}

pub fn locate_command(id: &str, release_time: Option<&str>) -> &'static str {
    if release_time_of(id, release_time) >= parse_date("2022-06-07").unwrap() {
        "locate biome"
    } else {
        "locatebiome"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dates() {
        assert_eq!(parse_date("1970-01-01"), Some(0.0));
        assert_eq!(parse_date("2021-11-30T09:16:29+00:00"), Some(1638263789000.0));
        assert_eq!(parse_date("2021-11-30T10:16:29+01:00"), Some(1638263789000.0));
    }
    #[test]
    fn versions() {
        assert!(is_supported("1.18.2", None));
        assert!(!is_supported("1.17.1", None));
        assert!(is_supported("26.1", None));
        assert_eq!(locate_command("1.18.2", None), "locatebiome");
        assert_eq!(locate_command("1.20.1", None), "locate biome");
        assert_eq!(compare_versions("0.2.10", "0.2.9"), Ordering::Greater);
    }
}
