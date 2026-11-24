"""把 data/ 下各科的 JSON 打包成 assets/data.js，讓網站可直接開啟（不需要伺服器）。

用法：python3 tools/build_data.py
資料結構：data/subjects.json 列出各科；每科資料夾內有 curriculum.json、knowledge/*.json、questions/*.json。
同時做基本檢查：代碼是否存在於該科 curriculum.json、單元與題號是否全站唯一、題目所屬單元是否有知識庫。
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
    meta = load(os.path.join(DATA, "subjects.json"))
    all_codes = {}
    subjects = []
    seen_units, seen_ids = set(), set()
    for sub in meta["subjects"]:
        d = os.path.join(DATA, sub["dir"])
        if not os.path.exists(os.path.join(d, "curriculum.json")):
            print(f"WARN  {sub['name']}：尚無資料夾 data/{sub['dir']}，略過")
            continue
        cur = load(os.path.join(d, "curriculum.json"))
        for c in cur["codes"]:
            if c["code"] in all_codes:
                errors.append(f"代碼重複：{c['code']}（{all_codes[c['code']]} 與 {sub['name']}）")
            all_codes[c["code"]] = sub["name"]
        subjects.append({**sub, "curriculum": cur, "knowledge": [], "questions": []})

    # 各科題目與知識點都可以引用任何一科的代碼（例如生物題引用化學的碳循環），方便跨科連結
    valid = set(all_codes)
    for s in subjects:
        d = os.path.join(DATA, s["dir"])
        for p in sorted(glob.glob(os.path.join(d, "knowledge", "*.json"))):
            u = load(p)
            if u["id"] in seen_units:
                errors.append(f"{p}: 單元 id 重複 {u['id']}")
            seen_units.add(u["id"])
            for t in u["topics"]:
                if t["id"] in seen_ids:
                    errors.append(f"{p}: 主題 id 重複 {t['id']}")
                seen_ids.add(t["id"])
                for c in t["codes"]:
                    if c not in valid:
                        errors.append(f"{os.path.relpath(p, ROOT)} {t['id']}: 未知代碼 {c}")
            s["knowledge"].append(u)
        s["knowledge"].sort(key=lambda u: u["order"])
        unit_ids = {u["id"] for u in s["knowledge"]}
        for p in sorted(glob.glob(os.path.join(d, "questions", "*.json"))):
            q = load(p)
            rel = os.path.relpath(p, ROOT)
            if q["unit_id"] not in unit_ids:
                errors.append(f"{rel}: unit_id {q['unit_id']} 沒有對應的知識庫")
            for bank in q["banks"]:
                items = list(bank["questions"]) + ([bank["mixed"]] if bank.get("mixed") else [])
                for item in items:
                    if item["id"] in seen_ids:
                        errors.append(f"{rel}: 題號重複 {item['id']}")
                    seen_ids.add(item["id"])
                    for c in split_codes(item["code"]):
                        if c not in valid:
                            errors.append(f"{rel} {item['id']}: 未知代碼 {c}")
            s["questions"].append(q)
        order = {u["id"]: u["order"] for u in s["knowledge"]}
        s["questions"].sort(key=lambda q: order.get(q["unit_id"], 99))

    for e in errors:
        print("ERROR", e)
    if errors:
        sys.exit(1)

    bundle = {"title": meta["title"], "subjects": subjects}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// 由 tools/build_data.py 自動產生，請勿手動修改；請編輯 data/ 下的 JSON。\n")
        f.write("window.SCI_DATA = ")
        json.dump(bundle, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    for s in subjects:
        n_t = sum(len(u["topics"]) for u in s["knowledge"])
        n_q = sum(len(b["questions"]) for q in s["questions"] for b in q["banks"])
        n_m = sum(1 for q in s["questions"] for b in q["banks"] if b.get("mixed"))
        print(f"{s['name']}：{len(s['knowledge'])} 單元、{n_t} 主題；{n_q} 題選擇題、{n_m} 組混合題")
    print(f"→ {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
