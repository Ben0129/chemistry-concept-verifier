"""把 data/ 下的 JSON 打包成 assets/data.js，讓網站可直接開啟（不需要伺服器）。

用法：python3 tools/build_data.py
同時做基本檢查：學習內容代碼是否存在於 curriculum.json、題目所屬單元是否有知識庫。
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "assets", "data.js")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def split_codes(s):
    return [c.strip() for c in re.split(r"[、,，\s]+", s) if c.strip()]


def main():
    errors = []
    curriculum = load(os.path.join(DATA, "curriculum.json"))
    valid = {c["code"] for c in curriculum["codes"]}

    knowledge = []
    for p in sorted(glob.glob(os.path.join(DATA, "knowledge", "*.json"))):
        u = load(p)
        for t in u["topics"]:
            for c in t["codes"]:
                if c not in valid:
                    errors.append(f"{os.path.basename(p)} {t['id']}: 未知代碼 {c}")
        knowledge.append(u)
    knowledge.sort(key=lambda u: u["order"])
    unit_ids = {u["id"] for u in knowledge}

    questions = []
    seen = set()
    for p in sorted(glob.glob(os.path.join(DATA, "questions", "*.json"))):
        q = load(p)
        if q["unit_id"] not in unit_ids:
            errors.append(f"{os.path.basename(p)}: unit_id {q['unit_id']} 沒有對應的知識庫")
        for bank in q["banks"]:
            items = list(bank["questions"]) + ([bank["mixed"]] if bank.get("mixed") else [])
            for item in items:
                if item["id"] in seen:
                    errors.append(f"{os.path.basename(p)}: 題號重複 {item['id']}")
                seen.add(item["id"])
                for c in split_codes(item["code"]):
                    if c not in valid:
                        errors.append(f"{os.path.basename(p)} {item['id']}: 未知代碼 {c}")
        questions.append(q)
    order = {u["id"]: u["order"] for u in knowledge}
    questions.sort(key=lambda q: order.get(q["unit_id"], 99))

    for e in errors:
        print("ERROR", e)
    if errors:
        sys.exit(1)

    bundle = {"curriculum": curriculum, "knowledge": knowledge, "questions": questions}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// 由 tools/build_data.py 自動產生，請勿手動修改；請編輯 data/ 下的 JSON。\n")
        f.write("window.CHEM_DATA = ")
        json.dump(bundle, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    n_topics = sum(len(u["topics"]) for u in knowledge)
    n_q = sum(len(b["questions"]) for q in questions for b in q["banks"])
    n_mx = sum(1 for q in questions for b in q["banks"] if b.get("mixed"))
    print(f"知識庫 {len(knowledge)} 單元、{n_topics} 個主題；題庫 {n_q} 題選擇題、{n_mx} 組混合題 → {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
