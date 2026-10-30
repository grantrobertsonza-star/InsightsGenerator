"""Shared independent CSM validation rules; no response generation."""

from pathlib import Path
from decimal import Decimal
from collections import Counter
import csv, datetime as dt, math


COMMON = ['respondent_id', 'interview_date', 'wave', 'company', 'weight', 'age',
          'age_band', 'gender', 'province', 'income', 'settlement', 'segment',
          'tenure_months']

DRIVERS = {
    'reliability': ['reliable_accurate', 'reliable_correct'],
    'responsiveness': ['responsive_speed', 'responsive_updates'],
    'assurance': ['assurance_knowledge', 'assurance_confidence'],
    'empathy': ['empathy_understood', 'empathy_respect'],
    'access_and_clarity': ['access_ease', 'access_clarity'],
}

NEW_CALL_FIELDS = ['call_agent_contact', 'queue_wait_csat5', 'total_call_time_csat5',
                   'agent_overall_csat5', 'correct_person_first_transfer',
                   'agent_ownership5', 'agent_promise_made', 'agent_promises_kept5',
                   'agent_patience5', 'urgency_need', 'agent_urgency5',
                   'ivr_availability5', 'ivr_response_speed5',
                   'ivr_information_accuracy5', 'ivr_ease5']

COUNT = Counter()

def check(ok, context):
    COUNT['assertions'] += 1
    if not ok:
        raise AssertionError(context)

def read_csv(path):
    with path.open(encoding='utf-8-sig', newline='') as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        fields = reader.fieldnames
    check(fields is not None and len(fields) == len(set(fields)), f'duplicate headers {path}')
    check(all(None not in row for row in rows), f'row width mismatch {path}')
    return fields, rows

def number(v):
    return None if v in ('', None) else Decimal(str(v))

def scalar_equal(a, b, numeric=False):
    if a in ('', None) or b in ('', None):
        return a in ('', None) and b in ('', None)
    if numeric:
        return number(a) == number(b)
    return a == b

def typed(rows, specs):
    types = {s['variable']: s['data_type'] for s in specs}
    return [{k: (None if v == '' else float(v) if types[k] == 'numeric' else v)
             for k, v in row.items()} for row in rows]

def unique(rows, keys, context):
    values = [tuple(row[k] for k in keys) for row in rows]
    check(len(set(values)) == len(values), f'duplicate {keys}: {context}')
    return dict(zip(values, rows))

def labels_check(rows, labels, context):
    allowed = {}
    for field, _label, value, _value_label in labels:
        allowed.setdefault(field, set()).add(value)
    for row in rows:
        for field, values in allowed.items():
            check(row[field] is None or row[field] in values,
                  f'unknown code {context} {row["respondent_id"]} {field}={row[field]}')

def route_checks(rel, channels, nc, metadata, wave):
    lookup = unique(rel, ['wave', 'respondent_id'], f'company wave {wave}')
    check(len(rel) == 1000, f'company count wave {wave}')
    keys = set()
    for row in rel:
        check(isinstance(row['respondent_id'], str) and len(row['respondent_id']) == 8
              and row['respondent_id'].startswith('0'), 'customer text ID')
        check(row['wave'] == wave and row['weight'] > 0, 'company wave or weight')
    for row in channels:
        key = (row['wave'], row['respondent_id'])
        check(key in lookup, f'unmatched channel {key}')
        customer = lookup[key]
        ch = int(row['channel'])
        key3 = key + (ch,)
        check(key3 not in keys, f'duplicate channel {key3}')
        keys.add(key3)
        for field in COMMON:
            check(row[field] == customer[field], f'duplicate common context {key3} {field}')
        check(customer[f'channel_used_c{ch:02}'] == 1, f'unused channel populated {key3}')
        days = (dt.date.fromisoformat(row['interview_date']) - dt.date.fromisoformat(row['contact_date'])).days
        check(0 <= days <= 30 and days == row['days_ago'], f'channel date window {key3}')
        check((row['digital_mode'] is not None) == (ch == 3), f'digital mode {key3}')
        check(row['staff_contact'] == int(ch != 3), f'staff contact {key3}')
        check((row['wait_minutes'] is not None) == (row['staff_contact'] == 1), f'wait route {key3}')
        check((row['digital_response_seconds'] is not None) == (ch == 3), f'digital response route {key3}')
        check(row[f'reasons_r{int(row["primary_reason"]):02}'] == 1, f'primary reason {key3}')
        check((row['problem_resolution'] is not None) == (row['problem_present'] == 1), f'problem route {key3}')
        fcr = int(row['problem_resolution'] == 1 and row['contacts_same_need'] == 1) if row['problem_resolution'] in [1, 2, 3] else None
        check(row['first_contact_resolution'] == fcr, f'first contact resolution {key3}')
        for field in ['transferred', 'put_on_hold', 'callback_promised', 'used_ivr']:
            check((row[field] is not None) == (ch == 1), f'call centre route {key3} {field}')
        check((row['number_transfers'] is not None) == (row['transferred'] == 1), f'transfers route {key3}')
        check((row['callback_outcome'] is not None) == (row['callback_promised'] == 1), f'callback route {key3}')
        for field in ['ivr_csat5', 'ivr_clarity5']:
            check((row[field] is not None) == (row['used_ivr'] == 1), f'IVR route {key3} {field}')
        for field in ['agent_introduced', 'agent_polite', 'preferred_language_assisted', 'driver_assurance_knowledge', 'driver_empathy_understood', 'driver_empathy_respect']:
            check((row[field] is not None) == (row['staff_contact'] == 1), f'staff route {key3} {field}')
        for field in ['branch_tidy5', 'branch_accessible5']:
            check((row[field] is not None) == (ch == 2), f'branch route {key3} {field}')
        for dimension, fields in DRIVERS.items():
            values = [row['driver_' + f] for f in fields]
            valid = [v for v in values if v is not None and 1 <= v <= 5]
            value = row['dimension_' + dimension]
            check((value is None) == (len(valid) < 2), f'dimension missing {key3} {dimension}')
            if value is not None:
                check(abs(value - sum(valid) / 2) < 1e-9, f'dimension value {key3} {dimension}')
        for field in ['channel_angry5', 'channel_disappointed5']:
            check(row[field] in [1, 2, 3, 4, 5, 99], f'new channel emotion scale {key3} {field}')
        if ch != 1:
            check(all(row[field] is None for field in NEW_CALL_FIELDS), f'new noncall diagnostics blank {key3}')
        else:
            # Every source call already has staff_contact=1. The new gate must
            # retain that known history, not invent contradictory IVR-only calls.
            check(row['call_agent_contact'] == 1 and row['staff_contact'] == 1, f'live agent preservation {key3}')
            for field in ['queue_wait_csat5', 'total_call_time_csat5', 'agent_overall_csat5']:
                check(row[field] in [1, 2, 3, 4, 5, 99], f'new call CSAT scale {key3} {field}')
            check((row['correct_person_first_transfer'] is not None) == (row['transferred'] == 1), f'first transfer route {key3}')
            for field in ['agent_ownership5', 'agent_patience5']:
                check(row[field] in [1, 2, 3, 4, 5, 98, 99], f'agent agreement scale {key3} {field}')
            check(row['agent_promise_made'] in [0, 1, 99], f'agent promise gate {key3}')
            if row['callback_promised'] == 1:
                check(row['agent_promise_made'] == 1, f'existing callback promise preserved {key3}')
            check((row['agent_promises_kept5'] is not None) == (row['agent_promise_made'] == 1), f'agent promise kept route {key3}')
            if row['callback_outcome'] == 9:
                check(row['agent_promises_kept5'] == 9, f'callback not yet due preserved {key3}')
            check(row['urgency_need'] in [0, 1, 99], f'agent urgency gate {key3}')
            check((row['agent_urgency5'] is not None) == (row['urgency_need'] == 1), f'agent urgency route {key3}')
            for field in ['ivr_availability5', 'ivr_response_speed5', 'ivr_information_accuracy5', 'ivr_ease5']:
                check((row[field] is not None) == (row['used_ivr'] == 1), f'new IVR route {key3} {field}')
    unique(channels, ['wave', 'experience_id'], 'channel experience IDs')
    jfields = [s['variable'] for s in metadata['company_specs'] if s['variable'].startswith('journey_') and s['variable'] != 'journey_recent30']
    bfields = [s['variable'] for s in metadata['company_specs'] if s['variable'].startswith('benchmark_')]
    for row in rel:
        key = (row['wave'], row['respondent_id'])
        for field in ['complaint_resolution', 'complaint_handling_csat5'] + [f'complaint_reason_r{i:02}' for i in range(1, 7)]:
            check((row[field] is not None) == (row['complaint3m'] == 1), f'complaint route {key} {field}')
        check(row['channel_none'] == int(not any(row[f'channel_used_c{i:02}'] for i in range(1, 5))), f'none flag {key}')
        for ch in range(1, 5):
            check((key + (ch,) in keys) == bool(row[f'channel_used_c{ch:02}']), f'channel presence {key} {ch}')
            check((row[f'channel_contacts_c{ch:02}'] > 0) == bool(row[f'channel_used_c{ch:02}']), f'contact count {key} {ch}')
        picks = [i for i in range(1, 7) if row[f'stay_reason_r{i:02}'] == 1]
        exclusive = row['stay_none'] + row['stay_dk']
        check((bool(picks) and exclusive == 0) or (not picks and exclusive == 1), f'staying exclusivity {key}')
        check(row['stay_primary'] in picks if picks else row['stay_primary'] == (97 if row['stay_none'] else 99), f'primary staying reason {key}')
        if row['journey_recent30'] == 0:
            check(all(row[k] is None for k in jfields + bfields), f'no journey route {key}')
        else:
            for field in ['journey_angry5', 'journey_disappointed5']:
                check(row[field] in [1, 2, 3, 4, 5, 99], f'new anchored journey emotion scale {key} {field}')
            check(row['journey_id'] == row['respondent_id'] + '-J', f'journey anchor ID {key}')
            check(0 <= row['journey_last_days_ago'] <= row['journey_start_days_ago'] <= 30, f'journey time window {key}')
            seq = [int(v) for v in row['journey_sequence'].split('>')]
            check(len(seq) == row['journey_contacts'] and len(seq) > 0, f'journey sequence contacts {key}')
            used = set(seq)
            check(row['journey_multichannel'] == int(len(used) > 1), f'journey multichannel {key}')
            for ch in range(1, 5):
                check(row[f'journey_channel_c{ch:02}'] == int(ch in used), f'journey channel flag {key} {ch}')
                check(seq.count(ch) <= row[f'channel_contacts_c{ch:02}'], f'journey contact bound {key} {ch}')
                if ch in used:
                    check(row[f'channel_used_c{ch:02}'] == 1, f'journey channel used {key} {ch}')
            check((row['journey_digital_mode'] is not None) == (3 in used), f'journey digital mode {key}')
            check(row['journey_completed'] == (None if row['journey_status'] == 9 else int(row['journey_status'] == 1)), f'journey completion {key}')
            if row['benchmark_recent_same_task30'] == 1:
                check(row['benchmark_provider'] != row['company'], f'benchmark different company {key}')
                check(row['benchmark_task'] == row['journey_task'] and 0 <= row['benchmark_days_ago'] <= 30, f'benchmark comparable task {key}')
                valid = row['journey_csat5'] in range(1, 6) and row['benchmark_csat5'] in range(1, 6)
                check(row['benchmark_gap5'] == (row['journey_csat5'] - row['benchmark_csat5'] if valid else None), f'benchmark gap {key}')
            else:
                check(all(row[k] is None for k in bfields if k != 'benchmark_recent_same_task30'), f'benchmark skipped route {key}')
    check(len(nc) == 500, f'noncustomer count wave {wave}')
    unique(nc, ['wave', 'respondent_id'], 'noncustomer key')
    check(not {r['respondent_id'] for r in nc} & {r['respondent_id'] for r in rel}, 'noncustomers overlap customers')
    for row in nc:
        key = (row['wave'], row['respondent_id'])
        check(isinstance(row['respondent_id'], str) and row['respondent_id'].startswith('NC'), 'noncustomer text ID')
        check(row['focal_company'] == 1 and row['current_focal_use'] == 0 and row['company'] != 1, f'noncustomer eligibility {key}')
        check(18 <= row['age'] <= 69 and row['weight'] == 1, f'noncustomer age or weight {key}')
        for field in ['focal_consider5'] + [f'expect_level_d{i:02}' for i in range(1, 7)]:
            check((row[field] is not None) == (row['focal_awareness'] == 1), f'noncustomer awareness route {key} {field}')
        for field in ['alternative_task', 'alternative_days_ago', 'alternative_channel', 'alternative_csat5']:
            check((row[field] is not None) == (row['alternative_recent30'] == 1), f'noncustomer alternative route {key} {field}')
        if row['alternative_recent30'] == 1:
            check(0 <= row['alternative_days_ago'] <= 30, f'noncustomer alternative time {key}')
    for rows, name in [(rel, 'company'), (channels, 'channel'), (nc, 'noncustomer')]:
        labels_check(rows, metadata[name + '_labels'], name)

def recalc_metrics(expected, data, wave):
    checked = 0
    for ex in (x for x in expected if int(x['wave']) == wave):
        rows = [r for r in data[ex['dataset']] if (ex['company'] == 0 or r['company'] == ex['company']) and (ex['channel'] == 0 or r.get('channel') == ex['channel'])]
        stat, field = ex['statistic'], ex['variable']
        upper = 5 if stat in ['t2b', 'top', 'b2b', 'mean5'] or stat.startswith('dist') else 7 if stat in ['ease', 'mean7'] else 10 if stat in ['nps', 'risk'] else 1
        lower = 0 if stat in ['nps', 'risk', 'yes'] else 1
        if stat == 'mean_gap':
            lower, upper = -4, 4
        valid = [r for r in rows if r[field] is not None and lower <= r[field] <= upper]
        base = math.fsum(r['weight'] for r in valid)
        check(len(valid) == ex['raw_base'], f'metric raw base {ex}')
        check(abs(base - ex['weighted_base']) < 1e-6, f'metric weighted base {ex}')
        if not valid:
            check(ex['expected'] is None, f'metric empty result {ex}')
            checked += 1
            continue
        def score(value):
            if stat == 't2b': return int(value >= 4)
            if stat == 'top': return int(value == 5)
            if stat == 'b2b': return int(value <= 2)
            if stat.startswith('dist'): return int(value == int(stat[-1]))
            if stat == 'nps': return int(value >= 9) - int(value <= 6)
            if stat == 'risk': return int(value >= 8)
            if stat == 'ease': return int(value >= 6)
            return value
        numerator = math.fsum(r['weight'] * score(r[field]) for r in valid)
        value = numerator / base * (1 if stat.startswith('mean') else 100)
        check(abs(value - ex['expected']) < 1e-6, f'metric result {ex}')
        check(abs(numerator - ex['numerator']) < 1e-6, f'metric numerator {ex}')
        checked += 1
    return checked

def xlsx_csv_check(path, fields, csv_rows, numeric_fields, sheet_name=None):
    import openpyxl
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook[sheet_name] if sheet_name else workbook.worksheets[0]
    iterator = iter(sheet.values)
    header = list(next(iterator))
    check(header == fields, f'XLSX header {path} {sheet.title}')
    count = 0
    for count, (row, original) in enumerate(zip(iterator, csv_rows, strict=True), 1):
        for field, value in zip(fields, row, strict=True):
            check(scalar_equal(value, original[field], field in numeric_fields), f'XLSX CSV mismatch {path} row {count} {field}')
            if field not in numeric_fields and value is not None:
                check(isinstance(value, str), f'XLSX text type {path} row {count} {field}')
        COUNT['xlsx_cells_compared'] += len(fields)
    check(count == len(csv_rows), f'XLSX row count {path}')
    workbook.close()
