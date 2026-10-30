"""Approved synthetic testing additions. Never changes an existing source value."""
import random,hashlib

EMOTION={1:'Not at all',2:'A little',3:'Moderately',4:'Very',5:'Extremely',99:'Do not know'}
CSAT={1:'Very dissatisfied',2:'Dissatisfied',3:'Neither satisfied nor dissatisfied',4:'Satisfied',5:'Very satisfied',99:'Do not know'}
AGREE={1:'Strongly disagree',2:'Disagree',3:'Neither agree nor disagree',4:'Agree',5:'Strongly agree',98:'Not applicable',99:'Do not know'}
PERF={1:'Very poor',2:'Poor',3:'Adequate',4:'Good',5:'Excellent',98:'Not applicable',99:'Do not know'}
BINARY={0:'No',1:'Yes',99:'Do not know'}
COMPANY=[('journey_angry5','Anchored journey left customer angry','J7f','journey_recent30=1',EMOTION),('journey_disappointed5','Anchored journey left customer disappointed','J7g','journey_recent30=1',EMOTION)]
CHANNEL=[
 ('channel_angry5','This latest channel experience left customer angry','E8f','All records',EMOTION),
 ('channel_disappointed5','This latest channel experience left customer disappointed','E8g','All records',EMOTION),
 ('call_agent_contact','Spoke with a live agent during this call','Q7a','channel=1',BINARY),
 ('queue_wait_csat5','Satisfaction with wait to speak to a live agent including no wait','Q7b','channel=1 and call_agent_contact=1',CSAT),
 ('total_call_time_csat5','Satisfaction with total duration of this call','Q7c','channel=1',CSAT),
 ('agent_overall_csat5','Overall satisfaction with the live agent on this call','Q7d','channel=1 and call_agent_contact=1',CSAT),
 ('correct_person_first_transfer','Reached the right person on the first transfer','Q7e','channel=1 and call_agent_contact=1 and transferred=1',BINARY),
 ('agent_ownership5','The agent took ownership of helping resolve the need','Q8a','channel=1 and call_agent_contact=1',AGREE),
 ('agent_promise_made','Agent made a specific promise about something to happen after the call','Q8b','channel=1 and call_agent_contact=1',BINARY),
 ('agent_promises_kept5','The agent kept the promises that were due by now','Q8c','channel=1 and call_agent_contact=1 and agent_promise_made=1',{**AGREE,9:'Not yet due or too early to tell'}),
 ('agent_patience5','The agent was patient with me','Q8d','channel=1 and call_agent_contact=1',AGREE),
 ('urgency_need','Told the agent that the need was urgent','Q8e','channel=1 and call_agent_contact=1',BINARY),
 ('agent_urgency5','The agent responded appropriately to the urgency of my need','Q8f','channel=1 and call_agent_contact=1 and urgency_need=1',AGREE),
 ('ivr_availability5','Availability of the automated telephone service when needed','Q9a','channel=1 and used_ivr=1',PERF),
 ('ivr_response_speed5','Speed of the automated telephone service responses','Q9b','channel=1 and used_ivr=1',PERF),
 ('ivr_information_accuracy5','Accuracy of information supplied by the automated telephone service','Q9c','channel=1 and used_ivr=1',PERF),
 ('ivr_ease5','Ease of using the automated telephone service','Q9d','channel=1 and used_ivr=1',PERF),
]
def extend_meta(meta):
    for section,defs in [('company',COMPANY),('channel',CHANNEL)]:
        for var,label,q,universe,labels in defs:
            meta[section+'_specs'].append({'variable':var,'label':label,'question':q,'data_type':'numeric','question_type':'categorical','universe':universe,'mr_set':'','selected_value':None,'derivation':'','unit':'code'})
            meta[section+'_labels'].extend([[var,label,code,text] for code,text in labels.items()])
    return meta
def rng(sector,row,channel=0):
    key=f'combined_csm_testing_20261030_v1|{sector}|{row["wave"]}|{row["respondent_id"]}|{channel}'
    return random.Random(int.from_bytes(hashlib.sha256(key.encode()).digest()[:16],'big'))
def score(r,base=3,miss=True):
    if miss and r.random()<0.015:return 99
    if base not in [1,2,3,4,5]:base=3
    return max(1,min(5,int(round(base+r.choices([-2,-1,0,1,2],[3,19,50,24,4])[0]))))
def expand_company(sector,row):
    r=rng(sector,row)
    row['journey_angry5']=None;row['journey_disappointed5']=None
    if row['journey_recent30']==1:
        base=row['journey_frustrated5']
        row['journey_angry5']=score(r,base if base==99 else max(1,base-1))
        sat=row['journey_csat5'];row['journey_disappointed5']=score(r,6-sat if sat in range(1,6) else 3)
    return row
def expand_channel(sector,row):
    r=rng(sector,row,row['channel'])
    for var,*_ in CHANNEL:row[var]=None
    f=row['channel_frustrated5'];sat=row['channel_csat5']
    row['channel_angry5']=score(r,f if f==99 else max(1,f-1))
    row['channel_disappointed5']=score(r,6-sat if sat in range(1,6) else 3)
    if row['channel']!=1:return row
    # Source staff_contact is positive for every existing call; preserve that fact.
    assert row['staff_contact']==1
    row['call_agent_contact']=1
    row['queue_wait_csat5']=score(r,5-min(4,int(row['wait_minutes']/5)))
    row['total_call_time_csat5']=score(r,sat)
    row['agent_overall_csat5']=score(r,sat)
    if row['transferred']==1:
        row['correct_person_first_transfer']=1 if r.random()<(0.88 if row['number_transfers']==1 else 0.35) else 0
    row['agent_ownership5']=score(r,row['driver_reliable_correct'])
    row['agent_patience5']=score(r,row['driver_empathy_respect'])
    row['agent_promise_made']=1 if row['callback_promised']==1 or r.random()<0.32 else 0
    if row['agent_promise_made']==1:
        out=row['callback_outcome']
        if out==9:row['agent_promises_kept5']=9
        elif out in [1,2,3]:row['agent_promises_kept5']=score(r,{1:5,2:3,3:1}[out],False)
        elif r.random()<0.15:row['agent_promises_kept5']=9
        else:row['agent_promises_kept5']=score(r,sat)
    row['urgency_need']=int(r.random()<(0.62 if row['problem_present']==1 else 0.20))
    if row['urgency_need']==1:row['agent_urgency5']=98 if r.random()<0.02 else score(r,sat)
    if row['used_ivr']==1:
        for var in ['ivr_availability5','ivr_response_speed5','ivr_information_accuracy5','ivr_ease5']:
            row[var]=98 if r.random()<0.025 else score(r,row['ivr_clarity5'])
    return row
def new_metrics(meta,wave,company,channels):
    result=[]
    for dataset,rows,defs in [('Relationship',company,COMPANY),('Channel',channels,CHANNEL)]:
        for co in [0]+list(range(1,len(meta['brands'])+1)):
            for ch in ([0] if dataset=='Relationship' else [1,2,3,4]):
                base=[r for r in rows if (co==0 or r['company']==co) and (ch==0 or r['channel']==ch)]
                for var,label,q,univ,labels in defs:
                    if dataset=='Channel' and var not in ['channel_angry5','channel_disappointed5'] and ch!=1:continue
                    stats=['yes'] if labels==BINARY else ['mean5','t2b']
                    for stat in stats:
                        valid=[r for r in base if r[var] in ([0,1] if stat=='yes' else [1,2,3,4,5])]
                        den=sum(r['weight'] for r in valid)
                        num=sum(r['weight']*(r[var] if stat=='mean5' else int(r[var]>=4) if stat=='t2b' else r[var]) for r in valid)
                        result.append({'wave':wave,'dataset':dataset,'company':co,'channel':ch,'variable':var,'statistic':stat,'expected':(num/den*(1 if stat=='mean5' else 100)) if den else None,'numerator':num,'weighted_base':den,'raw_base':len(valid),'unit':'scale points' if stat=='mean5' else 'percent'})
    return result
