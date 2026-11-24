"""檢查各科題庫（data/<科目>/questions/*.json）的格式、配分、難度配比與答案分布。

用法：python3 tools/check_bank.py [questions.json ...]（不給參數則檢查全部科目）
選修關鍵字取自該科 curriculum.json 的 elective_keywords。
ERROR 必須修正；WARN 請逐條判斷（例如選修關鍵字只要題幹已提供規則即可保留）。
"""
import glob
import json
import os
import re
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILE = {"E": {"single": 6, "multi": 10, "mixed": [10, 10, 10]},
           "M": {"single": 5, "multi": 10, "mixed": [4, 4, 6, 6]},
           "H": {"single": 5, "multi": 10, "mixed": [4, 4, 12]}}
# 每份題庫預設結構：(單選數, 多選數, 易, 中, 難)
SHAPE = {"E": (10, 1, 8, 3, 0), "M": (6, 5, 2, 7, 2), "H": (6, 5, 0, 3, 8)}
ELECTIVE_CACHE = {}


def elective_for(src):
    d = os.path.dirname(os.path.dirname(os.path.abspath(src)))
    if d not in ELECTIVE_CACHE:
        p = os.path.join(d, "curriculum.json")
        ELECTIVE_CACHE[d] = json.load(open(p, encoding="utf-8")).get("elective_keywords", []) if os.path.exists(p) else []
    return ELECTIVE_CACHE[d]


errors, warns = [], []


def check_file(src):
    d = json.load(open(src, encoding="utf-8"))
    tag0 = os.path.basename(src)
    img_dir = os.path.join(ROOT, "data", "img")
    for k in ("unit_id", "unit_title", "scope", "banks"):
        if k not in d:
            errors.append(f"{tag0}: 缺少 {k}")
    ids = set()
    for bank in d.get("banks", []):
        tag = f"{tag0}/{bank.get('name')}"
        P = bank.get("points") or PROFILE.get(bank["key"][0], PROFILE["M"])
        qs = bank["questions"]
        singles = [q for q in qs if q["type"] == "單選"]
        multis = [q for q in qs if q["type"] == "多選"]
        for q in qs:
            w = f"{tag} {q.get('id')}"
            for k in ("id", "code", "level", "type", "stem", "options", "answer", "explain"):
                if not q.get(k):
                    errors.append(f"{w}: 缺少 {k}")
            if q["id"] in ids:
                errors.append(f"{w}: 題號重複")
            ids.add(q["id"])
            if q["type"] not in ("單選", "多選"):
                errors.append(f"{w}: 題型須為 單選 或 多選")
            if q["level"] not in ("易", "中", "難"):
                errors.append(f"{w}: 難度須為 易／中／難")
            if len(q["options"]) != 5:
                errors.append(f"{w}: 選項必須 5 個（目前 {len(q['options'])}）")
            if len(set(q["options"])) != len(q["options"]):
                errors.append(f"{w}: 有重複選項")
            a = q["answer"]
            if not re.fullmatch(r"[A-E]+", a) or list(a) != sorted(set(a)):
                errors.append(f"{w}: 答案格式錯誤「{a}」")
            if q["type"] == "單選" and len(a) != 1:
                errors.append(f"{w}: 單選題答案只能一個字母")
            if q["type"] == "多選" and len(a) == 5:
                warns.append(f"{w}: 多選題五個選項全對，請確認")
            if q.get("image") and not os.path.exists(os.path.join(img_dir, q["image"])):
                errors.append(f"{w}: 找不到圖檔 data/img/{q['image']}")
            for s in [q["stem"], q["explain"], *q["options"]]:
                if s.count("{") != s.count("}"):
                    errors.append(f"{w}: 大括號不成對：{s[:40]}")
            text = q["stem"] + "".join(q["options"])
            hits = [kw for kw in elective_for(src) if kw in text]
            if hits:
                warns.append(f"{w}: 出現選修概念 {hits}，請確認判讀規則已寫在題幹")
            for o in q["options"]:
                if "以上皆是" in o or "以上皆非" in o:
                    warns.append(f"{w}: 使用「以上皆是／皆非」")
        shape = SHAPE.get(bank["key"][0])
        lv = Counter(q["level"] for q in qs)
        got = (len(singles), len(multis), lv["易"], lv["中"], lv["難"])
        if shape and got != shape and not bank.get("points"):
            warns.append(f"{tag}: 結構 單選{got[0]}／多選{got[1]}／易{got[2]}中{got[3]}難{got[4]}，預設為 單選{shape[0]}／多選{shape[1]}／易{shape[2]}中{shape[3]}難{shape[4]}")
        neg = sum(1 for q in qs if "錯誤" in q["stem"] or "不正確" in q["stem"])
        if neg > 2:
            warns.append(f"{tag}: 否定問法 {neg} 題（建議最多 2 題）")
        mx = bank.get("mixed")
        mixed_total = 0
        if mx:
            if mx["id"] in ids:
                errors.append(f"{tag}: 混合題題號重複 {mx['id']}")
            ids.add(mx["id"])
            if len(mx["parts"]) != len(P["mixed"]):
                errors.append(f"{tag}: 混合題小題數 {len(mx['parts'])} 與配分 {P['mixed']} 不一致")
            mixed_total = sum(P["mixed"])
            for i, p in enumerate(mx["parts"], 1):
                for k in ("q", "a", "rubric"):
                    if not p.get(k):
                        errors.append(f"{tag} 混合題第{i}小題: 缺少 {k}")
            if bank["key"][0] == "H" and not any("主張" in p["q"] for p in mx["parts"]):
                warns.append(f"{tag}: 難題庫混合題建議包含「主張、證據、推論」論證")
        total = P["single"] * len(singles) + P["multi"] * len(multis) + mixed_total
        if total != 100:
            errors.append(f"{tag}: 總分 {total}，不是 100")
        sa = [q["answer"] for q in singles]
        if len(sa) >= 5:
            letter, n = Counter(sa).most_common(1)[0]
            if n / len(sa) > 0.4:
                warns.append(f"{tag}: 單選答案 {letter} 占 {n}/{len(sa)}")
            for i in range(len(sa) - 2):
                if sa[i] == sa[i + 1] == sa[i + 2]:
                    warns.append(f"{tag}: 單選第 {i + 1}–{i + 3} 題答案連續都是 {sa[i]}")
        ma = Counter(q["answer"] for q in multis)
        if ma and ma.most_common(1)[0][1] >= 3:
            warns.append(f"{tag}: 多選答案「{ma.most_common(1)[0][0]}」出現 {ma.most_common(1)[0][1]} 次")


files = sys.argv[1:] or sorted(glob.glob(os.path.join(ROOT, "data", "*", "questions", "*.json")))
for f in files:
    check_file(f)
for m in errors:
    print("ERROR", m)
for m in warns:
    print("WARN ", m)
print(f"\n檢查 {len(files)} 個檔案：{len(errors)} 個錯誤、{len(warns)} 個提醒")
sys.exit(1 if errors else 0)
