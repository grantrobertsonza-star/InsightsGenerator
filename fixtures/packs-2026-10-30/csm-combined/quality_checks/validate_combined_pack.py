"""Independent integrity checks for the combined company and channel CSM pack.

Run with the bundled Python runtime. This script reads files only. It never edits
customer records. Standard-library CSV checks and optional read-only openpyxl
checks are separate so that users can check CSV inputs without installing Excel.
The schema and expected metrics are QA fixtures, not dashboard import mappings.
"""
from pathlib import Path
from decimal import Decimal
from collections import Counter
import argparse
import csv
import datetime as dt
import hashlib
import json
import math
import re
import zipfile


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


def locate(base, filename):
    found = sorted(base.rglob(filename))
    check(len(found) == 1, f'expected exactly one {filename} under {base}, found {len(found)}')
    return found[0]


def schema_from_standard_files(root):
    """Read ordinary CSV codebooks and value labels; no mapping JSON required."""
    output = {}
    for sector, prefix in [('banking', 'Banking'), ('mobile', 'Mobile')]:
        base = root / sector
        _, specs = read_csv(base / 'Combined_Codebook.csv')
        _, labels = read_csv(base / 'Combined_Labels.csv')
        _, nc_specs = read_csv(base / 'supplemental_noncustomers/Noncustomer_Codebook.csv')
        _, nc_labels = read_csv(base / 'supplemental_noncustomers/Noncustomer_Labels.csv')
        company_specs = [s for s in specs if s['section'] == 'Company']
        channel_specs = [dict(s) for s in company_specs if s['variable'] in COMMON]
        for spec in specs:
            if spec['variable'].startswith('ch01_'):
                item = dict(spec)
                item['variable'] = item['variable'][5:]
                channel_specs.append(item)
        company_vars = {s['variable'] for s in company_specs}
        def label_row(row, strip=False):
            return [row['variable'][5:] if strip else row['variable'], row['label'], float(row['value']), row['value_label']]
        company_labels = [label_row(l) for l in labels if l['variable'] in company_vars]
        channel_labels = [label_row(l) for l in labels if l['variable'] in COMMON] + [label_row(l, True) for l in labels if l['variable'].startswith('ch01_')]
        output[sector] = {'prefix': prefix, 'company_specs': company_specs, 'channel_specs': channel_specs,
                          'company_labels': company_labels, 'channel_labels': channel_labels,
                          'noncustomer_specs': nc_specs, 'noncustomer_labels': [label_row(l) for l in nc_labels]}
    return output


def metadata_checks(base, metadata, source=None):
    _, specs = read_csv(base / 'Combined_Codebook.csv')
    by_var = {s['variable']: s for s in specs}
    check(len(by_var) == len(specs) == 400, f'codebook coverage {base}')
    common = {s['variable'] for s in metadata['company_specs']} & {s['variable'] for s in metadata['channel_specs']}
    check(common == set(COMMON), f'common schema {base}')
    channel_only = {s['variable'] for s in metadata['channel_specs']} - set(COMMON)
    for s in specs:
        field = s['variable']
        if field.startswith('ch0'):
            prefix = field[:5]
            check(s['source_variable'] == field[5:], f'channel source mapping {base} {field}')
            check(s['question'] == prefix[:4].upper() + '.' + s['source_question'], f'question namespace {base} {field}')
            check(('channel_used_c' + prefix[2:4] + ' = 1;') in s['universe'], f'channel universe {base} {field}')
            for expr in [s['universe'], s['derivation']]:
                tokens = re.findall(r'\b[A-Za-z_][A-Za-z_0-9]*\b', expr)
                for token in tokens:
                    if re.match(r'ch\d\d_', token):
                        check(token in by_var, f'unknown prefixed route variable {base} {field} {token}')
                    check(token not in channel_only, f'unprefixed channel variable in route {base} {field} {token}')
        else:
            check(s['source_variable'] == field, f'company source mapping {base} {field}')
            check(s['question'] == 'C.' + s['source_question'], f'company namespace {base} {field}')
    _, labels = read_csv(base / 'Combined_Labels.csv')
    check(len({(r['variable'], r['value']) for r in labels}) == len(labels), f'duplicate labels {base}')
    for row in labels:
        check(row['variable'] in by_var, f'label unknown variable {base} {row["variable"]}')
    _, mr = read_csv(base / 'Combined_MR_Sets.csv')
    check(len({(r['set_id'], r['variable']) for r in mr}) == len(mr), f'duplicate MR entries {base}')
    for row in mr:
        check(row['variable'] in by_var, f'MR unknown variable {base} {row["variable"]}')
        spec = by_var[row['variable']]
        check(spec['mr_set'] == row['set_id'], f'MR set mismatch {base} {row["variable"]}')
        check(number(spec['selected_value']) == number(row['selected_value']), f'MR selected value {base} {row["variable"]}')
    for spec in specs:
        if spec['mr_set']:
            check(any(r['set_id'] == spec['mr_set'] and r['variable'] == spec['variable'] for r in mr), f'MR omitted field {base} {spec["variable"]}')
    if source:
        original = json.loads((source / 'test-reference/metadata.json').read_text())
        for dataset, key in [('Company', 'company'), ('Channel', 'channel')]:
            for spec in original[key + '_specs']:
                targets = [spec['variable']] if dataset == 'Company' or spec['variable'] in COMMON else [f'ch{ch:02}_{spec["variable"]}' for ch in range(1, 5)]
                for target in targets:
                    out = by_var[target]
                    for field in ['data_type', 'question_type', 'unit']:
                        check(out[field] == spec[field], f'codebook preserved {base} {target} {field}')
                    check(out['source_question'] == spec['question'], f'source question preserved {base} {target}')
        label_map = {(r['variable'], number(r['value'])): r['value_label'] for r in labels}
        for key in ['company', 'channel']:
            for variable, _label, value, label in original[key + '_labels']:
                targets = [variable] if key == 'company' or variable in COMMON else [f'ch{ch:02}_{variable}' for ch in range(1, 5)]
                for target in targets:
                    check(label_map[(target, number(value))] == label, f'value label preserved {base} {target} {value}')


def exported_reference_metrics(base, wide_fields, source=None):
    _, rows = read_csv(base / 'reference/Reference_Metrics.csv')
    expected = []
    section_map = {'Company': 'Relationship', 'Channel': 'Channel', 'Optional noncustomers': 'Noncustomer'}
    for r in rows:
        dataset = section_map[r['section']]
        ch = int(r['channel'])
        if dataset == 'Channel':
            fields = [f'ch{ch:02}_{r["source_variable"]}'] if ch else [f'ch{c:02}_{r["source_variable"]}' for c in range(1, 5)]
            check(r['variable'].split(' ; ') == fields, f'reference channel field mapping {base} {r}')
            check(all(f in wide_fields for f in fields), f'reference unknown channel field {base} {r}')
            if not ch:
                check('dependent within respondent' in r['record_basis'], f'pooled reference record basis {base} {r}')
        else:
            check(r['variable'] == r['source_variable'], f'reference nonchannel field {base} {r}')
        ex = {'dataset': dataset, 'variable': r['source_variable'], 'statistic': r['statistic'], 'unit': r['unit']}
        for k in ['wave', 'company', 'channel', 'raw_base']:
            ex[k] = int(r[k])
        for k in ['expected', 'numerator', 'weighted_base']:
            ex[k] = None if r[k] == '' else float(r[k])
        expected.append(ex)
    keys = ['wave', 'dataset', 'company', 'channel', 'variable', 'statistic']
    actual_map = unique(expected, keys, f'exported reference {base}')
    if source:
        original = json.loads((source / 'test-reference/reference_results.json').read_text())
        source_map = unique(original, keys, f'source reference {base}')
        check(set(source_map) <= set(actual_map), f'original reference coverage {base}')
        for key in source_map:
            check(source_map[key] == actual_map[key], f'reference exact preservation {base} {key}')
    return expected


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
        if ch == 1:
            check(row['staff_contact'] == row['call_agent_contact'], f'explicit live-agent gate consistency {key3}')
        else:
            check(row['staff_contact'] == int(ch != 3), f'noncall source staff contact {key3}')
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
            # Use the explicit agent gate, never infer live-agent contact merely
            # because the channel is telephone. Exact source preservation below
            # separately verifies that this fixture's known agent contacts stay.
            live = row['call_agent_contact'] == 1
            check(row['call_agent_contact'] in [0, 1, 99], f'live agent gate {key3}')
            check(row['total_call_time_csat5'] in [1, 2, 3, 4, 5, 99], f'total call CSAT scale {key3}')
            for field in ['queue_wait_csat5', 'agent_overall_csat5']:
                check((row[field] is not None) == live, f'new call CSAT live-agent route {key3} {field}')
            check((row['correct_person_first_transfer'] is not None) == (live and row['transferred'] == 1), f'first transfer route {key3}')
            for field in ['agent_ownership5', 'agent_patience5']:
                check((row[field] is not None) == live, f'agent agreement live-agent route {key3} {field}')
            check((row['agent_promise_made'] is not None) == live, f'agent promise live-agent route {key3}')
            if live and row['callback_promised'] == 1:
                check(row['agent_promise_made'] == 1, f'existing callback promise preserved {key3}')
            check((row['agent_promises_kept5'] is not None) == (live and row['agent_promise_made'] == 1), f'agent promise kept route {key3}')
            if live and row['callback_outcome'] == 9:
                check(row['agent_promises_kept5'] == 9, f'callback not yet due preserved {key3}')
            check((row['urgency_need'] is not None) == live, f'agent urgency live-agent route {key3}')
            check((row['agent_urgency5'] is not None) == (live and row['urgency_need'] == 1), f'agent urgency route {key3}')
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


def future_boundary_checks(base):
    """Exercise delivered routing metadata on disposable in-memory examples."""
    _, definitions = read_csv(base / 'Combined_Codebook.csv')
    specs = {s['variable']: s for s in definitions}
    ivr_only = {'channel_used_c01': 1, 'ch01_channel': 1,
                'ch01_call_agent_contact': 0, 'ch01_staff_contact': 0,
                'ch01_used_ivr': 1, 'ch01_transferred': 1,
                'ch01_agent_promise_made': 1, 'ch01_urgency_need': 1}
    def asked(field, answers):
        expr = specs['ch01_' + field]['universe']
        check(' or ' not in expr.lower(), f'unsupported boundary OR expression {field}')
        conditions = re.findall(r'\b(ch\d\d_[A-Za-z0-9_]+|channel_used_c\d\d)\s*=\s*(\d+)\b', expr)
        check(bool(conditions), f'boundary route missing conditions {field}')
        return all(answers.get(name) == int(value) for name, value in conditions)
    skipped = ['wait_minutes', 'driver_assurance_knowledge', 'driver_empathy_understood',
               'driver_empathy_respect', 'agent_introduced', 'agent_polite',
               'preferred_language_assisted', 'queue_wait_csat5', 'agent_overall_csat5',
               'correct_person_first_transfer', 'agent_ownership5', 'agent_promise_made',
               'agent_promises_kept5', 'agent_patience5', 'urgency_need', 'agent_urgency5']
    for field in skipped:
        check(not asked(field, ivr_only), f'IVR-only must skip staff/live-agent item {field}')
    retained = ['total_call_time_csat5', 'used_ivr', 'ivr_csat5', 'ivr_clarity5',
                'ivr_availability5', 'ivr_response_speed5', 'ivr_information_accuracy5',
                'ivr_ease5', 'transferred', 'put_on_hold', 'callback_promised']
    for field in retained:
        check(asked(field, ivr_only), f'IVR-only retains call-wide or IVR item {field}')
    zero_wait = dict(ivr_only, ch01_call_agent_contact=1, ch01_staff_contact=1, ch01_wait_minutes=0)
    check(asked('queue_wait_csat5', zero_wait), 'zero queue wait must still permit queue satisfaction')
    rows = [{'company': 1, 'channel': 1, 'agent_promises_kept5': value, 'weight': weight}
            for value, weight in [(9, 100), (4, 2), (1, 1), (98, 50), (99, 50), (None, 20)]]
    expected = [{'wave': 1, 'dataset': 'Channel', 'company': 0, 'channel': 1,
                 'variable': 'agent_promises_kept5', 'statistic': stat,
                 'expected': value, 'numerator': numerator, 'weighted_base': 3,
                 'raw_base': 2, 'unit': unit}
                for stat, value, numerator, unit in [('mean5', 3, 9, 'mean'), ('t2b', 200 / 3, 2, 'percent')]]
    recalc_metrics(expected, {'Channel': rows}, 1)
    return {'ivr_only_route': 'passed', 'staff_or_agent_items_skipped': len(skipped),
            'call_wide_or_ivr_items_retained': len(retained),
            'zero_queue_wait_still_asks_satisfaction': True,
            'pending_9_excluded_from_mean_and_top_two_box': True,
            'delivered_data_modified': False}


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


def metadata_workbook_check(path, base, master=False):
    mappings = [('Combined variables' if master else 'Codebook', 'Combined_Codebook.csv', {'selected_value'}),
                ('Value labels' if master else 'Labels', 'Combined_Labels.csv', {'value'}),
                ('MR sets', 'Combined_MR_Sets.csv', {'selected_value'})]
    if master:
        mappings.extend([('Source map', 'reference/Source_to_Combined_Map.csv', {'channel'}),
                         ('Optional NC variables', 'supplemental_noncustomers/Noncustomer_Codebook.csv', {'selected_value'}),
                         ('Optional NC labels', 'supplemental_noncustomers/Noncustomer_Labels.csv', {'value'})])
    for sheet, relative, numeric in mappings:
        headers, rows = read_csv(base / relative)
        xlsx_csv_check(path, headers, rows, numeric, sheet)


def run(args):
    root = Path(args.pack).resolve()
    source = Path(args.source_separated).resolve() if args.source_separated else None
    schema = json.loads(Path(args.schema).read_text()) if args.schema else schema_from_standard_files(root)
    summary = {'status': 'passed', 'scope': 'Combined data, schema, route and reference-arithmetic checks. Not dashboard application acceptance.', 'xlsx_checked': args.xlsx, 'source_preservation_checked': bool(source), 'sectors': {}}
    if args.authoritative_zip:
        digest = hashlib.sha256(Path(args.authoritative_zip).read_bytes()).hexdigest()
        check(digest == '490de8e1a87ca8fa22086fc321c65197942e02a0c6d64547360349efe7a48523', 'authoritative ZIP hash')
        summary['authoritative_zip_sha256'] = digest
        if source:
            checked = 0
            with zipfile.ZipFile(args.authoritative_zip) as archive:
                for item in archive.infolist():
                    if item.is_dir():
                        continue
                    relative = item.filename
                    if relative.startswith('Banking_and_Telecoms_CSM_Separated/'):
                        relative = relative.split('/', 1)[1]
                    path = source / relative
                    check(path.exists() and path.read_bytes() == archive.read(item), f'source file differs from authoritative archive {relative}')
                    checked += 1
            summary['source_files_verified_against_archive'] = checked
    for sector, metadata in schema.items():
        if args.sector and sector != args.sector:
            continue
        base = root / sector
        company_fields = [s['variable'] for s in metadata['company_specs']]
        channel_fields = [s['variable'] for s in metadata['channel_specs']]
        channel_only = [k for k in channel_fields if k not in COMMON]
        wide_fields = company_fields + [f'ch{ch:02}_{k}' for ch in range(1, 5) for k in channel_only]
        wide_numeric = {s['variable'] for s in metadata['company_specs'] if s['data_type'] == 'numeric'} | {f'ch{ch:02}_{s["variable"]}' for ch in range(1, 5) for s in metadata['channel_specs'] if s['variable'] not in COMMON and s['data_type'] == 'numeric'}
        check(len(company_fields) == 100 and len(channel_fields) == 88 and len(wide_fields) == 400, f'wide field count {sector}')
        prefix = metadata['prefix']
        metadata_checks(base, metadata, source / sector if source else None)
        summary.setdefault('disposable_boundary_tests', {})[sector] = future_boundary_checks(base)
        expected = exported_reference_metrics(base, wide_fields, source / sector if source else None)
        waves = []
        all_wide = []
        for wave in range(1, 4):
            csv_path = locate(base, f'{prefix}_CSM_Combined_Wave_{wave}.csv')
            fields, wide = read_csv(csv_path)
            all_wide.extend(wide)
            check(fields == wide_fields, f'wide schema {sector} {wave}')
            unique(wide, ['wave', 'respondent_id'], f'wide keys {sector} {wave}')
            rel_raw = [{k: r[k] for k in company_fields} for r in wide]
            channels_raw = []
            blank_cells = 0
            for r in wide:
                for ch in range(1, 5):
                    pref = f'ch{ch:02}_'
                    if r[f'channel_used_c{ch:02}'] == '0':
                        check(all(r[pref + k] == '' for k in channel_only), f'unused channel not blank {sector} {wave} {r["respondent_id"]} {ch}')
                        blank_cells += len(channel_only)
                    else:
                        e = {k: r[k] if k in COMMON else r[pref + k] for k in channel_fields}
                        check(number(e['channel']) == ch, f'prefix channel code {sector} {wave} {r["respondent_id"]} {ch}')
                        channels_raw.append(e)
            nc_fields, nc_raw = read_csv(locate(base, f'{prefix}_CSM_Noncustomer_Wave_{wave}.csv'))
            check(nc_fields == [s['variable'] for s in metadata['noncustomer_specs']], f'noncustomer schema {sector} {wave}')
            rel = typed(rel_raw, metadata['company_specs'])
            channels = typed(channels_raw, metadata['channel_specs'])
            nc = typed(nc_raw, metadata['noncustomer_specs'])
            route_checks(rel, channels, nc, metadata, wave)
            metrics = recalc_metrics(expected, {'Relationship': rel, 'Channel': channels, 'Noncustomer': nc}, wave)
            if args.xlsx:
                xlsx_path = locate(base, f'{prefix}_CSM_Combined_Wave_{wave}.xlsx')
                xlsx_csv_check(xlsx_path, fields, wide, wide_numeric)
                metadata_workbook_check(xlsx_path, base)
                nc_numeric = {s['variable'] for s in metadata['noncustomer_specs'] if s['data_type'] == 'numeric'}
                xlsx_csv_check(locate(base, f'{prefix}_CSM_Noncustomer_Wave_{wave}.xlsx'), nc_fields, nc_raw, nc_numeric)
            if source:
                for ds, rows, specs, keys in [('Relationship', rel_raw, metadata['company_specs'], ['wave', 'respondent_id']), ('Channel', channels_raw, metadata['channel_specs'], ['wave', 'respondent_id', 'channel']), ('Noncustomer', nc_raw, metadata['noncustomer_specs'], ['wave', 'respondent_id'])]:
                    s_fields, old = read_csv(source / sector / f'test-reference/{prefix}_CSM_{ds}_Wave_{wave}.csv')
                    check(set(s_fields) <= {s['variable'] for s in specs}, f'original source schema retained {sector} {ds} {wave}')
                    original = unique(old, keys, f'source {sector} {ds} {wave}')
                    new = unique(rows, keys, f'output {sector} {ds} {wave}')
                    check(set(original) == set(new), f'source record keys {sector} {ds} {wave}')
                    numeric = {s['variable'] for s in specs if s['data_type'] == 'numeric'}
                    if args.xlsx and ds in ['Relationship', 'Channel']:
                        xlsx_csv_check(source / sector / f'{prefix}_CSM_{ds}_Wave_{wave}.xlsx', s_fields, old, numeric)
                    for key in original:
                        for field in s_fields:
                            check(scalar_equal(original[key][field], new[key][field], field in numeric), f'source value {sector} {ds} {wave} {key} {field}')
                            COUNT['source_values_compared'] += 1
                    if ds == 'Noncustomer' and args.xlsx:
                        p1 = source / sector / f'{prefix}_CSM_Noncustomer_Wave_{wave}.xlsx'
                        p2 = locate(base, p1.name)
                        check(p1.read_bytes() == p2.read_bytes(), f'noncustomer workbook altered {sector} {wave}')
                p1 = source / sector / '01_Noncustomer_Expectations_Questionnaire.docx'
                p2 = locate(base, p1.name)
                check(p1.read_bytes() == p2.read_bytes(), f'noncustomer questionnaire altered {sector}')
            special_codes = {f: {str(code): sum(r[f] == code for r in channels) for code in [9, 98, 99]} for f in NEW_CALL_FIELDS}
            waves.append({'wave': wave, 'customer_rows': len(rel), 'columns': len(fields), 'channel_blocks_populated': len(channels), 'channel_counts': dict(sorted(Counter(int(r['channel']) for r in channels).items())), 'no_channel_customers': sum(int(r['channel_none']) for r in rel), 'unused_channel_cells_blank': blank_cells, 'noncustomer_rows': len(nc), 'weight_sum': math.fsum(r['weight'] for r in rel), 'reference_metrics_recalculated': metrics, 'new_diagnostic_special_codes': special_codes})
        summary['sectors'][sector] = waves
        pooled_csv = locate(base, f'{prefix}_CSM_Combined_All_Waves.csv')
        pooled_fields, pooled = read_csv(pooled_csv)
        check(pooled_fields == wide_fields, f'pooled schema {sector}')
        check(pooled == all_wide, f'pooled file exact wave concatenation {sector}')
        check(len(pooled) == 3000, f'pooled row count {sector}')
        unique(pooled, ['wave', 'respondent_id'], f'pooled key {sector}')
        check(Counter(r['wave'] for r in pooled) == {'1': 1000, '2': 1000, '3': 1000}, f'pooled wave counts {sector}')
        for wave in range(1, 4):
            pooled_weight = sum(number(r['weight']) for r in pooled if int(r['wave']) == wave)
            separate_weight = sum(number(r['weight']) for r in all_wide if int(r['wave']) == wave)
            check(pooled_weight == separate_weight, f'pooled weight preservation {sector} {wave}')
        if args.xlsx:
            pooled_xlsx = locate(base, f'{prefix}_CSM_Combined_All_Waves.xlsx')
            xlsx_csv_check(pooled_xlsx, pooled_fields, pooled, wide_numeric)
            metadata_workbook_check(pooled_xlsx, base)
            metadata_workbook_check(base / 'Master_Combined_CSM_Codebook.xlsx', base, True)
            ref_headers, ref_rows = read_csv(base / 'reference/Reference_Metrics.csv')
            xlsx_csv_check(base / 'CSM_Combined_Reference_Metrics.xlsx', ref_headers, ref_rows,
                           {'wave', 'company', 'channel', 'expected', 'numerator', 'weighted_base', 'raw_base'}, 'Reference metrics')
        summary.setdefault('pooled', {})[sector] = {'rows': len(pooled), 'columns': len(pooled_fields), 'exact_wave_concatenation': True, 'wave_weights_preserved': True}
    summary['checks'] = dict(COUNT)
    if args.report:
        Path(args.report).write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pack', help='Root Banking_and_Telecoms_CSM_Combined folder')
    parser.add_argument('--source-separated', help='Optional original separated pack for exact source preservation checks')
    parser.add_argument('--schema', help='Optional source-schema fixture; default reads ordinary CSV codebooks and labels')
    parser.add_argument('--authoritative-zip', help='Optional original ZIP whose SHA256 is checked')
    parser.add_argument('--xlsx', action='store_true', help='Check XLSX with read-only openpyxl as well as CSV')
    parser.add_argument('--sector', choices=['banking', 'mobile'], help='Check only one sector; default checks both')
    parser.add_argument('--report', help='Write JSON result to this path')
    run(parser.parse_args())
