"""Join relational codebook tables by declared IDs, without interpreting variable prefixes."""
import re
import json


def relational_codebook_items(grids, question_type):
    def key(value):
        return re.sub(r"[^a-z0-9]+", "", str(value).lower())

    tables = {}
    signatures = {
        "variables": {"variableid", "fieldlabel", "questionid", "valuecodelist"},
        "rules": {"variableid", "eligiblebaserouting", "companionstatefield"},
        "labels": {"codelistid", "rawcode", "valuelabel"},
        "questions": {"questionid", "exactquestionwording", "responsetype"},
    }
    for sheet, grid in grids:
        for h, row in enumerate(grid[:12]):
            names = [key(c) for c in row]
            for kind, required in signatures.items():
                if required <= set(names):
                    if kind in tables:
                        raise ValueError(f"Two codebook tables describe {kind}; choose one unambiguous codebook.")
                    tables[kind] = (sheet, [dict(zip(names, r)) for r in grid[h + 1:] if any(str(c).strip() for c in r)])
    if "variables" not in tables:
        return None
    missing = set(signatures) - set(tables)
    if missing:
        raise ValueError("The relational codebook is incomplete: missing " + ", ".join(sorted(missing)) + ".")

    def unique(kind, field):
        result = {}
        for row in tables[kind][1]:
            ident = str(row.get(field, "")).strip()
            if not ident:
                continue
            if ident in result:
                raise ValueError(f"Duplicate {field} {ident} in codebook {kind}.")
            result[ident] = row
        return result

    rules = unique("rules", "variableid")
    questions = unique("questions", "questionid")
    variables = unique("variables", "variableid")
    code_lists = {}
    for row in tables["labels"][1]:
        ident, code = row.get("codelistid", ""), row.get("rawcode", "")
        if not ident or code == "":
            continue
        if any(o["code"] == str(code) for o in code_lists.get(ident, [])):
            raise ValueError(f"Duplicate raw code {code} in {ident}.")
        code_lists.setdefault(ident, []).append({"code": str(code), "label": row.get("valuelabel", "")})
    question_options = {}
    for _, grid in grids:
        for h, header in enumerate(grid[:12]):
            keys = [key(c) for c in header]
            if {"questionid", "optioncode", "responseoptionlabel"} <= set(keys):
                for raw in grid[h + 1:]:
                    option = dict(zip(keys, raw))
                    if option.get("questionid") and option.get("optioncode"):
                        question_options.setdefault(option["questionid"], []).append({"code": option["optioncode"], "label": option.get("responseoptionlabel", "")})
                break
    items = []
    for name, row in variables.items():
        if name not in rules:
            raise ValueError(f"No field rules are declared for {name}.")
        rule = rules[name]
        qid = row.get("questionid", "")
        q = questions.get(qid)
        if qid != "ADMIN" and q is None:
            raise ValueError(f"Question {qid} for {name} is absent from the question table.")
        q = q or {}
        code_list = row.get("valuecodelist", "")
        if code_list.startswith("CL") and code_list not in code_lists:
            raise ValueError(f"Answer code list {code_list} for {name} is absent.")
        qtype, raw_type = question_type(q.get("responsetype", row.get("storagetype", "")))
        mr = row.get("responsesetid", "")
        state = rule.get("companionstatefield", "")
        if state == "No companion state field":
            state = None
        if state and state not in variables:
            raise ValueError(f"Response state {state} for {name} is absent from the dictionary.")
        metadata = {
            "questionWording": q.get("exactquestionwording", ""),
            "fieldRole": row.get("fieldrole", ""),
            "stateVariable": state,
            "eligibleBase": rule.get("eligiblebaserouting", ""),
            "period": rule.get("referenceperiod", ""),
            "unit": rule.get("unit", ""),
            "validValues": rule.get("validvaluesrange", ""),
            "missingTreatment": rule.get("missingblankhandling", ""),
            "loopContext": row.get("loopcontext", ""),
            "itemId": row.get("itemid", ""),
            "administrationNotes": q.get("administrationnotes", ""),
            "questionOptions": json.dumps(question_options.get(qid, []), ensure_ascii=True),
        }
        items.append({
            "variable": name, "label": row.get("fieldlabel") or name,
            "questionId": qid, "questionType": qtype,
            **({"questionTypeAsWritten": raw_type} if raw_type and not qtype else {}),
            "mrSet": None if mr == "Not part of a multiple-response set" else mr or None,
            "options": code_lists.get(code_list, []), "section": None,
            "routing": rule.get("eligiblebaserouting", ""),
            "researchMeta": metadata, "sheet": tables["variables"][0],
        })
    return {"items": items, "sheets": [x[0] for x in tables.values()], "skippedSheets": []}
