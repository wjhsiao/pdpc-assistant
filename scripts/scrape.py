"""
PDPC 函釋爬蟲 - 增量更新版
用於 GitHub Actions，自動比對並更新 src/data/pdpc_data.json

網站結構（三層）：
  /News_Html/100/          → 法條列表（DefaultData JSON）
  /News_Content/101/366    → 某條法條的函釋列表（含分頁）
  /News_Content/102/1115   → 個別函釋全文（JSON-LD）
"""

import requests
import re
import json
import sys
import time
from pathlib import Path
BASE_URL = "https://www.pdpc.gov.tw"
LISTING_URL = f"{BASE_URL}/News_Html/100/"
DATA_PATH = Path(__file__).parent.parent / "src" / "data" / "pdpc_data.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "zh-TW,zh;q=0.9",
}


def get_session():
    s = requests.Session()
    s.headers.update(HEADERS)
    return s


# ── 現有資料 ───────────────────────────────────────────────────────────────────

def load_existing():
    if DATA_PATH.exists():
        with open(DATA_PATH, encoding="utf-8") as f:
            return json.load(f)
    return []


def build_existing_ids(data):
    ids = set()
    for article in data:
        for interp in article.get("函釋", []):
            ids.add(interp["函釋字號"])
    return ids


# ── 第一層：法條列表 ───────────────────────────────────────────────────────────

def fetch_article_list(session):
    print(f"[1] 抓取法條列表：{LISTING_URL}")
    resp = session.get(LISTING_URL, timeout=30)
    resp.raise_for_status()
    resp.encoding = 'utf-8'

    match = re.search(r"let DefaultData = (\[.*?\]);", resp.text, re.DOTALL)
    if not match:
        raise ValueError("找不到 DefaultData，頁面結構可能已變更")

    data = json.loads(match.group(1))
    print(f"    找到 {len(data)} 筆法條")
    return data


def extract_list_url(article_data):
    """從 LinksHtml 取出函釋列表頁 URL（/News_Content/101/xxx）"""
    links_html = article_data.get("LinksHtml", "")
    m = re.search(r'href="(https?://www\.pdpc\.gov\.tw/News_Content/101/\d+)/?\"', links_html)
    return m.group(1) if m else None


# ── 第二層：函釋列表頁 → 找所有 102 連結 ─────────────────────────────────────
# 實測確認：PDPC 網站 101 列表頁一次顯示全部函釋，無分頁機制。

def fetch_interp_urls(session, list_url):
    """進入 101 列表頁，取出所有函釋連結（絕對 URL 格式）"""
    resp = session.get(list_url, timeout=30)
    resp.raise_for_status()
    resp.encoding = 'utf-8'

    # 頁面裡的 href 是完整絕對 URL
    found = re.findall(
        r'href="(https?://www\.pdpc\.gov\.tw/News_Content/102/\d+)/?\"',
        resp.text
    )
    seen = set()
    result = []
    for url in found:
        if url not in seen:
            seen.add(url)
            result.append(url)
    return result


# ── 第三層：個別函釋頁面 ────────────────────────────────────────────────────────

def fetch_interp(session, url):
    """抓 /News_Content/102/xxx，從 JSON-LD 取函釋字號、日期、全文"""
    resp = session.get(url, timeout=30)
    resp.raise_for_status()
    resp.encoding = 'utf-8'

    m = re.search(r'<script type="application/ld\+json">(.*?)</script>', resp.text, re.DOTALL)
    if not m:
        return None

    jsonld = json.loads(m.group(1))
    headline = jsonld.get("headline", "").strip()
    date_raw = jsonld.get("datePublished", "")
    desc_html = jsonld.get("description", "")

    # 清理 HTML 標籤
    full_text = re.sub(r"<[^>]+>", " ", desc_html)
    full_text = re.sub(r"\s+", " ", full_text).strip()

    # 日期：JSON-LD datePublished 通常已是 ISO（2026-04-02），取前 10 碼
    date_fmt = date_raw[:10] if re.match(r"\d{4}-\d{2}-\d{2}", date_raw) else date_raw

    return {
        "函釋字號": headline,
        "標題": headline,
        "發文日期": date_fmt,
        "全文": full_text,
        "來源URL": url,
    }


# ── 主流程 ─────────────────────────────────────────────────────────────────────

def main():
    session = get_session()

    existing = load_existing()
    existing_ids = build_existing_ids(existing)
    print(f"現有函釋：{len(existing_ids)} 筆")

    # 條號 → 在 existing 的索引
    article_index = {a["條號"]: i for i, a in enumerate(existing)}

    articles = fetch_article_list(session)
    new_count = 0

    for art in articles:
        article_no = art.get("條號", "").strip()
        list_url = extract_list_url(art)
        if not list_url or not article_no:
            continue

        print(f"\n[2] {article_no} → {list_url}")

        # 若為新條號，建立欄位
        if article_no not in article_index:
            existing.append({
                "條號": article_no,
                "條文內容": art.get("條文內容", ""),
                "函釋列表URL": list_url,
                "函釋": [],
            })
            article_index[article_no] = len(existing) - 1

        idx = article_index[article_no]

        interp_urls = fetch_interp_urls(session, list_url)
        print(f"    找到 {len(interp_urls)} 個函釋連結")

        for url in interp_urls:
            try:
                content = fetch_interp(session, url)
                if not content or not content["函釋字號"]:
                    continue

                if content["函釋字號"] in existing_ids:
                    continue  # 已存在，跳過

                existing[idx]["函釋"].append(content)
                existing_ids.add(content["函釋字號"])
                new_count += 1
                print(f"    ✅ 新增：{content['函釋字號']}")
                time.sleep(1)

            except Exception as e:
                print(f"    ❌ 錯誤（{url}）：{e}")

    print(f"\n共新增 {new_count} 筆函釋")

    if new_count == 0:
        print("無新增，結束。")
        sys.exit(0)

    # 寫回
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(existing, f, ensure_ascii=False, indent=2)
    print(f"已更新 {DATA_PATH}")


if __name__ == "__main__":
    main()
