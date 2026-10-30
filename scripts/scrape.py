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
import os
import sys
import time
from pathlib import Path
BASE_URL = "https://www.pdpc.gov.tw"
LISTING_URL = f"{BASE_URL}/News_Html/100/"
# 可用環境變數 PDPC_DATA_PATH 覆寫資料檔路徑（試跑用）；未設定時維持原路徑
DATA_PATH = (
    Path(os.environ["PDPC_DATA_PATH"])
    if os.environ.get("PDPC_DATA_PATH")
    else Path(__file__).parent.parent / "src" / "data" / "pdpc_data.json"
)

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


def build_existing_pairs(data):
    """(條號, 函釋字號) 配對集合；同一函釋可掛在多個條號底下"""
    pairs = set()
    for article in data:
        for interp in article.get("函釋", []):
            pairs.add((article["條號"], interp["函釋字號"]))
    return pairs


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

def parse_doc_date(full_text):
    """從全文解析公文發文日（民國年），回傳 ISO YYYY-MM-DD；解析不到回 None"""
    m = re.search(r"發文日期\s*(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", full_text or "")
    if not m:
        return None
    return f"{int(m.group(1)) + 1911}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"


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
        "發文日期": parse_doc_date(full_text) or date_fmt,  # 公文發文日；解析失敗 fallback 公布日期
        "公布日期": date_fmt,  # 網站發布日（JSON-LD datePublished）
        "全文": full_text,
        "來源URL": url,
    }


# ── 主流程 ─────────────────────────────────────────────────────────────────────

def main():
    session = get_session()

    existing = load_existing()
    existing_pairs = build_existing_pairs(existing)
    print(f"現有函釋：{len(build_existing_ids(existing))} 筆（{len(existing_pairs)} 列）")

    # 條號 → 在 existing 的索引
    article_index = {a["條號"]: i for i, a in enumerate(existing)}

    articles = fetch_article_list(session)
    new_count = 0
    failures = []  # (URL 或條號, 錯誤訊息)
    fetched = {}   # 本次執行已抓過的 URL → content，同一函釋跨條號時重用

    for art in articles:
        article_no = art.get("條號", "").strip()
        list_url = extract_list_url(art)
        if not list_url or not article_no:
            continue

        print(f"\n[2] {article_no} → {list_url}")

        try:
            interp_urls = fetch_interp_urls(session, list_url)
        except Exception as e:
            failures.append((article_no, f"列表頁 {list_url}：{e}"))
            print(f"    ❌ 列表頁錯誤（{article_no}）：{e}")
            continue
        print(f"    找到 {len(interp_urls)} 個函釋連結")

        # 若為新條號，建立欄位（列表頁抓取成功後才建立，避免留下空條號）
        if article_no not in article_index:
            existing.append({
                "條號": article_no,
                "條文內容": art.get("條文內容", ""),
                "函釋列表URL": list_url,
                "函釋": [],
            })
            article_index[article_no] = len(existing) - 1

        idx = article_index[article_no]

        for url in interp_urls:
            try:
                from_cache = url in fetched
                if from_cache:
                    content = fetched[url]
                else:
                    content = fetch_interp(session, url)
                    fetched[url] = content
                if not content or not content["函釋字號"]:
                    continue

                pair = (article_no, content["函釋字號"])
                if pair in existing_pairs:
                    continue  # 此條號下已有該函釋，跳過（不更新既有內容）

                existing[idx]["函釋"].append(dict(content))
                existing_pairs.add(pair)
                new_count += 1
                print(f"    ✅ 新增：{article_no} / {content['函釋字號']}")
                if not from_cache:
                    time.sleep(1)

            except Exception as e:
                failures.append((url, str(e)))
                print(f"    ❌ 錯誤（{url}）：{e}")

    print(f"\n共新增 {new_count} 列函釋")

    if new_count == 0:
        print("無新增。")
    else:
        # 有新增即寫回（即使有失敗，也保留已成功抓到的內容）
        DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(DATA_PATH, "w", encoding="utf-8") as f:
            json.dump(existing, f, ensure_ascii=False, indent=2)
        print(f"已更新 {DATA_PATH}")

    if failures:
        print(f"\n失敗摘要：共 {len(failures)} 筆失敗")
        for target, msg in failures:
            print(f"  - {target}：{msg}")
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
